# AI Sales Coach — Build Plan

Convert the single-tenant n8n "Sales Call Analysis Agent" into a **multi-tenant SaaS**
that buyers sign up for, connect their own recorder to, and read reports in a
dashboard.

## Goal / "done" (sellable v1 = M1–M7)
A buyer signs up → connects their **Fathom** account → their sales calls are
auto-fetched, graded against the **11-criteria H.E.A.R.T. rubric** by an LLM
(OpenRouter · Claude Sonnet 4.5), and every call surfaces as a **scorecard on a
dashboard**, with **Slack** as an optional integrated reporting channel.

## Users
- **Sales rep / advisor** — sees their own scored calls and trend.
- **Manager / admin** (buyer org owner) — connects integrations, sees all reps.
- **Platform owner (you)** — operates one deployment serving all buyer orgs.

## Hard constraints / decisions (locked)
- **Multi-tenant SaaS**, one deployment. `tenant_id` on every domain table from row one.
- **House stack:** Bun · SolidJS + Tailwind · TypeScript + Express · PostgreSQL ·
  BetterAuth · Docker Compose.
- **Inference:** OpenRouter, model `anthropic/claude-sonnet-4.5`, JSON mode
  (`OPENROUTER_MODEL` overridable).
- **Recorder v1: Fathom only** (webhook + transcript API). Other recorders deferred.
- **Reporting:** dashboard-native primary; Slack optional per tenant.
- **Prompts** are captured verbatim in `backend/prompts/` — the product IP, used as the
  default rubric. Prompt **optimization is deferred** (M8).
- **Secrets** (per-tenant Fathom/Slack tokens) encrypted at rest; only `.env` holds
  platform secrets. App ports bind to **loopback only** (never `0.0.0.0`).
- **Frontend UI is delegated** to a separate Cloud Design agent (wireframes + CSS
  tokens first). This track builds **all backend logic + the dashboard read APIs**
  with clean JSON contracts — it does **not** build SolidJS components.
- **Host ports** (this box also runs `fanstart` on 8080/5173): backend `8090`,
  frontend `5183`, both loopback, overridable via `BACKEND_HOST_PORT`/`FRONTEND_HOST_PORT`.

## Env vars (define in `.env.example`, real values in `.env` only)
`POSTGRES_PASSWORD` · `DATABASE_URL` (composed) · `BETTER_AUTH_SECRET` ·
`OPENROUTER_API_KEY` · `OPENROUTER_MODEL=anthropic/claude-sonnet-4.5` ·
`APP_ENCRYPTION_KEY` (32-byte hex, encrypts tenant tokens) · `PUBLIC_APP_URL` · `PORT`

---

## M0 · Scaffold ✅
- [x] House-stack skeleton scaffolded (compose, backend, frontend, per-project CLAUDE.md)
- [x] Original workflow preserved (`Sales Call Analysis Agent (1).json`, `workflow-overview.md`)
- [x] Prompts extracted to `backend/prompts/{sales-analysis.system.md, slack-messaging.system.md}`

## M1 · Foundation & data model (multi-tenant from row one) ✅
- [x] Compose: parameterized DB creds, loopback ports, `OPENROUTER_*`/`APP_ENCRYPTION_KEY`/`BETTER_AUTH_SECRET` passthrough — verified `docker compose up` healthy, `/api/health` → `{ok:true,db:"up"}`
- [x] SQL migration runner (`scripts/migrate.ts`, tracked in `schema_migrations`, runs on boot) + `0001_init.sql`: `tenants`, `reps`, `integrations`, `rubrics`, `calls`, `analyses` — all carry `tenant_id`; re-run idempotent
- [x] Seed script (`scripts/seed.ts`): default tenant (`GAMEPLAN` filter) + rubric v1 from `backend/prompts/` — verified rows present; re-seed keeps same tenant

## M2 · Analysis engine — the core IP (de-risk first) ✅
- [x] OpenRouter client (`services/openrouter.ts`): Sonnet 4.5, JSON response format, 64k tokens, AbortController timeout; injectable `Completer` for tests; `requireOpenRouterKey()` fails loud
- [x] Transcript formatter (`services/transcript.ts`) + JSON extractor (`lib/json.ts`, ports the n8n validate extraction) — tested
- [x] Zod schema (`schemas/analysis.ts`): exactly 11 `evaluations` + `call_metadata` + `summary` (+ optional `disqualification_summary`/`timestamp_analysis`/`critical_moments`); `deriveMetrics`/`toCriterionMap` — valid passes, 10-item & missing-field fail
- [x] Analysis service (`services/analysis.ts`): rubric → format → OpenRouter → validate → **retry once** → `persistAnalysis` upsert — verified via `analyze:fixture --mock` (11 evals, total 90.91, `qualified`, persisted). 16 bun tests pass; typecheck clean.
- Note: current prompt emits no structured won/lost, only free-text; `outcome` persists `disqualified`|`qualified` (structured won/lost → M8).

## M3 · Fathom ingestion (automated trigger) ✅
- [x] Fathom client (`services/fathom.ts`): `GET /recordings/{id}/transcript` with `X-Api-Key`; `FathomError` carries status; injectable `fetchImpl` — 401/404 tested
- [x] Webhook route `POST /api/webhooks/fathom/:tenantToken` (`routes/webhooks.ts` + `services/ingest.ts`): resolve tenant, zod payload, advisor→rep upsert, per-tenant keyword filter, dedupe `(tenant_id, recording_id)`, 202 fast — verified 404/400/202 + skip/dedup
- [x] Async `processCall`: fetching→analyzing→analyzed (or failed), decrypts per-tenant key, runs M2, persists — verified end-to-end (`ingest:smoke` → analyzed; real dummy-key call → failed w/ logged `Fathom 401`). AES-256-GCM in `lib/crypto.ts`; centralized error handler + `asyncHandler`.

## M4 · Auth & tenant onboarding (BetterAuth) ✅
- [x] BetterAuth email/password (`src/auth.ts`, `better-auth@1.6.24`), sessions in Postgres (`user`/`session`/`account`/`verification` via `scripts/auth-migrate.ts`); `user.create.after` hook provisions tenant + owner `membership` + rubric copy (`services/provisioning.ts`); `requireAuth` verifies server-side — verified signup→tenant, `/api/me` 401 without cookie / 200 with
- [x] Tenant isolation: `requireAuth` attaches `req.auth.tenantId`; every query scoped by it — verified Bob cannot see Alice's Fathom integration
- [x] Settings API (`routes/settings.ts`): `POST /integrations/fathom` AES-GCM-encrypts the key (verified ciphertext in DB), `GET /` returns filter + webhook URL, `PUT /` edits filter — auth handler mounted before `express.json`; `/api/me` + `/api/settings` live

## M5 · Dashboard read APIs (backend ✅; SolidJS UI by Cloud Design agent)
- [x] `GET /api/calls` (`routes/calls.ts` + `services/reports.ts`): tenant-scoped list, filters `rep`/`status`/`outcome`/`from`/`to`, pagination; members see only their own — verified 3 demo calls, parameterized
- [x] `GET /api/calls/:id`: full scorecard (11 criteria via `toCriterionMap` + summary/disqualification/critical_moments from stored JSON); 404 cross-tenant/not-owned — verified
- [x] `GET /api/leaderboard` (managers only) + `GET /api/reps/:id/trends` (members: self): per-rep avg, DQ count, daily points, per-criterion — verified aggregates
- [x] `backend/API.md` documents every endpoint (auth + app) with sample JSON for the frontend agent. `demo:data` script seeds sample scorecards.

## M6 · Slack integration (optional, per tenant) ✅
- [x] `POST/PUT /api/settings/integrations/slack`: connect (bot token encrypted) + channel + on/off toggle — verified 201/toggle-persist/404-when-not-connected
- [x] On analysis complete, `notifySlack` (`services/notify.ts`) posts headline + threaded 11-criteria breakdown **rendered deterministically from stored JSON** (`services/slack.ts` + `slack-render.ts`; 2nd LLM deferred), logs to `notifications` (`0004`) — verified smoke: 2 posts, `sent`; best-effort (never fails the analysis); disabled/not-connected posts nothing

## M7 · Harden & deploy (remote box)
- [x] Security posture ✅ — TLS reverse proxy (`Caddyfile`, Caddy auto-HTTPS + http→https + HSTS/nosniff/frame-DENY) in `docker-compose.prod.yml`; **only 80/443 published**, app/db off the host (host ports moved base→`docker-compose.override.yml` so the prod overlay exposes nothing). Webhook rate-limit `middleware/rate-limit.ts` (120/min per IP, `trust proxy` for real IP behind Caddy) + BetterAuth `rateLimit` on auth. `.dockerignore` keeps `.env` out of build context; secrets only in `.env`. **Verified:** 30 bun tests (incl. 3 rate-limit) + typecheck clean; live webhook flips to 429 after 120 with `Retry-After`; `caddy validate` = Valid; prod `compose config` publishes only 80/443.
- [x] Production deploy ✅ — **LIVE at https://sales-coach.shipdeck.dev** (2026-07-24). Routed through fanstart's shared Caddy edge via `docker-compose.shared-edge.yml` + external `salescoach_edge` net (own-Caddy `docker-compose.prod.yml` kept for a future dedicated box). Valid Let's Encrypt cert (→ Oct 2026); **fanstart untouched** (still 200). Verified over TLS: health, signup→tenant, `/api/me`, `/api/settings` (webhook_url on the https domain), webhook reachable + rate-limited. Analysis pipeline verified internally (`ingest:smoke`). **Last mile:** connect a real Fathom key → real call → scorecard needs the user's Fathom account. **Durability caveat:** the edge↔`salescoach_edge` attach is manual — re-run `docker network connect salescoach_edge fanstart-edge-1` if fanstart recreates its edge (Caddyfile block itself persists on the host bind-mount). — skill: docker-postgres

## M7.5 · Fathom auto-onboarding (webhook via API + past-meeting backfill) ✅ (2026-07-24)
- [x] **Per-tenant webhook registered via Fathom API** (not manual paste). `services/fathom.ts`
  gains `createWebhook`/`deleteWebhook`/`listMeetings` (base URL `api.fathom.ai/external/v1`,
  `X-Api-Key`). `POST /api/settings/integrations/fathom` now registers the tenant's unique
  `/webhooks/fathom/:token` URL with `triggered_for:[my_recordings, my_shared_with_team_recordings]`,
  `include_summary:true`; stores `{webhook_id, webhook_secret_enc}` in `integrations.config`
  (AES-GCM secret for future signature verification). Idempotent: deletes prior webhook first.
  Bad key → 400, nothing stored. `GET /settings` reports `fathom.webhook_registered` → UI turns
  **green ("auto-syncing")**. `DELETE /integrations/fathom` revokes the webhook + drops the row.
- [x] **Architecture decision:** unique endpoint **per tenant** (the existing `webhook_token` path),
  registered per-key — Fathom enforces isolation (each key→each URL); no shared-endpoint payload
  sniffing. Each webhook also carries its own signing secret.
- [x] **Past-meeting backfill.** `GET /api/settings/integrations/fathom/meetings` (paginated via
  Fathom `next_cursor`; flags `existing_status` + `matches_filter`) → modal. `POST …/backfill`
  (≤50 ids) reuses the webhook pipeline: `enqueueCall` (extracted from `receiveWebhook`, `force:true`
  to bypass keyword filter) + background `processCall`. Frontend: green chip, auto-opening
  "Analyze past meetings" modal (checkboxes, load-more), Scan/Disconnect buttons.
- [x] **Verified:** 39 bun tests (9 new fathom-client tests) + backend/frontend typecheck + `vite build`
  clean; **redeployed live** (base+shared-edge) — health 200, new endpoints 401-gated, app 200,
  fanstart untouched 200, backend boots clean.

## M8 · Deferred (post-v1)
- [ ] Prompt/rubric **optimization** + per-tenant editor with versioning
- [ ] Billing (Stripe) — plans, seats, metering
- [ ] More recorders: Gong, Fireflies, Otter, Zoom
- [ ] Optional Slack **presentation LLM** (re-enable the second agent for richer phrasing)

## M9 · Real-time in-call coaching (new product track) — IN PROGRESS
Full architecture + phased plan: **`product/realtime-plan.md`** (synthesis of 3 research tracks in
`product/research/`). Individual-rep niche, pay-as-you-go credits, **local capture, no meeting bot**
(cross-platform Tauri v2 + Rust desktop app — plus a phone path — captures rep mic + prospect system
audio as two separate streams). Cues on an on-screen overlay **and** a private earbud. De-branded "Cue
Framework" (no NEPQ/Jeremy Miner). Isolated `realtime/` service + `live_*` tables; never touches the
async grading write path. **Lane split:** the desktop capture client is a parallel agent's lane
(`desktop/`); this repo's backend owns the `realtime` service + the AI tool calls. They meet at the
`desktop/PROTOCOL.md` v0 contract.
- [x] **RT-0** Foundation & isolation — ✅ (2026-07-27) isolated `realtime/` Bun WS service + consent
  gate (rejects audio until `consent.captured`) + `live_sessions` migration (`0006`). Auth = a
  short-lived HMAC token minted by the backend (`POST /api/realtime/token`, `lib/realtime-token.ts`)
  and verified inside the service — no cross-service import. Built to `desktop/PROTOCOL.md` v0. Pure
  logic unit-tested (backend 46 + realtime 14 tests; typecheck clean); verified end-to-end on an
  isolated throwaway stack: authed→token→ready→pre-consent audio **rejected**→post-consent
  **accepted**→bye; only `live_sessions` written, `calls`/`analyses` untouched.
- [x] **Cue-framework store** — ✅ (2026-07-27) migration `0007` = `cue_frameworks` + `cue_knowledge`
  (reference data, de-branded, NOT `live_*`) + deterministic loader `scripts/seed-cue-framework.ts`
  (`bun run seed:cues`). **Ingestion pipeline**: owner-supplied source books → extract (poppler
  `pdftotext` for text PDFs; **vision fan-out** via ~10 subagents for the 125pp image book) →
  de-brand + classify into our 8-stage taxonomy → curated JSON in `backend/data/cue-framework/`.
  Objections book loaded (12 entries); Questions book loaded via 10-agent vision fan-out (88 entries /
  ~460 paraphrased questions, de-brand scan clean) — **100 entries total across all 8 stages, load verified**.
  Same pipeline later powers bring-your-own-framework.
  Retrieval = exact category (no pgvector yet). Companion rule tables (`0008`) load the **23 cue
  definitions + 8 scheduled goals**; runtime **retrieval service** `realtime/src/framework.ts`
  (`loadPlaybook` + `retrieveKnowledge`) built + smoke-verified. Verified on a throwaway DB; both
  services typecheck clean. Feeds RT-3.
- [ ] **RT-1** Capture thin slice — Tauri v2 Rust `AudioCapture` trait: `cpal` mic + one loopback
  backend → 2 PCM streams over WS; transparent always-on-top SolidJS overlay. *(desktop agent's lane.)*
- [ ] **RT-2** Dual-stream STT (AssemblyAI ×2) → speaker-tagged merged buffer + local prosody DSP
- [x] **RT-3** Cue engine + arbiter + first 3 cues — ✅ (2026-07-27) in `realtime/src/`: pure mechanics
  `signals.ts` (talk-ratio/monologue/question metrics), `cue-engine.ts` (debounced Haiku 4.5 structured
  output via forced tool-use; injectable `Completer`; the LLM picks *which* cue + a confidence, and the
  rep-facing text is always the authored `cue_text` → de-brand-safe), `arbiter.ts` (alert-fatigue gating
  from `gating_config`: warm-up, per-cue cooldown, min-gap, per-min + 30-min budgets, one-on-screen,
  critical pre-emption) — composed by the domain orchestrator `cue-runtime.ts` (`feedTranscript` → EOT/
  trailing debounce → engine → arbiter → emit). Wired into `server.ts` (armed on consent, best-effort +
  key-guarded so RT-0 is unchanged when no key is set); cues persist to `live_cues` (`0009`) + stream back
  as `cue` frames. Verified: **36 realtime tests** (signals/arbiter/cue-engine + a scripted-transcript
  `cue-runtime` replay, all with a fake LLM) + a throwaway-DB integration run (migrate 0001–0009, seed,
  `scripts/cue-replay.ts` fires the right cues over the real 23-cue playbook); typecheck clean. **Depends
  on RT-2** for the live feed (audio→STT→`feedTranscript`) — the seam exists but nothing decodes audio yet.
- [x] **RT-4** Scheduled-goal runner + data-authored playbooks — ✅ (2026-07-27) `realtime/src/goal-runner.ts`
  (pure): the 8 `cue_goals` as fire-once state machines (deadline / guard / watch / window), driven by a
  machine-readable predicate vocab in each goal's `config` (`deadline_sec` / `arm_when` / `require_uncovered` /
  `require_covered` / `watch` / `window_last_sec`), so the runner stays generic for BYO-frameworks. The
  cue-engine now *observes* per-window **coverage** (stages engaged, is-presenting, budget/incumbent) in the
  same forced-tool call — no extra latency — which the runtime accumulates cumulatively; goal candidates flow
  through the **same arbiter** as signal cues (uniform one-on-screen / budgets), and a goal counts as fired
  only once the arbiter actually emits it. Wired `gating_config.end_reserve_next_step`: a critical next-step
  cue in the closing 5 min bypasses the rate caps so `confirm_next_steps` is never starved. Verified: **+17
  realtime tests (53 total)** (goal-runner unit + end-reserve + a runtime integration, all fake-LLM) +
  throwaway-DB re-seed (8 goals land with predicate config; `cue-replay` fires goals + signal cues over the
  real playbook); typecheck clean. **No new deps; not deployed.** Window goals also need a `scheduledLengthMin`
  (threaded from the booking) which arrives with RT-2's live feed.
- [x] **RT-3/RT-4 hardening pass** — ✅ (2026-07-27) 2 review + 1 simplify agents over the cue engine.
  Fixed: per-element candidate parse (one malformed item was silently dropping ALL cues), `stage`
  canonicalization (a hallucinated stage was leaking to `live_cues.stage`; coverage slug-drift was firing
  false goal nudges), a `loadPlaybook` cue_key∩goal_key disjointness guard, non-finite-confidence guard,
  per-field-resilient `parseGating`, `stageModel` element guard. Simplified: dropped 4 unread `CueGoal`
  fields, producer-less `msg.transcript`, dead `fire_once` keys. Distilled the lessons into 3 project
  skills (`.claude/skills/realtime-llm-output-boundary`, `no-speculative-surface`,
  `realtime-cue-engine-invariants`). +10 regression tests → **63 realtime + 46 backend green**; prod untouched.
- [ ] **RT-5** Post-call report (reuse H.E.A.R.T. grading on the live transcript)
- [ ] **RT-6** Persona extraction + practice mode (extension)
- [ ] **RT-7** Credit metering + pay-as-you-go wallet (Stripe)
- **Tool-call layer (this lane, next):** prompt-creation-from-brain-dump pipeline, Client Profile
  extraction/memory, next-steps extraction, follow-up message generation — all token-metered.
- Resolved decisions: platform = **cross-platform from day one** (one Tauri/Rust core); capture =
  **build** (not Recall.ai); screen-share invisibility **dropped** (reps share a single window). Still
  open: emotion v1 (local prosody vs Hume), consent UX weight, which loopback backend leads RT-1.

## GTM · Waitlist landing page — ✅ SHIPPED (2026-07-24) — https://sales-coach.shipdeck.dev/join
- [x] Single conversion page for the individual rep; hero = live cues + report + persona practice;
  pay-as-you-go teaser; email capture → `waitlist` store. Standalone, house stack, reuses app tokens.
  - Built in-house: `landing/` (SolidJS+Tailwind, own `sc-landing` container, served at `/join` via
    the shared Caddy edge) + public `POST /api/waitlist` (`routes/waitlist.ts`, `schemas/waitlist.ts`,
    migration `0005_waitlist.sql`) — email normalized + deduped, honeypot + rate-limit. 40 tests pass.
  - De-branded per owner: no "NEPQ"/"Jeremy Miner"; framed as "a private coach on your side of the
    call" (invisibility claim dropped, not just softened).
  - Note: box has no wildcard DNS, so it ships at `/join` on the cert'd domain; a dedicated vanity
    subdomain is a 1-DNS-record upgrade (add A → 169.58.20.145, set landing `base:"/"`, add a drop-in).
- [ ] Drive traffic (r/sales, sales LinkedIn, demo clips) + iterate copy via Ideabrowser skills.
