# Director Studio implementation ledger

## Baseline

- Origin is the private `LOV3RBOY/director-studio` repository. Its default branch contains the initialization README.
- The work branch starts from Parallax `main` at `f1bad631c83ba528216466c551a0a42e816cb9a2`. Keep the upstream MIT license and copyright notice with the imported code.
- For the remote checkout, add `https://github.com/nickvasilescu/parallax.git` as `upstream`; keep `origin` pointed at the private repository.
- Upstream documents Node.js 22.13 or later and `npm ci`. Read the repository's `AGENTS.md` and the installed Next.js documentation before editing server routes.

## Verified during setup

- Verified private repository access, destination and upstream histories, and the pinned upstream license and lockfile.
- Read the upstream Cinema, Supercomputer and Hermes documentation. The inherited generation worker retries against Treg with its idempotency key. The direct MuAPI path needs its own uncertain-submission state and recovery rules.
- Reviewed the public MuAPI contracts. Seedance 2.0 documents `video_files` and `audio_files`. Seedance 2.5 documents `videos_list`, `audios_list`, and `seed`. Use separate request mapping tests.
- Reviewed the public Hermes per-request model contract. Use explicit provider and model selection, or verified configured aliases, and test against the installed gateway before enabling live use.
- The provider-free Parallax baseline passed registry, typecheck, production build, core, Cinema, and Hermes fixture checks on GitHub Actions run 44406946237.
- The Director mock vertical slice passed on run 44411666525. It covered actual frame extraction, saved style reuse, owner-scoped edits and deliveries, both Seedance request mappings, simultaneous approvals, ZIP portability, and video with audio.

## Implementation decisions

- Cinema owns project, cast and first-storyboard records. Director owns immutable style and pack snapshots, separate request compilation, resumable attempts, and exports. The legacy composer remains available for legacy work.
- The private Hermes adapter confirms the configured model and refuses an unrestricted gateway. It supplies app-owned evidence and can fulfill one additional frame-window request.
- GitHub Actions provides remote Linux and macOS verification because this chat could not attach a Cloud workspace. The independent iPhone ZIP is compiled from a clean extraction. Use the current branch check for simulator and package evidence.
- A physical phone, live provider endpoints, authorized HTTPS staging and App Store sandbox products are separate acceptance inputs. See the runbook for the exact credential and test requirements.

## Upgrade progress

### Phase A — Style DNA and multi-reference learning

- [x] A1 — Measure style from source media.
  Files: `media.ts`, `contracts.ts`. Added synthetic cut, palette, loudness, click-track tempo, camera push, fallback, and repeatability coverage in `tests/director_style_metrics.py`.
- [x] A2 — Include measured evidence in version 2 style profiles and analysis.
  Files: `contracts.ts`, `runtime.ts`, `worker.ts`, `StudioModels.swift`. Added version, measured rule, and invalid metric citation checks in `tests/director_style_metrics.py`.
- [x] A3 — Learn a style from up to eight references and preserve existing clients.
  Files: migration 170, `contracts.ts`, `store.ts`, `media.ts`, `worker.ts`, `style-library.tsx`, `StudioModels.swift`, and the runbook. Added source ordering, aggregate measurements, evidence ownership, citation, and immutable save checks in `tests/director_style_metrics.py`.

### Open questions

None.

### Phase A acceptance

- A1 synthetic media verified known cut times, two colors by CIEDE2000, sine loudness, 120 BPM tempo, a camera push with vidstabdetect, and identical repeated measurements. The standard Mac FFmpeg exercised the luma-motion fallback.
- A2 new profiles contain measured evidence at schema version 2, mock guide rules cite metrics, and missing or null metric values fail citation validation. Actual profiles at versions 1 and 2 decoded in Swift.
- A3 migration 170 backfilled the source in an isolated upgraded database. The mock API verified ownership, order, aggregate measurements, and source-aware frame citations. The phone-width web flow accepted and saved two references. The unsigned iPhone build and all three simulator tests passed against migrated version 1 data.
- Verification passed on Node 22 in mock mode: `npm run check:registry`, `npm run typecheck`, `npm run build`, and all 36 files in `npm test`. A separate phone-width browser check loaded the migrated version 1 guide and its evidence.
- Phase A uses its own review branch targeting `codex/director-studio`. The hosted workflow runs on pushes to that branch and on pull requests targeting it. [Run 44709271841](https://github.com/LOV3RBOY/director-studio/actions/runs/44709271841) confirmed the pull request trigger.
- Phase A follow-up `a576ccb` passed `python3 tests/run.py tests/director_style_metrics.py` in mock mode with Ubuntu FFmpeg `6.1.1-3ubuntu5` and with the checksum-verified CI FFmpeg `n8.1.3-27-g8dca1586f4-20261031`. The camera push fixture passed on both the legacy default and the explicit ASCII option. A separate forced `vidstabdetect` failure returned `Camera motion analysis failed.` and preserved motion energy.
- Pricing follow-up reads the launch promo configuration in `tests/ui/pricing.mjs` and uses the browser clock to require a ticking countdown only while the offer is enabled and active. Disabled or expired offers require no timer, including an offer that expires during the tick check. The promo configuration is unchanged. A fresh production build and all 36 files in `npm test` passed locally on Node 22.23.5 in mock mode after the offer expired, including the pricing browser flow.
