# Realtime — Shared Call Context framework (the "brain" between transcript and cues)

Status: DESIGN (2026-07-28). Extends `realtime-rt2-plan.md`. Owner-requested: a modular,
service-layer framework — **not a monolith** — sitting on top of the core (Rust capture + STT).

## Why

Today the cue engine is memory-light: each tick it re-reads the last ~2 min of transcript +
hard signals and asks the model "which cue fires *right now*?". Nothing persistent knows **what
has been collected, what the pains are, what stage we're in, how the prospect *feels*, or what
should happen next.** Every tick re-derives the world from scratch, and every future agent would
have to do the same.

The framework fixes that with **one shared per-call state object** that a cheap "collector" AI
keeps current, a **state machine** for what's next, and **emotional-change detection** that fuses
voice (prosody) with conversation dynamics. Every realtime agent reads the same object.

## Shape (fits the existing service-layer convention exactly)

The realtime service already splits **orchestration** (`CueRuntime` — owns *when* to evaluate,
holds per-call state, composes mechanics) from **pure mechanics** (`signals`, `cue-engine` w/
injectable completer, `arbiter`, `goal-runner`, `framework` DB reader — explicit inputs, structured
outputs, unit-tested). We extend that pattern; we do **not** add a second orchestrator or a god class.

```
audio ─▶ STT relay (RT-2a) ─▶ TranscriptSegment ─┐
raw PCM ─▶ prosody DSP (RT-2b) ─▶ ProsodyFrame ──┤
                                                 ▼
                                        ┌───────────────────┐   read-only by ALL agents
                                        │   CallContext     │◀──────────────────────────┐
                                        │  (one per call)   │                            │
                                        └───────┬───────────┘                            │
   fast tick ~0.8s  signals + CallContext ─▶ cue-engine(emit_cues) ─▶ arbiter ─▶ cue     │
   slow tick ~12s   transcript + CallContext ─▶ context-collector(update_context) ─▶ delta┘
   per seg/frame    prosody + signals + knowledge ─▶ emotion.derive() ─▶ context.emotion (+shift)
   on delta         call-state.next() ─▶ context.stage + context.nextActions
```

One object, many small mechanics, one runtime wiring them. Add an agent later → it just **reads
`CallContext`**; no rewiring.

## New modules (each: pure/DB-free, explicit inputs, structured output, unit-tested)

- **`context-store.ts` — the shared object.** The `CallContext` type + pure `applyDelta`,
  `snapshot`, and a `version` counter. Held per session by the runtime, **passed into** every
  agent (not reached-into). This is the "global context shared between agents."
  ```
  CallContext = {
    stage: CallStage                 // current best estimate (from call-state)
    collected: { role?, teamSize?, incumbent?, timeline?, decisionProcess?, budgetSignal?, … }
    pains: { key, label, severity, evidence, addressed }[]   // OUR taxonomy keys
    emotion: { valence, arousal, tension, trend, lastShiftMs }
    nextActions: { key, label, priority }[]                  // "what's next / what to generate"
    momentum: {…from signals…}, version, updatedAt
  }
  ```
- **`context-collector.ts` — the "collector" AI step.** `collectContext(window, ctx, framework,
  emotion) → ContextDelta`, via a **forced tool `update_context`** — same de-brand-safe contract
  as `emit_cues`: the model fills *structured fields / enum keys*, never rep-facing prose. Runs on
  a **slow cadence (~12 s / on stage-change)**, off the sub-second cue path, so it can use a
  slightly bigger (still cheap) model. Injectable completer → unit-tested with a fake.
- **`call-state.ts` — the state machine (pure).** Stages come from the framework's `stage_model`
  (tenant-configurable) plus meta-states (opening/objection/closing). `nextState(current, ctx,
  signals) → CallStage` = best estimate + allowed transitions (soft, not a blocking FSM — real
  calls are messy). Derives `nextActions` from stage × coverage: the concrete "what's next".
- **`emotion.ts` — emotional-change detection (pure fusion).** `deriveEmotion({ prosody, signals,
  lexical, knowledge }) → EmotionState`. Fuses **voice** (RT-2b: pitch/F0, energy/RMS, pauses,
  rate — "how you pause"), **conversation dynamics** (talk ratio, monologue, question cadence,
  response latency), and the **de-branded emotional-flow knowledge** (`cue_knowledge`, retrieved
  server-side) to map raw signals → *our* emotional categories and flag **shifts** (tension spike,
  disengagement, warming/buying-signal). A shift is an event the cue engine can react to.

## Orchestration (no new god object)

`CueRuntime` already owns the transcript buffer + tick loop and drives `goal-runner` + `arbiter`.
It gains: (1) hold the `CallContextStore`; (2) a **second, slow timer** for the collector; (3) call
`emotion.derive()` per segment/prosody frame; (4) pass the `CallContext` into `buildUserPrompt` so
cue selection is **context- and emotion-aware** — while STILL returning only `cue_key` + confidence.

## Invariants (unchanged — the framework must preserve all of these)

- **De-brand:** every LLM step (collector included) is a forced-tool structured call returning
  enums/keys/short internal evidence. Rep-facing text is ALWAYS our authored `cue_text`. No model
  free-text ever reaches the wire or renderable storage. Emotional interpretation uses OUR
  de-branded taxonomy from `cue_knowledge`, never branded methodology.
- **Consent-gated** third-party egress; **secrets only from env**; **parameterized SQL**; realtime
  writes **only `live_*` tables** (if we snapshot context for the post-call report, it's a new
  `live_context_snapshots` table).
- A failure in any new step must **never** break RT-0 (handshake/consent/lifecycle) or the cue path.

## Slice plan (small, ordered, each shippable + tested)

- **C0 — Companion i · cue completer → OpenRouter.** ✅ SHIPPED 2026-07-28. `openRouterCompleter`
  beside `anthropicCompleter`, provider/model via `REALTIME_CUE_PROVIDER`/`REALTIME_CUE_MODEL`
  (default `openrouter` + `openai/gpt-4o-mini`). Makes cues fire on cheap/fast A/B models.
- **C1 — CallContext substrate.** `context-store.ts` + wire into the runtime; seed from existing
  signals/coverage; pass (read-only) into the cue prompt. Cues become context-aware. No collector yet.
- **C2 — Collector step.** `context-collector.ts` + `update_context` tool + slow-tick loop.
  The shared context is now genuinely maintained by an AI step (pains, collected facts, stage guess).
- **C3 — State machine + nextActions.** `call-state.ts`; explicit "what's next / what to generate",
  read by the cue engine + goal runner.
- **C4 — Emotion fusion (conversational-only).** `emotion.ts` minus prosody — shifts from talk
  dynamics + lexical + knowledge. Ships before RT-2b (graceful degradation).
- **C5 — RT-2b prosody → emotion upgrade.** DSP F0/RMS/pause from raw PCM feeds `emotion.derive()`
  → true voice-based emotional detection.
- **C6 — Harden context-aware prompt + optional `live_context_snapshots`** persistence (bridge to
  the RT-5 post-call report).

## Cost / latency posture

Two tiers, both cheap: **fast cue tick** stays on a sub-second tool-calling model (gpt-4o-mini class);
**slow collector** can be a bit larger since it runs ~5×/min, not ~1×/sec. Emotion + state machine are
pure compute (no LLM). A/B every LLM tier via env — no redeploy.
