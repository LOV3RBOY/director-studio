import "server-only";

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assetFile, ownedAsset, removeAsset, saveAsset } from "../assets";
import { all, get, newId, run, tx } from "../db";
import { ApiError, badRequest, notFound } from "../errors";
import { reusableStyleRules, type StyleMetrics, type StyleProfile } from "./contracts";
import { evidenceFrame, measureReferences, measureStyle, rgbLab, runMedia, temporary } from "./media";
import { reviewTake, type DirectorMode } from "./runtime";
import { ownedJob, projectProfile, projectRow, type JobRow } from "./store";

type Lab = [number, number, number];
type Palette = NonNullable<StyleMetrics["palette"]>;
type FidelityState = "queued" | "running" | "succeeded" | "failed";

interface FidelityRow {
  id: string; user_id: string; job_id: string; style_version_id: string; state: FidelityState;
  score: number | null; report: string | null; error: string | null; attempts: number; next_run: number; created_at: number; updated_at: number;
}

interface GradeRow {
  id: string; user_id: string; job_id: string; source_asset_id: string; asset_id: string;
  strength: number; lut_sha256: string; report: string; created_at: number;
}

export interface NumericCheck {
  metric: string; label: string; target: number; actual: number; tolerance: string; difference: number; pass: boolean;
}

export interface FidelityReport {
  takeAssetId: string;
  numeric: NumericCheck[];
  skipped: { metric: string; label: string; reason: string }[];
  judged: { index: number; topic: string; detail: string; pass: boolean; note: string; evidence: number[] }[] | null;
  judge: { fixture: boolean; model: string; usage: Record<string, number> } | null;
  judgeError: string | null;
  numericRate: number | null;
  judgedRate: number | null;
}

const MAX_ATTEMPTS = 2;

// CIEDE2000 colour difference (Sharma, Wu and Dalal, 2005).
export function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const degrees = (value: number) => value * 180 / Math.PI;
  const averageC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = (1 - Math.sqrt(averageC ** 7 / (averageC ** 7 + 25 ** 7))) / 2;
  const [ap1, ap2] = [a1 * (1 + g), a2 * (1 + g)];
  const [c1, c2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (degrees(Math.atan2(b, a)) + 360) % 360);
  const [h1, h2] = [hue(b1, ap1), hue(b2, ap2)];
  let dh = 0;
  if (c1 * c2 !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dL = l2 - l1;
  const dC = c2 - c1;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(radians(dh / 2));
  const meanL = (l1 + l2) / 2;
  const meanC = (c1 + c2) / 2;
  let meanH = h1 + h2;
  if (c1 * c2 !== 0) meanH = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const t = 1 - 0.17 * Math.cos(radians(meanH - 30)) + 0.24 * Math.cos(radians(2 * meanH))
    + 0.32 * Math.cos(radians(3 * meanH + 6)) - 0.2 * Math.cos(radians(4 * meanH - 63));
  const sl = 1 + 0.015 * (meanL - 50) ** 2 / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanC;
  const sh = 1 + 0.015 * meanC * t;
  const rt = -2 * Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)) * Math.sin(radians(60 * Math.exp(-(((meanH - 275) / 25) ** 2))));
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

/**
 * Weighted mean CIEDE2000 between two palettes. Target colours are matched greedily in
 * order of weight to the nearest unused take colour; a take with fewer colours is reused.
 */
export function paletteDistance(target: Palette, take: Palette): number {
  const used = new Set<number>();
  let total = 0;
  let weight = 0;
  for (const color of [...target].sort((a, b) => b.weight - a.weight)) {
    const pool = take.map((candidate, index) => ({ candidate, index })).filter(({ index }) => used.size >= take.length || !used.has(index));
    let best = pool[0];
    let bestDistance = deltaE2000(color.lab, best.candidate.lab);
    for (const entry of pool.slice(1)) {
      const distance = deltaE2000(color.lab, entry.candidate.lab);
      if (distance < bestDistance) [best, bestDistance] = [entry, distance];
    }
    used.add(best.index);
    total += bestDistance * color.weight;
    weight += color.weight;
  }
  return weight ? total / weight : 0;
}

/** Compares a take's measurements with its style's, using the Phase C tolerances. */
export function numericChecks(style: StyleMetrics, take: StyleMetrics) {
  const numeric: NumericCheck[] = [];
  const skipped: FidelityReport["skipped"] = [];
  const add = (metric: string, label: string, target: number | null | undefined, actual: number | null | undefined,
    tolerance: string, allowed: (target: number) => number, missing: string) => {
    if (target === null || target === undefined || actual === null || actual === undefined) {
      skipped.push({ metric, label, reason: missing });
      return;
    }
    const difference = actual - target;
    numeric.push({ metric, label, target, actual, tolerance, difference, pass: Math.abs(difference) <= allowed(target) + 1e-9 });
  };
  add("editing.shotLengths.mean", "Mean shot length (s)", style.editing.shotLengths.mean, take.editing.shotLengths.mean,
    "±35%", (target) => 0.35 * target, "Shot length is not measured for one side.");
  if (style.palette?.length && take.palette?.length) {
    const distance = paletteDistance(style.palette, take.palette);
    numeric.push({ metric: "palette", label: "Palette (weighted CIEDE2000)", target: 0, actual: distance, tolerance: "≤ 12", difference: distance, pass: distance <= 12 });
  } else {
    skipped.push({ metric: "palette", label: "Palette (weighted CIEDE2000)", reason: "The palette is not measured for one side." });
  }
  add("tone.p50", "Median luma", style.tone.p50, take.tone.p50, "±0.08", () => 0.08, "Luma is not measured for one side.");
  add("tone.contrast", "Contrast", style.tone.contrast, take.tone.contrast, "±0.10", () => 0.1, "Contrast is not measured for one side.");
  add("tone.saturation", "Saturation", style.tone.saturation, take.tone.saturation, "±0.10", () => 0.1, "Saturation is not measured for one side.");
  add("audio.integratedLufs", "Loudness (LUFS)", style.audio.integratedLufs, take.audio.integratedLufs, "±3 LU", () => 3, "Loudness is not measured for one side.");
  const confident = (metrics: StyleMetrics) => (metrics.audio.confidence ?? 0) >= 0.35 ? metrics.audio.tempo : null;
  add("audio.tempo", "Tempo (BPM)", confident(style), confident(take), "±4 BPM", () => 4, "Tempo is not confidently measured on both sides.");
  return { numeric, skipped };
}

const rate = (items: { pass: boolean }[] | null) => items?.length ? items.filter(({ pass }) => pass).length / items.length : null;

/** 0.5 × numeric pass rate + 0.5 × judged pass rate; when one side has no checks, the other counts alone. */
export function fidelityScore(numericRate: number | null, judgedRate: number | null): number {
  const parts = [numericRate, judgedRate].filter((value): value is number => value !== null);
  if (!parts.length) return 0;
  return Math.round(100 * parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

function renderTake(userId: string, jobId: string) {
  const job = ownedJob(userId, jobId);
  if (job.kind !== "render" || job.state !== "succeeded" || !job.project_id || !job.result) throw notFound("That render has no delivered take.");
  const result = JSON.parse(job.result) as { assetId?: string };
  if (!result.assetId) throw notFound("That render has no delivered take.");
  const asset = ownedAsset(userId, result.assetId);
  const project = projectRow(userId, job.project_id, job.mode as DirectorMode);
  return { job, asset, pinned: projectProfile(userId, project) };
}

const styleMetricsOf = (profile: StyleProfile) => profile.evidence.metrics ?? null;

const toFidelity = (row: FidelityRow) => ({
  id: row.id, jobId: row.job_id, styleVersionId: row.style_version_id, state: row.state, score: row.score,
  report: row.report ? JSON.parse(row.report) as FidelityReport : null,
  error: row.error ? JSON.parse(row.error) as { code: string; message: string } : null,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

const toGrade = (row: GradeRow) => ({
  id: row.id, jobId: row.job_id, sourceAssetId: row.source_asset_id, assetId: row.asset_id,
  url: `/api/assets/${row.asset_id}/file`, strength: row.strength, lutSha256: row.lut_sha256,
  report: JSON.parse(row.report) as GradeReport, createdAt: row.created_at,
});

/** Queues a score for a delivered take. Returns the pending score instead of queuing a second one. */
export function queueFidelity(userId: string, jobId: string) {
  const { job, pinned } = renderTake(userId, jobId);
  return tx(() => {
    const pending = get<FidelityRow>("SELECT * FROM director_fidelity WHERE job_id = ? AND state IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1", job.id);
    if (pending) return toFidelity(pending);
    const now = Date.now();
    const id = newId("dfs");
    run("INSERT INTO director_fidelity (id, user_id, job_id, style_version_id, state, next_run, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)",
      id, userId, job.id, pinned.id, now, now, now);
    return toFidelity(get<FidelityRow>("SELECT * FROM director_fidelity WHERE id = ?", id)!);
  });
}

/** Queues a first score after a render is delivered, when its style has measurements to compare. */
export function queueFidelityAfterRender(row: JobRow) {
  try {
    const { pinned } = renderTake(row.user_id, row.id);
    if (!styleMetricsOf(pinned.profile)) return;
    if (get("SELECT 1 FROM director_fidelity WHERE job_id = ? LIMIT 1", row.id)) return;
    queueFidelity(row.user_id, row.id);
  } catch {
    console.error("[director] Could not queue the fidelity score.", row.id);
  }
}

export function renderReview(userId: string, jobId: string) {
  const { job } = renderTake(userId, jobId);
  const fidelity = get<FidelityRow>("SELECT * FROM director_fidelity WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", job.id);
  const grade = get<GradeRow>("SELECT * FROM director_grades WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", job.id);
  return { fidelity: fidelity ? toFidelity(fidelity) : null, grade: grade ? toGrade(grade) : null };
}

export function dueFidelity(mode: DirectorMode, limit: number) {
  return all<FidelityRow>(
    "SELECT f.* FROM director_fidelity f JOIN director_jobs j ON j.id = f.job_id WHERE j.mode = ? AND f.state = 'queued' AND f.next_run <= ? ORDER BY f.next_run LIMIT ?",
    mode, Date.now(), limit,
  );
}

export function claimFidelity(id: string) {
  return run("UPDATE director_fidelity SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'", Date.now(), id).changes > 0;
}

export function requeueInterruptedFidelity(mode: DirectorMode) {
  run("UPDATE director_fidelity SET state = 'queued', next_run = ? WHERE state = 'running' AND job_id IN (SELECT id FROM director_jobs WHERE mode = ?)", Date.now(), mode);
}

export async function scoreFidelity(row: FidelityRow) {
  try {
    const { job, asset } = renderTake(row.user_id, row.job_id);
    const style = get<{ profile: string }>("SELECT profile FROM director_style_versions WHERE id = ? AND user_id = ?", row.style_version_id, row.user_id);
    if (!style) throw notFound("The style version for this take no longer exists.");
    const profile = JSON.parse(style.profile) as StyleProfile;
    const target = styleMetricsOf(profile);
    const evidence = await measureReferences([asset]);
    const measured = evidence.metrics!;
    const { numeric, skipped } = target
      ? numericChecks(target, measured)
      : { numeric: [], skipped: [{ metric: "style", label: "Style measurements", reason: "This style was learned before measurements existed. Learn it again to compare numbers." }] };
    const signature = reusableStyleRules(profile.rules).filter(({ reuse }) => reuse === "signature");
    const frames = evenly(evidence.frames.map(({ ordinal }) => ordinal), 6);
    let judged: FidelityReport["judged"] = null;
    let judge: FidelityReport["judge"] = null;
    let judgeError: string | null = null;
    try {
      const review = await reviewTake({
        mode: job.mode as DirectorMode,
        rules: signature.map(({ index, topic, detail }) => ({ index, topic, detail })),
        frames: () => Promise.all(frames.map((ordinal) => evidenceFrame(asset, evidence, ordinal))),
      });
      judged = review.rules.map((item) => {
        const rule = profile.rules[item.index];
        return { ...item, topic: rule.topic, detail: rule.detail };
      });
      judge = { fixture: review.fixture, model: review.model, usage: review.usage };
    } catch (error) {
      judgeError = error instanceof ApiError ? error.message : "The Director could not review the frames. Score the take again.";
    }
    const numericRate = rate(numeric);
    const judgedRate = rate(judged);
    const report: FidelityReport = { takeAssetId: asset.id, numeric, skipped, judged, judge, judgeError, numericRate, judgedRate };
    run("UPDATE director_fidelity SET state = 'succeeded', score = ?, report = ?, error = NULL, updated_at = ? WHERE id = ?",
      fidelityScore(numericRate, judgedRate), JSON.stringify(report), Date.now(), row.id);
  } catch (error) {
    const detail = error instanceof ApiError
      ? { code: error.code, message: error.message }
      : { code: "fidelity_failed", message: "The take could not be measured. Check that it plays, then score it again." };
    if (row.attempts + 1 < MAX_ATTEMPTS && !(error instanceof ApiError && error.status === 404)) {
      run("UPDATE director_fidelity SET state = 'queued', attempts = attempts + 1, next_run = ?, updated_at = ? WHERE id = ?", Date.now() + 5_000, Date.now(), row.id);
      return;
    }
    run("UPDATE director_fidelity SET state = 'failed', attempts = attempts + 1, error = ?, updated_at = ? WHERE id = ?", JSON.stringify(detail), Date.now(), row.id);
  }
}

function evenly<T>(values: T[], count: number): T[] {
  if (values.length <= count) return values;
  return Array.from({ length: count }, (_, i) => values[Math.round(i * (values.length - 1) / (count - 1))]);
}

// ---------------------------------------------------------------------------------------------
// Post-grade: a deterministic 3D LUT (Reinhard Lab mean/std transfer) plus optional grain.

export interface GradeReport {
  strength: number;
  lutSize: number;
  grainAdded: number;
  paletteDistance: { before: number; after: number } | null;
  grain: { style: number | null; before: number | null; after: number | null };
}

type LabStats = { mean: Lab; std: Lab };

/** Weighted Lab mean and standard deviation of a measured palette. */
export function paletteStats(palette: Palette): LabStats {
  const total = palette.reduce((sum, { weight }) => sum + weight, 0) || 1;
  const mean = [0, 1, 2].map((axis) => palette.reduce((sum, { lab, weight }) => sum + lab[axis] * weight, 0) / total) as Lab;
  const std = [0, 1, 2].map((axis) => Math.sqrt(palette.reduce((sum, { lab, weight }) => sum + (lab[axis] - mean[axis]) ** 2 * weight, 0) / total)) as Lab;
  return { mean, std };
}

function labToSrgb([lightness, a, b]: Lab): [number, number, number] {
  const f = (value: number) => (value > 6 / 29 ? value ** 3 : 3 * (6 / 29) ** 2 * (value - 4 / 29));
  const y = (lightness + 16) / 116;
  const [x, luminance, z] = [0.95047 * f(y + a / 500), f(y), 1.08883 * f(y - b / 200)];
  const linear = [
    3.2404542 * x - 1.5371385 * luminance - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * luminance + 0.041556 * z,
    0.0556434 * x - 0.2040259 * luminance + 1.0572252 * z,
  ];
  return linear.map((value) => {
    const clamped = Math.min(1, Math.max(0, value));
    return Math.min(1, Math.max(0, clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055));
  }) as [number, number, number];
}

const ratioLimits = [0.25, 4] as const;
const stdFloor = 1;

/** Per-axis Lab scale factors of the full transfer, clamped so near-flat palettes cannot explode. */
export function transferScale(take: LabStats, style: LabStats): Lab {
  return [0, 1, 2].map((axis) => Math.min(ratioLimits[1], Math.max(ratioLimits[0],
    Math.max(style.std[axis], stdFloor) / Math.max(take.std[axis], stdFloor)))) as Lab;
}

/** Builds a 33³ .cube LUT that moves the take's Lab statistics toward the style's. Pure and deterministic. */
export function buildLut(take: LabStats, style: LabStats, strength: number, size = 33): string {
  const scale = transferScale(take, style);
  const lines = ["TITLE \"Director Studio style grade\"", `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const lab = rgbLab(r * step, g * step, b * step);
        // Partial strength interpolates the scale geometrically and the mean shift linearly,
        // so strength 1 is the full Reinhard transfer and 0 is the identity.
        const moved = lab.map((value, axis) =>
          (value - take.mean[axis]) * scale[axis] ** strength + take.mean[axis] + (style.mean[axis] - take.mean[axis]) * strength) as Lab;
        moved[0] = Math.min(100, Math.max(0, moved[0]));
        lines.push(labToSrgb(moved).map((value) => value.toFixed(6)).join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * ffmpeg's noise filter adds uniform noise of ±alls/255 per pixel. The style grain is measured
 * inside 64 × 128 pixels, where downscaling averages roughly k² pixels together (k is the
 * downscale factor), so the added standard deviation at the measured scale shrinks by about k.
 */
export function grainStrength(styleGrain: number | null, takeGrain: number | null, width: number, height: number, lightnessScale = 1): number {
  if (styleGrain === null || takeGrain === null) return 0;
  // The LUT scales lightness deviations, and the measured grain with them.
  const graded = takeGrain * lightnessScale;
  if (styleGrain <= graded) return 0;
  const needed = Math.sqrt(styleGrain ** 2 - graded ** 2);
  // measureStyle fits frames inside 64 × 128 pixels.
  const reduction = Math.max(1, width / 64, height / 128);
  const alls = needed * reduction * 255 * Math.sqrt(3);
  return Math.min(40, Math.max(0, Math.round(alls)));
}

const grading = new Set<string>();

/** Grades a delivered take toward its style. The original take is never modified. */
export async function gradeTake(userId: string, jobId: string, strength = 0.6, grain = true) {
  if (!(strength > 0 && strength <= 1)) throw badRequest("Choose a grade strength above 0 and up to 1.");
  const { job, asset, pinned } = renderTake(userId, jobId);
  const style = styleMetricsOf(pinned.profile);
  if (!style?.palette?.length) throw badRequest("Learn this style again to measure its palette before grading.");
  if (grading.has(job.id)) throw new ApiError(409, "grade_in_progress", "This take is already being graded.");
  grading.add(job.id);
  try {
    const before = await measureStyle(asset);
    if (!before.palette?.length) throw new ApiError(422, "media_analysis_failed", "The take's colours could not be measured.");
    const rounded = Math.round(strength * 1000) / 1000;
    const [takeStats, styleStats] = [paletteStats(before.palette), paletteStats(style.palette)];
    const lut = buildLut(takeStats, styleStats, rounded);
    const lutSha256 = createHash("sha256").update(lut).digest("hex");
    const lightness = transferScale(takeStats, styleStats)[0] ** rounded;
    const noise = grain ? grainStrength(style.grain, before.grain, asset.width ?? 64, asset.height ?? 128, lightness) : 0;
    const bytes = await temporary(userId, async (directory) => {
      await writeFile(path.join(directory, "grade.cube"), lut);
      const output = path.join(directory, "graded.mp4");
      const filters = ["lut3d=file=grade.cube:interp=tetrahedral", ...(noise ? [`noise=alls=${noise}:allf=t`] : []), "format=yuv420p"];
      try {
        await runMedia("ffmpeg", [
          "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", assetFile(asset),
          "-map", "0:v:0", "-map", "0:a?", "-vf", filters.join(","),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", "-c:a", "copy", "-movflags", "+faststart", output,
        ], { timeout: 180_000, maxBuffer: 2_000_000, cwd: directory });
      } catch {
        throw new ApiError(422, "media_analysis_failed", "Could not grade this take. Check that it plays.");
      }
      return readFile(output);
    });
    const graded = await saveAsset({
      userId, bytes, source: "generated", accept: ["video"], title: `${asset.title} · Style grade`,
      prompt: asset.prompt, modelId: asset.model_id,
      params: { gradedFrom: asset.id, renderJobId: job.id, strength: rounded, lutSha256, grainAdded: noise },
    });
    try {
      const after = await measureStyle(graded);
      const report: GradeReport = {
        strength: rounded, lutSize: 33, grainAdded: noise,
        paletteDistance: after.palette?.length ? { before: paletteDistance(style.palette, before.palette), after: paletteDistance(style.palette, after.palette) } : null,
        grain: { style: style.grain, before: before.grain, after: after.grain },
      };
      const id = newId("dgr");
      run("INSERT INTO director_grades (id, user_id, job_id, source_asset_id, asset_id, strength, lut_sha256, report, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, userId, job.id, asset.id, graded.id, rounded, lutSha256, JSON.stringify(report), Date.now());
      return toGrade(get<GradeRow>("SELECT * FROM director_grades WHERE id = ?", id)!);
    } catch (error) {
      removeAsset(userId, graded.id);
      throw error;
    }
  } finally {
    grading.delete(job.id);
  }
}

