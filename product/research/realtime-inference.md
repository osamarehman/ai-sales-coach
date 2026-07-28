# Real-Time Inference Pipeline — AI Sales Coach (2026)

Design + justification for the live coaching subsystem: dual-stream capture → real-time
transcription → conversation state + prosody → debounced fast-LLM cue engine → WebSocket
overlay. Target: **< ~1.5 s speech-to-cue**. Users: SMB solo reps + small teams. Cost matters.
All vendor facts verified against 2026 sources (URLs in each section + Sources at the end).

---

## 0. Recommended pipeline (component by component)

```
 Desktop client (Electron/native)
 ├─ MIC  (rep / employee)  ─┐
 └─ SYS  (prospect / customer)─┐
        two PCM streams, wall-clock-stamped frames
                    │  (secure WS, BetterAuth cookie verified server-side)
                    ▼
 ┌──────────────────────── realtime service (own container, Bun+TS) ─────────────────────┐
 │  Relay ── stream A ──► AssemblyAI Universal-Streaming  (rep channel)                   │
 │        ── stream B ──► AssemblyAI Universal-Streaming  (prospect channel)              │
 │            partials/finals + word timestamps + intelligent endpointing (EOT)           │
 │                    │                                                                    │
 │   Prosody DSP (local, per channel): F0 pitch, RMS energy, WPM, pauses, pitch variance  │
 │                    │                                                                    │
 │   Conversation buffer  ── merge by absolute ts → speaker-tagged rolling window          │
 │                    │                                                                    │
 │   ┌─ Goal/Timer runner (deterministic, no LLM) ─┐   ┌─ Cue engine (Claude Haiku 4.5) ─┐ │
 │   │ time deadlines, phase, keyword-mention latch │→ │ debounced + flush-on-EOT,        │ │
 │   │ fire-once; injects focus-hint into LLM ctx   │  │ prompt-cached, structured JSON   │ │
 │   └──────────────────────────────────────────────┘  └──────────────┬──────────────────┘ │
 │                          Cue arbiter (dedupe, priority, rate-limit ≤1/~15–20 s)          │
 └──────────────────────────────────────────────┬───────────────────────────────────────┘
                    │  cues {type,text,priority,confidence}  (WS push)
                    ▼
             Desktop overlay renders cue
```

| Layer | Choice (v1) | Why |
|---|---|---|
| Capture | Desktop client, two separate PCM streams (mic + system) | Separate streams = **speaker attribution for free**, no diarization |
| STT | **AssemblyAI Universal-Streaming**, 2 concurrent mono sessions | $0.15/hr/stream, ~300 ms immutable transcripts, word timestamps, intelligent endpointing, unlimited concurrent streams |
| STT alt | Deepgram Flux | Native model-integrated end-of-turn; pick when turn-taking fidelity > cost |
| Prosody | **Local DSP** (F0, RMS, WPM, pauses) + text sentiment from the LLM | Cheapest, lowest latency, no raw audio to a 3rd-party emotion API; also sidesteps EU rep-emotion ban |
| Cue engine | **Claude Haiku 4.5** (Anthropic API direct), prompt-cached, structured outputs | $1/$5 per Mtok, fast, strict-schema JSON, native caching + streaming |
| Scheduled cues | In-process per-session goal/timer runner | Deterministic, cheap, fires once; hands focus-hints to the LLM loop |
| Transport | WebSocket (Bun) | Bidirectional, low overhead |
| Isolation | Separate `realtime` container beside the async Fathom→grading pipeline | A real-time failure never breaks post-call grading |

**Not chosen:** OpenAI Realtime end-to-end (`gpt-realtime-2.1`, ~$0.06–0.11/min) — ~4–8× our
all-in COGS, bundles STT+reasoning (less control over cue schema/state/cadence), and is
speech-to-speech, not built for passive dual-stream listening.

---

## 1. STT layer

**Recommendation: AssemblyAI Universal-Streaming, run as two independent mono streaming
sessions (one per channel).** Deepgram Flux is the alternative when semantic end-of-turn
detection is the top priority.

### Why dual separate streams change the calculus
Because mic and system audio arrive as **physically separate channels**, the channel *is* the
speaker — rep on the mic, prospect on system audio. We get **speaker attribution for free** and
never run diarization. This makes Gladia's headline feature (bundled diarization) irrelevant
spend for us, and it removes diarization latency/error from the pipeline.

### Verified 2026 pricing / latency (per stream)
| Provider | Streaming price | Latency | Turn detection | Notes |
|---|---|---|---|---|
| **AssemblyAI Universal-Streaming** | **$0.15/hr** (billed on WebSocket session duration) | ~**307 ms** median (41% faster than peers), P99 ~1,012 ms | Intelligent endpointing (acoustic+semantic+silence) | Immutable transcripts (~300 ms word emission, never revised), word-level timestamps, **unlimited autoscaling concurrent streams**, ≥99.9% uptime |
| **Deepgram Flux** | **$0.0065/min** English PAYG (~$0.39/hr); $0.0057/min Growth; multilingual ~$0.0078/min | Sub-300 ms; EOT p95 ~1.5 s | **Model-integrated end-of-turn**, built for voice agents | Eliminates separate VAD/endpoint layer |
| **Gladia Solaria-1** | $0.25/hr Growth / $0.75/hr Starter | ~103 ms partial | Yes | Bundles diarization/NER/sentiment (we don't need diarization) |

Sources: AssemblyAI — https://www.assemblyai.com/blog/introducing-universal-streaming , https://www.assemblyai.com/pricing ; Deepgram Flux — https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/ , https://deepgram.com/learn/best-speech-to-text-apis-2026 ; Gladia — https://www.gladia.io/blog/best-real-time-stt-models-for-meeting-assistants-2026

**Dual-stream cost:** 2 × $0.15/hr = **$0.30/rep-hour** (AssemblyAI). Flux would be
2 × ~$0.39 = ~$0.78/rep-hour. For cost-sensitive SMB, lead with AssemblyAI; offer Flux as an
upgrade where turn-taking precision matters most (its native EOT is the cleanest cue trigger).

**Keys stay server-side.** The client streams audio to *our* relay; the relay holds the STT
credentials and opens the provider sessions. Never hand STT keys to the desktop client.

### Interleaving two timestamped streams into one conversation transcript
1. **Common clock.** The client stamps every audio frame with a monotonic capture timestamp
   (or the relay stamps on arrival). Each provider returns word-level timestamps *relative to
   that stream's session start*; add the session-start offset to get absolute wall-clock per word.
2. **Single ordered buffer.** Maintain one conversation buffer of finalized segments, each tagged
   `{speaker: rep|prospect, start_ms, end_ms, text, words[], prosody}`. Insert finals sorted by
   `start_ms`. Partials update only the tail for the live view; **commit on final** (AssemblyAI
   finals are immutable, so no rewrite churn).
3. **Overlap is fine.** When both talk at once, keep *both* concurrent segments (no diarization
   guess needed — the channel decides). The LLM sees an explicitly interleaved, speaker-labeled
   window, e.g. `[PROSPECT 12:03–12:07] …  [REP 12:06–12:09] …`, which also lets the coach detect
   interruptions/overtalk.
4. **Rolling window.** Feed the cue engine the last ~60–90 s of this merged, speaker-tagged buffer
   plus a compact running summary (below) — not the whole transcript.

---

## 2. Emotional / prosodic signal

The owner wants "the ups and downs of the voice, the pitch, the tone, the emotional flow."
Three families of options, with the recommended split of **v1 = local prosody + LLM text
sentiment**, **v2 = dedicated emotion model (Hume) for the prospect only**.

### Options evaluated (verified 2026)
| Option | What it returns | Latency | Cost | Compliance note |
|---|---|---|---|---|
| **Local DSP prosody** (client or server) | F0/pitch, RMS energy, speaking rate (WPM), pause length, pitch variance/monotone | ~20–50 ms, in-process | ~$0 marginal | No raw audio to 3rd party; objective *delivery* metrics avoid EU emotion-recognition scope |
| **Hume Expression Measurement** (Speech Prosody model) | **48 emotion dimensions** from tune/rhythm/timbre + vocal bursts + emotional-language model | Streaming WS available; **no published ms figure for EM streaming** | ~**$0.0639/min** audio *(third-party trackers; not on Hume's current pricing page — verify)* | Prosody→emotion from voice is likely "biometric"; must be **prospect-only** in EU |
| **Hume EVI 3 / EVI 4 mini** | Empathic speech-to-speech (prosody-aware) | EVI 3 <300 ms model (~1.2 s practical); EVI 4 mini sub-250 ms | $0.04–0.07/min | Speech-to-speech agent, overkill for passive read |
| **Gemini 2.5 Flash native-audio** | Audio-native; "affective dialog" adapts to vocal tone | real-time | audio in $3 / out $12 per 1M (~$0.02–0.03/min) | Sends raw prospect audio to Google; reasons over tone |
| **OpenAI gpt-realtime-2.1** | Reasons over tone, laughs, emotion | real-time | audio in $32 / out $64 per 1M (~$0.06–0.11/min) | Expensive; speech-to-speech |

Sources: Hume prosody — https://www.hume.ai/explore/speech-prosody-model ; Hume streaming — https://dev.hume.ai/docs/expression-measurement-api/websocket ; Hume pricing — https://www.hume.ai/pricing (EVI) + https://autogpt.net/hume-ai-pricing-every-plan-explained/ (EM, unofficial) ; Gemini — https://ai.google.dev/gemini-api/docs/pricing ; OpenAI — https://developers.openai.com/api/docs/pricing , https://openai.com/index/introducing-gpt-realtime/

### v1 recommendation: local prosody features + LLM text sentiment
- **Local DSP** on the PCM the relay already has: fundamental frequency (F0) via autocorrelation/YIN,
  RMS energy, speaking rate (words/sec straight from STT word timestamps — no extra DSP), pause
  detection (gaps between words), and pitch variance (monotone vs. dynamic). Emit a compact
  per-speaker signal frame (~100–120 tokens of JSON) into the cue-engine context.
- **Text sentiment / emotional flow** is read by the cue LLM itself from the transcript window — no
  separate classifier, no extra call. The LLM already sees "the flow"; prosody numbers ground it.
- **Why v1 this way:** cheapest (~$0 marginal), lowest latency (in-process, off the critical path,
  runs concurrent with STT), no raw audio leaves to a 3rd-party emotion API, and it cleanly avoids
  the EU rep-emotion ban (delivery metrics like talk-ratio/WPM/monologue length are *behavioral*,
  not emotion inference — see §7).

### v2: dedicated emotion model (Hume Expression Measurement) — prospect only
When we want richer affect ("prospect warming / cooling / hesitant"), add Hume's Speech Prosody
model **on the prospect channel only**, streamed in parallel, feeding a small set of emotion scores
into the cue context. Gate strictly by role + geography (§7). Cost adds ~$0.064/min *for the
prospect stream* (verify with Hume). Keep local DSP as the always-on baseline; Hume is an
enrichment, not a replacement. (Gemini native-audio is the interesting audio-native alternative if
we later want tone *reasoning* folded into one call — but it bundles the pipeline and sends raw
prospect audio to Google, so it stays a fallback, not the v2 default.)

---

## 3. Cue engine

A fast model over a **rolling window + running state + computed signals + per-call goal state**,
producing **typed JSON cues**.

### Model
**Claude Haiku 4.5** (`claude-haiku-4-5`, $1/1M in, $5/1M out, 200K ctx) called **directly against
the Anthropic API** for the realtime path (lower latency than the OpenRouter hop the async grader
uses; native prompt caching + structured outputs + streaming). Alternative cheap model via
OpenRouter: GPT-5.4-mini ($0.75/$4.50) — note GPT-5-mini has been delisted. Haiku 4.5 is the
recommendation: fast, cheap, first-class structured outputs.
Source (model IDs/pricing): Anthropic model catalog (claude-api skill, cached 2026-06-24).

### Loop parameters
- **Window size:** last ~60–90 s of the merged speaker-tagged transcript (~700–900 tokens) +
  a **running state summary** (~250 tokens) that the engine maintains itself: call goal, playbook
  stage, criteria/topics covered, prospect signals so far, last cue given. This keeps rolling state
  cheap — we never resend the whole transcript.
- **Debounce + triggers (reconciles cadence vs. the 1.5 s target):**
  - **Reactive trigger** — *flush on prospect end-of-turn* (STT intelligent endpointing / Flux EOT).
    This is the low-latency path for "respond to what was just said."
  - **Strategic trigger** — trailing debounce **~2 s** after the last final, with a hard
    **max-wait ~8–10 s** during continuous talk, for slower coaching nudges.
  - Rapid partials never trigger; only finals + EOT + timers do.
- **Structured output enforcement:** Haiku 4.5 supports `output_config.format` (json_schema, strict)
  and strict tool use. Emit an **array of 0..n cues**; empty array = "nothing to say." Schema:
  ```
  { "cues": [ { "type": "objection|discovery|next_step|risk|delivery|goal",
                "text": "string (≤~140 chars, imperative, in-context)",
                "priority": "low|med|high",
                "confidence": 0.0-1.0 } ] }
  ```
  Structured outputs guarantee valid parseable JSON — no prefill, no regex, no retry-on-malformed.
- **Cost/latency controls:** prompt-cache the static prefix; stream the response and render the
  first cue as it generates; small `max_tokens` (~200); confidence threshold filter (drop
  `confidence < ~0.55`) before delivery.

### Token budget per inference (with prompt caching)
| Segment | Tokens | Note |
|---|---:|---|
| Static prefix (instructions + rubric + schema + few-shot) | ~4,500 | **cached** (Haiku min cacheable prefix = 4,096 tokens — design the prefix ≥4,096, else it silently won't cache) |
| Rolling transcript window | ~900 | fresh |
| Running state summary | ~250 | fresh |
| Prosody/signal JSON | ~120 | fresh |
| Output (cue array) | ~120 | — |

Per-inference cost (Haiku 4.5): cache-read 4,500 × $0.10/1M = **$0.00045** + fresh input 1,270 ×
$1/1M = **$0.00127** + output 120 × $5/1M = **$0.00060** ≈ **$0.0023/inference** (cache-write of the
prefix is once-per-call, amortized to ~$0.00004/inference — negligible). Without caching:
~$0.0064/inference, so caching ~halves it.

### $/rep-hour COGS (LOCAL capture — no meeting-bot fee)
Cadence ~4–7 inferences/min (flush-on-EOT + debounce; midpoint ~5/min = 300/hr):
| Line item | $/rep-hour |
|---|---:|
| STT (AssemblyAI, 2 streams × $0.15) | $0.30 |
| Cue LLM (Haiku 4.5, cached, ~300 inf/hr × $0.0023) | ~$0.69 |
| Prosody (local DSP) | ~$0.00 |
| WS/infra (own servers, amortized) | ~$0.02 |
| **v1 total** | **≈ $1.00/rep-hour** (range ~$0.90–$1.15) |

**vs OpenAI Realtime end-to-end** (`gpt-realtime-2.1`, ~$0.06–0.11/min = **$3.60–6.60/rep-hour**):
the hybrid is **~4–7× cheaper all-in**, and the STT commodity alone ($0.30/hr dual = $0.005/min)
vs Realtime ($0.06–0.11/min) is **~12–22× cheaper** — directionally consistent with the "10–18×"
framing; the exact multiple depends on how heavy the LLM layer is. The economic point that matters:
at ~$1/rep-hour the hybrid is viable at $25/45/75-per-rep pricing; Realtime end-to-end is not.

---

## 4. Scheduled / queued cues

A lightweight, **deterministic per-session goal/timer runner** living beside the transcript stream —
no LLM in its trigger path.

### Goal types (loaded from the tenant's playbook at session start)
- **Time-deadline:** "prompt a consequence question if none asked by minute 8."
- **Phase / relative-time:** "remind next-steps in the last 5 minutes" (uses expected duration from
  the calendar invite, or an elapsed-time heuristic / detected wrap-up signals when unknown).
- **Event / condition:** "cue when budget is mentioned" (fires when the condition flips true).

### Design
- On session start, load goals and **arm** them: absolute-time goals → timer wheel; event goals →
  condition watchers.
- **Condition matching is cheap** — keyword/regex or embedding match over incoming finals, or reuse
  a boolean the cue LLM already emits (e.g. `budget_mentioned: true` in its running-state update).
  No dedicated LLM call to *decide* a trigger.
- **Fire-once latch** per goal (idempotent) — a goal never re-fires within a session.
- **Coexistence with the debounced LLM engine (two ways a goal can surface):**
  1. **Direct template** — emit a pre-written cue straight to the arbiter (fastest, canned).
  2. **Focus-hint injection (preferred)** — the runner sets a flag in the running state
     (`pending_goal: ask_consequence_question`); the *next* cue-engine inference sees it and phrases
     a natural, in-context cue. Reuses the LLM loop, avoids a jarring canned line. On EOT this fires
     within the normal low-latency path; for a hard deadline with no imminent turn, the runner can
     force a flush.
- **Arbiter** (shared by LLM + goal runner): dedupe, sort by `priority`, and **rate-limit the
  overlay to ≤1 cue per ~15–20 s** (highest priority wins) so the rep isn't spammed. Timer cues and
  LLM cues compete in the same queue.

This keeps the deterministic "did X happen / has the clock passed T" logic out of the probabilistic
LLM (reliable, ~free) while letting the LLM do the wording (natural, in-context).

---

## 5. Latency budget (~1.5 s speech → on-screen cue)

Reactive path (cue in response to what the prospect just said — the tight path):
| Stage | Budget | Risk / mitigation |
|---|---:|---|
| Capture + frame + uplink (client→relay) | ~150 ms | audio frame size (100–250 ms) is inherent; keep frames small |
| STT endpointing (end-of-turn detect) | ~300–500 ms | AssemblyAI intelligent endpointing / Flux native EOT; tune silence threshold |
| Final transcript delivered | ~200–300 ms | immutable finals ~300 ms; overlaps with endpointing in practice |
| Prosody DSP | ~0 ms on critical path | runs **concurrently** with STT |
| **Cue LLM inference (Haiku 4.5)** | **~500–700 ms** | **biggest, most variable** — mitigate with prompt caching, streaming (render first cue as it generates), small max_tokens, direct Anthropic call (no OpenRouter hop) |
| Post-process + WS push | ~50–100 ms | — |
| Overlay render | ~50 ms | — |
| **Total** | **~1.25–1.5 s** | tight but feasible |

**Where the risk is:** the LLM step dominates and varies most. Levers: keep the fresh input small
(rolling window, not full transcript), cache the static prefix, stream + render incrementally, cap
output tokens, and call Anthropic directly. Secondary risk: over-aggressive endpointing adds
latency or clips turns — make the silence threshold configurable. The **strategic** (debounced)
cues are *not* on this 1.5 s clock; only the EOT-flushed reactive cues need to hit it.

---

## 6. Compliance gating (hard requirement)

### 6a. Recording consent — CIPA / all-party (client-captured, server-enforced)
- **Federal baseline:** one-party consent (18 U.S.C. §2511) — a floor; states may be stricter.
- **CIPA (Cal. Penal Code §632):** California is **all-party** consent for confidential
  communications; $2,500/violation + a private civil action ($5,000 or 3× damages).
- **All-party states (~11–13, genuinely fuzzy):** CA, CT, FL, IL, MD, MA, MT, NV, NH, OR, PA, WA
  (DE ambiguous), with wrinkles — OR is one-party for *phone*, NV is all-party by case law, MI is
  effectively one-party for a participant. Because a SaaS call can cross states, **follow the
  strictest applicable law**.
- **Design — capture in client, enforce in backend:**
  - The client must record consent **before any audio streams**. Practically: an all-party
    **disclosure at call start** ("This call is recorded for quality and coaching") captured *in the
    recording itself*, with the prospect's continued participation = implied consent; decline →
    drop the party / stop.
  - **Backend enforcement:** a `live_session` cannot transition to `active` and the relay **rejects
    audio** until `consent_captured = true`; store consent metadata (timestamp, method, rep
    attestation, jurisdiction) on the session.
  - **Safest posture:** universal all-party disclosure on **every** call regardless of state
    (cheap; provable). Note the accelerating 2024–2026 CIPA class-action wave (800+ filings in 2025;
    pen-register/§638.51 and session-replay theories; CA SB 690 pending) — real-time
    interception/transcription is exactly the surface plaintiffs are stretching CIPA toward, so
    consent capture must be airtight.
- Sources: https://codes.findlaw.com/ca/penal-code/pen-sect-632/ , https://www.recordinglaw.com/party-two-party-consent-states/ , https://btlaw.com/en/insights/alerts/2026/cipa-ecpa-website-tracking-privacy-litigation-in-2026

### 6b. EU AI Act — emotion recognition of employees is banned; prospects allowed
- **Article 5(1)(f)** bans AI that **infers emotions of a natural person in the workplace/education**,
  except for medical or safety reasons. **In force since 2 Feb 2025**; fines up to **€35M or 7% of
  global turnover** (enforceable from 2 Aug 2025).
- **Scope:** covers **employees/workers** (the rep). Does **NOT** cover **customers/prospects** — the
  Commission's Feb-2025 guidance explicitly allows customer emotion detection. A system reading
  **both** sides needs safeguards so the *employee* isn't the one emotion-tracked.
- **Definition hook:** Art 3(39) — "emotion recognition system" infers emotions **from biometric
  data**. Out of scope: readily-apparent expressions, basic voice features, **text-only sentiment**
  (not biometric), and physical-state detection. So **text sentiment on the rep is fine; voice-prosody
  emotion inference on the rep is the risky part** in the EU.
- **Feature-gating design — branch by role × geography, resolved at session start:**
  ```
  emotion_policy = {
    analyze_prospect_emotion: true,                 // prospect channel — allowed everywhere
    analyze_rep_emotion:      region !== "EU",      // rep channel — OFF for EU workplaces
    rep_delivery_metrics:     true                  // talk-ratio, WPM, monologue, interrupts — behavioral, allowed
  }
  ```
  - **Prospect channel (system audio):** emotion/prosody analysis allowed (incl. Hume v2).
  - **Rep channel (mic):** in EU, **do not infer rep emotional states** and **never surface
    "rep is stressed/nervous" cues**. Still allowed: objective **delivery metrics** (talk/listen
    ratio, pace, monologue length, interruptions) — behavioral, not emotion recognition.
  - **Geography source:** tenant config (declared workplace jurisdiction / billing country), not IP;
    default the restriction **on** for EU tenants. The cue LLM's system prompt + the prosody pipeline
    both read `emotion_policy`; the LLM is instructed not to emit rep-emotion inferences when gated.
- Sources: https://artificialintelligenceact.eu/article/5/ , https://artificialintelligenceact.eu/article/3/ , https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/ , https://artificialintelligenceact.eu/article/99/

*(Compliance research is engineering guidance, not legal advice; the all-party state list and EU
scope should be confirmed with counsel before launch.)*

---

## 7. Fit with the existing stack (alongside, not inside)

The current product is a **multi-tenant async pipeline**: Fathom webhook → background
`processCall` → OpenRouter (`anthropic/claude-sonnet-4.5`, JSON mode) → `analyses` (11-criteria
scorecard) → optional Slack notify. Tables: `tenants, reps, integrations, rubrics, calls,
analyses, memberships, notifications`; every domain row carries `tenant_id`; deployed live behind a
shared Caddy edge.

### Placement + isolation
- **New `realtime` service = its own container/process** (Bun+TS), with its own WebSocket server,
  its own STT + Anthropic connections. It shares the **same Postgres instance** and BetterAuth, but
  **writes only to new `live_*` tables** — it never touches the `calls`/`analyses` write paths.
- **Failure isolation (the hard requirement):** because it's a separate deploy unit, a real-time
  crash / OOM / hot-loop cannot take down the API + Fathom webhook process. If `realtime` is down,
  Fathom webhooks still ingest and grade normally. Coupling is **one-directional and optional**: a
  finished `live_session` *may* enqueue a post-call analysis (link to a `call`, reuse the tenant's
  rubric to produce the same 11-criteria scorecard), but grading never depends on realtime being up.
- **Shared vs separate:** shared = Postgres, BetterAuth (verify the WS upgrade's session cookie
  server-side, resolve `tenant_id` + `rep_id` before opening a session), Anthropic key, tenant
  scoping. Separate = compute, scaling, deploy cadence.

### New tables (high level, all `tenant_id`-scoped)
- **`live_sessions`** — `id, tenant_id, rep_id, call_id?(link to calls), status,
  started_at, ended_at, consent_captured, consent_meta jsonb, region, playbook_id,
  goal_state jsonb, metrics jsonb`.
- **`live_cues`** — `id, tenant_id, session_id, ts, type, text, priority, confidence,
  source (llm|goal|system), delivered bool, feedback` (for cue-quality tuning + post-call replay).
- **`live_transcript_segments`** — `id, tenant_id, session_id, speaker (rep|prospect),
  start_ms, end_ms, text, is_final, prosody jsonb` (persist finals for post-call; the hot rolling
  window lives in memory).
- **`live_playbooks`** — `id, tenant_id, name, goals jsonb` (the §4 time/event goals), referenced by
  `live_sessions.playbook_id`.

### Reuse
- Same `tenant_id` multi-tenant model, same BetterAuth sessions, same Anthropic account. The async
  grader keeps using OpenRouter/Sonnet-4.5; the realtime cue engine uses Anthropic-direct/Haiku-4.5
  (different latency/cost profile, deliberately). Optional post-call bridge lets a live call also
  land in the existing dashboard as a normal graded `call`.

---

## Sources
STT: https://www.assemblyai.com/blog/introducing-universal-streaming · https://www.assemblyai.com/pricing · https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/ · https://deepgram.com/learn/best-speech-to-text-apis-2026 · https://www.gladia.io/blog/best-real-time-stt-models-for-meeting-assistants-2026
Emotion / audio-LLM: https://www.hume.ai/explore/speech-prosody-model · https://dev.hume.ai/docs/expression-measurement-api/websocket · https://www.hume.ai/pricing · https://autogpt.net/hume-ai-pricing-every-plan-explained/ · https://ai.google.dev/gemini-api/docs/pricing · https://developers.openai.com/api/docs/pricing · https://openai.com/index/introducing-gpt-realtime/
LLM pricing: Anthropic model catalog (claude-api skill, cached 2026-06-24) · https://pricepertoken.com/pricing-page/model/openai-gpt-5-mini
Compliance: https://artificialintelligenceact.eu/article/5/ · https://artificialintelligenceact.eu/article/3/ · https://artificialintelligenceact.eu/article/99/ · https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/ · https://codes.findlaw.com/ca/penal-code/pen-sect-632/ · https://www.recordinglaw.com/party-two-party-consent-states/ · https://btlaw.com/en/insights/alerts/2026/cipa-ecpa-website-tracking-privacy-litigation-in-2026
