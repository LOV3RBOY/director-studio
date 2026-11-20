import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { assetFile, type AssetRow } from "../assets";
import { dataDir } from "../db";
import { ApiError, badRequest } from "../errors";
import { metricAt, styleMetrics, type Evidence, type StyleMetrics } from "./contracts";

export const runMedia = promisify(execFile);
const bounded = { timeout: 45_000, maxBuffer: 2_000_000 };
const measurementProbe = z.object({
  format: z.object({ duration: z.string().optional() }).optional(),
  streams: z.array(z.object({ codec_type: z.string() })).optional(),
});

export function privateDirectory(ownerId: string, ...parts: string[]) {
  return path.join(dataDir(), "director", ownerId, ...parts);
}

export async function temporary<T>(ownerId: string, run: (directory: string) => Promise<T>): Promise<T> {
  const root = privateDirectory(ownerId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(root, "tmp-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function digestOf(filename: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

function timestamps(stderr: string) {
  return [...stderr.matchAll(/\bpts_time:([\d.eE+-]+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
}

const frameName = (ordinal: number) => `frame-${String(ordinal + 1).padStart(3, "0")}.jpg`;
const evidenceDir = (asset: AssetRow, digest: string) => privateDirectory(asset.user_id, "evidence", asset.id, digest);

export function evidenceFrame(asset: AssetRow, evidence: Evidence, ordinal: number) {
  const frame = evidence.frames.find((item) => item.ordinal === ordinal);
  const filename = frame?.filename && /^(frame|window-\d{1,8})-\d{3}\.jpg$/.test(frame.filename) ? frame.filename : frameName(ordinal);
  const digest = evidence.sources?.[frame?.source ?? 0]?.digest ?? evidence.digest;
  return readFile(path.join(evidenceDir(asset, digest), filename));
}

export async function sampleWindow(asset: AssetRow, evidence: Evidence, seconds: number): Promise<{ evidence: Evidence; images: Buffer[] }> {
  if (!evidence.duration || !Number.isFinite(seconds) || seconds < 0 || seconds >= evidence.duration) {
    throw badRequest("Choose a point inside this video.");
  }
  return temporary(asset.user_id, async (directory) => {
    const start = Math.max(0, seconds - 0.15).toFixed(3);
    const end = Math.min(evidence.duration!, seconds + 0.30).toFixed(3);
    const prefix = `window-${Math.round(seconds * 1000)}`;
    const { stderr } = await runMedia("ffmpeg", [
      "-nostdin", "-hide_banner", "-protocol_whitelist", "file,pipe", "-i", assetFile(asset), "-an",
      "-vf", `setpts=PTS-STARTPTS,select='between(t,${start},${end})*(isnan(prev_selected_t)+gte(t-prev_selected_t,0.08))',scale='min(480,iw)':-2,showinfo`,
      "-fps_mode", "vfr", "-frames:v", "4", "-q:v", "5", path.join(directory, `${prefix}-%03d.jpg`),
    ], bounded);
    const files = (await readdir(directory)).sort();
    const times = timestamps(stderr);
    if (!files.length || times.length !== files.length) throw badRequest("There are no readable frames in that window.");
    const images = await Promise.all(files.map((name) => readFile(path.join(directory, name))));
    const frames = files.map((filename, index) => ({
      ordinal: evidence.frames.length + index, seconds: times[index], cutCandidate: false, filename,
      ...(evidence.sources ? { source: 0 } : {}),
    }));
    for (const file of files) await rename(path.join(directory, file), path.join(evidenceDir(asset, evidence.digest), file));
    return { evidence: { ...evidence, frames: [...evidence.frames, ...frames] }, images };
  });
}

export async function extractEvidence(asset: AssetRow): Promise<Evidence> {
  if (asset.kind === "audio") throw badRequest("Use an image or a video to learn a style.");
  const source = assetFile(asset);
  const digest = await digestOf(source);
  const stored = evidenceDir(asset, digest);
  try {
    const cached = JSON.parse(await readFile(path.join(stored, "evidence.json"), "utf8")) as Evidence;
    if (cached.audioCues !== undefined) return cached;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    return await temporary(asset.user_id, async (directory) => {
      const { stdout } = await runMedia("ffprobe", [
        "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,width,height:stream_side_data=rotation",
        "-of", "json", source,
      ], bounded);
      const media = JSON.parse(stdout) as {
        streams: { codec_type: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[];
        format: { duration?: string };
      };
      const video = media.streams.find((stream) => stream.codec_type === "video");
      if (!video?.width || !video.height) throw badRequest("This file has no readable picture.");
      const rotation = video.side_data_list?.find((item) => item.rotation != null)?.rotation ?? 0;
      const [width, height] = Math.abs(rotation) % 180 === 90 ? [video.height, video.width] : [video.width, video.height];
      const duration = asset.kind === "video" ? Number(media.format.duration ?? asset.duration) : null;
      if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 120)) {
        throw badRequest("Use a video with known timing and a maximum length of two minutes.");
      }
      const input = ["-nostdin", "-hide_banner", "-protocol_whitelist", "file,pipe", "-i", source, "-an", "-sn"];
      let anchors = [0];
      let cuts: number[] = [];
      if (duration !== null) {
        const detection = await runMedia("ffmpeg", [
          ...input, "-vf", "setpts=PTS-STARTPTS,scale=256:-2,select='gt(scene,0.32)',showinfo",
          "-f", "null", "-",
        ], bounded);
        cuts = timestamps(detection.stderr).slice(0, 16);
        anchors = [...[0, 0.18, 0.40, 0.65, 0.86].map((fraction) => duration * fraction), ...cuts.slice(0, 3)];
        if (cuts[0] != null) anchors.push(Math.max(0, cuts[0] - 0.12), Math.min(duration - 0.04, cuts[0] + 0.12));
      }
      const select = anchors.sort((a, b) => a - b).map((time) => {
        const at = Math.max(0, time).toFixed(6);
        return `gte(t,${at})*(isnan(prev_selected_t)+lt(prev_selected_t,${at}))`;
      }).join("+");
      const samples = await runMedia("ffmpeg", [
        ...input, "-vf", `setpts=PTS-STARTPTS,select='${select}',scale='min(640,iw)':-2,showinfo`,
        "-fps_mode", "vfr", "-frames:v", String(anchors.length), "-q:v", "5", path.join(directory, "frame-%03d.jpg"),
      ], bounded);
      const files = (await readdir(directory)).filter((name) => name.endsWith(".jpg")).sort();
      const times = timestamps(samples.stderr);
      if (!files.length || files.length !== times.length) throw badRequest("Frame extraction returned incomplete timing.");
      const hasAudio = media.streams.some((stream) => stream.codec_type === "audio");
      let audioCues: NonNullable<Evidence["audioCues"]> = [];
      if (hasAudio) {
        try {
          const audio = await runMedia("ffmpeg", [
            "-nostdin", "-hide_banner", "-protocol_whitelist", "file,pipe", "-i", source, "-map", "0:a:0", "-vn",
            "-af", "asetpts=PTS-STARTPTS,silencedetect=noise=-35dB:d=0.25", "-f", "null", "-",
          ], bounded);
          audioCues = [...audio.stderr.matchAll(/silence_(start|end):\s*([\d.eE+-]+)/g)]
            .slice(0, 24).map((match) => ({ seconds: Number(match[2]), type: match[1] === "start" ? "silence-start" : "silence-end" }))
            .filter((cue): cue is NonNullable<Evidence["audioCues"]>[number] => Number.isFinite(cue.seconds));
        } catch {
          // Presence is known from ffprobe. Audio cues are supplemental.
        }
      }
      const evidence: Evidence = {
        assetId: asset.id, digest, duration, width, height,
        hasAudio, audioCues,
        frames: files.map((_, ordinal) => ({
          ordinal, seconds: duration === null ? null : times[ordinal],
          cutCandidate: cuts.some((time) => Math.abs(time - times[ordinal]) < 0.04),
        })),
      };
      await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence));
      await mkdir(path.dirname(stored), { recursive: true, mode: 0o700 });
      try {
        await rename(directory, stored);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        for (const file of [...files, "evidence.json"]) await rename(path.join(directory, file), path.join(stored, file));
      }
      return evidence;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "media_analysis_failed", "Could not extract evidence. Check that the media plays and FFmpeg and FFprobe are installed.");
  }
}

export async function mockVideo(ownerId: string, width: number, height: number, duration: number) {
  return temporary(ownerId, async (directory) => {
    const file = path.join(directory, "mock.mp4");
    await runMedia("ffmpeg", [
      "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=24`,
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", String(duration),
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-af", "volume=0.1", "-movflags", "+faststart", file,
    ], bounded);
    return readFile(file);
  });
}

type Lab = [number, number, number];
type Color = { lab: Lab; weight: number };
type Palette = NonNullable<StyleMetrics["palette"]>;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => sum(values) / values.length;

function percentile(sorted: ArrayLike<number>, fraction: number) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

function rgbLab(r: number, g: number, b: number): Lab {
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const f = (value: number) => value > (6 / 29) ** 3 ? Math.cbrt(value) : value / (3 * (6 / 29) ** 2) + 4 / 29;
  const [red, green, blue] = [r, g, b].map(linear);
  const x = f((0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047);
  const y = f(0.2126729 * red + 0.7151522 * green + 0.0721750 * blue);
  const z = f((0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function labHex([lightness, a, b]: Lab) {
  const f = (value: number) => value > 6 / 29 ? value ** 3 : 3 * (6 / 29) ** 2 * (value - 4 / 29);
  const y = (lightness + 16) / 116;
  const xyz = [0.95047 * f(y + a / 500), f(y), 1.08883 * f(y - b / 200)];
  const [x, luminance, z] = xyz;
  const rgb = [
    3.2404542 * x - 1.5371385 * luminance - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * luminance + 0.0415560 * z,
    0.0556434 * x - 0.2040259 * luminance + 1.0572252 * z,
  ];
  return "#" + rgb.map((value) => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(255 * Math.min(1, Math.max(0, encoded))).toString(16).padStart(2, "0");
  }).join("");
}

const distance = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function clusterColors(colors: Color[]): Palette {
  const tally = sum(colors.map((color) => color.weight));
  let seed = 1729;
  const pick = (weights: number[]) => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    let target = seed / (2 ** 32) * sum(weights);
    return weights.findIndex((weight) => (target -= weight) < 0);
  };
  let centers = [colors[pick(colors.map((color) => color.weight))].lab];
  while (centers.length < 6) {
    const next = pick(colors.map((color) => color.weight * Math.min(...centers.map((center) => distance(center, color.lab)))));
    if (next < 0) break;
    centers.push(colors[next].lab);
  }
  let weights: number[] = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    const groups = centers.map(() => ({ lab: [0, 0, 0] as Lab, weight: 0 }));
    for (const color of colors) {
      let index = 0;
      for (let j = 1; j < centers.length; j++) {
        if (distance(centers[j], color.lab) < distance(centers[index], color.lab)) index = j;
      }
      const group = groups[index];
      group.weight += color.weight;
      for (let axis = 0; axis < 3; axis++) group.lab[axis] += color.lab[axis] * color.weight;
    }
    const next = groups.map((group, i): Lab => group.weight ? [group.lab[0] / group.weight, group.lab[1] / group.weight, group.lab[2] / group.weight] : centers[i]);
    const converged = next.every((center, i) => distance(center, centers[i]) < 1e-8);
    centers = next;
    weights = groups.map((group) => group.weight);
    if (converged) break;
  }
  return centers.flatMap((lab, i) => weights[i] ? [{ lab, hex: labHex(lab), weight: weights[i] / tally }] : [])
    .sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex));
}

function sampleStatistics(rgb: Buffer, width: number, height: number) {
  const frameSize = width * height;
  const frames = rgb.length / (frameSize * 3);
  if (!Number.isInteger(frames) || frames === 0) throw badRequest("The reference has no measurable picture.");
  const colors = new Map<number, number>();
  const luma = new Float64Array(rgb.length / 3);
  let saturation = 0;
  for (let i = 0; i < luma.length; i++) {
    const [r, g, b] = [rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]];
    const key = (r << 16) + (g << 8) + b;
    colors.set(key, (colors.get(key) ?? 0) + 1);
    luma[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const max = Math.max(r, g, b);
    saturation += max ? (max - Math.min(r, g, b)) / max : 0;
  }
  const sample = [...colors].map(([key, weight]) => ({
    lab: rgbLab((key >> 16) / 255, ((key >> 8) & 255) / 255, (key & 255) / 255),
    weight,
  }));
  const grains: number[] = [];
  for (let frame = 0; frame < frames && width >= 3 && height >= 3; frame++) {
    let residuals = 0;
    let squares = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const center = frame * frameSize + y * width + x;
        let box = 0;
        for (let row = -1; row <= 1; row++) {
          for (let column = -1; column <= 1; column++) box += luma[center + row * width + column];
        }
        const residual = luma[center] - box / 9;
        residuals += residual;
        squares += residual ** 2;
      }
    }
    const size = (width - 2) * (height - 2);
    grains.push(Math.sqrt(Math.max(0, squares / size - (residuals / size) ** 2)));
  }
  luma.sort();
  const [p5, p50, p95] = [0.05, 0.5, 0.95].map((fraction) => percentile(luma, fraction));
  return {
    palette: clusterColors(sample), grain: grains.length ? mean(grains) : null,
    tone: { p5, p50, p95, contrast: p95 - p5, saturation: saturation / luma.length,
      warmth: sum(sample.map((color) => color.lab[2] * color.weight)) / luma.length },
  };
}

function tempoOf(pcm: Buffer) {
  const hop = 220;
  const onset: number[] = [];
  let previous = 0;
  for (let offset = 0; offset + hop * 2 <= pcm.length; offset += hop * 2) {
    let squares = 0;
    for (let sample = offset; sample < offset + hop * 2; sample += 2) squares += pcm.readInt16LE(sample) ** 2;
    const energy = Math.sqrt(squares / hop);
    onset.push(Math.max(0, energy - previous));
    previous = energy;
  }
  if (onset.length < 300) return { tempo: null, confidence: null };
  const stepsPerMinute = 60 * 22050 / hop;
  const first = Math.floor(stepsPerMinute / 180);
  const last = Math.ceil(stepsPerMinute / 60);
  const average = mean(onset);
  const centered = onset.map((value) => value - average);
  const scores: number[] = [];
  for (let lag = first; lag <= last; lag++) {
    let product = 0;
    let left = 0;
    let right = 0;
    for (let i = lag; i < centered.length; i++) {
      product += centered[i] * centered[i - lag];
      left += centered[i] ** 2;
      right += centered[i - lag] ** 2;
    }
    scores.push(left && right ? product / Math.sqrt(left * right) : 0);
  }
  const peaks = scores.flatMap((score, i) => score >= (scores[i - 1] ?? -1) && score >= (scores[i + 1] ?? -1) ? [i] : []);
  const best = Math.max(...scores);
  const peak = peaks.find((i) => scores[i] >= best * 0.94);
  const confidence = Math.max(0, Math.min(1, peak === undefined ? best : scores[peak]));
  if (peak === undefined || confidence < 0.35) return { tempo: null, confidence };
  return { tempo: Math.min(180, Math.max(60, stepsPerMinute / (first + peak))), confidence };
}

type LocalMotion = { dx: number; dy: number; x: number; y: number };
function fitMotion(motions: LocalMotion[], width: number, height: number) {
  if (motions.length < 4) return null;
  const x = mean(motions.map((motion) => motion.x));
  const y = mean(motions.map((motion) => motion.y));
  const dx = mean(motions.map((motion) => motion.dx));
  const dy = mean(motions.map((motion) => motion.dy));
  let scale = 0;
  let angle = 0;
  let length = 0;
  for (const motion of motions) {
    const [u, v] = [motion.x - x, motion.y - y];
    scale += u * (motion.dx - dx) + v * (motion.dy - dy);
    angle += u * (motion.dy - dy) - v * (motion.dx - dx);
    length += u ** 2 + v ** 2;
  }
  if (length < 64 * motions.length) return null;
  const rotation = angle / length;
  const zoom = scale / length;
  return { dx: dx + zoom * (width / 2 - x) - rotation * (height / 2 - y),
    dy: dy + zoom * (height / 2 - y) + rotation * (width / 2 - x), rotation, zoom };
}

function cameraMotion(data: string, width: number, height: number) {
  // vid.stab ASCII stores local displacement followed by the center of the measured field.
  const frames = data.split("\n").filter((line) => line.startsWith("Frame "));
  const motions = frames.flatMap((line) => {
    const points = [...line.matchAll(/\(LM (-?\d+) (-?\d+) (-?\d+) (-?\d+) \d+ [^ )]+ [^ )]+\)/g)]
      .map(([, dx, dy, x, y]) => ({ dx: Number(dx), dy: Number(dy), x: Number(x), y: Number(y) }));
    const estimate = fitMotion(points, width, height);
    if (!estimate) return [];
    const residual = (m: LocalMotion) => {
      const x = m.x - width / 2;
      const y = m.y - height / 2;
      return Math.hypot(m.dx - estimate.dx - estimate.zoom * x + estimate.rotation * y,
        m.dy - estimate.dy - estimate.zoom * y - estimate.rotation * x);
    };
    const threshold = Math.max(1.5, 2.5 * percentile(points.map(residual).sort((a, b) => a - b), 0.5));
    const refined = fitMotion(points.filter((point) => residual(point) <= threshold), width, height);
    if (!refined) return [];
    // vid.stab registers the current frame to the previous one. Invert the
    // measured transform to report motion in playback order.
    const a = 1 + refined.zoom;
    const b = refined.rotation;
    const scaleSquared = a * a + b * b;
    if (!scaleSquared) return [];
    return [{
      dx: (-a * refined.dx - b * refined.dy) / scaleSquared,
      dy: (b * refined.dx - a * refined.dy) / scaleSquared,
      rotation: Math.atan2(-b, a),
      zoom: 1 / Math.sqrt(scaleSquared) - 1,
    }];
  });
  if (motions.length < 2 || motions.length * 2 < frames.length - 1) return null;
  const x = mean(motions.map((motion) => motion.dx));
  const y = mean(motions.map((motion) => motion.dy));
  const rotation = mean(motions.map((motion) => motion.rotation));
  const zoom = mean(motions.map((motion) => motion.zoom));
  const jitter = mean(motions.slice(1).map((motion, i) => Math.hypot(motion.dx - motions[i].dx, motion.dy - motions[i].dy)));
  const scale = Math.abs(zoom) * Math.min(width, height) / 2;
  const displacement = Math.hypot(x, y);
  let camera: StyleMetrics["motion"]["camera"] = "mixed";
  if (Math.abs(zoom) >= 0.0015 && scale >= displacement * 0.7) camera = zoom > 0 ? "push" : "pull";
  else if (jitter > Math.max(0.8, displacement)) camera = "handheld";
  else if (displacement < 0.2 && scale < 0.2 && Math.abs(rotation) < 0.002) camera = "static";
  else if (Math.abs(x) > 2 * Math.abs(y)) camera = "pan";
  else if (Math.abs(y) > 2 * Math.abs(x)) camera = "tilt";
  return { translation: { x, y }, rotation, zoom, jitter, camera };
}

export async function measureStyle(asset: AssetRow): Promise<StyleMetrics> {
  return temporary(asset.user_id, async (directory) => {
    const source = assetFile(asset);
    const options = { ...bounded, cwd: directory };
    const input = ["-nostdin", "-hide_banner", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", "-i", source];
    const attempt = async <T>(task: () => Promise<T>): Promise<T | null> => {
      try { return await task(); } catch { return null; }
    };
    const probe = await attempt(async () => {
      const { stdout } = await runMedia("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe",
        "-show_entries", "format=duration:stream=codec_type", "-of", "json", source], options);
      return measurementProbe.parse(JSON.parse(stdout));
    });
    const seconds = probe ? Number(probe.format?.duration ?? asset.duration) : NaN;
    const duration = asset.kind === "video" && Number.isFinite(seconds) && seconds > 0 && seconds <= 120 ? seconds : null;
    const hasAudio = probe?.streams?.some((stream) => stream.codec_type === "audio") ?? false;
    const reasons: StyleMetrics["reasons"] = {};

    const cutTimes = duration === null ? null : await attempt(async () => {
      const { stderr } = await runMedia("ffmpeg", [...input, "-an", "-sn", "-vf",
        "setpts=PTS-STARTPTS,scale=256:-2,select='gt(scene,0.32)',showinfo",
        "-frames:v", "401", "-f", "null", "-"], options);
      const cuts = timestamps(stderr);
      if (cuts.length > 400) throw badRequest("The reference exceeds the measured cut limit.");
      return cuts.filter((cut) => cut > 0 && cut < duration);
    });
    const shotLengths = cutTimes && duration !== null
      ? [0, ...cutTimes].map((time, i) => (cutTimes[i] ?? duration) - time).sort((a, b) => a - b) : [];
    const editing = {
      cutTimes,
      shotLengths: shotLengths.length ? { mean: mean(shotLengths), median: percentile(shotLengths, 0.5),
        p10: percentile(shotLengths, 0.1), p90: percentile(shotLengths, 0.9) } : { mean: null, median: null, p10: null, p90: null },
      cutsPer10s: cutTimes && duration ? 10 * cutTimes.length / duration : null,
    };
    if (!cutTimes) reasons.editing = asset.kind === "image" ? "Still references have no cuts." : "Cuts could not be measured within the analysis limits.";

    const picture = await attempt(async () => {
      const fps = duration === null ? "" : `fps=${(24 / duration).toFixed(8)},`;
      const { stdout, stderr } = await runMedia("ffmpeg", [...input, "-an", "-sn", "-vf",
        `${fps}scale=64:128:force_original_aspect_ratio=decrease,format=rgb24,showinfo`, "-frames:v", duration ? "24" : "1",
        "-threads", "1", "-f", "rawvideo", "pipe:1"], { ...options, encoding: "buffer" });
      const size = stderr.toString().match(/\bs:(\d+)x(\d+)/);
      if (!size) throw badRequest("Unable to read the sampled picture dimensions.");
      return sampleStatistics(stdout, Number(size[1]), Number(size[2]));
    });
    const palette = picture?.palette ?? null;
    const tone = picture?.tone ?? { p5: null, p50: null, p95: null, contrast: null, saturation: null, warmth: null };
    const grain = picture?.grain ?? null;
    if (!picture) { reasons.palette = "RGB sampling did not finish."; reasons.tone = reasons.palette; }
    if (grain === null) reasons.grain = "There were no readable 3×3 pixel neighborhoods.";

    const motionEnergy = duration === null ? null : await attempt(async () => {
      const { stderr } = await runMedia("ffmpeg", [...input, "-an", "-vf",
        "fps=12,scale=256:144,signalstats,metadata=print:key=lavfi.signalstats.YDIF", "-f", "null", "-"], options);
      const differences = [...stderr.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].slice(1).map((item) => Number(item[1]) / 255);
      return differences.length ? mean(differences) : null;
    });
    const filters = duration === null ? null : await attempt(async () => (await runMedia("ffmpeg", ["-hide_banner", "-filters"], options)).stdout);
    const canStabilize = /\bvidstabdetect\b/.test(filters ?? "");
    let camera: ReturnType<typeof cameraMotion> = null;
    if (canStabilize) {
      try {
        const help = await runMedia("ffmpeg", ["-hide_banner", "-h", "filter=vidstabdetect"], options);
        const fileFormat = /^\s*fileformat\b/m.test(`${help.stdout}\n${help.stderr}`) ? ":fileformat=ascii" : "";
        await runMedia("ffmpeg", [...input, "-an", "-vf",
          `fps=12,scale=256:144,format=yuv420p,vidstabdetect=accuracy=15:stepsize=3:mincontrast=0.15${fileFormat}:result=motion.trf`,
          "-f", "null", "-"], { ...options, env: { ...process.env, OMP_NUM_THREADS: "1" } });
        camera = cameraMotion(await readFile(path.join(directory, "motion.trf"), "utf8"), 256, 144);
      } catch {
        reasons.motion = "Camera motion analysis failed.";
      }
    }
    if (!camera) reasons.motion ??= duration === null ? "Still references have no camera motion." : canStabilize
      ? "Too few reliable motion fields were available." : "FFmpeg vidstabdetect is unavailable.";
    if (motionEnergy === null) reasons["motion.motionEnergy"] = "No consecutive video samples could be compared.";
    const motion = { ...(camera ?? { translation: null, rotation: null, zoom: null, jitter: null, camera: null }), motionEnergy };

    const loudness = !hasAudio ? null : await attempt(async () => {
      const { stderr } = await runMedia("ffmpeg", [...input, "-map", "0:a:0", "-vn", "-af", "ebur128=framelog=verbose", "-f", "null", "-"], options);
      const summary = stderr.split("Summary:").at(-1) ?? "";
      const value = (pattern: RegExp) => {
        const match = summary.match(pattern);
        return match ? Number(match[1]) : null;
      };
      const measured = value(/\bI:\s*(-?[\d.]+) LUFS/);
      return { integratedLufs: measured !== null && measured > -70 ? measured : null,
        loudnessRange: measured !== null && measured > -70 ? value(/\bLRA:\s*([\d.]+) LU/) : null };
    });
    const tempo = !hasAudio ? null : await attempt(async () => {
      const { stdout } = await runMedia("ffmpeg", [...input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "22050",
        "-t", "120", "-f", "s16le", "pipe:1"], { ...options, encoding: "buffer", maxBuffer: 5_400_000 });
      return tempoOf(stdout);
    });
    const audio = { ...(loudness ?? { integratedLufs: null, loudnessRange: null }), ...(tempo ?? { tempo: null, confidence: null }) };
    if (!hasAudio) reasons.audio = "The reference contains no readable audio stream.";
    else {
      if (audio.integratedLufs === null) reasons["audio.integratedLufs"] = "No integrated loudness above the measurement gate was available.";
      if (audio.loudnessRange === null) reasons["audio.loudnessRange"] = "Loudness range was unavailable.";
      if (audio.tempo === null) reasons["audio.tempo"] = "The onset signal was too short or did not reach the confidence threshold.";
      if (audio.confidence === null) reasons["audio.confidence"] = "There were too few PCM samples to measure confidence.";
    }
    return styleMetrics.parse({ editing, palette, tone, grain, motion, audio, reasons });
  });
}

const scalarPaths = [
  "editing.shotLengths.mean", "editing.shotLengths.median", "editing.shotLengths.p10", "editing.shotLengths.p90", "editing.cutsPer10s",
  "tone.p5", "tone.p50", "tone.p95", "tone.contrast", "tone.saturation", "tone.warmth", "grain",
  "motion.translation.x", "motion.translation.y", "motion.rotation", "motion.zoom", "motion.jitter", "motion.motionEnergy",
  "audio.integratedLufs", "audio.loudnessRange", "audio.tempo", "audio.confidence",
] as const;

function aggregateMeasurements(inputs: StyleMetrics[]) {
  const spread: NonNullable<Evidence["metricSpread"]> = {};
  const reasons: StyleMetrics["reasons"] = { "editing.cutTimes": "Cut times are recorded separately for each reference." };
  const summarize = (path: string, values: number[]) => {
    if (!values.length) return null;
    const center = mean(values);
    spread[path] = Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
    return center;
  };
  const values = new Map(scalarPaths.map((path) => {
    const entries = inputs.map((stats) => metricAt(stats, path)).filter((value): value is number => typeof value === "number");
    const result = summarize(path, entries);
    if (result === null) reasons[path] = "The references have no comparable measurements for this field.";
    return [path, result] as const;
  }));
  const get = (path: typeof scalarPaths[number]) => values.get(path) ?? null;
  const palettes = inputs.flatMap((stats) => stats.palette?.length ? [stats.palette] : []);
  const palette = palettes.length ? clusterColors(palettes.flat()) : null;
  if (!palette) reasons.palette = "No reference palette could be measured.";
  palette?.forEach((color, i) => {
    const matching = palettes.map((colors) => colors.filter((entry) =>
      palette.every((center) => distance(entry.lab, color.lab) <= distance(entry.lab, center.lab))));
    summarize(`palette.${i}.weight`, matching.map((entries) => sum(entries.map((entry) => entry.weight))));
    for (const axis of [0, 1, 2] as const) {
      const centers = matching.flatMap((entries) => entries.length
        ? [sum(entries.map((entry) => entry.lab[axis] * entry.weight)) / sum(entries.map((entry) => entry.weight))] : []);
      summarize(`palette.${i}.lab.${axis}`, centers);
    }
  });
  const cameras = new Set(inputs.flatMap((stats) => stats.motion.camera ? [stats.motion.camera] : []));
  const camera = cameras.size > 1 ? "mixed" : [...cameras][0] ?? null;
  if (!camera) reasons["motion.camera"] = "No reference had a measurable camera classification.";
  const x = get("motion.translation.x");
  const y = get("motion.translation.y");
  if (x === null || y === null) reasons["motion.translation"] = "No reference had measurable translation.";
  const metrics: StyleMetrics = {
    editing: { cutTimes: null, cutsPer10s: get("editing.cutsPer10s"),
      shotLengths: { mean: get("editing.shotLengths.mean"), median: get("editing.shotLengths.median"),
        p10: get("editing.shotLengths.p10"), p90: get("editing.shotLengths.p90") } },
    palette, grain: get("grain"),
    tone: { p5: get("tone.p5"), p50: get("tone.p50"), p95: get("tone.p95"), contrast: get("tone.contrast"),
      saturation: get("tone.saturation"), warmth: get("tone.warmth") },
    motion: { translation: x === null || y === null ? null : { x, y }, rotation: get("motion.rotation"),
      zoom: get("motion.zoom"), jitter: get("motion.jitter"), motionEnergy: get("motion.motionEnergy"), camera },
    audio: { integratedLufs: get("audio.integratedLufs"), loudnessRange: get("audio.loudnessRange"),
      tempo: get("audio.tempo"), confidence: get("audio.confidence") },
    reasons,
  };
  return { metrics, metricSpread: spread };
}

export async function measureReferences(assets: AssetRow[]): Promise<Evidence> {
  const sources: Array<Evidence & { metrics: StyleMetrics }> = [];
  // Analyze one file at a time so an eight-source job does not fan out media processes.
  for (const asset of assets) {
    const evidence = await extractEvidence(asset);
    sources.push({ ...evidence, metrics: await measureStyle(asset) });
  }
  const first = sources[0];
  if (!first) throw badRequest("Choose at least one reference.");
  if (sources.length === 1) return first;
  const budget = 10;
  const frames: Evidence["frames"] = [];
  sources.forEach((source, index) => {
    const available = Math.floor(budget / sources.length) + (index < budget % sources.length ? 1 : 0);
    const count = Math.min(available, source.frames.length);
    for (let i = 0; i < count; i++) {
      const position = count === 1 ? Math.floor(source.frames.length / 2) : Math.round(i * (source.frames.length - 1) / (count - 1));
      const frame = source.frames[position];
      frames.push({ ...frame, ordinal: frames.length, source: index, filename: frameName(frame.ordinal) });
    }
  });
  const aggregated = aggregateMeasurements(sources.map((source) => source.metrics));
  return {
    ...first, ...aggregated, frames,
    sources: sources.map(({ assetId, digest, duration, width, height, hasAudio, metrics }) => ({
      assetId, digest, duration, width, height, hasAudio, metrics,
    })),
  };
}
