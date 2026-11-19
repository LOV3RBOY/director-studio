import { createHmac, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { usdToMillicredits } from "@/config/economy";
import { assetFile, fileResponse, readAsset, type AssetRow } from "../assets";
import { get, tx } from "../db";
import { ApiError, badRequest, notFound } from "../errors";
import { configuredOrigin } from "../origin";
import { inspectAsset, providerBody, type CompiledClip, type PackBody } from "./compiler";
import type { Brief, Settings } from "./contracts";
import { privateDirectory, runMedia, temporary } from "./media";
import { directorMode } from "./runtime";
import { queue, replay, snapshot, toJob, type JobRow, type Snapshot } from "./store";

const api = "https://api.muapi.ai/api/v1";
const reviewError = "MuAPI acceptance or billing could not be confirmed. Check the provider before retrying.";
export class RenderReview extends ApiError {
  constructor(message = reviewError) {
    super(503, "render_requires_review", message);
  }
}
export class RenderPending extends Error {}

function muapiConfig() {
  const key = process.env.DIRECTOR_MUAPI_KEY?.trim();
  const hosts = process.env.DIRECTOR_MUAPI_OUTPUT_HOSTS?.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!key || !hosts?.length) {
    throw new ApiError(503, "render_unavailable", "Live rendering needs MuAPI and an output host allowlist.");
  }
  return { key, hosts };
}

function signedMediaConfig() {
  const secret = process.env.DIRECTOR_INGEST_SECRET;
  const origin = process.env.DIRECTOR_INGEST_ORIGIN || configuredOrigin();
  let url: URL;
  try {
    url = new URL(origin ?? "");
  } catch {
    throw new ApiError(503, "render_unavailable", "Configure a reachable HTTPS address for signed MuAPI references.");
  }
  if (!secret || secret.length < 32 || url.protocol !== "https:" || url.hostname.endsWith(".local")
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ApiError(503, "render_unavailable", "Configure a reachable HTTPS address for signed MuAPI references.");
  }
  return { secret, origin: url.origin };
}

const uploadReferences = () => process.env.DIRECTOR_MUAPI_REFERENCE_MODE === "upload";
const muapiReferenceLimit = (asset: AssetRow) => (asset.kind === "video" ? 50 : 10) * 1_000_000;

function checkReferences(userId: string, clip: CompiledClip) {
  const assets = clip.attachments.map((ref) => ({ ref, asset: inspectAsset(userId, ref.assetId) }));
  if (uploadReferences() && assets.some(({ asset }) => asset.bytes > muapiReferenceLimit(asset))) {
    throw badRequest("MuAPI supports video references up to 50 MB and other reference files up to 10 MB.");
  }
  return assets;
}

const ratesSchema = z.record(z.string(), z.object({ output: z.number().positive(), referenceVideo: z.number().nonnegative().optional() }));
const clipAt = (body: PackBody, index: number) => {
  const clip = body.clips[index];
  if (!clip) throw badRequest("Choose an existing clip.");
  return clip;
};

function exactQuote(clip: CompiledClip, settings: Settings) {
  if (directorMode() === "mock") return { millicredits: 0, estimatedUsd: 0, fixture: true };
  muapiConfig();
  try {
    const rates = ratesSchema.parse(JSON.parse(process.env.DIRECTOR_RENDER_RATES ?? "{}"));
    const rate = rates[[settings.model, settings.resolution, settings.quality].filter(Boolean).join("/")];
    if (!rate) throw new Error("missing rate");
    const videoSeconds = clip.attachments.reduce((total, file) => total + (file.modality === "video" ? file.duration ?? 0 : 0), 0);
    if (videoSeconds > 0 && rate.referenceVideo === undefined) throw new Error("missing video reference rate");
    const estimatedUsd = Math.ceil(1_000_000 * (clip.duration * rate.output + videoSeconds * (rate.referenceVideo ?? 0))) / 1_000_000;
    return { millicredits: usdToMillicredits(estimatedUsd), estimatedUsd, fixture: false };
  } catch {
    throw new ApiError(503, "render_unpriced", "An approved server price is missing for this model and resolution.");
  }
}

export function renderQuote(userId: string, packId: string, index: number) {
  const { pack } = snapshot(userId, packId);
  const clip = clipAt(pack.body, index);
  const assets = checkReferences(userId, clip);
  const quote = exactQuote(clip, pack.body.settings);
  const sendsReferences = assets.length > 0 && !quote.fixture;
  if (sendsReferences && !uploadReferences()) signedMediaConfig();
  return { ...quote, sendsReferencesToMuapi: sendsReferences };
}

export function requestRender(userId: string, packId: string, input: { clip: number; requestKey: string; maxCredits: number }) {
  const { project, pack } = snapshot(userId, packId);
  return tx(() => {
    const previous = replay(userId, "render", input.requestKey);
    if (previous) {
      if (previous.snapshot_id !== packId || JSON.parse(previous.input).clip !== input.clip) throw badRequest("That approval belongs to another clip.");
      return toJob(previous);
    }
    const quote = renderQuote(userId, packId, input.clip);
    if (quote.millicredits > input.maxCredits) throw new ApiError(409, "quote_changed", "The render quote changed. Review the new price.");
    if (!quote.fixture) {
      const max = Number(process.env.DIRECTOR_DAILY_RENDER_USD);
      const recent = get<{ usd: number }>(
        `SELECT COALESCE(SUM(json_extract(input, '$.quotedUsd')), 0) AS usd FROM director_jobs
         WHERE mode = 'live' AND kind = 'render' AND created_at > ?`, Date.now() - 86_400_000,
      )!.usd;
      if (!Number.isFinite(max) || max <= 0 || recent + quote.estimatedUsd > max) {
        throw new ApiError(503, "render_budget_limit", "This render exceeds the server's daily spend limit.");
      }
    }
    return toJob(queue({
      userId, kind: "render", projectId: project.id, snapshotId: pack.id,
      requestKey: input.requestKey, body: { clip: input.clip, quotedUsd: quote.estimatedUsd }, reserve: quote.millicredits,
    }));
  });
}

function signature(secret: string, job: string, asset: string, expiry: string) {
  return createHmac("sha256", secret).update([job, asset, expiry].join("\n")).digest("base64url");
}

function ingressUrl(config: ReturnType<typeof signedMediaConfig>, row: JobRow, assetId: string, expires: string) {
  const sig = signature(config.secret, row.id, assetId, expires);
  return `${config.origin}/api/director/ingest/${row.id}/${assetId}?expires=${expires}&sig=${sig}`;
}

export function ingest(jobId: string, assetId: string, req: Request): Response {
  if (directorMode() !== "live") throw notFound();
  const config = signedMediaConfig();
  const query = new URL(req.url).searchParams;
  const expiry = query.get("expires") ?? "";
  const received = Buffer.from(query.get("sig") ?? "");
  const expected = Buffer.from(signature(config.secret, jobId, assetId, expiry));
  if (!/^\d{13}$/.test(expiry) || Number(expiry) < Date.now() || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw notFound();
  }
  const row = get<JobRow>("SELECT * FROM director_jobs WHERE id = ? AND mode = 'live' AND kind = 'render' AND state IN ('submitting', 'polling')", jobId);
  if (!row?.snapshot_id) throw notFound();
  const { pack } = snapshot(row.user_id, row.snapshot_id);
  if (!clipAt(pack.body, JSON.parse(row.input).clip).attachments.some((ref) => ref.assetId === assetId)) throw notFound();
  const response = fileResponse(req, inspectAsset(row.user_id, assetId));
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

async function uploadReference(key: string, asset: AssetRow, filename: string) {
  try {
    const bytes = await readAsset(asset);
    if (bytes.length < 1 || bytes.length > muapiReferenceLimit(asset) || bytes.length !== asset.bytes) {
      throw badRequest("The reference is missing or its size changed.");
    }
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: asset.mime }), filename);
    const response = await fetch(`${api}/upload_file`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
      headers: { "x-api-key": key }, body: form,
    });
    if (!response.ok) throw new ApiError(422, "render_reference_rejected", `MuAPI declined the reference upload (HTTP ${response.status}).`);
    const { url } = z.object({ url: z.url({ protocol: /^https$/ }) }).parse(await response.json());
    return url;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "render_reference_unavailable", "MuAPI did not confirm the reference upload. Try again.");
  }
}

async function checkMuapiFunds(key: string, approvedUsd: number) {
  try {
    const response = await fetch(`${api}/account/balance`, {
      headers: { "x-api-key": key }, redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("balance unavailable");
    const { balance } = z.object({ balance: z.number().nonnegative() }).parse(await response.json());
    if (balance < approvedUsd) {
      throw new ApiError(402, "render_provider_balance", `MuAPI has $${balance.toFixed(2)} available. The approved render estimate is $${approvedUsd.toFixed(2)}.`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "render_provider_balance_unavailable", "MuAPI could not confirm the render balance. Try again.");
  }
}

export async function prepareMuapi(row: JobRow, pack: Snapshot, brief: Brief, index: number) {
  const config = muapiConfig();
  const clip = clipAt(pack.body, index);
  const approvedUsd = z.object({ quotedUsd: z.number().positive() }).parse(JSON.parse(row.input)).quotedUsd;
  await checkMuapiFunds(config.key, approvedUsd);
  const assets = checkReferences(row.user_id, clip);
  const urls = new Map<string, string>();
  if (assets.length && uploadReferences()) {
    for (const { ref, asset } of assets) {
      if (!urls.has(ref.assetId)) urls.set(ref.assetId, await uploadReference(config.key, asset, ref.filename));
    }
  } else if (assets.length) {
    const signing = signedMediaConfig();
    const configuredTtl = Number(process.env.DIRECTOR_INGEST_TTL_SECONDS ?? "900");
    if (!Number.isInteger(configuredTtl) || configuredTtl < 60 || configuredTtl > 1800) throw badRequest("Configure an ingest duration between 60 and 1800 seconds.");
    const expiry = String(Date.now() + 1000 * configuredTtl);
    for (const { ref } of assets) urls.set(ref.assetId, ingressUrl(signing, row, ref.assetId, expiry));
  }
  return { config, clip, body: providerBody(clip, pack.body.settings, brief.aspect, (file) => urls.get(file.assetId)!) };
}

export async function submitMuapi(request: Awaited<ReturnType<typeof prepareMuapi>>) {
  try {
    const response = await fetch(`${api}/${request.clip.endpoint}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000),
      headers: { "x-api-key": request.config.key, "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
    if ([400, 401, 402, 403, 404, 422].includes(response.status)) {
      throw new ApiError(422, "render_provider_rejected", `MuAPI declined the request (HTTP ${response.status}). Review the inputs or provider access.`);
    }
    if (!response.ok) throw new RenderReview();
    const parsed = z.object({ request_id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) }).safeParse(await response.json());
    if (!parsed.success) throw new RenderReview();
    return parsed.data.request_id;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new RenderReview();
  }
}

const resultSchema = z.object({
  status: z.string(), outputs: z.array(z.union([z.string(), z.object({ url: z.string() })])).optional(),
  cost: z.union([
    z.number().nonnegative(),
    z.object({ amount_usd: z.number().nonnegative() }).transform((cost) => cost.amount_usd),
  ]).nullish(),
});

export async function pollMuapi(row: JobRow) {
  const config = muapiConfig();
  let result: z.infer<typeof resultSchema>;
  try {
    const response = await fetch(`${api}/predictions/${row.provider_id}/result`, {
      headers: { "x-api-key": config.key }, redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new RenderPending();
    result = resultSchema.parse(await response.json());
  } catch {
    throw new RenderPending();
  }
  if (result.status === "failed") throw new RenderReview("MuAPI reported a failed render. Check its billed usage before releasing the reservation.");
  if (result.status !== "completed") throw new RenderPending();
  const output = result.outputs?.[0];
  if (!output) throw new RenderReview("MuAPI completed the render without returning a take.");
  const url = new URL(typeof output === "string" ? output : output.url);
  if (url.protocol !== "https:" || url.port || url.username || url.password || !config.hosts.includes(url.hostname)) {
    throw new RenderReview("MuAPI returned a video outside the configured output hosts.");
  }
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new RenderPending();
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 200_000_000) {
        await reader.cancel();
        throw new RenderReview("The provider video exceeded the server's download limit.");
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), providerCost: result.cost ?? null };
  } catch (error) {
    if (error instanceof RenderReview) throw error;
    throw new RenderPending();
  }
}

export const exportFile = (ownerId: string, jobId: string) => privateDirectory(ownerId, "exports", `${jobId}.zip`);

export async function buildExport(job: JobRow, pack: Snapshot, brief: Brief, style: { title: string; version: number }) {
  return temporary(job.user_id, async (directory) => {
    const assets = new Map<string, { asset: AssetRow; filename: string }>();
    for (const clip of pack.body.clips) {
      for (const ref of clip.attachments) {
        assets.set(ref.assetId, { asset: inspectAsset(job.user_id, ref.assetId), filename: ref.filename });
      }
    }
    for (const draft of pack.body.plan.imagePrompts) {
      for (const id of draft.assetIds) {
        if (assets.has(id)) continue;
        const asset = inspectAsset(job.user_id, id);
        const extension = asset.path.split(".").pop()?.match(/^[a-z0-9]{1,6}$/)?.[0] ?? "bin";
        assets.set(id, { asset, filename: `${id}.${extension}` });
      }
    }
    if ([...assets.values()].reduce((size, { asset }) => size + asset.bytes, 0) > 250_000_000) {
      throw new ApiError(413, "export_too_large", "The referenced files exceed the 250 MB export limit.");
    }
    await mkdir(path.join(directory, "assets"));
    await mkdir(path.join(directory, "prompts"));
    for (const { asset, filename } of assets.values()) {
      await copyFile(assetFile(asset), path.join(directory, "assets", filename));
    }
    const promptFiles = pack.body.clips.map((_, i) => `prompts/clip-${String(i + 1).padStart(2, "0")}.txt`);
    const clips = await Promise.all(pack.body.clips.map(async (clip, i) => {
      await writeFile(path.join(directory, promptFiles[i]), clip.prompt + "\n");
      return {
        clip: i + 1, ...pack.body.plan.clips[i], duration: clip.duration, endpoint: clip.endpoint,
        promptFile: promptFiles[i], providerRequest: providerBody(clip, pack.body.settings, brief.aspect, (ref) => `assets/${ref.filename}`),
        attachments: clip.attachments.map((item) => ({ ...item, path: `assets/${item.filename}` })),
      };
    }));
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
      schemaVersion: 1, fixture: job.mode === "mock", project: brief.title, snapshot: pack.id, version: pack.version, style,
      settings: pack.body.settings, aspect: brief.aspect, notes: pack.body.notes, clips,
      imagePrompts: pack.body.plan.imagePrompts.map((draft) => ({
        ...draft, files: draft.assetIds.map((id) => `assets/${assets.get(id)!.filename}`),
      })),
    }, null, 2) + "\n");
    await writeFile(path.join(directory, "README.md"), [
      "# Project Pack", "", brief.title, `Version ${pack.version} · ${style.title} v${style.version}`,
      job.mode === "mock" ? "Provider-free fixture." : "",
      "Open the clips in manifest order. Copy each clip's prompt and attach its files in the order shown for each modality.",
      ...clips.map((clip) => `- Clip ${clip.clip}: ${clip.duration} s · ${clip.endpoint} · ${clip.promptFile}`),
      "", ...pack.body.notes, "",
    ].join("\n"));
    await runMedia("zip", ["-q", "-X", "-r", "export.zip", "README.md", "manifest.json", "prompts", "assets"], {
      cwd: directory, timeout: 90_000, maxBuffer: 100_000,
    });
    const target = exportFile(job.user_id, job.id);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(directory, "export.zip"), target);
  });
}
