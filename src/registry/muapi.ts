/**
 * Seedance 2.5 through MuAPI (muapi.ai), outside the Treg gateway. MuAPI has three Seedance 2.5
 * endpoints and a request cannot mix them:
 *   omni-reference     up to 30 reference images (identity, outfits, places) + prompt
 *   image-to-video     one first frame + prompt
 *   first-last-frame   exactly [first, last] + prompt
 * So the models mirror Seedance's own two modes: References, or Frames (first, optional last).
 *
 * Prices are MuAPI's published per-second rates (no reference video), the same on all three.
 * The worker sends these jobs to MuAPI itself (src/server/muapi.ts); the endpoint ids below
 * only exist here, not in treg-catalog.json.
 */
import { aspect, compact, resolution, select } from "./helpers";
import type { CatalogEndpoint } from "./quote";
import type { MediaSlot, ModelDef } from "./types";

const RATES: [string, number][] = [["480p", 0.17], ["720p", 0.34], ["1080p", 0.85], ["4k", 1.7]];
const cost = { table: RATES.map(([res, usd]) => ({ when: { "body.resolution": res }, value: usd, times: "body.duration" })), ceiling: 51 };
const async = { interval: 8, statusPath: "status", success: ["completed"], failure: ["failed"], resultPath: "outputs" };
const endpoint = (slug: string, name: string): CatalogEndpoint => ({
  provider: "muapi", platform: null, name, method: "POST", path: `/api/v1/${slug}`, params: [], cost, async,
});

export const MUAPI_ENDPOINTS: Record<string, CatalogEndpoint> = {
  "muapi.seedance-2-5.omni-reference": endpoint("seedance-2.5-omni-reference", "Seedance 2.5 Omni Reference"),
  "muapi.seedance-2-5.image-to-video": endpoint("seedance-2.5-image-to-video", "Seedance 2.5 Image to Video"),
  "muapi.seedance-2-5.first-last-frame": endpoint("seedance-2.5-first-last-frame", "Seedance 2.5 First & Last Frame"),
};

/** The MuAPI path for an endpoint id, or null when the id is not a MuAPI one. */
export function muapiPath(endpointId: string): string | null {
  return MUAPI_ENDPOINTS[endpointId]?.path ?? null;
}

const PROMPT = { required: true, maxLength: 4000, placeholder: "Describe the shot: who, where, what happens, camera." };
const REFS: MediaSlot = { id: "refs", label: "References", hint: "People, outfits or places to keep.", accept: ["image"], min: 1, max: 9 };
const FIRST: MediaSlot = { id: "start", label: "First frame", hint: "The shot starts on this image.", accept: ["image"], min: 1, max: 1 };
const LAST: MediaSlot = { id: "end", label: "Last frame", hint: "Optional. The shot lands on this image.", accept: ["image"], min: 0, max: 1 };
const durations = select("duration", "Duration", [5, 8, 10, 15].map((s) => ({ value: String(s), label: `${s}s` })), "5");
const sizes = () => resolution(["720p", "1080p"], "1080p");
const base: Pick<ModelDef, "kind" | "vendor" | "status" | "surfaces" | "prompt" | "batch" | "output"> = {
  kind: "video", vendor: "ByteDance", status: "available", surfaces: ["apps"], prompt: PROMPT, batch: { max: 1, native: false }, output: "video",
};

export const muapiVideoModels: ModelDef[] = [
  {
    ...base,
    id: "seedance-2.5-refs",
    name: "Seedance 2.5 References",
    tagline: "Seedance 2.5 on MuAPI from up to 9 reference images.",
    slots: [REFS],
    controls: [aspect(["9:16", "16:9", "1:1"], "9:16"), durations, sizes()],
    eta: 150,
    build({ prompt, values, media }) {
      return {
        endpoint: "muapi.seedance-2-5.omni-reference",
        body: compact({
          prompt,
          images_list: (media.refs ?? []).map((m) => m.url),
          aspect_ratio: values.aspect,
          duration: Number(values.duration),
          resolution: values.resolution,
          seed: -1,
          omni_reference_task_type: "reference",
        }),
      };
    },
  },
  {
    ...base,
    id: "seedance-2.5-frames",
    name: "Seedance 2.5 Frames",
    tagline: "Seedance 2.5 on MuAPI from a first frame and an optional last frame.",
    slots: [FIRST, LAST],
    controls: [durations, sizes()],
    eta: 150,
    build({ prompt, values, media }) {
      const first = media.start?.[0]?.url;
      const last = media.end?.[0]?.url;
      const shared = { prompt, duration: Number(values.duration), resolution: values.resolution, seed: -1 };
      return last
        ? { endpoint: "muapi.seedance-2-5.first-last-frame", body: compact({ ...shared, images_list: [first, last] }) }
        : { endpoint: "muapi.seedance-2-5.image-to-video", body: compact({ ...shared, image_url: first }) };
    },
  },
];
