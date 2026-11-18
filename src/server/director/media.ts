import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assetFile, type AssetRow } from "../assets";
import { dataDir } from "../db";
import { ApiError, badRequest } from "../errors";
import type { Evidence } from "./contracts";

export const runMedia = promisify(execFile);
const bounded = { timeout: 45_000, maxBuffer: 2_000_000 };

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
  const supplemental = evidence.frames.find((item) => item.ordinal === ordinal)?.filename;
  const filename = supplemental && /^window-\d{1,8}-\d{3}\.jpg$/.test(supplemental) ? supplemental : frameName(ordinal);
  return readFile(path.join(evidenceDir(asset, evidence.digest), filename));
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
