---
name: no-speculative-surface
description: Use when adding a reader field, DTO, protocol message builder, config key, or export ahead of the code that will consume it (ai-sales-coach backend/realtime lanes). Read before mirroring a DB table into a type or pre-staging a protocol frame for a future slice.
---

# Ship the surface with its consumer, not ahead of it

Bias to deletion. Every field, builder, key, and `export` is a promise someone maintains and a reader
mistakes for "done." Add it in the **same slice** that wires the thing that reads it — not before.
"We'll need it for RT-N" ⇒ build it in RT-N, when you know its real shape. Each rule below is a real
piece of dead surface that accreted in this repo and was removed in review.

## A DB column belongs in a domain type only if code READS it

Mirroring a table 1:1 is **not** a reason. `loadGoals` selected and mapped `arm / disarm / condition /
satisfied_by` into `CueGoal`, but the goal runner is driven entirely by `config` — nothing read them.
SELECT and map only the columns the logic uses. The human-readable spec still lives in the DB columns
and in `goals.default.json`; the runtime just doesn't carry what it never touches.

## A protocol/message builder with no producer is dead

`msg.transcript` existed in `protocol.ts` with **zero callers** — the STT layer that would emit
transcript frames (RT-2) isn't built yet. A line in `desktop/PROTOCOL.md` is a **contract**, not a
consumer. Delete the builder; re-add it in the slice that actually produces the frame.

## Every config key must be read by code

`goals.default.json` carried `"fire_once": true` on two goals. Fire-once is structural for **all**
goals (enforced in `evaluateGoals` via `firedGoalKeys`), the key wasn't in the `GoalConfig` schema, and
`.passthrough()` silently swallowed it — misleading noise implying some goals aren't fire-once. If a
`.passthrough()` schema lets unknown keys through, they rot: keep the schema == the vocabulary and
delete keys nothing reads.

## An `export` needs an out-of-module importer

`emptyCoverage` was exported but called only one line away in the same file. A same-file caller (or a
test-only / smoke-script caller) doesn't earn an `export` — narrow it to file scope so the module's
public surface is exactly what other modules use.

## The test

Grep for the identifier across `src/` and `scripts/`. If the only hits are its **definition** (plus a
type mirror or a fixture that sets it to `null`), it's dead — remove it. A green suite won't flag
loaded-but-unread data; you have to look.
