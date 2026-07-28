---
name: realtime-llm-output-boundary
description: Use when parsing or validating the realtime cue engine's LLM (Haiku forced-tool) output — candidates, coverage, stage — or adding any new model-produced field in the realtime coaching service. Read before trusting anything the model returns for display, persistence, or gating.
---

# The LLM's output is untrusted input

The cue engine forces a tool call (`emit_cues`), so the reply is JSON — but a forced tool is NOT a
trusted schema. Haiku still **stringifies numbers** (`"0.9"`), **over-runs length caps**, **omits
required fields**, **returns >N array items**, and **hallucinates identifiers** (stage names, cue
keys). The engine's two guarantees — de-brand safety and alert-fatigue gating — live or die on how
`runCueEngine` (`realtime/src/cue-engine.ts`) handles that reply. Every rule below is a real bug that
was in this file.

## Parse arrays PER-ELEMENT, never as one schema

`z.array(z.object({...})).max(8)` fails the **whole** parse on one bad element, so `safeParse` returns
empty and you silently drop every GOOD candidate with the bad one — including a time-critical cue.

- Type the array as `z.array(z.unknown()).default([])`, then `CandidateSchema.safeParse(item)` **inside
  the loop** and `continue` on failure. One malformed item is dropped; the rest survive.
- Cap size with `.slice(0, n)` **after** parsing, not `.max(n)` in the schema (`.max` is array-level →
  discards everything).
- LOG each per-element drop (`console.warn`). A silent skip is indistinguishable from a correct "fire
  nothing" and hides real suppression when you're debugging why a cue didn't show.

## Coerce numbers, clamp non-finite, truncate free-text in code

- `z.coerce.number()` for any model number — a stringified `"0.95"` must not reject the item. Then
  `clamp01` at use (and the arbiter guards `Number.isFinite` — NaN passes `<`, Infinity clears any bar).
- Never put a hard `.max(n)` on a free-text field (`reason`): a chatty rationale would reject the whole
  payload. Make it `z.string().optional()` and `.slice(0, n)` in code.

## Canonicalize / allowlist EVERY model identifier before you use OR persist it

A model-supplied string that names a thing (stage, cue key, coverage slug) is untrusted:

- `cue_key`: keep only keys in the framework's catalog (`known.has(...)`).
- `stage` and `coverage.stages_covered`: run through `canonicalStager` — normalize casing/whitespace to
  the real slug (`"Consequence"` → `consequence`) or drop to `null`. This does two jobs at once (below).

## Classify each drop path: fail-SAFE vs fail-DANGEROUS

Not all "unmatched → dropped" is safe. Decide per field:

- Unknown **cue_key** dropped → **silence** → fail-safe.
- Unknown/misspelled **coverage stage** dropped → read as *UN*covered → **fires the goal that guards
  it** (a wrong critical nudge) → fail-DANGEROUS. That's why casing drift MUST be normalized, not just
  filtered. Never let "the model didn't report X" mean "X is false" for anything that triggers a
  user-facing action. Constrain the vocab at generation (JSON-schema `enum` from the framework slugs)
  when you can.

## LLM free-text never reaches the wire OR renderable storage

The de-brand guarantee is not just "the overlay shows authored text." It's a **boundary**:

- The rep-facing/stored display string is ALWAYS authored framework text (`cueText`), never model text.
- A hallucinated `stage` ("NEPQ commitment phase") that isn't canonicalized lands in `live_cues.stage`
  and surfaces in any post-call view — a brand leak at the persistence layer. Canonicalize before
  `insertLiveCue`.
- `reason` is internal LLM free-text: it's kept OFF the client (`msg.cue` never carries it) and treated
  like `source_ref` — internal only. Any future view that renders `live_cues.reason`/`.stage` must
  brand-filter first; don't rely on "we don't show it today."

## Test the boundary

- A malformed-but-recoverable element (over-long `reason`, stringified confidence) next to a good
  critical candidate → assert the good one **survives**.
- An out-of-vocab / branded `stage` and a drifted-casing coverage slug → assert the **safe** handling
  (null / canonical slug).
- Grep the serialized outgoing `msg.cue` payload: only `id/tier/text/category/ttl_ms/ts_ms/type`, and
  no forbidden brand terms.
