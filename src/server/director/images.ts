import { assetRef, getModel, quoteJob, resolveValues } from "@/registry";
import type { User } from "../auth";
import { all, get, run, tx } from "../db";
import { ApiError, badRequest } from "../errors";
import { getJob, submitJobs } from "../jobs";
import { tregMode } from "../treg";
import { inspectAsset } from "./compiler";
import { snapshot } from "./store";

const modelId = "nano-banana-2";
type Attempt = { job_id: string; prompt_index: number; snapshot_id: string };

function imageRequest(userId: string, packId: string, index: number) {
  const { project, pack } = snapshot(userId, packId);
  if (project.mode !== tregMode() || (project.mode === "live" && !process.env.TREG_TOKEN)) {
    throw new ApiError(503, "image_provider_unavailable", "The image service is unavailable for this workspace mode.");
  }
  const draft = pack.body.plan.imagePrompts[index];
  if (!draft) throw badRequest("Choose an image prompt from the pack.");
  const model = getModel(modelId);
  if (!model) throw new ApiError(503, "image_provider_unavailable", "The image model is unavailable.");
  const refs = draft.assetIds.map((id) => {
    const asset = inspectAsset(userId, id);
    if (asset.kind !== "image") throw badRequest("Image generation requires image references.");
    return assetRef(asset.id, asset.mime);
  });
  const filled = { refs: refs.length };
  const values = resolveValues(model, { aspect: draft.kind === "character" ? "1:1" : project.request.aspect, resolution: "1K" }, filled);
  const quote = quoteJob(model, { prompt: draft.prompt, values, media: { refs }, filled, count: 1 });
  return { project, draft, values, quote };
}

export function imageQuote(userId: string, packId: string, index: number) {
  const { project, quote } = imageRequest(userId, packId, index);
  return { millicredits: quote.millicredits, estimatedUsd: project.mode === "mock" ? 0 : quote.usdPerJob, fixture: project.mode === "mock" };
}

export function requestImage(user: User, packId: string, input: { index: number; requestKey: string; maxCredits: number }) {
  snapshot(user.id, packId);
  return tx(() => {
    const previous = get<Attempt>("SELECT * FROM director_images WHERE user_id = ? AND request_key = ?", user.id, input.requestKey);
    if (previous) {
      if (previous.snapshot_id !== packId || previous.prompt_index !== input.index) throw badRequest("That approval belongs to another image prompt.");
      return { index: input.index, job: getJob(user.id, previous.job_id) };
    }
    const { draft, values, quote } = imageRequest(user.id, packId, input.index);
    if (quote.millicredits > input.maxCredits) throw new ApiError(409, "quote_changed", "The image quote changed. Review the new price.");
    const [job] = submitJobs(user, {
      modelId, prompt: draft.prompt, values, inputs: { refs: draft.assetIds }, count: 1, surface: "director",
      meta: { packId, promptIndex: input.index, role: draft.kind },
    });
    run("INSERT INTO director_images VALUES (?, ?, ?, ?, ?, ?)", user.id, packId, input.index, input.requestKey, job.id, Date.now());
    return { index: input.index, job };
  });
}

export function imageAttempts(userId: string, packId: string) {
  snapshot(userId, packId);
  return all<Attempt>("SELECT * FROM director_images WHERE user_id = ? AND snapshot_id = ? ORDER BY created_at DESC LIMIT 30", userId, packId)
    .map((row) => ({ index: row.prompt_index, job: getJob(userId, row.job_id) }));
}
