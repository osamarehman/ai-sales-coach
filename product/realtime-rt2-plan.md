# RT-2 Integration Plan — ElevenLabs Scribe v2 Realtime (STT feed)

**Status:** plan/research only (owner said *stop building*; no code until agreed).
**Lane:** `realtime/` backend service (writes only `live_*` tables). Desktop lane unchanged.
**Goal of RT-2:** turn live call audio into speaker-tagged transcript segments and feed them to the
already-shipped cue engine — i.e. light up the `runtime.feedTranscript(seg)` seam that RT-3/RT-4 wait on.

---

## 1. Decision

Use **ElevenLabs Scribe v2 Realtime** (`model_id: scribe_v2_realtime`) as the streaming STT front-end,
**one WebSocket session per audio channel** (rep mic + prospect system audio), proxied **server-side** from
our `realtime` Bun container. This is a **drop-in replacement for the shelved AssemblyAI dual-stream plan** —
same two-mono-session shape, different vendor.

Companion change (separate, small): move the **cue-engine inference to OpenRouter** so the owner can A/B
models. See §7.

## 2. What Scribe v2 Realtime actually is (grounded)

- **Streaming STT over WebSocket.** ~150 ms median latency (p95 ~250 ms, p99 ~400 ms), 90+ languages,
  93.5% accuracy on FLEURS. It transcribes; it does **not** decide cues — that stays our LLM step.
- **Endpoint:** `wss://api.elevenlabs.io/v1/speech-to-text/realtime` (regional hosts exist:
  `api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io`, …).
- **Auth:** `xi-api-key` request header (server-to-server) **or** a single-use `token` query param
  (browser/client-side). We use the **header** (server holds the key) — key is `ELEVENLABS_API` in `.env`
  (note: `_API`, not `_KEY`).
- **Audio in:** default `audio_format=pcm_16000` = **16-bit mono PCM @ 16 kHz** — an exact match for what
  `capture-core` already produces. Also supports `pcm_8000/22050/24000/44100/48000`, `ulaw_8000`.
- **Diarization:** the realtime word schema carries an optional `speaker_id`, but realtime speaker
  separation is **not production-grade (batch-only)**. **We don't use it** — our two streams already
  separate speakers (see §3).

## 3. The speaker problem → solved by capture, not by the model

Our locked capture design (see `project-ai-sales-coach-realtime`) sends **two separate streams**:
rep **mic** (`cpal`) and prospect **system loopback**, each as PCM16 frames tagged with a `channel`
(PROTOCOL.md: `channel|ts_ms|i16[]`, consent-gated).

→ We open **two Scribe sessions**: `session[rep]` fed only rep-channel frames, `session[prospect]` fed only
prospect-channel frames. Every segment from a session is attributed to that known speaker. **No diarization,
no merge-time guessing** — more reliable than model diarization, and it sidesteps the batch-only limitation
entirely. (This is exactly the "2 mono sessions → free speaker separation" the AssemblyAI plan assumed.)

## 4. Topology — server-proxied (not client-direct)

```
desktop (Rust)  ──PCM16 frames (channel|ts_ms|i16[])──▶  our realtime WS (exists, consent-gated)
                                                              │  decode + route by channel
                                                              ├─▶ Scribe WS  session[rep]
                                                              └─▶ Scribe WS  session[prospect]
                                                              ◀── committed_transcript(_with_timestamps)
                                                              │  → TranscriptSegment{speaker,text,ms}
                                                              ├─▶ runtime.feedTranscript(seg)   (RT-3/RT-4)
                                                              └─▶ live_transcript_segments      (persist)
```

Why server-proxied, not desktop→Scribe direct:
- The desktop↔realtime WS **already streams PCM16 frames** — RT-2 is literally defined at `server.ts` as
  "decode PCM → STT → `feedTranscript`". Reuse it.
- **Keep the ElevenLabs key server-side** (secure-defaults) — never ship it to the client.
- Centralizes STT so cue engine + persistence + gating stay in one place; desktop stays a dumb capture/view.
- **Consent-gated third-party egress:** we only open Scribe sessions and forward audio **after**
  `consent.captured` — audio never leaves to a third party pre-consent (all-party posture preserved).

## 5. Concrete protocol (for a no-SDK Bun `WebSocket` client)

**Connect** (query params):
`model_id=scribe_v2_realtime` · `audio_format=pcm_16000` · `commit_strategy=vad` ·
`include_timestamps=true` · `enable_logging=false` (zero-retention — don't let a 3rd party retain call audio) ·
`include_language_detection=true` (auto-detect — owner decision; do **not** pin `language_code`). **Do NOT set `no_verbatim`** — we want fillers (um/uh) as confidence/prosody signal.

**Client→server** (only message type): `input_audio_chunk`
```json
{ "message_type": "input_audio_chunk",
  "audio_base_64": "<base64 of the frame's i16[] PCM bytes>",
  "sample_rate": 16000,
  "commit": false }
```
(With `commit_strategy=vad`, Scribe segments on silence automatically — we don't need manual `commit`.)

**Server→client** (the ones we consume):
- `session_started` `{ session_id, config }` — ready.
- `partial_transcript` `{ text }` — interim; optional live-overlay display later, **not** fed to the LLM.
- `committed_transcript_with_timestamps` `{ text, language_code, words:[{text,start,end,type,speaker_id,logprob,…}] }`
  — a **settled utterance** = one segment. This is the feed unit for `feedTranscript` (matches the cue
  runtime's EOT + trailing-debounce model). `start`/`end` are seconds.
- `committed_transcript_entities` (if `entity_detection` on) `{ entities:[{entity_type:"credit_card",…}] }`
  — future PII redaction hook; off for v1.

**Call-clock mapping:** each session is fed frames carrying `ts_ms` (shared epoch threaded by capture-core).
Track the `ts_ms` of the last frame forwarded before a `committed_transcript`; use it as the segment's
call-clock end. RT-4 goals evaluate predicates on this clock, so alignment matters — the shared epoch
already removes the mic/system start skew.

**Close/flush:** no explicit end message documented — closing the WebSocket ends the session. On `bye`/socket
close, close both Scribe sockets. **Reconnect:** a dropped Scribe socket = lost coaching → auto-reconnect with
backoff, re-open the session, and drop (don't buffer unboundedly) audio during the gap.

## 6. Integration seams in our code (described, not yet written)

Follows the architecture skill: **service = pure mechanics, Action orchestrates.**

- **`realtime/src/stt.ts` (NEW service, DB-free, explicit inputs):**
  `connectScribe({ channel, apiKey, model, onSegment }) → { sendPcm(i16Bytes), close() }`.
  Owns: WS connect + query params, base64, parsing `committed_transcript_with_timestamps` →
  `TranscriptSegment { speaker, text, startMs, endMs, words? }`, reconnect/backoff. No DB, no `ws` object.
- **`realtime/src/server.ts` (Action wiring):**
  - Mirror `startCueRuntime`: arm STT on consent, **guarded by `config.elevenLabsApiKey`** (no key ⇒ STT
    disabled ⇒ RT-0 unchanged, same fail-safe pattern as the Anthropic guard).
  - `onAudio`: after `parseAudioFrame(frame)` (today validate-only — now **use** its parsed `channel`/`ts_ms`/`pcm`),
    route `pcm` to `ws.data.scribe[channel].sendPcm(...)`.
  - `onSegment` callback → `ws.data.runtime?.feedTranscript(seg)` **and** persist via a new
    `insertLiveTranscriptSegment` (sibling of `insertLiveCue`).
  - `bye`/`onClose`: close both Scribe handles alongside `runtime.stop()`.
- **`realtime/src/transcripts.ts` (NEW, the only `live_transcript_segments` writer)** — parameterized inserts.
- **`realtime/src/config.ts`:** add `elevenLabsApiKey = process.env.ELEVENLABS_API || ""`,
  `scribeModel = process.env.SCRIBE_MODEL || "scribe_v2_realtime"`, and (for §7) an `openRouter` block +
  `cueProvider`. Fail-safe: missing key ⇒ that capability is simply off.
- **Compose:** pass `ELEVENLABS_API` (+ OpenRouter vars) into the `realtime` service env in base compose.

## 7. Companion: cue-engine inference → OpenRouter (owner decision, for A/B)

Independent of STT; small, clean seam because `completer` is already **injected** into `CueRuntime`.
- **`realtime/src/cue-engine.ts`:** add `openRouterCompleter()` beside `anthropicCompleter()` —
  `POST ${openRouter.baseUrl}/chat/completions`, OpenAI-style forced tool call
  `tools:[{type:"function",function:{name:"emit_cues",parameters:<same schema>}}]`,
  `tool_choice:{type:"function",function:{name:"emit_cues"}}`; read
  `choices[0].message.tool_calls[0].function.arguments` (JSON string → parse).
- **Select by config** (`REALTIME_CUE_PROVIDER=openrouter|anthropic`); model via `REALTIME_CUE_MODEL` = an
  OpenRouter slug (`openai/gpt-4o-mini`, `anthropic/claude-haiku-4.5`, …). **A/B = swap env + recreate.**
- **Key:** realtime now uses **`OPENROUTER_API_KEY`** (already in `.env`); `ANTHROPIC_API_KEY` no longer
  required for realtime.
- **De-brand UNCHANGED / model-agnostic:** still forced-tool `emit_cues` returning only `cue_key` +
  confidence; rep sees our authored `cue_text`. The **`realtime-llm-output-boundary`** skill rules
  (parse candidates **per-element**, canonicalize/allowlist every model identifier, coerce numbers) **still
  apply** — a new provider is new untrusted output.
- **A/B shortlist (owner: include open-source high-reasoning models; verify each slug on OpenRouter at build):**
  - *Baseline — fast, proven forced tool-calls:* `openai/gpt-4o-mini`, `anthropic/claude-haiku-4.5`.
  - *Open-source, latency-friendly + JSON-schema tool use:* `deepseek/deepseek-v4-flash`,
    `nvidia/nemotron-3-super-120b-a12b` (55B active → low latency). `:free` variants exist → cheap A/B.
  - *Open-source high-reasoning (owner ask — watch latency/cost):* `moonshotai/kimi-k3` (2.8T, 1M ctx,
    **$3/$15 per M — pricey for a hot path**); optionally `qwen/qwen3-coder`, Tencent `hy3`.
- **Two HARD gates — a candidate failing either is out of the live seam (could still serve post-call analysis):**
  1. **Forced function-calling** — must honor `tool_choice` forcing `emit_cues` on OpenRouter (many reasoning
     models don't reliably); strip any `<think>` trace before parsing; the **`realtime-llm-output-boundary`**
     per-element parse rules still apply (new provider = new untrusted output).
  2. **Latency budget** — the cue-decision call must stay in the **~500–800 ms p95** the pipeline was designed
     around (STT ~150–500 ms + LLM ~500–700 ms). A model that burns >~1 s on a reasoning trace is disqualified
     for live. NB: cue selection is *fast classification* (pick a `cue_key`), not deep reasoning — "high
     reasoning" cuts against the hot path, so treat the reasoning candidates as experiments, not favorites.
- OpenRouter adds a small hop vs a direct provider; fine for flexibility — pin to a direct provider once a
  winner emerges.

## 8. Phasing (smallest slice first)

- **RT-2a — STT → `feedTranscript` (the value slice). ✅ SHIPPED 2026-07-28** (`realtime/src/stt.ts` + `transcripts.ts` + migration `0010` + server wiring; +14 tests, 77 realtime green, typecheck clean). Dual Scribe sessions, committed segments feed the
  cue engine + persist. **This alone lights up RT-3/RT-4** (talk-ratio/monologue/question signals derive from
  transcript). Includes **WPM for free** (from Scribe word timestamps).
- **RT-2b — DSP prosody enrichment (follow-on).** F0/RMS/pause energy from raw PCM (pitch/energy for emotion
  v1). Needs PCM analysis; **not required** for first-light cues. Keep off the critical path.
- **Companion i — cue completer → OpenRouter** (§7). Independent; can land before/after RT-2a.
- **Companion ii — thread `scheduledLengthMin`** (from the booking, via `hello`) into `CueRuntime` so the
  `confirm_next_steps` window goal + `end_reserve_next_step` stop being inert (the standing `TODO(RT-2)`).

## 9. Compliance / security

- **Consent-gated egress:** open Scribe sessions + forward audio only after `consent.captured`.
- **`enable_logging=false`** (zero-retention) so ElevenLabs doesn't retain call audio.
- **Key server-side only**, from `process.env.ELEVENLABS_API`; never shipped to desktop, never logged.
- Writes stay within `live_*` (`live_transcript_segments`) — never the `calls`/`analyses` path.
- Optional later: `entity_detection` → redact PII (`credit_card`, etc.) before persisting transcript.

## 10. Cost & limits (to confirm — not fabricating numbers)

- **2 concurrent Scribe streams per active call** (rep + prospect) → ~2× per-minute STT cost per rep-hour.
- Public pricing says Scribe v2 is "~40% cheaper than v1"; realtime per-minute rate is tiered/enterprise and
  **not clearly published** — confirm on the ElevenLabs pricing page / dashboard before locking COGS
  (locked target was ~$1/rep-hr with AssemblyAI).
- **Concurrency limits** for realtime WS on our plan tier are **not documented** — confirm (N live reps = 2N
  sockets).

## 11. Decisions (resolved 2026-07-28)

1. **Transport:** raw Bun `WebSocket` — no ElevenLabs SDK (dep-light; we own reconnect/backoff).
2. **A/B model set:** baseline `openai/gpt-4o-mini` + `anthropic/claude-haiku-4.5`, **plus** open-source
   high-reasoning candidates (`moonshotai/kimi-k3`, `deepseek/deepseek-v4-flash`,
   `nvidia/nemotron-3-super-120b-a12b`, …), each gated on forced tool-calls + the latency budget (§7).
3. **Language:** auto-detect (`include_language_detection=true`; no pinned `language_code`).
4. **Retention:** `enable_logging=false` (zero-retention) — confirmed.

## 12. Acceptance criteria

- **RT-2a:** with `ELEVENLABS_API` set, a consented live session with two channels produces
  `live_transcript_segments` rows tagged rep/prospect, and the cue engine emits cues driven by real speech
  (verified on a throwaway DB, prod untouched); with the key **absent**, RT-0 behaves exactly as today
  (no STT, no cues) — fail-safe intact. New unit tests for `stt.ts` parsing (fake Scribe messages) +
  a scripted-audio→segment integration test.
- **Companion i:** `REALTIME_CUE_PROVIDER=openrouter` routes cue decisions through OpenRouter with the same
  forced-tool `emit_cues` contract; de-brand boundary tests still green; swapping `REALTIME_CUE_MODEL`
  changes the model with no code change.

---

### Sources
- Scribe v2 Realtime API reference — https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
- Client-side streaming guide — https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
- Introducing Scribe v2 Realtime — https://elevenlabs.io/blog/introducing-scribe-v2-realtime
- Realtime STT product/latency — https://elevenlabs.io/realtime-speech-to-text
- Diarization = batch-only (secondary) — https://aividpipeline.com/blog/elevenlabs-scribe-v2-guide-2026
