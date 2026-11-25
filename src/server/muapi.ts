/**
 * The MuAPI client for the shared generation pipeline. MuAPI jobs are asynchronous:
 * POST the request, get a `request_id`, then poll `/api/v1/predictions/{id}/result` until
 * `status` is `completed` (files in `outputs`) or `failed` (reason in `error`).
 * The key is server-side only: MUAPI_API_KEY, or the Director's DIRECTOR_MUAPI_KEY.
 */
import { tidy } from "./treg";

/** Overridable for tests against a stand-in server. */
const BASE = process.env.MUAPI_BASE_URL || "https://api.muapi.ai";

export const muapiKey = () => process.env.MUAPI_API_KEY || process.env.DIRECTOR_MUAPI_KEY || "";

/** A transport failure: no answer, so the request may or may not have been taken. */
export class MuapiUnreachable extends Error {}

/** MuAPI answered and said no. `retry` is true for a busy or overloaded answer. */
export class MuapiRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const key = muapiKey();
  if (!key) throw new MuapiRefused("Video isn't connected on this server yet.", 503, false);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-api-key": key, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new MuapiUnreachable(err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text answer */
  }
  if (!res.ok) {
    const said = body && typeof body === "object" ? ((body as Record<string, unknown>).detail ?? (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message) : text;
    const message = typeof said === "string" && said.trim() ? tidy(said) : `MuAPI answered HTTP ${res.status}.`;
    throw new MuapiRefused(message, res.status, res.status === 429 || res.status >= 500);
  }
  return body;
}

/** Sends a generation. Returns MuAPI's request id. */
export async function muapiSubmit(path: string, body: unknown): Promise<string> {
  const reply = (await call(path, { method: "POST", body: JSON.stringify(body) }, 60_000)) as Record<string, unknown> | null;
  const id = reply?.request_id ?? reply?.id ?? (reply?.data as Record<string, unknown> | undefined)?.request_id;
  if (typeof id !== "string" || !id) throw new MuapiRefused("MuAPI did not return a request id.", 502, false);
  return id;
}

export type MuapiResult = { state: "running" } | { state: "failed"; message: string } | { state: "done"; urls: string[] };

/** Reads where a request stands. */
export async function muapiResult(requestId: string): Promise<MuapiResult> {
  const reply = (await call(`/api/v1/predictions/${encodeURIComponent(requestId)}/result`, { method: "GET" }, 30_000)) as Record<string, unknown> | null;
  const data = (reply?.data && typeof reply.data === "object" ? reply.data : reply) as Record<string, unknown> | null;
  const status = String(data?.status ?? "").toLowerCase();
  if (status === "failed" || status === "error" || status === "canceled" || status === "cancelled") {
    const err = data?.error;
    return { state: "failed", message: typeof err === "string" && err.trim() ? tidy(err) : "The model could not make this one. Try again." };
  }
  if (status !== "completed" && status !== "succeeded" && status !== "success") return { state: "running" };
  const raw = data?.outputs ?? data?.output;
  const urls = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (typeof v === "string" ? [v] : v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? [(v as { url: string }).url] : []));
  if (urls.length === 0) return { state: "failed", message: "The model finished without a file. Try again." };
  return { state: "done", urls };
}
