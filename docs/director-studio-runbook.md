# Director Studio runbook

## Development and verification

Work on the private codex/director-studio branch. The checkout's origin is LOV3RBOY/director-studio. Add upstream as https://github.com/nickvasilescu/parallax.git if it is missing. The imported Parallax main is pinned at f1bad631c83ba528216466c551a0a42e816cb9a2.

Use Node 22.13 or later, Python 3, FFmpeg, FFprobe, and Info-ZIP. Run npm ci with the pinned lockfile. Set DIRECTOR_MODE=mock, TREG_MODE=mock, and SUPER_MODE=mock for a provider-free workspace. Run npm run dev for iteration. In CI, run npm run check:registry, npm run typecheck, npm run build, and python3 tests/run.py tests/core_e2e.py tests/cinema.py tests/super_hermes.py tests/director.py. Use an isolated PARALLAX_DATA_DIR in every test environment.

The workflow named **Director Studio checks** packages the iOS sources, unzips them into a clean directory, compiles the iPhone target without signing, and runs a simulator smoke test. Use the workflow artifact for the matching commit. See [the device install guide](../ios/INSTALL.md).

## Environment variables

| Variable | Purpose |
| --- | --- |
| DIRECTOR_MODE | Set explicitly to mock or live. Anything else disables Director. Records and jobs are scoped to their originating mode. |
| PARALLAX_DATA_DIR | Persistent private directory for SQLite, assets, evidence, and ZIP exports. |
| PARALLAX_ORIGIN and COOKIE_SECURE=1 | HTTPS origin reachable from the iPhone and MuAPI, with secure session cookies. |
| DIRECTOR_HERMES_URL and DIRECTOR_HERMES_KEY | Dedicated private Hermes API origin and server credential. Configure the model provider credentials in that isolated Hermes profile. |
| DIRECTOR_HERMES_MODEL and DIRECTOR_HERMES_PROVIDER | Authoring model and provider for the private Hermes gateway. Defaults to claude-fable-5-2 on anthropic. Test structured and image input against the configured profile. |
| DIRECTOR_HERMES_CHAT_MODEL and DIRECTOR_HERMES_CHAT_PROVIDER | Optional server-side overrides for Director chat. Defaults to the same Hermes model and provider as authoring. |
| DIRECTOR_DAILY_AUTHORING_JOBS | Positive integer live job cap across learning, planning and chat. Learning can request one additional bounded evidence window. Configure provider ceilings on the dedicated credential and gateway before live use. |
| DIRECTOR_MUAPI_KEY | Server-side MuAPI credential. |
| DIRECTOR_MUAPI_REFERENCE_MODE | Set to upload to send approved references to MuAPI's upload endpoint. The default uses signed, expiring links. |
| DIRECTOR_INGEST_ORIGIN | Optional distinct HTTPS base URL for signed media ingestion. Defaults to the configured Studio origin. |
| DIRECTOR_MUAPI_OUTPUT_HOSTS | Comma-separated exact HTTPS hostnames approved for MuAPI result files. Verify against the actual response before allowing a host. |
| DIRECTOR_INGEST_SECRET and DIRECTOR_INGEST_TTL_SECONDS | Random secret of at least 32 characters for scoped asset links. TTL defaults to 900 seconds and supports 60–1,800 seconds. Exclude query strings from ingress access logs. |
| DIRECTOR_RENDER_RATES | JSON object mapping model/resolution/quality for 2.0 and model/resolution for 2.5 to objects with numeric output and referenceVideo USD rates per second. Example key seedance-2.0/720p/high. Enter approved account rates before enabling renders. |
| DIRECTOR_DAILY_RENDER_USD | Positive server-wide daily estimate ceiling for paid render submissions. Unconfirmed attempts count toward it. |
| TREG_MODE, TREG_TOKEN, TREG_DAILY_BUDGET_USD | The existing Nano Banana 2 conditioned image path. Explicit live Treg configuration is required in Director live mode. Use mock for both services in fixture CI. |
| DIRECTOR_STOREKIT_MODE | Set to sandbox or production to enable commerce when App Store products and verification settings are ready. Sandbox transactions use a separate test balance and cannot fund paid renders. |
| DIRECTOR_APPLE_BUNDLE_ID, DIRECTOR_APPLE_APP_ID, DIRECTOR_APPLE_ROOT_CA_FILES | Signed transaction verification settings. The App Store app ID is required for production. Provide comma-separated paths to the Apple root CA certificates from Apple PKI and allow certificate status checks. |
| DIRECTOR_APPLE_PRODUCTS | JSON map of real product IDs to objects with kind set to subscription or credits. Credit products also need a positive integer millicredits value. Configure matching auto-renewable subscriptions and consumables in App Store Connect. |
| DIRECTOR_SUBSCRIPTION_REQUIRED | Optional value 1 requires an active production subscription for new authoring jobs. |

Keep upstream demo seeding and demo billing off in live deployments. Do not place the service keys in the app, exports or CI logs. Scope ingress and application access to the designated workspace. Use an isolated Hermes profile with gateway toolsets disabled, disabled external memory and no connected browser, user shell or other accounts. Director supplies bounded evidence from its own storage and checks the gateway model reported for the turn. Features with missing credentials fail when requested and return a recoverable error. They do not synthesize a live result.

## Private iPhone pilot

Use a built app and run `node scripts/studio-local-tls.mjs` with a private IPv4 interface in `STUDIO_LISTEN_ADDRESS`, an HTTPS .local `PARALLAX_ORIGIN`, `STUDIO_TLS_CERT` and `STUDIO_TLS_KEY` file paths, `COOKIE_SECURE=1`, a dedicated `STUDIO_PILOT_EMAIL`, and a randomly generated 32-byte hex `STUDIO_PILOT_CODE`. Use a dedicated data directory. In this mode signup, guest sessions, and password login are disabled. A Debug iPhone build can pair through **Open local studio** using `STUDIO_PILOT_URL`, the base64 DER leaf certificate in `STUDIO_PILOT_CERTIFICATE`, and `STUDIO_PILOT_PAIR_CODE` matching the server. Pass the code via a private xcconfig outside version control. Only distribute that paired build to the owner. The app pins the certificate for the configured host and port in Debug.

Use two private Hermes profiles. Set the Director profile's API server toolset list to empty. The crew profile can list only the Studio MCP server in its API server toolsets. Set its MCP URL to the Studio engine endpoint and share a unique bearer token. Set `STUDIO_LOCAL_MCP_PORT` to make that route available through a loopback-only listener on the Mac. Set `SUPER_ENGINE=hermes`, `HERMES_URL`, `HERMES_API_KEY`, and `SUPER_ENGINE_TOKEN` to route crew chat through it. The agent directory at `/agents` stores the selected role with each chat and uses the same owned library and tool approval flow.

The local Mac pilot requires the phone and Mac to share a network. For remote use, deploy the same app and Hermes profiles to a persistent Linux host with a public HTTPS origin. The private test build places Open Studio and device unlock before a stored session, using system trust for a public HTTPS origin. A .local address cannot serve signed references to MuAPI over the internet. Public rendering requires a reachable HTTPS ingest origin or the provider upload mode, with the user's approval to send assets to MuAPI. Keep server credentials out of the iPhone app.

## Storage, replay, and rollback

- Run one process with the job worker on a persistent volume. An ephemeral function host cannot preserve this server's job state or SQLite data. Store application artifacts and the database together and back them up together. Limit upload sizes and keep writable volume space available for extraction and ZIP scratch files.
- Stop the process before taking a portable snapshot of the data directory, including existing SQLite sidecar files. Restore into an empty volume, start with the same application revision, check account reads and a queued fixture job, then upgrade. Migrations are additive and run on startup. Roll back the app by deploying the prior commit against a tested copy of its pre-migration backup when compatibility is uncertain.
- An approved render with the same request key reuses its local job and credit hold. A server restart before a provider ID is saved, an ambiguous response, or a provider failure that may have been charged puts the attempt in Needs provider review. Confirm the attempt and billed usage in the MuAPI dashboard before releasing any funds or authorizing a new attempt. Preserve the original local job and provider request ID when available.
- Back up job history before reconciling. Set the deployment's PARALLAX_DATA_DIR, then use node --conditions=react-server --import tsx scripts/director-reconcile.ts with the local job ID. Use resume with a verified provider request ID and a note to continue polling. Use release with a note for a confirmed unbilled attempt, or charge with a note for a confirmed bill with no retrievable take. Each action requires a job in review. Credit changes are recorded in the existing SQLite ledger and the operator decision is recorded with the job.

## Live and device acceptance

Use an authorized HTTPS staging origin, a dedicated test member, a short owned or synthetic clip, and small server budgets. First check Hermes readiness and its reported model for both routes. Study the actual clip and use one saved style on two different briefs. Compare guide evidence, project timing, continuity, reference identity, usable frames and rework. Confirm native audio. Verify that the pack ZIP opens without network access.

Run a priced, explicitly approved attempt against each configured MuAPI model and retain sanitized model/endpoint data, token usage, submitted prompt, provider request status, estimates, billed usage and attempts per kept take. Verify the output host and TTL against the actual ingestion window.

Physical device testing requires the owner's Xcode signing and an authorized HTTPS endpoint for the connected flow. The ZIP also has a labeled offline demo. Commercial purchases require App Store Connect products and sandbox verification before a release. Configure the App Store Server Notifications v2 URL at /api/director/store/notifications. Verify a purchase, replay the same signed receipt, confirm restore on the same Studio account, and test the matching refund notification. Sandbox balances and entitlements cannot pay for live authoring or rendering. Keep demo wallet top-ups disabled.

Provider contracts: [Hermes API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) · [MuAPI Seedance 2.0](https://muapi.ai/playground/seedance-2-omni-reference/api) · [MuAPI Seedance 2.5](https://muapi.ai/playground/seedance-2.5-omni-reference/api)
