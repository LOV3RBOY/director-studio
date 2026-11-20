// Builds src/server/developer/app-routes.json, the API index agents read through the
// app_routes tool, from the "METHOD /api/path  summary" doc lines in each route file and
// the Director entries below. Run `node scripts/app-routes.mjs`; `--check` fails when stale.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "src/server/developer/app-routes.json");

const director = [
  ["GET", "/api/director/status", "Director mode."],
  ["GET", "/api/director/models", "Render models a Director project can use, with clip lengths, aspects and resolutions."],
  ["GET", "/api/director/styles", "Saved and draft styles."],
  ["POST", "/api/director/styles", "{ assetIds: [fileId] (1-8), title, notes? }  Learn a style from reference files. Returns a job."],
  ["GET", "/api/director/styles/:styleId", "A style with its versions, rules, guide and evidence."],
  ["POST", "/api/director/styles/:styleId/save", "{ previousId: versionId, guide }  Save a version to the Style Library."],
  ["POST", "/api/director/styles/:styleId/retry", "Study the references again."],
  ["GET", "/api/director/projects", "Director projects."],
  ["POST", "/api/director/projects", "{ title, styleVersionId, brief, constraints?, cast?: [{ name, notes?, assetIds }], duration (s), aspect, model }  Start a styled project; the Director writes the storyboard."],
  ["GET", "/api/director/projects/:projectId", "Project detail: brief, current pack (storyboard + compiled prompts), jobs and takes."],
  ["POST", "/api/director/projects/:projectId/chat", "{ message }  Talk to the Director; it can revise the storyboard."],
  ["POST", "/api/director/projects/:projectId/pack", "{ previousId, plan, settings }  Save an edited storyboard as a new pack version."],
  ["POST", "/api/director/projects/:projectId/plan", "Retry a failed storyboard."],
  ["GET", "/api/director/packs/:packId", "A pack version."],
  ["POST", "/api/director/packs/:packId/review", "Mark the pack reviewed."],
  ["POST", "/api/director/packs/:packId/export", "Build a ZIP of prompts and references; returns a job."],
  ["GET", "/api/director/packs/:packId/quote/:clip", "Price to render clip N (0-based)."],
  ["POST", "/api/director/packs/:packId/render", "{ clip, requestKey (16+ chars, unique per approval), maxCredits }  Render a clip; maxCredits must cover the quote."],
  ["GET", "/api/director/packs/:packId/image-quote/:index", "Price for image prompt N (character sheet or keyframe)."],
  ["POST", "/api/director/packs/:packId/images", "{ index, requestKey, maxCredits }  Generate a character sheet or keyframe."],
  ["GET", "/api/director/packs/:packId/images", "Image attempts for the pack."],
  ["GET", "/api/director/jobs/:jobId", "A Director job (analysis, plan, chat, render, export)."],
  ["GET", "/api/director/renders/:jobId/fidelity", "How closely a delivered take follows its style."],
  ["POST", "/api/director/renders/:jobId/fidelity", "Score a take again."],
  ["POST", "/api/director/renders/:jobId/grade", "{ strength? (0-1], grain? }  Grade a take toward its style; makes a new file."],
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name === "route.ts" ? [p] : [];
  });
}

// Methods and paths come from each route file's location and exports; doc lines only add summaries.
const shape = (p) => p.replace(/:[^/]+/g, ":");
const rows = new Map();
for (const file of walk(path.join(root, "src/app/api")).sort()) {
  const dir = path.relative(path.join(root, "src/app"), path.dirname(file)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
  if (dir.some((s) => s.startsWith("[..."))) continue; // catch-all handlers are listed by hand below
  const route = "/" + dir.map((s) => s.replace(/^\[(.+)\]$/, ":$1")).join("/");
  if (route.startsWith("/api/director")) continue;
  const source = readFileSync(file, "utf8");
  const methods = [...source.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  const docs = new Map();
  for (const line of source.split("\n")) {
    const m = /^\s*(?:\/\*\*|\*)\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s?`\[]*)(\?[^\s]*|\[[^\]]*\])?:?\s*(.*?)\s*(?:\*\/)?$/.exec(line);
    if (m && shape(m[2]) === shape(route)) docs.set(m[1], `${m[3] ? `Query ${m[3]}  ` : ""}${m[4]}`.trim());
  }
  for (const method of new Set(methods)) rows.set(`${method} ${route}`, { method, path: route, summary: docs.get(method) ?? "" });
}
for (const [method, p, summary] of director) rows.set(`${method} ${p}`, { method, path: p, summary });
const json = JSON.stringify([...rows.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)), null, 1) + "\n";

if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== json) {
    console.error("app-routes.json is stale. Run node scripts/app-routes.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(out, json);
  console.log(`${rows.size} routes`);
}
