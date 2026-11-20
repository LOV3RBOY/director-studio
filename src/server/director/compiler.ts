import { statSync } from "node:fs";
import { assetFile, ownedAsset, type AssetRow } from "../assets";
import { badRequest, notFound } from "../errors";
import type { Brief, Plan, Reference, Settings, StyleProfile } from "./contracts";

const endpoint20 = "seedance-2.0-omni-reference";
const endpoint25 = "seedance-2.5-omni-reference";
const modalities = ["image", "video", "audio"] as const;
type Modality = typeof modalities[number];
const maximum = {
  "seedance-2.0": { image: 9, video: 3, audio: 3 },
  "seedance-2.5": { image: 30, video: 10, audio: 10 },
} satisfies Record<Settings["model"], Record<Modality, number>>;
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

function withStyleKit(references: Reference[], model: Settings["model"], profile: StyleProfile): Reference[] {
  const kit = profile.kit;
  if (!kit) return references;
  const ordered = [...references.filter(({ role }) => role === "identity"), ...references.filter(({ role }) => role !== "identity")];
  const used = new Set(references.map(({ assetId }) => assetId));
  const is20 = model === "seedance-2.0";
  let images = Math.min(is20 ? 2 : 4, maximum[model].image - references.filter(({ modality }) => modality === "image").length);
  for (const [index, assetId] of kit.images.entries()) {
    if (images <= 0) break;
    if (used.has(assetId)) continue;
    ordered.push({ assetId, modality: "image", role: profile.exemplars?.[index]?.role ?? "composition", scope: kitScope });
    used.add(assetId);
    images--;
  }
  if (!is20 && kit.motion && !used.has(kit.motion) && references.filter(({ modality }) => modality === "video").length < maximum[model].video) {
    ordered.push({ assetId: kit.motion, modality: "video", role: "motion", scope: kitScope });
  }
  return ordered;
}

export function compilePack(userId: string, brief: Brief, plan: Plan, settings: Settings, style?: StyleProfile): PackBody {
  if (settings.model === "seedance-2.0" && settings.seed !== undefined) throw badRequest("Seedance 2.0 has no documented seed input.");
  if (settings.model === "seedance-2.5" && settings.quality !== undefined) throw badRequest("Choose resolution for Seedance 2.5.");
  const { styleRefs, ...renderSettings } = settings;
  const effective = settings.model === "seedance-2.0"
    ? { ...renderSettings, quality: settings.quality ?? "high" as const }
    : { ...renderSettings, seed: settings.seed ?? -1 };
  const identity = new Set(brief.cast.flatMap((member) => member.assetIds));
  let cursor = 0;
  const clips = plan.clips.map((clip, index) => {
    if (clip.startMs !== cursor || clip.endMs <= clip.startMs) throw badRequest(`Clip ${index + 1} must follow the previous clip without gaps.`);
    cursor = clip.endMs;
    const duration = (clip.endMs - clip.startMs) / 1000;
    const is20 = settings.model === "seedance-2.0";
    if (!Number.isInteger(duration) || duration < (is20 ? 4 : 5) || duration > (is20 ? 15 : 30)) {
      throw badRequest(`Clip ${index + 1} must be ${is20 ? "4–15" : "5–30"} whole seconds for this pack's model.`);
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
    const references = styleRefs !== false && style?.kit ? withStyleKit(clip.references, settings.model, style) : clip.references;
    const attachments = references.map((ref): Attachment => {
      if (seen.has(ref.assetId)) throw badRequest("Each file may appear only once in a clip.");
      seen.add(ref.assetId);
      const asset = inspectAsset(userId, ref.assetId);
      if (asset.kind !== ref.modality || !(allowed[ref.role] as readonly Modality[]).includes(ref.modality)) {
        throw badRequest("The file modality does not match its assigned role.");
      }
      if (ref.role === "identity" && !identity.has(ref.assetId)) throw badRequest("Cast identity must use an original character reference.");
      if (identity.has(ref.assetId) && ref.role !== "identity") throw badRequest("Assign original cast images the identity role.");
      const order = ++counts[ref.modality];
      if (order > maximum[settings.model][ref.modality]) throw badRequest(`Too many ${ref.modality} references in clip ${index + 1}.`);
      if (is20 && ref.modality === "image" && !["image/jpeg", "image/png", "image/webp"].includes(asset.mime)) {
        throw badRequest("Seedance 2.0 image references must be JPEG, PNG, or WebP.");
      }
      if (is20 && ref.modality === "video" && (asset.mime !== "video/mp4" || !asset.duration || asset.duration > 15)) {
        throw badRequest("Seedance 2.0 video references must be MP4 and at most 15 seconds.");
      }
      if (is20 && ref.modality === "audio" && (!["audio/wav", "audio/mpeg"].includes(asset.mime) || !asset.duration)) {
        throw badRequest("Seedance 2.0 audio references must be MP3 or WAV with readable timing.");
      }
      const extension = asset.path.split(".").pop()?.match(/^[a-z0-9]{1,6}$/)?.[0] ?? "bin";
      return { ...ref, index: order, filename: `${asset.id}.${extension}`, mime: asset.mime, duration: asset.duration };
    });
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
    const refs = attachments.map((a) => `${is20 ? `@${a.modality}${a.index}` : `Reference ${a.modality} ${a.index}`} — ${a.role}: ${a.scope}.`);
    const prompt = [
      clip.mode === "continuous" ? "One continuous take." : "Use the specified cuts.",
      ...refs, brief.constraints ? `Keep these constraints: ${brief.constraints}` : "", direction,
    ].filter(Boolean).join("\n");
    if (prompt.length > 8000) throw badRequest("Shorten the clip prompt to fit the provider request.");
    return { endpoint: is20 ? endpoint20 : endpoint25, duration, attachments, prompt };
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
    notes: ["Prompt timing is a creative target. Compare delivered cuts, motion and identity with the storyboard.", ...(plan.notes ? [plan.notes] : [])],
  };
}

export function providerBody(clip: CompiledClip, settings: Settings, aspect: Brief["aspect"], urlFor: (file: Attachment) => string) {
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
