---
name: realtime-cue-engine-invariants
description: Use before changing or simplifying the realtime cue engine (signals/cue-engine/arbiter/goal-runner/cue-runtime/server). The load-bearing fail-safes and invariants here break silently. Read before deleting anything "defensive", merging key spaces, trusting a green suite, or touching the DB path.
---

# Invariants that break silently

The cue engine is a fail-safe, de-brand-safe, deterministic pipeline. Several behaviors look like
"defensive clutter" but are load-bearing — a refactor that removes one still compiles and still passes
most tests. Know these before you touch `realtime/src/{signals,cue-engine,arbiter,goal-runner,cue-runtime,server}.ts`.

## Required fail-safes — never delete without a replacement

- **No `ANTHROPIC_API_KEY` ⇒ engine stays OFF** and the WS runs the RT-0 handshake/consent/lifecycle
  byte-for-byte unchanged (`server.ts` `startCueRuntime` returns early). This is what keeps prod safe
  before the key is set.
- **Malformed model reply ⇒ fire NOTHING** (`runCueEngine` returns empty on outer parse failure; each
  candidate is parsed per-element — see the `realtime-llm-output-boundary` skill).
- **Engine throw ⇒ caught** in `cue-runtime.flush` so a timeout/transient error never crashes the live
  session. The `[realtime] cue tick failed` log in test output is the intentional proof of this.
- **Post-`await` race re-check**: `startCueRuntime` re-checks `ws.data.runtime` / `phase === "closed"`
  after the async `loadPlaybook`, because `close()` can fire during the load.

## Determinism, and two easy-to-miss operators

- All gating/goal timing is on the **call clock** (segment `tsMs` → `nowMs`), never wall time. That
  determinism is what makes the replay tests real. Wall time is allowed ONLY for the debounce/coalesce
  timer in `cue-runtime`. Don't reach for `Date.now()` in a gating decision.
- `def.confidenceMin ?? gating.confidenceMin[pr]` must stay **`??`**, never `||`: goals register as
  pseudo-cue-defs with `confidenceMin: 0`, and `0` must clear the bar. `||` would treat 0 as falsy and
  wrongly fall back to the tier threshold.

## `cue_key` and `goal_key` share one dispatch map

Goals are presented to the arbiter as pseudo-`CueDefinition`s in one `cuesByKey` map, and a goal's key
also drives fire-once memory. A collision means `new Map([...cues, ...goalDefs])` **last-write-wins** →
a goal silently overwrites a cue def (wrong text shown) and a signal emit cross-trips the goal's
fire-once. **Per-table unique indexes do NOT guarantee cross-table uniqueness** — `loadPlaybook`
validates the two key spaces are disjoint and throws on a clash. Keep that guard.

## A feature gated by an off-by-default option is only real at the live edge

`scheduledLengthMin` gates the `confirm_next_steps` window goal AND `end_reserve_next_step`. It's
threaded in tests but **not yet passed at the production construction site** (`server.ts`) — so those
features are INERT in the live path while all 63 tests are green. A green suite that passes the value
explicitly proves nothing about production. When you wire a gating option: trace it from the real
socket/server construction, and leave a `TODO(<slice>)` **at the construction site**, not only in
TASKS.md.

## Before deleting a "defensive" branch, find the test that pins it

warmup / min-gap / per-cue cooldown / hard-cap / 30-min budget / end-reserve / fire-once each have a
test. If a branch you're eyeing is covered by one of those, it's behavior, not clutter. (Simplify the
edges — unread reader fields, dead builders — not the gate logic. See `no-speculative-surface`.)

## Verify DB-path changes on a THROWAWAY postgres — never `docker compose up` here

Any change to migrations, seed data, or the readers (`loadPlaybook`/`loadGoals`) must be verified
against a real DB, but **dev and prod share the compose project name `ai-sales-coach`** — a bare
`docker compose up` in this repo RECREATES the running prod containers. Instead:

- `docker run -d --name asc-*-verify -p 127.0.0.1:<port>:5432 postgres:16-alpine` (a throwaway, NOT a
  compose project), with an `EXIT`-trap `docker rm -f` teardown.
- Host `sleep` is blocked → wait for readiness **inside** the container
  (`docker exec … 'until pg_isready …; do sleep 0.5; done'`), then a host-side poll before migrating
  (docker-proxy publish race).
- `migrate` → `seed:cues` → `framework-smoke` (proves `loadPlaybook`) → `cue-replay`, then confirm the
  prod `docker ps` is identical before/after. Never point `DATABASE_URL` at the prod DB.
