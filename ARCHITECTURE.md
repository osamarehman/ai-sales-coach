# AI Sales Coach — Architecture

> One sentence: **Actions orchestrate domain rules; the service layer centralizes reusable
> operational mechanics with a composable, explicit-input API.** (see the `code-structure` skill)

Multi-tenant SaaS on the house stack: **Bun · SolidJS+Tailwind · TypeScript+Express ·
PostgreSQL · BetterAuth · Docker Compose.** One deployment serves all buyer orgs;
`tenant_id` is on every domain table and every query is tenant-scoped.

This document maps the **real code** onto the layering model so new work lands in the right
place. It reflects state as of the M7.5 milestone (Fathom auto-onboarding + backfill live).

---

## The layering model, as applied here

The skill describes a **two-layer** split (Actions ↔ Service). In an Express + Postgres app
that split reads most honestly as **three tiers** — the "Service" side simply divides into
*domain/data* services (own state + DB) and *shared-mechanics* services (pure, DB-free):

```
┌─ ACTIONS / ORCHESTRATION ───────────────────────────────────────────────┐
│  routes/*  ·  middleware/*  ·  background orchestrators (ingest.processCall)│
│  owns: auth & ownership, zod input validation, status transitions,         │
│        error classification (HttpError), retries, "when to call what",     │
│        HTTP response shape.                                                 │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ calls
┌───────────────▼── DOMAIN / DATA SERVICES ─────────────────────────────────┐
│  services that own tenant-scoped DB access + domain rules:                 │
│  reports · provisioning · ingest(data ops) · analysis.persistAnalysis ·    │
│  notify                                                                     │
│  owns: state, tenant scoping, domain queries. May touch the DB.            │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ composes
┌───────────────▼── SHARED MECHANICS (pure, DB-free, injectable) ───────────┐
│  provider SDKs + transforms with explicit params + structured returns:     │
│  openrouter · fathom · slack (+ slack-render) · transcript ·               │
│  analysis.runAnalysis · lib/{crypto,json,async} · middleware/rate-limit    │
│  owns: "how to do this operation reliably." Never reads req/res; never      │
│        reaches into the DB; deps injectable for tests.                      │
└────────────────────────────────────────────────────────────────────────────┘
```

**Rule of thumb when adding code:** "what this product flow *means*" → Actions. "how to do
this operation *reliably*" → a shared-mechanic service. Only extract a shared block when
**2+ callers** repeat it (else keep it inline — over-abstraction is an anti-pattern).

---

## Backend module map (`backend/src/`)

| Module | Tier | Role | Touches DB? | Notes |
|---|---|---|---|---|
| `routes/webhooks.ts` | Action | Fathom webhook endpoint; fast 202, backgrounds `processCall` | via services | unauthenticated + rate-limited |
| `routes/settings.ts` | Action | Connect/rotate/disconnect Fathom & Slack; list past meetings; backfill | via services | owns auth + zod + Fathom error→HTTP mapping |
| `routes/calls.ts` | Action | List calls + single scorecard, member-scoped | via `reports` | |
| `routes/analytics.ts` | Action | Leaderboard (managers) + rep trends | via `reports` | role gating lives here |
| `routes/me.ts` | Action | Current session/tenant | via services | |
| `middleware/auth.ts` | Action | `requireAuth` → verifies BetterAuth session, attaches `req.auth.{userId,tenantId,role}` | read | cross-cutting policy |
| `middleware/error.ts` | Action | `HttpError` + centralized handler; never leaks internals | — | error **classification** stays in Actions |
| `services/ingest.ts` | Domain + Action | `receiveWebhook`/`enqueueCall` (data), `processCall` (background orchestrator: fetch→analyze→persist→notify) | yes | `enqueueCall` extracted so webhook **and** backfill share dedupe/status logic |
| `services/reports.ts` | Domain/Data | Tenant-scoped reads: calls, scorecard, leaderboard, trends | yes | parameterized SQL only |
| `services/provisioning.ts` | Domain/Data | On signup: tenant + owner membership + rubric copy | yes | called from the BetterAuth `user.create.after` hook |
| `services/notify.ts` | Domain | Load Slack config, render, post (best-effort, never fails analysis) | yes | injectable `slackPoster` |
| `services/analysis.ts` | Mixed | `runAnalysis` (pure mechanic) + `persistAnalysis` (data) | split | keep the two halves separable |
| `services/openrouter.ts` | Mechanic | OpenRouter LLM client (Sonnet 4.5, JSON mode, timeout) | no | injectable `Completer` |
| `services/fathom.ts` | Mechanic | Fathom API: `fetchTranscript`, `createWebhook`, `deleteWebhook`, `listMeetings` over one `fathomFetch` | no | injectable `fetchImpl`; `fathomFetch` is the shared block |
| `services/slack.ts` / `slack-render.ts` | Mechanic | Post to Slack / deterministic Block Kit from stored JSON | no | render is pure |
| `services/transcript.ts` | Mechanic | Flatten Fathom transcript → text | no | pure |
| `schemas/analysis.ts` | Mechanic | 11-criteria zod schema + `deriveMetrics`/`toCriterionMap` | no | domain validation/transform |
| `lib/crypto.ts` | Mechanic | AES-256-GCM encrypt/decrypt for per-tenant tokens | no | |
| `lib/json.ts` | Mechanic | Tolerant JSON extraction from LLM output | no | |
| `lib/async.ts` | Mechanic | `asyncHandler` — routes async errors to the handler | no | |
| `middleware/rate-limit.ts` | Mechanic | Zero-dep fixed-window limiter, injectable clock | no | |
| `routes/realtime.ts` | Action | Mints the short-lived realtime WS token for an authed rep (tenant+user, signed) | read (auth) | the only bridge from the API to the isolated realtime lane |
| `lib/realtime-token.ts` | Mechanic | HMAC-SHA256 sign/verify of the realtime session token | no | mirror of `realtime/src/lib/token.ts` |

**Conformance today:** the pure-mechanic tier is genuinely pure and unit-tested with injected
deps (39 bun tests). The two best examples of the skill's core move are recent:
`fathomFetch` (one authenticated-call block behind `fetchTranscript`/`createWebhook`/…) and
`enqueueCall` (extracted from `receiveWebhook` so webhook **and** backfill dedupe identically).
Known mild mixes to keep an eye on (not urgent): `analysis.ts` and `notify.ts` combine a pure
mechanic with a DB write — fine while single-caller; split if a second caller appears.

---

## Frontend map (`frontend/src/`) — SolidJS

The same spirit: **screens orchestrate; `lib/` centralizes mechanics.** Components run once —
read `props.x`, never destructure (see `solid-frontend`).

| Module | Tier | Role |
|---|---|---|
| `App.tsx` / `index.tsx` | Orchestration | Route table (public vs `Protected`), mount |
| `lib/session.tsx` | Orchestration | `Protected` gate: loads `/api/me`, redirects 401→`/login` |
| `screens/*` | Orchestration (views) | Auth, Dashboard, CallsList, Scorecard, Trends, Team, Settings, Onboarding — own layout + when to call the API |
| `lib/api.ts` | Mechanic | Typed API client (`credentials:"include"`), all `/api/*` calls + display mappers |
| `lib/types.ts` | Mechanic | Shared response/display types (mirror `backend/API.md`) |
| `components/{ui,AppShell,charts,icons}.tsx` | Mechanic | Reusable presentational blocks |

`lib/api.ts` is the single seam to the backend — screens never `fetch` directly. New endpoints
get one typed function here, reused across screens (e.g. `listFathomMeetings`/`backfillFathom`).

---

## Data flows

**Post-call grading (async, live in prod):**
```
Fathom → POST /api/webhooks/fathom/:tenantToken   [Action: validate, dedupe, 202]
      → ingest.enqueueCall (Domain: rep upsert, filter, insert)
      → ingest.processCall (Action/bg: status transitions)
           → fathom.fetchTranscript (Mechanic) → transcript.format (Mechanic)
           → analysis.runAnalysis→openrouter (Mechanic) → analysis.persistAnalysis (Domain)
           → notify.notifySlack (Domain, best-effort)
Dashboard reads ← routes/calls,analytics ← reports (Domain) ← Postgres
```
Backfill (`POST /api/settings/integrations/fathom/backfill`) reuses the **same** `enqueueCall`
+ `processCall` — one pipeline, two entry points.

**Real-time in-call coaching (new track — RT-0 shipped):** an **isolated** subsystem in its own
`realtime/` service + container, sitting *alongside* — never inside — the async pipeline, so a
live-coaching failure can't break post-call grading. It writes **only** `live_*` tables. Same layering
inside it: the WS ingest handler (`src/server.ts`) is the **Action** — handshake, auth via a
backend-minted token, the all-party **consent gate** (audio dropped until `consent.captured`), session
lifecycle; `src/protocol.ts` is a pure **Mechanic** (control- and audio-frame parsing, the gate
predicate; unit-tested, no DB import); `src/sessions.ts` is the **Domain/Data** writer of
`live_sessions`. The backend bridges in via one Action — `routes/realtime.ts` mints the signed token
(`lib/realtime-token.ts`). The two lanes meet at the **`desktop/PROTOCOL.md` v0** contract; the desktop
capture client (Tauri v2 + Rust) is built on a parallel lane (`desktop/`). The **cue engine (RT-3)** is
built: pure **Mechanics** — `signals.ts` (talk-ratio/monologue/question metrics), `cue-engine.ts` (a
debounced Haiku 4.5 structured-output call, forced tool-use, injectable `Completer`) and `arbiter.ts`
(alert-fatigue gating from `gating_config`) — composed by the **Domain** orchestrator `cue-runtime.ts`
(one per session: `feedTranscript` → EOT/trailing debounce → engine → arbiter → emit) that `server.ts`
arms on consent; emitted cues persist to `live_cues` (`cues.ts`) and stream back as `cue` frames. The
rep-facing text is always the authored `cue_text` (de-brand-safe) — the LLM only picks which cue + a
confidence. The **scheduled-goal runner (RT-4)** `goal-runner.ts` (pure) is the second cue source: the
engine additionally *observes* per-window call **coverage** (which stages the rep engaged, is-presenting,
budget/incumbent mentions) in the same forced-tool call; the runtime accumulates it and the runner fires
the 8 `cue_goals` as fire-once state machines (deadline/guard/watch/window), driven by a machine-readable
predicate vocab in each goal's `config`. Goal candidates go through the **same arbiter** as signal cues, so
gating stays uniform — with `gating_config.end_reserve_next_step` letting a critical next-step cue in the
closing window bypass the rate caps. Remaining gap = **RT-2** (dual-stream STT + transcript merge), which will call
`runtime.feedTranscript(seg)`; today audio frames are validated but not yet decoded. Full plan:
`product/realtime-plan.md`.

**Cue-framework knowledge store (new — migration `0007`):** the cue engine's coaching
knowledge is **reference data** — seeded at build time, read at call time (not per-call runtime,
so it is *not* a `live_*` table). `cue_frameworks` holds a versioned, de-branded framework
(global default = `tenant_id NULL`; a per-tenant row = an org's bring-your-own-framework);
`cue_knowledge` holds the retrievable entries (principles, question banks, objection patterns)
indexed by `kind`/`stage`/`objection_type`/`tags`. It is populated by an **ingestion pipeline**
(owner-supplied source material → extract → de-brand + classify into our taxonomy → curated JSON
in `backend/data/cue-framework/` → `scripts/seed-cue-framework.ts`, a deterministic loader run via
`bun run seed:cues`). That same pipeline later powers the bring-your-own-framework product feature.
Retrieval is **exact-category** (no vector store yet — a `pgvector` column is the noted future
option). De-brand rule enforced in the data: our own wording only; `source_ref` provenance is
internal metadata, never surfaced. The engine's **rule set** sits alongside it (migration `0008`): `cue_definitions` (the ~23
fire-when cues) + `cue_goals` (the 8 scheduled deadline/watch/window/guard goals). The realtime
service reads all four `cue_*` tables through one Domain/Data reader — `realtime/src/framework.ts`
(`loadPlaybook` once at call start; `retrieveKnowledge` by kind/stage/objection_type/tags on demand).
Pipeline design: `product/cue-framework/` (see below).

**Tenant isolation (cross-cutting):** `requireAuth` attaches `tenantId`; every Domain query is
scoped by it; per-tenant provider tokens are AES-GCM encrypted (`lib/crypto`). This policy lives
in Actions/Domain, never in the pure mechanics.

---

## Adding a feature — the mental model

```
New feature? → Write it in the route (Action) first, clearly.
             → Does a second caller now repeat an operation?
                 yes → extract that block to a service (explicit params, structured return, DB-free
                       if it's a mechanic) → replace one caller → verify → migrate the rest.
                 no  → leave it in the Action. Don't pre-abstract.
```
Keep auth, status transitions, and error classification in the Action. Keep provider/SDK calls
and transforms in a mechanic. Verify with `bun test` + `bun run typecheck` before moving on.

---

## Sister app

**Fanstart** (`/root/fanstart`) runs on the same box and the same house stack and should follow
this same model. A matching `ARCHITECTURE.md` there is not yet written (cross-project change —
do on request). The `code-structure` skill is global (`~/.claude/skills/`), so both apps load it.
