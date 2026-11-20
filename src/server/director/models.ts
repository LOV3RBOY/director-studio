import { getModel, models, resolveValues, type ModelDef, type Values } from "@/registry";
import { badRequest } from "../errors";

export type Modality = "image" | "video" | "audio";
export const briefAspects = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

/**
 * What the Director needs to know about a render model.
 * `omni`: Seedance omni-reference through MuAPI (identity, style, motion and sound references).
 * `frames`: any registry video model, rendered through the shared generation pipeline from the
 * prompt plus optional start and end frames.
 */
export interface DirectorModel {
  id: string;
  name: string;
  engine: "omni" | "frames";
  /** Allowed whole-second clip lengths, ascending. */
  durations: number[];
  /** Null when the model has no aspect control and follows its frames. */
  aspects: string[] | null;
  resolutions: string[];
  defaultResolution: string;
  promptMax: number;
  references: Record<Modality, number>;
  slots: ("start" | "end")[];
  seed: boolean;
  quality: boolean;
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const seedanceResolutions = ["480p", "720p", "1080p", "4k"];
const omni: Record<string, DirectorModel> = {
  "seedance-2.0": {
    id: "seedance-2.0", name: "Seedance 2.0", engine: "omni", durations: range(4, 15), aspects: [...briefAspects],
    resolutions: seedanceResolutions, defaultResolution: "720p", promptMax: 8000,
    references: { image: 9, video: 3, audio: 3 }, slots: [], seed: false, quality: true,
  },
  "seedance-2.5": {
    id: "seedance-2.5", name: "Seedance 2.5", engine: "omni", durations: range(5, 30), aspects: [...briefAspects],
    resolutions: seedanceResolutions, defaultResolution: "720p", promptMax: 8000,
    references: { image: 30, video: 10, audio: 10 }, slots: [], seed: true, quality: false,
  },
};

function control(model: ModelDef, id: string) {
  return model.controls.find((item) => item.id === id && !item.when);
}

function frameModel(model: ModelDef): DirectorModel | null {
  // Director ids take precedence over a registry id with the same name.
  if (omni[model.id] || model.kind !== "video" || model.status !== "available" || !model.prompt) return null;
  // Keyframes fill start before end, so a slot may depend on another slot being filled, not on values.
  const slotOnly = (when: object | undefined) => !when || Object.keys(when).every((key) => key.startsWith("slot:"));
  if (model.slots.some((slot) => !["start", "end"].includes(slot.id) || slot.min > 0 || !slotOnly(slot.when))) return null;
  const length = control(model, "duration");
  const durations = length?.type === "select"
    ? length.options.map((option) => Number(option.value)).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b)
    : length?.type === "slider" && length.step === 1 ? range(Math.ceil(length.min), Math.floor(length.max)) : [];
  if (!durations.length) return null;
  const shape = control(model, "aspect");
  const aspects = shape?.type === "select" ? shape.options.map((option) => option.value).filter((value) => (briefAspects as readonly string[]).includes(value)) : null;
  if (aspects && !aspects.length) return null;
  const size = control(model, "resolution");
  const resolutions = size?.type === "select" ? size.options.map((option) => option.value) : [];
  if (!resolutions.length || size?.type !== "select") return null;
  const slots = model.slots.map((slot) => slot.id as "start" | "end");
  return {
    id: model.id, name: model.name, engine: "frames", durations, aspects, resolutions, defaultResolution: size.default,
    promptMax: model.prompt.maxLength, references: { image: slots.length, video: 0, audio: 0 }, slots, seed: false, quality: false,
  };
}

export function directorModels(): DirectorModel[] {
  return [...Object.values(omni), ...models.flatMap((model) => frameModel(model) ?? [])];
}

export function directorModel(id: string): DirectorModel {
  const registry = getModel(id);
  const found = omni[id] ?? (registry ? frameModel(registry) : null);
  if (!found) throw badRequest("Choose an available video model for this project.");
  return found;
}

/** "4–15" for a contiguous range, otherwise "6 or 10". */
export function describeDurations(durations: number[]) {
  const contiguous = durations.every((n, i) => !i || n === durations[i - 1] + 1);
  if (contiguous && durations.length > 2) return `${durations[0]}–${durations.at(-1)}`;
  return durations.length > 1 ? `${durations.slice(0, -1).join(", ")} or ${durations.at(-1)}` : String(durations[0]);
}

/**
 * Splits a project into the fewest whole-second clips the model can render, evenly where
 * possible. Returns null when no split of at most twelve clips exists.
 */
export function splitDuration(total: number, durations: number[]): number[] | null {
  const allowed = new Set(durations);
  const longest = durations.at(-1)!;
  for (let count = Math.max(1, Math.ceil(total / longest)); count <= 12; count++) {
    const even = Array.from({ length: count }, (_, i) => Math.floor(total * (i + 1) / count) - Math.floor(total * i / count));
    if (even.every((n) => allowed.has(n))) return even;
    // Exactly `count` allowed lengths that sum to the total, longest first.
    let reach = new Map<number, number[]>([[0, []]]);
    for (let step = 0; step < count; step++) {
      const next = new Map<number, number[]>();
      for (const [sum, parts] of reach) {
        for (const n of [...durations].reverse()) {
          if (sum + n <= total && !next.has(sum + n)) next.set(sum + n, [...parts, n]);
        }
      }
      reach = next;
    }
    const parts = reach.get(total);
    if (parts) return parts;
  }
  return null;
}

/** Registry control values for one clip. Throws when the model would change what was asked. */
export function frameValues(adapter: DirectorModel, duration: number, aspect: string, resolution: string, filled: Record<string, number>): Values {
  const model = getModel(adapter.id);
  if (!model || adapter.engine !== "frames") throw badRequest("Choose an available video model for this project.");
  const wanted: Record<string, unknown> = { duration, resolution, ...(adapter.aspects ? { aspect } : {}) };
  const values = resolveValues(model, wanted, filled);
  for (const [key, value] of Object.entries(wanted)) {
    if (String(values[key]) !== String(value)) throw badRequest(`${adapter.name} cannot render ${key} ${value} with these settings.`);
  }
  return values;
}
