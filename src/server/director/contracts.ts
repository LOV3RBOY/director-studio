import { z } from "zod";
import { badRequest } from "../errors";

const text = (max: number) => z.string().trim().min(1).max(max);
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const model = z.enum(["seedance-2.0", "seedance-2.5"]);
export const aspect = z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
export const projectsInput = z.object({
  title: text(120),
  styleVersionId: identifier,
  brief: text(3500),
  constraints: z.string().trim().max(1200).default(""),
  cast: z.array(z.object({ name: text(80), notes: z.string().trim().max(400).default(""), assetIds: z.array(identifier).min(1).max(6) })).max(8).default([]),
  duration: z.number().int().min(4).max(60),
  aspect,
  model,
});
export type Brief = z.infer<typeof projectsInput>;

export const learnInput = z.object({
  assetId: identifier.optional(),
  assetIds: z.array(identifier).min(1).max(8).optional(),
  title: text(120),
  notes: z.string().trim().max(2400).default(""),
}).transform(({ assetId, assetIds, title, notes }, ctx) => {
  if (Boolean(assetId) === Boolean(assetIds)) {
    ctx.addIssue({ code: "custom", message: "Supply either assetId or assetIds." });
    return z.NEVER;
  }
  const sources = assetIds ?? [assetId!];
  if (new Set(sources).size !== sources.length) {
    ctx.addIssue({ code: "custom", message: "Choose distinct references." });
    return z.NEVER;
  }
  return { assetIds: sources, title, notes };
});

export const topics = [
  "genre", "mood", "composition", "palette", "lighting", "texture", "shot-size",
  "lens", "camera-motion", "blocking", "holds-and-reveals", "transitions", "edit-rhythm", "audio",
] as const;

export const guidance = z.object({
  guide: text(18_000),
  rules: z.array(z.object({
    topic: z.enum(topics),
    basis: z.enum(["observed", "inferred", "unknown"]),
    reuse: z.enum(["signature", "adaptable", "exclude"]),
    detail: z.string().trim().min(25).max(900),
    evidence: z.array(z.number().int().nonnegative()).max(8),
    measures: z.array(z.string().max(80)).max(20).optional(),
  })).min(topics.length).max(32),
});
export type Guidance = z.infer<typeof guidance>;

export function reusableStyleRules(rules: Guidance["rules"]) {
  return rules.flatMap((rule, index) => rule.reuse !== "exclude" && rule.basis !== "unknown" ? [{ ...rule, index }] : []);
}

const measured = z.number().nullable();
const lab = z.tuple([z.number(), z.number(), z.number()]);
const paletteColor = z.object({ hex: z.string().regex(/^#[0-9a-f]{6}$/), lab, weight: z.number().min(0).max(1) });
export const styleMetrics = z.object({
  editing: z.object({
    cutTimes: z.array(z.number()).max(400).nullable(),
    shotLengths: z.object({ mean: measured, median: measured, p10: measured, p90: measured }),
    cutsPer10s: measured,
  }),
  palette: z.array(paletteColor).max(6).nullable(),
  tone: z.object({ p5: measured, p50: measured, p95: measured, contrast: measured, saturation: measured, warmth: measured }),
  grain: measured,
  motion: z.object({
    translation: z.object({ x: z.number(), y: z.number() }).nullable(),
    rotation: measured, zoom: measured, jitter: measured, motionEnergy: measured,
    camera: z.enum(["static", "pan", "tilt", "push", "pull", "handheld", "mixed"]).nullable(),
  }),
  audio: z.object({ integratedLufs: measured, loudnessRange: measured, tempo: measured, confidence: measured }),
  reasons: z.record(z.string(), z.string()),
});
export type StyleMetrics = z.infer<typeof styleMetrics>;

export interface EvidenceSource {
  assetId: string;
  digest: string;
  duration: number | null;
  width: number;
  height: number;
  hasAudio: boolean;
  metrics: StyleMetrics;
}

export interface EvidenceFrame {
  ordinal: number;
  seconds: number | null;
  cutCandidate: boolean;
  filename?: string;
  source?: number;
}

export interface Evidence {
  assetId: string;
  digest: string;
  duration: number | null;
  width: number;
  height: number;
  hasAudio: boolean;
  audioCues?: { seconds: number; type: "silence-start" | "silence-end" }[];
  frames: EvidenceFrame[];
  metrics?: StyleMetrics;
  metricSpread?: Record<string, number>;
  sources?: EvidenceSource[];
}

export interface StyleProfile extends Guidance {
  schemaVersion: 1 | 2;
  fixture: boolean;
  evidence: Evidence;
  provenance: { runtime: string; model: string; analysisId: string; usage: Record<string, number> };
}

export const measuredTopics = {
  palette: ["palette"],
  lighting: ["tone.p5", "tone.p50", "tone.p95", "tone.contrast"],
  texture: ["grain"],
  "camera-motion": ["motion.translation.x", "motion.translation.y", "motion.rotation", "motion.zoom", "motion.jitter", "motion.motionEnergy"],
  "edit-rhythm": ["editing.shotLengths.mean", "editing.shotLengths.median", "editing.shotLengths.p10", "editing.shotLengths.p90", "editing.cutsPer10s"],
  audio: ["audio.integratedLufs", "audio.loudnessRange", "audio.tempo", "audio.confidence"],
} satisfies Partial<Record<(typeof topics)[number], readonly string[]>>;

export function metricAt(metrics: StyleMetrics | undefined, path: string): unknown {
  if (path === "reasons" || path.startsWith("reasons.")) return undefined;
  let value: unknown = metrics;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part) || part === "length") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function verifyGuidance(value: Guidance, evidence: Evidence): Guidance {
  if (topics.some((topic) => !value.rules.some((rule) => rule.topic === topic))) {
    throw badRequest("The style guide must cover every directing topic.");
  }
  if (new Set(value.rules.map((rule) => rule.detail.toLowerCase())).size !== value.rules.length) {
    throw badRequest("The style guide contains repeated observations.");
  }
  for (const rule of value.rules) {
    if (rule.basis !== "unknown" && rule.evidence.length === 0) throw badRequest("Cite a frame for each observation or inference.");
    if (rule.evidence.some((ordinal) => !evidence.frames.some((frame) => frame.ordinal === ordinal))) {
      throw badRequest("The style guide cites a frame outside its evidence.");
    }
    if (rule.measures?.some((path) => {
      const metric = metricAt(evidence.metrics, path);
      return metric === undefined || metric === null;
    })) {
      throw badRequest("The style guide cites a metric outside its evidence.");
    }
    if ((evidence.sources?.length ?? 0) >= 2 && rule.reuse === "signature") {
      const sources = new Set(evidence.frames.filter((frame) => rule.evidence.includes(frame.ordinal)).map((frame) => frame.source ?? 0));
      if (sources.size < 2) throw badRequest("Cite at least two references for a signature rule.");
    }
  }
  return value;
}

export const reference = z.object({
  assetId: identifier,
  modality: z.enum(["image", "video", "audio"]),
  role: z.enum(["identity", "keyframe", "composition", "lighting", "motion", "sound"]),
  scope: text(240),
});
export type Reference = z.infer<typeof reference>;

const time = z.number().int().min(0).max(60_000);
const shot = z.object({
  startMs: time,
  endMs: time,
  start: text(450),
  action: text(900),
  movement: text(450),
  end: text(450),
  framing: text(450),
  continuity: text(450),
  sound: z.string().trim().max(450).default(""),
  transition: z.enum(["continuous", "cut"]),
  styleRuleIndices: z.array(z.number().int().min(0).max(31)).max(8).optional(),
});

export const plan = z.object({
  clips: z.array(z.object({
    startMs: time,
    endMs: time,
    mode: z.enum(["continuous", "cuts"]),
    shots: z.array(shot).min(1).max(12),
    references: z.array(reference).max(50),
    promptOverride: z.string().trim().max(6000).default(""),
  })).min(1).max(12),
  imagePrompts: z.array(z.object({
    kind: z.enum(["character", "keyframe"]),
    title: text(100),
    prompt: text(1800),
    assetIds: z.array(identifier).max(6),
  })).max(20),
  notes: z.string().trim().max(1800).default(""),
});
export type Plan = z.infer<typeof plan>;

export const packSettings = z.object({
  model,
  resolution: z.enum(["480p", "720p", "1080p", "4k"]),
  quality: z.enum(["basic", "high"]).optional(),
  seed: z.number().int().min(-1).max(2_147_483_647).optional(),
});
export type Settings = z.infer<typeof packSettings>;
export const packInput = z.object({ plan, settings: packSettings, previousId: identifier });
export const renderInput = z.object({
  clip: z.number().int().min(0).max(11),
  requestKey: z.string().min(16).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  maxCredits: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const chatInput = z.object({ message: text(3500) });
export const imageInput = renderInput.pick({ requestKey: true, maxCredits: true }).extend({ index: z.number().int().min(0).max(19) });

export function valid<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.map(String).join(".");
    throw badRequest(field ? `${field}: ${issue.message}` : issue.message);
  }
  return result.data;
}
