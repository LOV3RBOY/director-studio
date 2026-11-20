import type { output } from "zod";
import { balance, hold, release, settle } from "../credits";
import { all, get, newId, run, tx } from "../db";
import { ApiError, badRequest, notFound } from "../errors";
import { createElement, createProject, createShot, ownedProject, scenesOf, toProject } from "../cinema/store";
import { compilePack, inspectAsset, type PackBody } from "./compiler";
import { requireAuthoringEntitlement } from "./commerce";
import { reusableStyleRules, type Brief, type Guidance, type learnInput, type Plan, type Settings, type StyleProfile, verifyGuidance } from "./contracts";
import { materializeStyleKit } from "./media";
import { directorMode, hermesConfig, type DirectorMode } from "./runtime";

export interface StyleRow {
  id: string; user_id: string; asset_id: string; mode: DirectorMode; title: string; notes: string; created_at: number;
}
interface VersionRow {
  id: string; user_id: string; style_id: string; version: number; saved: number; profile: string; created_at: number;
}
interface ProjectRow {
  id: string; user_id: string; style_version_id: string; mode: DirectorMode; brief: string; created_at: number;
}
interface PackRow {
  id: string; user_id: string; project_id: string; version: number; body: string; created_at: number;
}
type Kind = "analysis" | "plan" | "chat" | "export" | "render";
type State = "queued" | "running" | "submitting" | "polling" | "review" | "succeeded" | "failed";
type ErrorDetail = { code: string; message: string };
export interface JobRow {
  id: string; user_id: string; kind: Kind; mode: DirectorMode; state: State; project_id: string | null;
  snapshot_id: string | null; request_key: string | null; input: string; result: string | null;
  provider_id: string | null; error: string | null; reserved: number; spent: number; released: number;
  next_run: number; created_at: number; updated_at: number;
}

function requireRow<T>(value: T | undefined): T {
  if (!value) throw notFound();
  return value;
}

export function styleRow(userId: string, id: string, mode = directorMode()) {
  return requireRow(get<StyleRow>("SELECT * FROM director_styles WHERE user_id = ? AND id = ? AND mode = ?", userId, id, mode));
}

function styleVersion(userId: string, versionId: string, mode = directorMode()) {
  return requireRow(get<VersionRow>(
    "SELECT v.* FROM director_style_versions v JOIN director_styles s ON v.style_id = s.id WHERE v.user_id = ? AND v.id = ? AND s.mode = ?",
    userId, versionId, mode,
  ));
}
const profileOf = (row: VersionRow): StyleProfile => JSON.parse(row.profile);
const toVersion = (row: VersionRow) => ({ id: row.id, version: row.version, saved: Boolean(row.saved), profile: profileOf(row), createdAt: row.created_at });

export function listStyles(userId: string) {
  return all<StyleRow>("SELECT * FROM director_styles WHERE user_id = ? AND mode = ? ORDER BY created_at DESC LIMIT 100", userId, directorMode()).map((style) => {
    const latest = get<VersionRow>("SELECT * FROM director_style_versions WHERE user_id = ? AND style_id = ? ORDER BY version DESC LIMIT 1", userId, style.id);
    return { id: style.id, title: style.title, notes: style.notes, assetId: style.asset_id, latest: latest ? toVersion(latest) : null };
  });
}

export function styleDetail(userId: string, id: string) {
  const style = styleRow(userId, id);
  const versions = all<VersionRow>("SELECT * FROM director_style_versions WHERE user_id = ? AND style_id = ? ORDER BY version DESC", userId, id);
  const analysis = all<JobRow>("SELECT * FROM director_jobs WHERE user_id = ? AND mode = ? AND kind = 'analysis' AND json_extract(input, '$.styleId') = ? ORDER BY rowid DESC LIMIT 20", userId, style.mode, id);
  return { id, title: style.title, notes: style.notes, assetId: style.asset_id, versions: versions.map(toVersion), analysis: analysis.map(toJob) };
}

export function evidenceFor(userId: string, styleId: string, versionId: string, ordinal: number) {
  const style = styleRow(userId, styleId);
  const row = styleVersion(userId, versionId, style.mode);
  if (row.style_id !== style.id) throw notFound();
  const { evidence } = profileOf(row);
  const frame = evidence.frames.find((item) => item.ordinal === ordinal);
  if (!frame) throw notFound();
  const source = evidence.sources?.[frame.source ?? 0]?.assetId ?? evidence.assetId;
  return { asset: inspectAsset(userId, source), evidence };
}

export function addStyleVersion(userId: string, styleId: string, profile: StyleProfile, saved: boolean) {
  return tx(() => {
    const version = (get<{ version: number }>("SELECT MAX(version) AS version FROM director_style_versions WHERE user_id = ? AND style_id = ?", userId, styleId)?.version ?? 0) + 1;
    const id = newId("dsv");
    run("INSERT INTO director_style_versions VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, styleId, version, Number(saved), JSON.stringify(profile), Date.now());
    return toVersion(requireRow(get<VersionRow>("SELECT * FROM director_style_versions WHERE id = ?", id)));
  });
}

export async function saveStyle(userId: string, id: string, input: { previousId: string; guide: string; rules?: Guidance["rules"] }) {
  const style = styleRow(userId, id);
  const previous = styleVersion(userId, input.previousId, style.mode);
  if (previous.style_id !== style.id) throw notFound();
  const requireLatest = () => {
    const latest = get<VersionRow>("SELECT * FROM director_style_versions WHERE user_id = ? AND style_id = ? ORDER BY version DESC LIMIT 1", userId, id);
    if (latest?.id !== previous.id) throw new ApiError(409, "version_conflict", "Reload the latest style guide before saving.");
  };
  requireLatest();
  const profile = profileOf(previous);
  const edits = verifyGuidance({ guide: input.guide, rules: input.rules ?? profile.rules }, profile.evidence);
  const save = (kit = profile.kit) => tx(() => {
    requireLatest();
    return addStyleVersion(userId, id, { ...profile, ...edits, ...(kit ? { kit } : {}) }, true);
  });
  return profile.exemplars && !profile.kit ? materializeStyleKit(userId, profile, save) : save();
}

export function projectRow(userId: string, id: string, mode = directorMode()) {
  const row = requireRow(get<ProjectRow>("SELECT * FROM director_projects WHERE user_id = ? AND id = ? AND mode = ?", userId, id, mode));
  return { ...row, request: JSON.parse(row.brief) as Brief };
}

export function projectProfile(userId: string, project: ReturnType<typeof projectRow>) {
  const version = styleVersion(userId, project.style_version_id, project.mode);
  const style = styleRow(userId, version.style_id, project.mode);
  return { styleId: style.id, title: style.title, ...toVersion(version) };
}

export function listProjects(userId: string) {
  return all<ProjectRow>("SELECT * FROM director_projects WHERE user_id = ? AND mode = ? ORDER BY created_at DESC LIMIT 100", userId, directorMode())
    .map((row) => ({ id: row.id, title: ownedProject(userId, row.id).title, createdAt: row.created_at }));
}

const toPack = (row: PackRow) => ({ id: row.id, projectId: row.project_id, version: row.version, createdAt: row.created_at, body: JSON.parse(row.body) as PackBody });
export type Snapshot = ReturnType<typeof toPack>;

export function currentPack(userId: string, projectId: string): Snapshot | null {
  const row = get<PackRow>("SELECT * FROM director_packs WHERE user_id = ? AND project_id = ? ORDER BY version DESC LIMIT 1", userId, projectId);
  return row ? toPack(row) : null;
}

export function snapshot(userId: string, id: string) {
  const row = requireRow(get<PackRow>("SELECT * FROM director_packs WHERE user_id = ? AND id = ?", userId, id));
  const project = projectRow(userId, row.project_id);
  return { project, pack: toPack(row) };
}

export function projectDetail(userId: string, id: string) {
  const project = projectRow(userId, id);
  const jobs = all<JobRow>("SELECT * FROM director_jobs WHERE user_id = ? AND project_id = ? AND mode = ? ORDER BY rowid DESC LIMIT 100", userId, id, project.mode);
  const versions = all<Pick<PackRow, "id" | "version" | "created_at">>("SELECT id, version, created_at FROM director_packs WHERE user_id = ? AND project_id = ? ORDER BY version DESC", userId, id);
  const pack = currentPack(userId, id);
  return {
    project: toProject(ownedProject(userId, id)), brief: project.request, pinnedStyle: projectProfile(userId, project),
    pack, reviewedAt: pack ? packReviewTime(pack.id) : null, versions, jobs: jobs.map(toJob),
  };
}

function packReviewTime(snapshotId: string) {
  return get<{ reviewed_at: number }>("SELECT reviewed_at FROM director_pack_reviews WHERE snapshot_id = ?", snapshotId)?.reviewed_at ?? null;
}

export function markPackReviewed(userId: string, snapshotId: string) {
  return tx(() => {
    const { project } = snapshot(userId, snapshotId);
    if (currentPack(userId, project.id)?.id !== snapshotId) {
      throw new ApiError(409, "version_conflict", "Open the current pack to record a review.");
    }
    run("INSERT INTO director_pack_reviews VALUES (?, ?) ON CONFLICT(snapshot_id) DO NOTHING", snapshotId, Date.now());
    return { reviewedAt: packReviewTime(snapshotId) };
  });
}

export function writePack(userId: string, projectId: string, plan: Plan, settings: Settings, expectedId: string | null) {
  return tx(() => {
    const project = projectRow(userId, projectId);
    const existing = currentPack(userId, projectId);
    if ((existing?.id ?? null) !== expectedId) throw new ApiError(409, "version_conflict", "Reload the latest pack before applying edits.");
    const { profile } = projectProfile(userId, project);
    const rules = new Set(reusableStyleRules(profile.rules).map(({ index }) => index));
    for (const clip of plan.clips) {
      for (const shot of clip.shots) {
        const citations = shot.styleRuleIndices ?? [];
        if (new Set(citations).size !== citations.length || citations.some((index) => !rules.has(index))) {
          throw badRequest("A shot cites a duplicate or inapplicable rule from the pinned style guide.");
        }
      }
    }
    const pack = compilePack(userId, project.request, plan, settings, profile);
    // Preserve the opt-out for edits without adding it to the compiler's renderer output.
    if (settings.styleRefs === false) pack.settings.styleRefs = false;
    const version = (existing?.version ?? 0) + 1;
    const id = newId("dpk");
    run("INSERT INTO director_packs VALUES (?, ?, ?, ?, ?, ?)", id, userId, projectId, version, JSON.stringify(pack), Date.now());
    if (!existing) {
      const scene = scenesOf(projectId)[0];
      const castIds = all<{ id: string }>("SELECT id FROM cinema_elements WHERE user_id = ? AND project_id = ? AND kind = 'character'", userId, projectId).map((row) => row.id);
      for (const clip of plan.clips) {
        createShot(userId, scene.id, {
          duration: (clip.endMs - clip.startMs) / 1000,
          action: clip.shots.map((shot) => shot.action).join("\n").slice(0, 2000),
          sound: clip.shots.map((shot) => shot.sound).join("\n").slice(0, 1000),
          castIds,
        });
      }
    }
    return toPack(requireRow(get<PackRow>("SELECT * FROM director_packs WHERE id = ?", id)));
  });
}

export function toJob(row: JobRow) {
  const input = JSON.parse(row.input);
  return {
    id: row.id, kind: row.kind, state: row.state, fixture: row.mode === "mock", projectId: row.project_id, snapshotId: row.snapshot_id,
    clip: row.kind === "render" ? input.clip : null, message: row.kind === "chat" ? input.message : null,
    result: row.result ? JSON.parse(row.result) : null, providerRequestId: row.provider_id,
    error: row.error ? JSON.parse(row.error) as ErrorDetail : null,
    credits: { reserved: row.reserved, spent: row.spent, released: row.released }, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function ownedJob(userId: string, id: string) {
  return requireRow(get<JobRow>("SELECT * FROM director_jobs WHERE id = ? AND user_id = ? AND mode = ?", id, userId, directorMode()));
}

export function replay(userId: string, kind: Kind, key: string) {
  return get<JobRow>("SELECT * FROM director_jobs WHERE user_id = ? AND mode = ? AND kind = ? AND request_key = ?", userId, directorMode(), kind, key);
}

export function queue(input: {
  userId: string; kind: Kind; body: Record<string, unknown>; projectId?: string; snapshotId?: string; requestKey?: string; reserve?: number;
}) {
  const mode = directorMode();
  return tx(() => {
    if (input.requestKey) {
      const replayed = replay(input.userId, input.kind, input.requestKey);
      if (replayed) return replayed;
    }
    const count = get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM director_jobs WHERE user_id = ? AND mode = ? AND state IN ('queued', 'running', 'submitting', 'polling')",
      input.userId, mode,
    )!.n;
    if (count >= 4) throw new ApiError(429, "too_many_jobs", "Wait for one of the four Director jobs to finish.");
    if (mode === "live" && ["analysis", "plan", "chat"].includes(input.kind)) {
      requireAuthoringEntitlement(input.userId);
      hermesConfig();
      const limit = Number(process.env.DIRECTOR_DAILY_AUTHORING_JOBS);
      const recent = get<{ n: number }>("SELECT COUNT(*) AS n FROM director_jobs WHERE mode = 'live' AND kind IN ('analysis', 'plan', 'chat') AND created_at > ?", Date.now() - 86_400_000)!.n;
      if (!Number.isSafeInteger(limit) || recent >= limit) {
        throw new ApiError(503, "director_authoring_limit", "Director authoring is paused by the server's daily limit.");
      }
    }
    const reserve = input.reserve ?? 0;
    if (reserve > balance(input.userId)) throw new ApiError(402, "insufficient_credits", "There are insufficient credits for this attempt.");
    const id = newId("djb");
    const now = Date.now();
    run(
      `INSERT INTO director_jobs (id, user_id, kind, mode, state, project_id, snapshot_id, request_key, input, reserved, next_run, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.userId, input.kind, mode, input.projectId ?? null, input.snapshotId ?? null,
      input.requestKey ?? null, JSON.stringify(input.body), reserve, now, now, now,
    );
    if (reserve) hold(input.userId, id, reserve, "Director Seedance render");
    return ownedJob(input.userId, id);
  });
}

export function styleAssets(userId: string, style: StyleRow) {
  const sources = all<{ asset_id: string }>(
    `SELECT source.asset_id FROM director_style_sources source JOIN director_styles style ON style.id = source.style_id
     WHERE style.user_id = ? AND style.id = ? AND style.mode = ? ORDER BY source.ordinal`,
    userId, style.id, style.mode,
  );
  return sources.map(({ asset_id }) => inspectAsset(userId, asset_id));
}

export function startStyle(userId: string, input: output<typeof learnInput>) {
  const assets = input.assetIds.map((id) => inspectAsset(userId, id));
  if (assets.some((asset) => asset.kind === "audio")) throw badRequest("Choose images or videos to study.");
  return tx(() => {
    const id = newId("dst");
    run("INSERT INTO director_styles VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, assets[0].id, directorMode(), input.title, input.notes, Date.now());
    assets.forEach((asset, ordinal) => run("INSERT INTO director_style_sources VALUES (?, ?, ?)", id, asset.id, ordinal));
    return { styleId: id, job: toJob(queue({ userId, kind: "analysis", body: { styleId: id } })) };
  });
}

export function reanalyzeStyle(userId: string, id: string) {
  const style = styleRow(userId, id);
  styleAssets(userId, style);
  return tx(() => {
    const active = get<JobRow>(
      "SELECT * FROM director_jobs WHERE user_id = ? AND mode = ? AND kind = 'analysis' AND json_extract(input, '$.styleId') = ? AND state IN ('queued', 'running')",
      userId, style.mode, id,
    );
    return toJob(active ?? queue({ userId, kind: "analysis", body: { styleId: id } }));
  });
}

export function startProject(userId: string, brief: Brief) {
  const mode = directorMode();
  const version = styleVersion(userId, brief.styleVersionId);
  if (!version.saved) throw badRequest("Save the style in the Style Library before applying it.");
  if (brief.model === "seedance-2.5" && brief.duration < 5) throw badRequest("Seedance 2.5 needs at least five seconds.");
  const seen = new Set<string>();
  for (const member of brief.cast) {
    for (const id of member.assetIds) {
      if (seen.has(id)) throw badRequest("Each original reference must belong to one cast member.");
      seen.add(id);
      if (inspectAsset(userId, id).kind !== "image") throw badRequest("Cast identity references must be images.");
    }
  }
  return tx(() => {
    const project = createProject(userId, { title: brief.title, logline: brief.brief.slice(0, 600), aspect: brief.aspect === "3:4" ? "9:16" : brief.aspect });
    for (const member of brief.cast) {
      createElement(userId, project.id, { kind: "character", name: member.name, description: member.notes, refAssetIds: member.assetIds });
    }
    run("INSERT INTO director_projects VALUES (?, ?, ?, ?, ?, ?)", project.id, userId, version.id, mode, JSON.stringify(brief), Date.now());
    return { projectId: project.id, job: toJob(queue({ userId, kind: "plan", projectId: project.id, body: {} })) };
  });
}

export function retryPlan(userId: string, projectId: string) {
  const project = projectRow(userId, projectId);
  return tx(() => {
    if (currentPack(userId, projectId)) throw badRequest("This project already has a storyboard.");
    const pending = get<JobRow>("SELECT * FROM director_jobs WHERE user_id = ? AND project_id = ? AND mode = ? AND kind = 'plan' AND state IN ('queued', 'running')", userId, projectId, project.mode);
    return toJob(pending ?? queue({ userId, kind: "plan", projectId, body: {} }));
  });
}

export function finish(row: JobRow, result: unknown) {
  tx(() => {
    if (row.reserved) settle(row.id);
    run("UPDATE director_jobs SET state = 'succeeded', result = ?, spent = reserved, updated_at = ? WHERE id = ?", JSON.stringify(result), Date.now(), row.id);
  });
}

export function reject(row: JobRow, error: ErrorDetail) {
  tx(() => {
    if (row.reserved) release(row.id, "Director render failed before delivering a take");
    run("UPDATE director_jobs SET state = 'failed', error = ?, released = reserved, updated_at = ? WHERE id = ?", JSON.stringify(error), Date.now(), row.id);
  });
}
