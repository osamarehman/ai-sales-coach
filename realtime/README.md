# realtime — isolated real-time coaching service (RT-0)

A separate Bun WebSocket server that backs the live in-call coaching product. It is
deliberately **isolated** from the main backend: it shares Postgres but writes **only**
`live_*` tables, so a live-coaching failure can never break the post-call grader.

- **Contract:** `desktop/PROTOCOL.md` (v0). This service is the **server** side; the
  desktop/phone app is the **client**. Both build to that document.
- **Auth:** the client presents a short-lived token on `hello`, minted by the main
  backend at `POST /api/realtime/token` (behind auth) and signed with a shared secret
  (`REALTIME_TOKEN_SECRET`, falling back to `BETTER_AUTH_SECRET`). Verified here in
  `src/lib/token.ts` — no DB round-trip, no import from the backend.
- **Consent gate (fail closed):** audio frames are dropped until the client sends
  `consent { captured: true }`. Enforced server-side; see `audioAdmitted()` in
  `src/protocol.ts` and the gate in `src/server.ts`.

## Layout
- `src/protocol.ts` — pure, DB-free: control-message + audio-frame parsing, the consent
  gate predicate, server-message builders. Unit-tested (`src/protocol.test.ts`).
- `src/lib/token.ts` — token verify/sign (mirror of `backend/src/lib/realtime-token.ts`).
- `src/sessions.ts` — DB writer for `live_sessions`; `src/cues.ts` — DB writer for `live_cues`.
- `src/server.ts` — the WS ingest action: handshake, consent gate, session lifecycle; arms the cue
  engine on consent.
- `src/index.ts` — boot (fails fast without the signing secret / DATABASE_URL).

### Cue engine (RT-3) + scheduled goals (RT-4)
- `src/framework.ts` — reads the seeded playbook: `loadPlaybook` (framework + 23 cues + 8 goals) at
  call start; `retrieveKnowledge` (by kind/stage/objection_type/tags) on demand.
- `src/signals.ts` — pure deterministic call metrics (talk-ratio, monologue length, question gaps).
- `src/cue-engine.ts` — the debounced Haiku 4.5 structured-output call (forced tool-use, injectable
  `Completer`). The LLM only picks *which* cue + a confidence; the rep-facing text is the authored
  `cue_text` (de-brand-safe). It also reports per-window **coverage** (stages engaged, is-presenting,
  budget/incumbent) in the same call — evidence for the goal runner, at no extra latency.
- `src/goal-runner.ts` — pure scheduled-goal runner (RT-4): folds coverage into cumulative call state and
  fires the 8 `cue_goals` as fire-once state machines (deadline/guard/watch/window), driven by a
  machine-readable predicate vocab in each goal's `config`. Goals are presented to the arbiter as cue
  definitions, so signal cues and goal cues share one gate.
- `src/arbiter.ts` — alert-fatigue gating from `gating_config` (warm-up, per-cue cooldown, min-gap,
  per-min + 30-min budgets, one-on-screen, critical pre-emption). `end_reserve_next_step` lets a critical
  next-step cue in the closing window bypass the rate caps.
- `src/cue-runtime.ts` — per-session orchestrator: `feedTranscript` → EOT/trailing debounce → engine +
  goal runner → arbiter → emit (a goal is "fired" only once the arbiter actually surfaces it). RT-2's STT
  merge will drive it via `feedTranscript`. Unit-tested with a fake LLM.

## Run
In the compose stack it comes up as the `realtime` service (see `docker-compose.yml`).
Dev publishes it on `127.0.0.1:${REALTIME_HOST_PORT:-8091}` (see the override).

```bash
bun install
bun test            # pure unit tests (no DB): protocol/token + signals/arbiter/cue-engine/cue-runtime
bun run typecheck
```

### Cue-engine scripts (need a seeded DB — run `bun run seed:cues` in backend first)
```bash
DATABASE_URL=... bun scripts/framework-smoke.ts    # loadPlaybook + retrieveKnowledge
DATABASE_URL=... bun scripts/cue-replay.ts         # full runtime over the real playbook (offline stub)
DATABASE_URL=... bun scripts/cue-replay.ts --live  # real Haiku 4.5 (needs ANTHROPIC_API_KEY)
```

## RT-0 end-to-end smoke (isolated — never against prod)
The prod stack shares this repo's compose project name, so a bare `docker compose up`
here would recreate the live containers. Always use a throwaway project + ephemeral DB:

```bash
# from repo root, with the throwaway compose in scratchpad (see scripts/smoke.ts header)
docker compose -p asc-rt-dev -f <throwaway-compose> up -d --build backend realtime
docker compose -p asc-rt-dev -f <throwaway-compose> run --rm realtime bun scripts/smoke.ts
docker compose -p asc-rt-dev -f <throwaway-compose> down -v
```
