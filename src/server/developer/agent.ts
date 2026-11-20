import "server-only";

import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import appRoutes from "./app-routes.json";
import { saveAsset, toAsset } from "../assets";
import { hashToken, type User } from "../auth";
import { run } from "../db";
import { ApiError, badRequest } from "../errors";
import { checkResolves, guardedLookup, isAllowedLocal, UrlRefused } from "./netguard";

/**
 * Full-account agent access: an agent with an `account` key works the app's own API as its owner.
 * Each call runs with a single-use session that lasts at most two minutes and is deleted afterwards.
 */

/** Paths an agent may never call: sign-in, keys, account settings, billing and the MCP endpoint itself. */
const DENIED = ["/api/auth", "/api/developer", "/api/mcp", "/api/account", "/api/billing", "/api/wallet/topup", "/api/v1"];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MAX_REPLY = 60_000;

export function listRoutes(query: unknown) {
  const words = typeof query === "string" ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const rows = (appRoutes as { method: string; path: string; summary: string }[])
    .filter((r) => !DENIED.some((p) => r.path === p || r.path.startsWith(p + "/")))
    .filter((r) => words.every((w) => `${r.method} ${r.path} ${r.summary}`.toLowerCase().includes(w)));
  return { routes: rows.slice(0, 200), total: rows.length };
}

function checkPath(raw: unknown): string {
  const path = typeof raw === "string" ? raw.trim() : "";
  const url = new URL(path || "/", "http://agent.invalid");
  if (!path.startsWith("/api/") || url.host !== "agent.invalid" || /(^|\/)\.\.?(\/|$)/.test(url.pathname)) {
    throw badRequest("Give a path that starts with /api/, such as /api/director/projects.");
  }
  if (DENIED.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) {
    throw new ApiError(403, "forbidden", "Agents cannot use sign-in, keys, account settings, billing or the MCP endpoint.");
  }
  return url.pathname + url.search;
}

/** The app itself on loopback: the port it listens on, else the port this request arrived on. */
function base(requestUrl: string) {
  const port = process.env.PORT || new URL(requestUrl).port || "80";
  return `http://127.0.0.1:${port}`;
}

/** Calls the app's own API as the key's owner and returns the status and the answer. */
export async function appRequest(user: User, input: { method?: unknown; path?: unknown; body?: unknown }, requestUrl: string) {
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "GET";
  if (!METHODS.includes(method)) throw badRequest("method must be GET, POST, PUT, PATCH or DELETE.");
  const path = checkPath(input.path);
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    hashToken(token), user.id, now, now + 120_000, "Agent (API key)", now,
  );
  try {
    const response = await fetch(base(requestUrl) + path, {
      method, redirect: "manual", signal: AbortSignal.timeout(90_000),
      headers: { cookie: `px_session=${token}`, ...(input.body === undefined ? {} : { "content-type": "application/json" }) },
      body: input.body === undefined || method === "GET" ? undefined : JSON.stringify(input.body),
    });
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("json")) {
      const text = await response.text();
      return text.length > MAX_REPLY
        ? { status: response.status, truncated: true, body: text.slice(0, MAX_REPLY) }
        : { status: response.status, body: text ? JSON.parse(text) : null };
    }
    const bytes = (await response.arrayBuffer()).byteLength;
    return { status: response.status, contentType: type || null, bytes, note: "Binary or page content is not returned. Open it in the app." };
  } finally {
    run("DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
  }
}

const FILE_LIMIT = 100 * 1024 * 1024;

function download(url: URL): Promise<Buffer> {
  const local = isAllowedLocal(url);
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, { lookup: guardedLookup(local), timeout: 60_000, headers: { "user-agent": "Out of Order Studio agent import" } }, (res) => {
      if ((res.statusCode ?? 0) >= 300) {
        res.resume();
        reject(new ApiError(422, "import_failed", `The file address answered HTTP ${res.statusCode}. Give a direct link to the file.`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > FILE_LIMIT) {
          req.destroy();
          reject(new ApiError(413, "import_failed", "That file is larger than 100 MB."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => reject(err instanceof ApiError ? err : new ApiError(422, "import_failed", "The file could not be downloaded.")));
  });
}

/** Saves a public image, video or audio file into the owner's Library. */
export async function importFile(user: User, input: { url?: unknown; title?: unknown }) {
  let url: URL;
  try {
    url = new URL(String(input.url ?? ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    await checkResolves(url);
  } catch (err) {
    throw badRequest(err instanceof UrlRefused ? err.message : "Give a public http(s) link to an image, video or audio file.");
  }
  const bytes = await download(url);
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 120) : url.pathname.split("/").pop() || "Imported file";
  const asset = await saveAsset({ userId: user.id, bytes, source: "upload", title });
  return { file: toAsset(asset) };
}
