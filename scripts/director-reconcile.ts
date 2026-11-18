import { get, run, tx } from "../src/server/db";
import { release, settle } from "../src/server/credits";

const [, , id, action, detail, resumeNote] = process.argv;
const unavailable = "Only a live render in review can be reconciled.";
if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !["resume", "release", "charge"].includes(action ?? "") || !detail) {
  throw new Error("Usage: director-reconcile <job-id> resume <provider-id> <verification-note> | release <verification-note> | charge <verification-note>");
}
const note = (action === "resume" ? resumeNote : detail)?.trim();
if (!note || note.length < 12 || note.length > 400) throw new Error("Record a 12–400 character provider verification note, without credentials or URLs.");
if (action === "resume" && !/^[a-zA-Z0-9_-]{1,160}$/.test(detail)) throw new Error("Enter a confirmed MuAPI request ID.");

tx(() => {
  const row = get<{ provider_id: string | null }>(
    "SELECT provider_id FROM director_jobs WHERE id = ? AND mode = 'live' AND kind = 'render' AND state = 'review'", id,
  );
  if (!row) throw new Error(unavailable);
  const now = Date.now();
  if (action === "resume") {
    if (row.provider_id && row.provider_id !== detail) throw new Error("The stored provider request differs. Inspect the attempt.");
    run("UPDATE director_jobs SET state = 'polling', provider_id = ?, next_run = ?, updated_at = ?, error = NULL WHERE id = ?", detail, now, now, id);
  } else {
    if (action === "release") release(id, "Director render confirmed unbilled");
    else settle(id);
    run(`UPDATE director_jobs SET state = 'failed', error = ?, updated_at = ?,
      released = CASE WHEN ? = 'release' THEN reserved ELSE 0 END,
      spent = CASE WHEN ? = 'charge' THEN reserved ELSE 0 END WHERE id = ?`,
    JSON.stringify({ code: "render_reconciled", message: action === "release" ? "The unbilled reservation was released." : "The billed attempt was settled without a take." }),
    now, action, action, id);
  }
  run("INSERT INTO director_render_reviews (job_id, action, note, created_at) VALUES (?, ?, ?, ?)", id, action, note, now);
});
console.log("Recorded Director render review.");
