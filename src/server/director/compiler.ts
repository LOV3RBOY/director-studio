import { statSync } from "node:fs";
import { assetFile, ownedAsset, type AssetRow } from "../assets";
import { badRequest, notFound } from "../errors";
import type { Brief, Plan, Reference, Settings, StyleProfile } from "./contracts";
import { describeDurations, directorModel, frameValues, type DirectorModel, type Modality } from "./models";

const endpoint20 = "seedance-2.0-omni-reference";
const endpoint25 = "seedance-2.5-omni-reference";
const modalities = ["image", "video", "audio"] as const;
const allowed = {
  identity: ["image"], keyframe: ["image"], composition: ["image", "video"],
  lighting: ["image", "video"], motion: ["video"], sound: ["audio"],
} satisfies Record<Reference["role"], Modality[]>;
const kitScope = "Style reference only: match lighting, palette, composition, texture and camera behavior. Do not reproduce its people, objects, text or location.";

export interface Attachment extends Reference {
  index: number;
  filename: string;
  mime: string;
  duration: number | null;
  /** Frame models only: which registry slot this keyframe fills. */
  slot?: "start" | "end";
}

export interface CompiledClip {
  endpoint: string;
  prompt: string;
  duration: number;
  attachments: Attachment[];
}

export interface PackBody {
  plan: Plan;
  settings: Settings;
  clips: CompiledClip[];
  notes: string[];
}

export function inspectAsset(userId: string, assetId: string): AssetRow {
  const asset = ownedAsset(userId, assetId);
  if (!statSync(assetFile(asset), { throwIfNoEntry: false })?.isFile()) {
    throw notFound("A referenced file is missing. Upload it again and replace the reference.");
  }
  return asset;
}

function withStyleKit(references: Reference[], adapter: DirectorModel, profile: StyleProfile): Reference[] {
  const kit = profile.kit;
  if (!kit) return references;
  const ordered = [...references.filter(({ role }) => role === "identity"), ...references.filter(({ role }) => role !== "identity")];
  const used = new Set(references.map(({ assetId }) => assetId));
  const is20 = adapter.id === "seedance-2.0";
  let images = Math.min(is20 ? 2 : 4, adapter.references.image - references.filter(({ modality }) => modality === "image").length);
  for (const [index, assetId] of kit.images.entries()) {
    if (images <= 0) break;
    if (used.has(assetId)) continue;
    ordered.push({ assetId, modality: "image", role: profile.exemplars?.[index]?.role ?? "composition", scope: kitScope });
    used.add(assetId);
    images--;
  }
  if (!is20 && kit.motion && !used.has(kit.motion) && references.filter(({ modality }) => modality === "video").length < adapter.references.video) {
    ordered.push({ assetId: kit.motion, modality: "video", role: "motion", scope: kitScope });
  }
  return ordered;
}

export function compilePack(userId: string, brief: Brief, plan: Plan, settings: Settings, style?: StyleProfile): PackBody {
  const adapter = directorModel(settings.model);
  const frames = adapter.engine === "frames";
  if (!adapter.seed && settings.seed !== undefined) throw badRequest(`${adapter.name} has no documented seed input.`);
  if (!adapter.quality && settings.quality !== undefined) throw badRequest(`Choose resolution for ${adapter.name}.`);
  if (!adapter.resolutions.includes(settings.resolution)) throw badRequest(`${adapter.name} renders at ${adapter.resolutions.join(", ")}.`);
  if (adapter.aspects && !adapter.aspects.includes(brief.aspect)) throw badRequest(`${adapter.name} renders ${adapter.aspects.join(", ")} aspect ratios.`);
  const { styleRefs, ...renderSettings } = settings;
  const effective = frames ? renderSettings : settings.model === "seedance-2.0"
    ? { ...renderSettings, quality: settings.quality ?? "high" as const }
    : { ...renderSettings, seed: settings.seed ?? -1 };
  const dropped: string[] = [];
  const identity = new Set(brief.cast.flatMap((member) => member.assetIds));
  let cursor = 0;
  const clips = plan.clips.map((clip, index) => {
    if (clip.startMs !== cursor || clip.endMs <= clip.startMs) throw badRequest(`Clip ${index + 1} must follow the previous clip without gaps.`);
    cursor = clip.endMs;
    const duration = (clip.endMs - clip.startMs) / 1000;
    const is20 = settings.model === "seedance-2.0";
    if (!adapter.durations.includes(duration)) {
      throw badRequest(`Clip ${index + 1} must be ${describeDurations(adapter.durations)} whole seconds for this pack's model.`);
    }
    let shotCursor = clip.startMs;
    const shots = clip.shots.map((shot) => {
      if (shot.startMs !== shotCursor || shot.endMs <= shot.startMs || shot.endMs > clip.endMs) {
        throw badRequest(`Clip ${index + 1} has a gap, overlap, or invalid shot boundary.`);
      }
      const description = [shot.start, shot.action, shot.movement, shot.end, shot.framing].join(" ");
      if (clip.mode === "continuous" && (shot.transition === "cut" || /\b(hard cut|cut to|jump cut|smash cut)\b/i.test(description))) {
        throw badRequest(`Clip ${index + 1} is continuous and cannot contain a cut.`);
      }
      shotCursor = shot.endMs;
      const local = (time: number) => ((time - clip.startMs) / 1000).toFixed(3).replace(/\.?0+$/, "");
      return `${local(shot.startMs)}–${local(shot.endMs)} seconds. ${shot.transition === "cut" ? "Cut. " : ""}Start: ${shot.start} Action: ${shot.action} Camera: ${shot.movement} End: ${shot.end} Framing and reveal: ${shot.framing} Continuity: ${shot.continuity}${shot.sound ? ` Sound: ${shot.sound}` : ""}`;
    });
    if (shotCursor !== clip.endMs) throw badRequest(`Clip ${index + 1} has uncovered time at the end.`);
    const counts = { image: 0, video: 0, audio: 0 };
    const seen = new Set<string>();
    const references = !frames && styleRefs !== false && style?.kit ? withStyleKit(clip.references, adapter, style) : clip.references;
    const checked = references.map((ref): Attachment => {
      if (seen.has(ref.assetId)) throw badRequest("Each file may appear only once in a clip.");
      seen.add(ref.assetId);
      const asset = inspectAsset(userId, ref.assetId);
      if (asset.kind !== ref.modality || !(allowed[ref.role] as readonly Modality[]).includes(ref.modality)) {
        throw badRequest("The file modality does not match its assigned role.");
      }
      if (ref.role === "identity" && !identity.has(ref.assetId)) throw badRequest("Cast identity must use an original character reference.");
      if (identity.has(ref.assetId) && ref.role !== "identity") throw badRequest("Assign original cast images the identity role.");
      if (frames) return { ...ref, index: 0, ...fileOf(asset), mime: asset.mime, duration: asset.duration };
      const order = ++counts[ref.modality];
      if (order > adapter.references[ref.modality as Modality]) throw badRequest(`Too many ${ref.modality} references in clip ${index + 1}.`);
      if (is20 && ref.modality === "image" && !["image/jpeg", "image/png", "image/webp"].includes(asset.mime)) {
        throw badRequest("Seedance 2.0 image references must be JPEG, PNG, or WebP.");
      }
      if (is20 && ref.modality === "video" && (asset.mime !== "video/mp4" || !asset.duration || asset.duration > 15)) {
        throw badRequest("Seedance 2.0 video references must be MP4 and at most 15 seconds.");
      }
      if (is20 && ref.modality === "audio" && (!["audio/wav", "audio/mpeg"].includes(asset.mime) || !asset.duration)) {
        throw badRequest("Seedance 2.0 audio references must be MP3 or WAV with readable timing.");
      }
      return { ...ref, index: order, ...fileOf(asset), mime: asset.mime, duration: asset.duration };
    });
    // Frame models take keyframe images as start and end frames, in order, and nothing else.
    const attachments = frames ? checked.filter((ref) => ref.role === "keyframe").slice(0, adapter.slots.length)
      .map((ref, i) => ({ ...ref, index: i + 1, slot: adapter.slots[i] })) : checked;
    if (frames && attachments.length < checked.length) dropped.push(`clip ${index + 1}`);
    if (is20 && attachments.filter((file) => file.modality === "audio").reduce((sum, file) => sum + (file.duration ?? 0), 0) > 15) {
      throw badRequest("Combined Seedance 2.0 audio references must be at most 15 seconds.");
    }
    const direction = clip.promptOverride || shots.join("\n");
    if (clip.mode === "continuous" && /\b(hard cut|cut to|jump cut|smash cut)\b/i.test(direction)) {
      throw badRequest(`Clip ${index + 1} has a cut in its continuous prompt.`);
    }
    if (/@(?:image\d|video\d|audio\d|character:|omni-character:)/i.test(direction)) {
      throw badRequest("Assign provider references through the ordered attachments.");
    }
    const refs = frames ? [] : attachments.map((a) => `${is20 ? `@${a.modality}${a.index}` : `Reference ${a.modality} ${a.index}`} — ${a.role}: ${a.scope}.`);
    const prompt = [
      clip.mode === "continuous" ? "One continuous take." : "Use the specified cuts.",
      ...refs, brief.constraints ? `Keep these constraints: ${brief.constraints}` : "", direction,
    ].filter(Boolean).join("\n");
    if (prompt.length > adapter.promptMax) {
      throw badRequest(frames ? `Shorten clip ${index + 1}'s prompt to ${adapter.promptMax} characters for ${adapter.name}.` : "Shorten the clip prompt to fit the provider request.");
    }
    if (frames) frameValues(adapter, duration, brief.aspect, settings.resolution, filledOf(attachments));
    return { endpoint: frames ? adapter.id : is20 ? endpoint20 : endpoint25, duration, attachments, prompt };
  });
  if (cursor !== brief.duration * 1000) throw badRequest("The clips must cover the requested project duration.");
  for (const draft of plan.imagePrompts) {
    for (const id of draft.assetIds) {
      if (inspectAsset(userId, id).kind !== "image") throw badRequest("Image-generation references must be images.");
      if (draft.kind === "character" && !identity.has(id)) throw badRequest("Character sheets use the original cast references.");
    }
  }
  return {
    plan, settings: effective, clips,
    notes: [
      "Prompt timing is a creative target. Compare delivered cuts, motion and identity with the storyboard.",
      ...(frames ? [`${adapter.name} renders from the prompt${adapter.slots.length ? " and optional keyframes as start and end frames" : ""}. The style travels in the prompt; identity, style, motion and sound references are not sent${dropped.length ? ` (left out of ${dropped.join(", ")})` : ""}.`] : []),
      ...(plan.notes ? [plan.notes] : []),
    ],
  };
}

export function fileOf(asset: AssetRow) {
  const extension = asset.path.split(".").pop()?.match(/^[a-z0-9]{1,6}$/)?.[0] ?? "bin";
  return { filename: `${asset.id}.${extension}` };
}

export function filledOf(attachments: Attachment[]): Record<string, number> {
  return Object.fromEntries(attachments.flatMap((file) => file.slot ? [[file.slot, 1]] : []));
}

/** The registry request for a frame model's clip: control values and `{ slot: [assetId] }` inputs. */
export function frameRequest(clip: CompiledClip, settings: Settings, aspect: Brief["aspect"]) {
  const adapter = directorModel(settings.model);
  const filled = filledOf(clip.attachments);
  return {
    modelId: adapter.id, prompt: clip.prompt, values: frameValues(adapter, clip.duration, aspect, settings.resolution, filled), filled,
    inputs: Object.fromEntries(clip.attachments.flatMap((file) => file.slot ? [[file.slot, [file.assetId]]] : [])) as Record<string, string[]>,
  };
}

export function providerBody(clip: CompiledClip, settings: Settings, aspect: Brief["aspect"], urlFor: (file: Attachment) => string) {
  if (directorModel(settings.model).engine === "frames") {
    const { modelId, prompt, values } = frameRequest(clip, settings, aspect);
    return { model: modelId, prompt, values, frames: Object.fromEntries(clip.attachments.map((file) => [file.slot, urlFor(file)])) };
  }
  const files = Object.fromEntries(modalities.map((modality) => [
    modality, clip.attachments.filter((ref) => ref.modality === modality).map(urlFor),
  ])) as Record<Modality, string[]>;
  const base = {
    prompt: clip.prompt, resolution: settings.resolution, duration: clip.duration, aspect_ratio: aspect,
    ...(files.image.length ? { images_list: files.image } : {}),
  };
  if (settings.model === "seedance-2.0") {
    return {
      ...base, quality: settings.quality ?? "high",
      ...(files.video.length ? { video_files: files.video } : {}),
      ...(files.audio.length ? { audio_files: files.audio } : {}),
    };
  }
  return {
    ...base, seed: settings.seed ?? -1, omni_reference_task_type: "reference",
    ...(files.video.length ? { videos_list: files.video } : {}),
    ...(files.audio.length ? { audios_list: files.audio } : {}),
  };
}
