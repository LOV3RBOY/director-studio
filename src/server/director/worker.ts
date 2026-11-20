import { assetsOfJobs, saveAsset } from "../assets";
import { all, run, tx } from "../db";
import { ApiError, notFound } from "../errors";
import { inspectAsset } from "./compiler";
import { buildExport, pollMuapi, prepareMuapi, RenderPending, RenderReview, submitMuapi } from "./delivery";
import { evidenceFrame, extractEvidence, mockVideo, sampleWindow } from "./media";
import { directChat, directProject, mode, studyStyle } from "./runtime";
import { addStyleVersion, currentPack, finish, projectProfile, projectRow, reject, snapshot, styleRow, writePack, type JobRow } from "./store";

const interval = 900;
const shared = globalThis as typeof globalThis & {
  directorWorker?: { owner: symbol; timer?: NodeJS.Timeout; running: Set<string> };
};
const instance = Symbol("director worker");
const review = (row: JobRow, message: string) => run(
  "UPDATE director_jobs SET state = 'review', error = ?, updated_at = ? WHERE id = ?",
  JSON.stringify({ code: "render_requires_review", message }), Date.now(), row.id,
);

export function ensureDirectorWorker() {
  const current = mode();
  if (!current || shared.directorWorker?.owner === instance) return;
  if (shared.directorWorker?.timer) clearInterval(shared.directorWorker.timer);
  if (!shared.directorWorker) {
    tx(() => {
      run("UPDATE director_jobs SET state = 'queued', next_run = ? WHERE mode = ? AND state = 'running' AND (mode = 'mock' OR kind IN ('export', 'render'))", Date.now(), current);
      run("UPDATE director_jobs SET state = 'failed', error = ?, updated_at = ? WHERE mode = 'live' AND state = 'running' AND kind IN ('analysis', 'plan', 'chat') AND mode = ?",
        JSON.stringify({ code: "authoring_interrupted", message: "The server restarted during authoring. Review the result, then retry if needed." }), Date.now(), current);
      run("UPDATE director_jobs SET state = 'review', error = ?, updated_at = ? WHERE mode = ? AND kind = 'render' AND state = 'submitting'",
        JSON.stringify({ code: "render_requires_review", message: "The server restarted during submission. Confirm the provider's acceptance before retrying." }), Date.now(), current);
    });
  }
  const state = { owner: instance, running: shared.directorWorker?.running ?? new Set<string>(), timer: undefined as NodeJS.Timeout | undefined };
  shared.directorWorker = state;
  const tick = () => {
    try {
      if (state.running.size >= 3) return;
      const due = all<JobRow>("SELECT * FROM director_jobs WHERE mode = ? AND state IN ('queued', 'polling') AND next_run <= ? ORDER BY next_run LIMIT 20", current, Date.now());
      for (const row of due) {
        if (state.running.size >= 3) break;
        if (state.running.has(row.id)) continue;
        if (row.state === "queued" && !run("UPDATE director_jobs SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'", Date.now(), row.id).changes) continue;
        state.running.add(row.id);
        void perform(row).catch((error: unknown) => {
          try {
            handleFailure(row, error);
          } catch {
            console.error("[director] Could not persist job failure.", row.id);
          }
        }).finally(() => state.running.delete(row.id));
      }
    } catch {
      console.error("[director] Could not read the durable job queue.");
    }
  };
  state.timer = setInterval(tick, interval);
  state.timer.unref();
  tick();
}

function handleFailure(row: JobRow, error: unknown) {
  if (error instanceof RenderPending) {
    if (Date.now() - row.updated_at < 45 * 60_000) {
      run("UPDATE director_jobs SET next_run = ? WHERE id = ?", Date.now() + 5_000, row.id);
    } else {
      review(row, "MuAPI is taking longer than expected. Check the provider request before retrying.");
    }
  } else if (error instanceof RenderReview || (row.state === "polling" && row.mode === "live")) {
    review(row, error instanceof RenderReview ? error.message : "The provider accepted this render but the take could not be stored. Check the provider request.");
  } else {
    reject(row, error instanceof ApiError
      ? { code: error.code, message: error.message }
      : { code: "director_job_failed", message: "The Director could not complete this job. Check the media or service configuration and retry." });
  }
}

async function perform(row: JobRow) {
  const input = JSON.parse(row.input);
  if (row.kind === "analysis") {
    const style = styleRow(row.user_id, input.styleId, row.mode);
    const asset = inspectAsset(row.user_id, style.asset_id);
    const evidence = await extractEvidence(asset);
    const profile = await studyStyle({
      mode: row.mode, id: row.id, notes: style.notes, evidence,
      frames: () => Promise.all(evidence.frames.map((frame) => evidenceFrame(asset, evidence, frame.ordinal))),
      window: (seconds) => sampleWindow(asset, evidence, seconds),
    });
    tx(() => {
      const version = addStyleVersion(row.user_id, style.id, profile, false);
      finish(row, { styleId: style.id, versionId: version.id, usage: profile.provenance.usage });
    });
    return;
  }
  if (!row.project_id) throw notFound();
  const project = projectRow(row.user_id, row.project_id, row.mode);
  if (row.kind === "plan") {
    const style = projectProfile(row.user_id, project);
    const draft = await directProject(project.request, style.profile, row.mode);
    tx(() => {
      const pack = writePack(row.user_id, project.id, draft.plan, { model: project.request.model, resolution: "720p" }, null);
      finish(row, { snapshotId: pack.id, model: draft.model, usage: draft.usage });
    });
    return;
  }
  if (row.kind === "chat") {
    const current = currentPack(row.user_id, project.id);
    const style = projectProfile(row.user_id, project);
    const history = all<Pick<JobRow, "input" | "result">>(
      "SELECT input, result FROM director_jobs WHERE project_id = ? AND user_id = ? AND mode = ? AND kind = 'chat' AND state = 'succeeded' ORDER BY rowid DESC LIMIT 5",
      project.id, row.user_id, row.mode,
    ).reverse().map((turn) => ({ message: JSON.parse(turn.input).message as string, reply: JSON.parse(turn.result!).reply as string }));
    const result = await directChat({
      mode: row.mode, message: input.message, brief: project.request,
      guide: style.profile.guide, rules: style.profile.rules,
      current: current?.body.plan ?? null, history,
    });
    tx(() => {
      const edited = result.edits && current ? writePack(row.user_id, project.id, result.edits, current.body.settings, current.id) : null;
      finish(row, { reply: result.reply, snapshotId: edited?.id, model: result.model, usage: result.usage });
    });
    return;
  }
  if (!row.snapshot_id) throw notFound();
  const { pack } = snapshot(row.user_id, row.snapshot_id);
  if (row.kind === "export") {
    const style = projectProfile(row.user_id, project);
    await buildExport(row, pack, project.request, { title: style.title, version: style.version });
    finish(row, { filename: `director-${pack.projectId}-v${pack.version}.zip`, url: `/api/director/jobs/${row.id}/file` });
    return;
  }
  const clip = pack.body.clips[input.clip];
  if (!clip) throw notFound();
  const saved = assetsOfJobs([row.id]).get(row.id)?.[0];
  if (saved) {
    finish(row, { assetId: saved.id, url: `/api/assets/${saved.id}/file`, duration: saved.duration, estimatedUsd: input.quotedUsd });
    return;
  }
  if (row.mode === "live" && row.state !== "polling") {
    const prepared = await prepareMuapi(row, pack, project.request, input.clip);
    run("UPDATE director_jobs SET state = 'submitting', updated_at = ? WHERE id = ?", Date.now(), row.id);
    const requestId = await submitMuapi(prepared);
    try {
      run("UPDATE director_jobs SET state = 'polling', provider_id = ?, next_run = ?, updated_at = ? WHERE id = ?", requestId, Date.now() + 2_000, Date.now(), row.id);
    } catch {
      throw new RenderReview("MuAPI accepted the render but its request ID could not be saved. Verify the provider before retrying.");
    }
    return;
  }
  const [horizontal, vertical] = project.request.aspect.split(":").map(Number);
  const rendered = row.mode === "mock"
    ? { bytes: await mockVideo(row.user_id, horizontal * 24, vertical * 24, clip.duration), providerCost: null }
    : await pollMuapi(row);
  const asset = await saveAsset({
    userId: row.user_id, bytes: rendered.bytes, source: "generated", accept: ["video"], jobId: row.id,
    title: `${row.mode === "mock" ? "Fixture · " : ""}Clip ${input.clip + 1} · Pack v${pack.version}`, prompt: clip.prompt,
    modelId: pack.body.settings.model, params: { fixture: row.mode === "mock", packId: pack.id, clip: input.clip },
  });
  finish(row, {
    assetId: asset.id, url: `/api/assets/${asset.id}/file`, duration: asset.duration,
    estimatedUsd: input.quotedUsd, providerCost: rendered.providerCost,
  });
}
