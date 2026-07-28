# AI Sales Coach — Real-Time Coaching: Architecture & Build Plan

*Synthesis of three research tracks (2026-07-24). Raw findings: `product/research/realtime-{desktop-capture,nepq-cues,inference}.md`.*

## ⚑ AMENDMENTS — v1 FINAL (2026-07-24, owner decisions; supersede sections below)
1. **Screen-invisibility requirement DROPPED.** Cues do **not** need to be hidden from screen
   capture. Reps share a **single window** (deck/CRM), which never contains our separate overlay —
   sufficient. ⇒ no `setContentProtection` dependency; **macOS-first is unblocked** (its
   full-screen-share limitation is now irrelevant); marketing must **not** sell "invisible on
   screen-share." RT-1 drops the exclusion work.
2. **De-brand the methodology.** Do **not** use the trademarked terms **"NEPQ" / "Jeremy Miner"**
   in product, code, or marketing. Live-cue logic is **our own "Cue Framework"** on *generic*
   selling behaviors (talk-time balance, discovery depth, problem/consequence framing, tonality,
   objection handling, next-step). Owner supplies source material (PDFs/examples) → we **extract**
   the paths/logic into our own taxonomy (`agent-briefs/cue-framework-extraction-agent.md`). The
   file `research/realtime-nepq-cues.md` is **internal reference only**.
3. **Decisions:** platform = **macOS-first**; emotion v1 = **local prosody** (default); waitlist =
   **spec handed to the owner's agent** (`product/waitlist-landing-spec.md`); backend RT-0 = built in-house.
4. **Parallel-agent briefs** for the non-backend lanes live in **`product/agent-briefs/`**
   (desktop app, frontend, landing page, marketing, legal/IP, cue extraction).

## ⚑ AMENDMENTS — v2 (2026-07-25, owner decision; supersedes v1 §3 platform + §1 capture/overlay)
5. **Desktop app = one full Rust app, cross-platform from day one.** Replace the Electron shell +
   Swift Core-Audio sidecar with a **single Tauri v2 application**: a **Rust capture core** (`cpal`
   for mic + platform-native loopback — **WASAPI** on Windows, **Core Audio process taps /
   ScreenCaptureKit** on macOS, **PipeWire/PulseAudio monitor** on Linux) driving a **SolidJS**
   webview UI (overlay + controls). One codebase → **Windows, macOS, and Linux** ("works for all
   platforms"), no separate native sidecar, no Electron. Rationale + per-OS capture details:
   `/tmp/md.markdown` research and the desktop-app agent brief. This **drops "macOS-first"** (v1 §3)
   — the architecture is cross-platform by design; the only per-platform work is each loopback
   backend behind one `AudioCapture` trait. Two **separate** streams (mic + system loopback) are
   preserved → free speaker separation is unchanged. `setContentProtection` was already dropped
   (v1 §1), so no capture-exclusion dependency is lost in the Electron→Tauri move.

## 0. What we're building

Real-time in-call coaching for the **individual sales rep** (self-serve, pay-as-you-go credits).
Three pillars:
1. **Live cues** during the call — NEPQ-grounded, on a private overlay.
2. **Post-call report** — reuse the existing H.E.A.R.T. grading.
3. **Persona practice** (extension) — an AI persona of the prospect the rep drills against.

A rep runs a **desktop app** that captures their **mic** + the prospect's **system audio** as
two separate local streams, sends them to a new **`realtime` backend service**, and gets cues
back on an always-on-top overlay. It works on **any** call (Zoom/Meet/Teams/dialer/speakerphone)
and needs no bot in the meeting. This subsystem sits **beside** — never inside — the async
Fathom→grading pipeline, so a live failure can't break post-call grading.

---

## 1. System architecture

```
 Desktop client (Tauri v2 — one Rust app)           Backend
 ┌───────────────────────────────┐        ┌────────────────────────────────────────┐
 │ Rust capture core (cpal)      │        │  realtime service (Bun WS, own container)│
 │  • loopback → system PCM      │  WS    │  ├ per-stream STT relay (AssemblyAI ×2)  │
 │    (WASAPI/CoreAudio tap/PW)  │──audio→│  ├ merge → speaker-tagged transcript buf │
 │  • cpal input → mic PCM       │        │  ├ local prosody DSP (F0/RMS/WPM/pause)  │
 │ overlay webview (SolidJS)     │←cues── │  ├ cue engine (Haiku 4.5, structured)    │
 │  • always-on-top, transparent │  WS    │  ├ goal/timer runner (deterministic)     │
 │  • Win/mac/Linux, one codebase│        │  └ arbiter (dedupe / prioritize / gate)  │
 └───────────────────────────────┘        └───────────────┬──────────────────────────┘
                                                           │ (session end, optional)
                                       Postgres (live_* tables) ── enqueue normal graded call
```

**Component choices (verified 2026 facts in the research docs):**

| Layer | Choice | Why / key facts |
|---|---|---|
| Capture | **Rust core in a Tauri v2 app** (build, cross-platform) | One `AudioCapture` trait, `cpal` for mic + native loopback per OS — **WASAPI** (Win), **Core Audio taps 14.4+ / ScreenCaptureKit** (mac), **PipeWire/PulseAudio monitor** (Linux) = two clean streams → **free speaker separation**; works on any call medium. One codebase, all 3 platforms; no Electron, no separate sidecar. Runner-up: **Recall.ai Desktop SDK** (buy) — bot-less, demo in days, but Win/Apple-Silicon only, **mixes** mic+system for non-meeting calls. |
| STT | **AssemblyAI Universal-Streaming**, 2 mono sessions | $0.15/hr/stream, ~307 ms median, immutable transcripts, word timestamps. Alt: **Deepgram Flux** (~$0.39/hr, native end-of-turn) if turn-taking > cost. No diarization needed (separate streams). |
| Prosody | **v1: local DSP** (F0, RMS, WPM, pauses, pitch variance) + text sentiment read by the cue LLM | ~$0 marginal, ~20–50 ms off critical path, no raw audio to a 3rd party, sidesteps the EU rep-emotion ban. **v2: Hume** Expression Measurement on the **prospect channel only** (~$0.064/min, verify). |
| Cue LLM | **Claude Haiku 4.5 (Anthropic direct)** | $1/$5 per Mtok, structured outputs, prompt caching; ~$0.0023/inference. (Async grader stays OpenRouter/Sonnet-4.5 — deliberate split.) |
| Transport | WebSocket (Bun) | Separate `realtime` container. |
| Overlay | Tauri v2 always-on-top transparent webview (SolidJS) | Design lives once in SolidJS. `setContentProtection` dropped (v1 §1) — see §2. |

**Latency budget (~1.25–1.5 s, reactive cues only):** capture+uplink ~150 ms → STT endpoint
~300–500 ms → final ~200–300 ms (prosody concurrent, off-path) → **Haiku ~500–700 ms (dominant
risk)** → WS+render ~100–150 ms. Mitigate the LLM step with prompt caching, streaming render,
small `max_tokens`, Anthropic-direct. Strategic/debounced cues are **not** on the 1.5 s clock.

**COGS (local capture, no bot fee): ~$1.00/rep-hour** (STT $0.30 + cue LLM ~$0.69 + prosody ~$0)
vs OpenAI `gpt-realtime` at **$3.60–6.60/rep-hour** (~4–8×). This is what makes it viable at
consumer credit pricing.

---

## 2. Cue surface & platform  ·  ⚠ invisibility requirement DROPPED (see Amendments)
> Retained below as reference on *why* we dropped it. Net: single-window-share is the norm, so we
> don't rely on capture-exclusion; **macOS-first** is the chosen lead. Second-surface (phone/2nd
> monitor) stays a nice-to-have, not a requirement.

The "cues invisible when I share my screen" promise is **not uniformly deliverable**:

- **Windows: SOLVED & compositor-enforced.** `setContentProtection` → `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`; Zoom/Meet/Teams/OBS/OS-recording **cannot** capture the overlay (Win10 2004+). ✅
- **macOS ≤14: works** (`sharingType=.none`). ✅
- **macOS 15/26 + full-screen share: BROKEN.** ScreenCaptureKit reads the composited frame and ignores the flag; Apple states there is **no public API** to prevent screen capture. A full-screen share on a modern Mac **shows the overlay**. ❌
- **macOS 15/26 + single-window share: still hidden** (picker streams only the chosen window). ✅

**Mitigations (design for these from day one):**
1. **Lead on Windows** for the clean guarantee.
2. **Second-surface cue rendering** — phone/tablet web view or a non-shared monitor — sidesteps the OS limit entirely and is arguably better UX ("glance down").
3. On Mac, **nudge single-window sharing** in the UX.
4. **Honest positioning:** "a private coach only you can see," not an absolute "invisible on every screen-share."

---

## 3. The coaching brain — our Cue Framework  ·  de-branded (see Amendments)
> Below documents the *detectable behaviors* (generic, non-trademarked) that drive cues. The
> trademarked source name is scrubbed from product/code/marketing; the stage/behavior logic is
> universal consultative-selling craft. Owner will supply source material to extend this taxonomy.

**NEPQ stage flow:** Connection → **Engagement** [Situation → Problem-Awareness → Solution-Awareness
→ Consequence → Qualifying] → Transition → Presentation → Commitment. **Five tonalities**
(curious, confused, concerned, challenging, playful); the key detectable rule: **downward terminal
inflection = calm/curious; upward = needy/salesy**. Objections = **Clarify → Discuss → Diffuse**
(never rebut).

**Cue taxonomy (~18):** talk-ratio critical, monologue too long, question drought, no
problem-awareness by min 6, missed pain signal, **pitching too early (present while PA/consequence
= 0)**, no consequence before pitch, mirror-the-pain, needy tone, pace, filler spike, interrupting,
objection-clarify, defensive-on-objection, no-qualify-before-close, buying-signal-advance, **missing
next-step**. Grounded in Gong benchmarks (43/57 talk-ratio, monologue < 76–90 s, ~11–16 Q/call).
Full table: `product/research/realtime-nepq-cues.md`.

**Alert-fatigue gating (the adoption killer):** confidence tiers (Crit ≥0.75 / Help ≥0.80 / FYI
≥0.85), metric debounce ≥20–30 s, **one cue on screen** (6–8 s auto-dismiss), soft ≤1 cue/2 min,
hard 2/min, **8–12 cues per 30-min call**, ≥20 s quiet gap, per-cue cooldown, priority pre-emption,
90 s warm-up, self-heal on acknowledgment. Arbiter enforces ≤1 cue / ~15–20 s.

**Scheduled/queued cues** = per-session deterministic goal/timer runner (no LLM in its trigger
path), each **fire-once**: `deadline` ("consequence question by min 8"), `watch` ("budget
mentioned → cue"), `window` ("next-steps in last 5 min"), `guard` ("presenting before
problem-awareness"). On fire it injects a `pending_goal` hint into the running state so the **next**
cue-engine inference phrases it naturally. `satisfiedBy` cancels a goal the rep already met.
Playbooks are pure data → the product owner authors watches without code.

---

## 4. Compliance (engineering guidance, not legal advice)

- **Consent / CIPA:** client captures **all-party consent at call start** (recorded in-audio);
  backend **rejects audio until `consent_captured = true`**. Universal all-party posture on every
  call (2024–26 CIPA class-action wave).
- **EU AI Act Art 5(1)(f):** bans inferring **employee** emotion in the workplace; **prospect
  emotion is allowed**. Gate by **role × geography**: `analyze_prospect_emotion = true` everywhere;
  `analyze_rep_emotion = region !== "EU"`; never surface "rep is stressed" in EU. Rep **delivery
  metrics** (talk-ratio, WPM, monologue, interrupts) are behavioral, not emotion recognition — always on.
  Geography from tenant config, **EU-default-on**.

---

## 5. Data model & service layout (per the `code-structure` skill)

New **`realtime` container** beside `backend`; shares Postgres + BetterAuth + Anthropic key.
Writes **only** new `live_*` tables; never touches `calls`/`analyses` write paths.

New tables, all `tenant_id`-scoped: **`live_sessions`** (consent, region, role, playbook_id,
goal_state), **`live_transcript_segments`**, **`live_cues`**, **`live_playbooks`**.

Layering (Actions orchestrate; services = mechanics):
- **Actions:** the WS ingest handler (auth, consent gate, session lifecycle), the arbiter (cue
  policy), the goal runner (domain rules).
- **Shared mechanics (pure, injectable):** `stt` (AssemblyAI/Deepgram client), `prosody` (DSP),
  `cue-engine` (Haiku structured-output client), `transcript-merge`. Same test discipline as
  `openrouter`/`fathom` today.

---

## 6. Cost & credit pricing

COGS ≈ **$1/rep-hour** live + persona/practice inference (small). Map usage → credits with margin:
call-minutes (live coaching), cue-inference volume, practice sessions, persona generations. A single
closed high-commission deal dwarfs the cost, so pricing scales with value unlocked. Wallet + top-up
(Stripe); low-balance handling; free trial credits. *(Detailed credit table = task RT-7.)*

---

## 7. Phased build plan

Each phase is an isolated slice with a runnable check; every phase ends with a **real-call test**.

| # | Slice | Acceptance criteria |
|---|---|---|
| **RT-0** | **Foundation & isolation** — `realtime` container skeleton (Bun WS), `live_*` migration, BetterAuth session verify on WS, consent gate | Authed client opens a `live_session` with consent; server **rejects pre-consent audio**; nothing touches `calls`/`analyses` |
| **RT-1** | **Capture thin slice (Tauri, cross-platform core)** — Rust `AudioCapture` trait: `cpal` mic + **Linux Pulse/PipeWire monitor** loopback to first-light (the box we can run on) → 2 PCM streams over WS; transparent always-on-top SolidJS overlay. Stub Win/mac loopback behind the same trait. Build in `desktop/`; dev against `desktop/dev-stub/` (no real backend needed). *Optional parallel:* 1-wk Recall.ai spike on Zoom | Two separate audio streams reach the backend on a real call from one Tauri build; overlay renders a test cue; trait boundary lets a second OS loopback land without touching WS/overlay code. **Progress (2026-07-27):** WS contract (`desktop/PROTOCOL.md`) + Rust mirror, capture trait + DSP + cpal mic + `FakeSource`, dev-stub + smoke test — all green headless (13 Rust tests + 1 smoke). Remaining: Tauri shell + SolidJS overlay + capture→WS wiring, then Linux Pulse-monitor loopback. |
| **RT-2** | **Live transcription + prosody** — relay each stream to AssemblyAI (2 sessions); merge to one speaker-tagged, absolute-timestamped buffer; local DSP prosody | Live merged transcript with correct speaker labels + rolling prosody in a debug view; < 500 ms word latency |
| **RT-3** | **Cue engine + arbiter + first 3 cues** — debounced Haiku structured cues (EOT flush + trailing debounce); arbiter gating; ship talk-ratio, pitching-too-early, missing-next-step | Cues fire only when triggers hold, within gating limits, < 1.5 s from EOT; false-positive rate acceptable on a test script |
| **RT-4** | **Scheduled-goal runner + playbooks** — deterministic fire-once goals; `pending_goal` hint injection; `live_playbooks` as data | "Consequence Q by min 8" fires once if missing / cancels if satisfied; "budget mentioned → cue"; "next-steps last 5 min" |
| **RT-5** | **Post-call report** — assemble merged transcript → reuse H.E.A.R.T. grading → report; optionally enqueue as a normal graded call | After a live session, a report/scorecard shows in the dashboard |
| **RT-6** | **Persona extraction + practice mode** (extension) — persona from transcript → rep drills against it (text first, voice later), scored | Persona generated from a real call; rep runs a scored practice session (credit-metered) |
| **RT-7** | **Credit metering + pay-as-you-go wallet** — meter minutes/cues/practice → credits; Stripe top-up; map to COGS + margin | Rep buys credits; usage deducts; low-balance handling |

**Cross-cutting:** consent UX, platform order, second-surface rendering, EU role×geo gating,
alert-fatigue tuning (ongoing).

---

## 8. Open decisions (yours)

1. **Waitlist landing page** — build & deploy here now, or hand the spec to the other agent?
2. ~~Platform to lead on~~ — **RESOLVED (v2, 2026-07-25):** cross-platform from day one via one Tauri/Rust core. First-light loopback backend = **Linux Pulse/PipeWire monitor** (2026-07-27) — it's the machine we run end-to-end; WASAPI + Core Audio follow behind the same trait.
3. **First real-time build move** — Rust capture core in Tauri (own the differentiator) vs a 1-week Recall.ai validation spike first.
4. **Emotion in v1** — local prosody only (recommended) vs pay for Hume on the prospect channel from day one.
5. **Consent UX weight** — silent checkbox at setup vs an in-call spoken disclosure (safest).

---

## 9. Sources
See the three research docs under `product/research/` — each carries inline URLs (7thlevelhq NEPQ,
Gong Labs benchmarks, Recall.ai docs, Apple Core Audio taps + forum 792152, AssemblyAI/Deepgram,
Hume, EU AI Act Art 5, CIPA case law). Caveats: Hume per-minute pricing is third-party-sourced
(verify); compliance notes are engineering guidance, not legal advice.
