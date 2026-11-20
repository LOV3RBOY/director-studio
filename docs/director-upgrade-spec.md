# Codex Build Spec: Director Studio Style System & Agent Upgrade

Nov 19, 2026 · Owner: @chad homan · Repo: `LOV3RBOY/director-studio`, branch `codex/director-studio`

## 0. How to use this spec

**To the owner:** export this doc as Markdown, commit it to the repo as `docs/director-upgrade-spec.md`, and start Codex with:

> Read `docs/director-upgrade-spec.md` in full, then `AGENTS.md`. Execute Phase A only, following Sections 1–3 exactly. Stop at the end of the phase and report.

Run **one phase per Codex session and one pull request per phase**. Don't start the next phase until the previous PR is merged and CI is green.

**To the agent:** this document is the contract. Sections 1–3 apply to every task. Sections 4–9 define the work. If the spec and the code disagree, stop and report the disagreement instead of guessing.

## 1. Operating rules (non-negotiable)

### 1.1 Follow the spec, not your own ideas

1. Build only what this spec defines. No extra features, renames, refactors or "improvements" outside the task's listed files.
2. Never invent APIs, provider endpoints, model limits, ffmpeg filters or library functions. Check every external contract against the installed source or its official docs before you use it. If you can't verify something, stop and log the question (Section 1.4).
3. Next.js here is 16.x and differs from your training data. Before you edit any route, read the relevant guide in `node_modules/next/dist/docs/`, as `AGENTS.md` requires.
4. Do every task completely. No `TODO`, stub, placeholder or "left as an exercise". If a task can't be finished, mark it **Blocked** in the ledger with the reason.

### 1.2 Preserve what's correct

These behaviors are correct. Keep them unchanged, and keep their tests passing:

- **Evidence discipline:** `verifyGuidance` in `src/server/director/contracts.ts` requires full topic coverage, no duplicate rules, and frame citations for every observed or inferred rule.
- **Immutable versions:** style versions (`director_style_versions`) and pack snapshots (`director_packs`). A change always creates a new version.
- **Idempotent jobs:** the `request_key` uniqueness, the reserved/spent/released credit accounting, and the restart-to-`review` safety in `worker.ts`.
- **Scoped runtime:** `assertScoped` refuses any gateway that exposes tools. The JSON-only Director instruction and its prompt-injection guard stay as they are.
- **Compiler validation:** contiguous clips and shots, per-model reference limits, role–modality rules, no cuts in continuous clips, the cast-identity rules and the prompt length cap.
- **Safety and spending:** owner-scoped SQL in every query, `ctx.ask` approvals for anything that spends credits, and the `DIRECTOR_MODE` mock/live split. The demo-billing conflict guard stays.
- **License:** the upstream Parallax MIT license and copyright notice stay.

### 1.3 Removing code

Only remove code that this spec makes obsolete. Before deleting anything, prove it's unused: no `rg` hits outside its own definition and tests, and typecheck, build and tests all pass after removal. List every removal in the PR with its proof. **Never** edit an existing migration. Migrations are append-only, numbered `170_`, `180_` and up.

### 1.4 Stay on track (ledger protocol)

1. At the start of each phase, add a checklist for it to `docs/director-studio-ledger.md` under `## Upgrade progress`, with one line per task ID from this spec.
2. After each task, tick it and add one line: the files changed and the tests added.
3. Log open questions or blockers under `### Open questions` with the task ID. Don't guess past them.
4. Before ending a session, re-read the phase's acceptance criteria and confirm each one in the ledger.

### 1.5 Token efficiency

- Search with `rg` and read only the functions you'll change plus their direct callers. Never dump whole files or directories.
- Don't re-read a file you just edited, don't restate code back, and don't regenerate unchanged files.
- Batch related edits to the same file. Keep progress messages to one line and PR summaries to 15 lines or fewer.
- Reuse the existing helpers: `runMedia`, `temporary`, `privateDirectory`, `saveAsset`, `ownedAsset`, `queue` and `finish`/`reject` in the director store, `valid`, `ApiError`/`badRequest`, and the tool types in `super/tools.ts`.

### 1.6 Engineering standard

- **TypeScript:** strict typing with no `any`. Validate every boundary with zod v4. Mark server-only modules with `import "server-only"` where siblings do.
- **Determinism:** analysis algorithms use fixed seeds and are deterministic, so the same input gives the same output.
- **Bounded work:** every ffmpeg/ffprobe call is bounded (timeout and maxBuffer, like `bounded` in `media.ts`) and writes only inside `temporary()` directories.
- **Errors:** user-facing errors are short and safe (`badRequest` or `ApiError`) and never leak paths or provider bodies.
- **No new npm dependencies** unless a task explicitly allows one. Signal processing goes in plain TypeScript on raw PCM/RGB from ffmpeg.
- **Reference docs:** [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html) (`select`/scene, `ebur128`, `signalstats`, `vidstabdetect`, `lut3d`, `noise`), [Zod JSON Schema](https://zod.dev/json-schema) (`z.toJSONSchema`), [MCP specification](https://modelcontextprotocol.io/specification), CIEDE2000 colour difference, Reinhard et al. 2001 colour transfer, and k-means++ seeding.

## 2. Definition of done (every task)

1. `npm run check:registry`, `npm run typecheck`, `npm run build` and `npm test` pass with `TREG_MODE=mock SUPER_MODE=mock DIRECTOR_MODE=mock`.
2. New behavior has provider-free tests in `tests/` (Python, against the built server, in the same style as `tests/director.py`). Algorithm tests use synthetic media with known properties, made with ffmpeg `lavfi` sources.
3. Existing tests are unchanged unless this spec changes the behavior they assert. If so, list each one in the PR with the reason.
4. Backward compatibility: style profiles at schema v1 still load, render and display, on both web and iOS.
5. Docs are updated: `docs/director-studio-runbook.md` for new environment variables and operations, and `docs/api/super.md` for new agent tools.
6. The ledger is updated (Section 1.4).

## 3. Verified code map

Read only what your task needs.

| Area | Files | Role today |
| --- | --- | --- |
| Style contracts | `src/server/director/contracts.ts` | zod schemas: the 14 `topics`, `guidance` rules, `Evidence`, `StyleProfile` (schemaVersion 1), `plan`, `packSettings` |
| Evidence extraction | `src/server/director/media.ts` | `extractEvidence` (ffprobe, scene cuts capped at 16, about 10 anchor frames at 640px, silence cues), `sampleWindow`, `mockVideo` |
| Analysis and planning | `src/server/director/runtime.ts` | `turn()` to the scoped Hermes `/v1/responses`; `studyStyle`, `directProject`, `directChat`; mock fixtures |
| Compile | `src/server/director/compiler.ts` | `compilePack` (Seedance 2.0 and 2.5 limits and validation), `providerBody` |
| Store and jobs | `store.ts`, `worker.ts`, `delivery.ts` | style and project rows, packs, job queue, MuAPI submission and render intake |
| API | `src/app/api/director/[...parts]/route.ts` | Director routes |
| Web UI | `src/components/workspace/style-library.tsx`, `style-proof.tsx` | library and pack review flags |
| iOS | `ios/DirectorStudio/StudioModels.swift` (`StyleProfile`, `StyleRule`, `Evidence`, all `Decodable`), `StylesView.swift`, `PackEditor.swift` | native client |
| Agent | `src/server/super/tools.ts` (`ToolDef`, `toolsFor`, `engineTools`, `open_studio`), `loop.ts`, `engine-mcp.ts`, `library.ts` (skills, memories), `src/config/studio-agents.ts` (6 fixed personas) | Super agent |
| Schema | `migrations/120_director.sql` … `160_director_pack_review.sql` | SQLite |

## 4. Phase A: Style DNA and multi-reference learning

**Goal:** turn style rules from descriptions into measurements, and learn one style from several reference clips.

### A1. `measureStyle()` in `media.ts`

Add `measureStyle(asset): Promise<StyleMetrics>`, computed with ffmpeg/ffprobe plus TypeScript only. Add the `StyleMetrics` zod schema to `contracts.ts`. Report every field that can't be measured as `null` with a `reason`. Never estimate a value.

- **Editing:** detect scene cuts across the whole clip with the existing `select='gt(scene,0.32)'` method. Cap cuts at 400 for metrics (the existing 16-cut cap stays for frame anchors). Output `shotLengths` as mean, median, p10, p90 and `cutsPer10s`.
- **Palette:** sample about 24 frames at 64px wide as `rgb24` raw frames. Run deterministic k-means++ (k = 6, fixed seed) in CIELAB. Output `palette: {hex, lab, weight}[]`, sorted by weight.
- **Tone:** luma percentiles p5, p50 and p95 (0–1), `contrast` = p95 − p5, mean saturation (HSV), and `warmth` (mean Lab b\*).
- **Grain:** standard deviation of the luma high-pass residual (frame minus a 3×3 box blur), averaged across the sampled frames.
- **Motion:** if `ffmpeg -filters` lists `vidstabdetect`, derive per-frame translation, rotation and zoom. Classify the camera as `static`, `pan`, `tilt`, `push`, `pull`, `handheld` or `mixed`, with a `jitter` score. Otherwise, set the camera fields to `null` with a reason and report only `motionEnergy` from `signalstats` YDIF.
- **Audio:** when there's an audio stream, integrated LUFS and loudness range via `ebur128`. Tempo comes from an energy-flux onset envelope on 22.05 kHz mono PCM, autocorrelated across 60–180 BPM, with a `confidence` from 0 to 1. Report the tempo only when confidence is 0.35 or higher.

**Acceptance:** tests on lavfi-generated clips confirm each of the following within tolerance:

- cuts at known times (±0.1 s)
- a two-color clip whose palette recovers both colors (ΔE2000 under 5)
- a sine at a known level, measured to within ±1 LU
- a click track at 120 BPM, measured to within ±2
- a zoompan push, classified as `push` when vidstab is available
- identical output on two runs of the same input

### A2. Feed metrics into the analysis

- Add `metrics: StyleMetrics` to `Evidence`. Make it optional so v1 profiles still parse.
- Bump `StyleProfile.schemaVersion` to a union of `1 | 2`. New analyses write 2.
- In the `studyStyle` instruction, pass the metrics as measured ground truth. Rules for `palette`, `lighting`, `texture`, `camera-motion`, `edit-rhythm` and `audio` must quote the relevant numbers when `basis` is `observed`.
- Add an optional `measures: string[]` to each rule (metric paths such as `tone.contrast`). `verifyGuidance` rejects any path that doesn't exist in the metrics.
- Update the mock `fixtureGuide` so it uses the real metrics and still passes `verifyGuidance`.

### A3. Multi-reference styles

- **Migration `170_director_style_sources.sql`:** create the table `director_style_sources(style_id, asset_id, ordinal, PRIMARY KEY(style_id, ordinal))`. Backfill one row per existing style from `director_styles.asset_id`. Keep that column for compatibility.
- **`learnInput`:** accept `assetIds` (1–8). A legacy `assetId` is normalized to `[assetId]`, and both fields are rejected when sent together.
- **Evidence:** add an optional `sources` field with per-source `{assetId, digest, duration, width, height, hasAudio, metrics}`. Frames gain an optional `source` index, and ordinals stay globally unique. Spread the frame budget across sources so the total images per turn don't exceed today's single-source maximum.
- **Aggregation:** for each metric, compute the mean and spread across sources. In the instruction, tell the model: `signature` requires consistency across sources, so cite frames from at least 2 sources whenever there are 2 or more. `verifyGuidance` enforces that rule when `sources.length >= 2`.
- **Clients:** update the web library to choose multiple references. Add the optional `sources` and `metrics` fields to the iOS `Decodable`s. Display is optional, but decoding must not break.

## 5. Phase B: Style Kit (style references reach the render model)

**Goal:** the render model sees the look itself, not only a text description of it.

### B1. Exemplars in the profile

- The analysis turn returns `exemplars: {ordinal, role: "lighting" | "composition", why}[]` (3–6 image exemplars) plus at most one `motionWindow: {source, startSec, endSec, why}`. Image exemplars never take the `motion` role: in the compiler, `motion` is valid only for video, and that rule stays unchanged. The motion window becomes the kit's single video reference with role `motion`. Validate that the ordinals and the window exist.
- Prefer frames that show the environment, light and texture. Avoid frames dominated by an identifiable person or by text or logos.
- When a style version is saved, materialize the exemplars as owned assets with `saveAsset`:
  - images: full-resolution frames extracted from the source, not the 640px evidence frames
  - the motion window: an H.264 MP4 of 15 s or less, without audio
- Store their asset IDs on the version profile (`kit: {images: string[], motion: string | null}`).

### B2. Compiler injection

- Add an optional `styleRefs` flag (default `true`) to `packSettings`.
- In `compilePack`, after the plan's own references, append kit references within the model's remaining limits. Cast identity always comes first. Use at most 4 images and 1 video for Seedance 2.5, and at most 2 images and no video for Seedance 2.0.
- Use a fixed scope string: *"Style reference only: match lighting, palette, composition, texture and camera behavior. Do not reproduce its people, objects, text or location."*
- The roles are the existing `lighting`, `composition` and `motion`. All current validations apply unchanged.
- Keep the `hasSource` review flag in `style-proof.tsx`: it detects the raw source, and kit assets are separate derived assets. Add a separate informational row that lists the kit references.

**Acceptance:** compiled clips contain the kit references in order and within limits. Packs with `styleRefs: false` compile exactly as they do today. v1 styles (with no kit) compile exactly as they do today.

## 6. Phase C: Fidelity score and deterministic post-grade

### C1. Fidelity score

- **Migration `180_director_fidelity.sql`:** create `director_fidelity(id, user_id, job_id, style_version_id, score, report, created_at)`.
- After a render is ingested successfully, queue a non-billable `fidelity` job. This means adding `'fidelity'` to the `kind` CHECK through a new migration that rebuilds the table the SQLite-safe way. If the rebuild risks data, stop and log a question instead.
- **Numeric report:** run `measureStyle` on the take and compare it with the style metrics, using these tolerances:

| Metric | Tolerance |
| --- | --- |
| Mean shot length | ±35% |
| Palette | weighted mean CIEDE2000 ≤ 12, with colors matched greedily by weight |
| Luma p50 | ±0.08 |
| Contrast | ±0.10 |
| Saturation | ±0.10 |
| Loudness | ±3 LU |
| Tempo (only when both sides are confident) | ±4 BPM |

- **Judged report:** add a new `review` task to `turn()` in `runtime.ts`. It takes the signature rules and 6 output frames and returns `{rules: [{index, pass, note, evidence}]}`, validated with zod.
- `score` = 0.5 × the numeric pass rate + 0.5 × the judged pass rate, from 0 to 100. In mock mode, the judge is a deterministic fixture.
- **Routes:** `GET` and `POST /api/director/renders/:jobId/fidelity`. Show the score and the failing items in Style Proof.
- **No automatic re-renders.** A "Fix with Director" action sends the failures to `directChat` as a message, which creates a new pack version. Rendering it still requires the normal quote and approval.

### C2. Post-grade (LUT and grain)

- Add `gradeTake(jobId, strength = 0.6)`. It builds a 33³ `.cube` LUT in TypeScript using Lab mean/std transfer (Reinhard) from the take's statistics to the style's, blended by `strength`. Apply it with ffmpeg `lut3d`.
- If the style's grain is higher than the take's, add `noise=alls=<calibrated>:allf=t` to close the gap.
- Save the result as a new asset linked to the take. The original take is never overwritten.
- **Route:** `POST /api/director/renders/:jobId/grade`. Add a UI toggle to compare the original and graded takes.

**Acceptance:** grading a clip toward a known target palette lowers the palette ΔE by at least 40%, and two identical inputs produce byte-identical LUTs.

## 7. Phase D: Model adapters (pure refactor)

1. **Before** changing the compiler, add a test that snapshots the current compiled prompts and provider bodies for representative Seedance 2.0 and 2.5 packs.
2. Extract a `ModelAdapter` interface: `{ id, limits, durations, refLabel(attachment), validateAsset(asset, ref), providerBody(...) }`. Implement it in `src/server/director/adapters/seedance20.ts` and `seedance25.ts`, and make `compilePack` dispatch through it. The snapshots must stay byte-identical.
3. Remove the now-duplicated constants from `compiler.ts`, with proof (Section 1.3).
4. **Don't add any other model** unless its request contract is already documented in the repo or in MuAPI's published docs. Log it as a question instead.

## 8. Phase E: In-app agent built on the app's own API

**Principle:** the agent calls the same server functions the UI uses, through typed tools. It doesn't click screens. Computer use stays for outside websites only.

### E1. Studio tools

Create `src/server/super/studio-tools.ts`, exporting `ToolDef[]`:

- Each tool's `input_schema` comes from the existing zod contracts via `z.toJSONSchema`. Tools call the store, runtime and delivery functions directly, never over HTTP.
- Each tool declares `costClass: "free" | "quote" | "spend"`. A `spend` tool must call `quote` first, then `ctx.ask("approval", …)` with the credit amount, unless `ctx.hasPolicy(name)`. It always passes `maxCredits` equal to the approved quote.
- **Tools:** `list_styles`, `get_style`, `learn_style`, `list_projects`, `get_project`, `create_project`, `retry_plan`, `edit_plan` (through `directChat`), `quote_render`, `render_clip` (spend), `get_render`, `score_fidelity`, `grade_take`, `export_pack`.
- Register them in `toolsFor` and in `engineTools`, so Hermes and MCP get them automatically through `engine-mcp.ts`.
- **Tests:** a mock-mode chat turn that runs learn → project → plan → quote → approved render. Also: a denied approval spends nothing, and an unowned ID is refused.

### E2. UI action events

- Generalize `open_studio` into a `ui_action` tool. It takes `{action: "navigate" | "open_panel" | "highlight" | "fill_form" | "show_result", target, payload}` and is validated against an allowlist in `src/config/studio-workspace.ts`.
- It emits a transcript card row, the same pattern `open_studio` uses today. The web Super panel performs the allowlisted actions. Navigation still needs a user tap where it does today.
- iOS v1 supports `navigate` and `show_result` only. Keep `open_studio` as an alias until the clients are migrated, then remove it with proof (Section 1.3).

### E3. Agent templates

- **Migration `190_agent_templates.sql`:** create `agent_templates(id, user_id, name, role, instructions, tools TEXT /*JSON allowlist*/, defaults TEXT /*JSON: styleVersionId, model, aspect*/, budget_credits, approval TEXT CHECK (approval IN ('always','spend')), version, created_at, updated_at)`. Edits create a new version.
- The 6 personas in `studio-agents.ts` become read-only built-in templates. Their IDs and behavior stay the same.
- `super_chats.agent_id` accepts a built-in ID or a template ID. `toolsFor` filters tools by the template's allowlist, and the budget caps the credits approved per turn.
- Add routes `/api/super/agents` (CRUD, owner-scoped) and a UI on `/agents`.
- Add a `create_agent_template` tool. The agent drafts the template, the user approves it through `ctx.ask`, and then it's saved.

### E4. Delegation

- Add a `run_agent({templateId, task, budget})` tool. It starts a child chat with that template and waits, while the parent turn stays cancellable. It returns a summary of 2,000 characters or less, plus any asset or pack IDs created.
- Limits: delegation depth 1, at most 3 concurrent child chats per user. The child's budget is drawn from, and can't exceed, the parent's remaining approved budget.

### E5. Save a chat as an agent

- Add a "Save as agent" action on a chat. It builds a template draft from the tools that succeeded in that chat (their names only) and a summary of the user's goal, then opens the E3 approval flow.
- It never stores secrets, connector tokens or raw media.

## 9. Out of scope (don't touch)

- Billing, StoreKit and the wallet, unless a task above says otherwise.
- The legacy Cinema composer, Ads, Apps and Community modules.
- Treg and the registry beyond reading them.
- Deployment scripts and Hermes deploy files.
- Live-provider calls in tests.
- Any UI redesign beyond the controls named above.

## 10. Phase report template (end of every session)

```
Phase: <A–E>  Status: done | blocked
Tasks: <ids ticked>
Files changed: <list>
Removed (with proof): <list or none>
Tests added: <list>   Commands run: check:registry, typecheck, build, test — all pass? <y/n>
Open questions: <ledger refs or none>
```
