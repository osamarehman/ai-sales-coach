# Agent Brief — Desktop App Architecture & Build (web-research)

> Paste this whole file into a capable agent that has **web search / web research** tools.

## Product context
**AI Sales Coach** — real-time in-call coaching for the **individual sales rep** (self-serve,
pay-as-you-go credits). A cross-platform **desktop app** captures the rep's **mic** + the prospect's
**system audio** locally during any call (Zoom/Meet/Teams/dialer/in-person) and shows short **live
coaching cues** on a small always-on-top widget. After the call: a coaching report + an AI persona
to practice against. Backend is live (Bun · TypeScript+Express · PostgreSQL) and the real-time layer
is a new WebSocket service.

**Hard rules:** (1) never use the trademarked words "NEPQ"/"Jeremy Miner"; (2) do NOT design for
"invisible on screen-share" (dropped — reps share a single window); (3) ICP = the individual rep.

## Your role
Senior desktop + real-time-audio engineer. Research the **latest 2026 tooling** and produce a
**final architecture + build plan** for an auto-installable cross-platform widget.

## Requirements (design to these)
1. **Capture two SEPARATE audio streams** — the rep **mic** and the machine's **system/loopback
   output** (the prospect). Separate streams give free speaker separation. If a platform/tool can
   only deliver a mixed stream, flag it and propose a fallback (diarization).
2. **Stream to our backend over WebSocket** — PCM16 mono ~16 kHz frames, each tagged by channel
   (`mic` | `system`), authenticated by a per-session token. Receive **cue messages** (JSON) back and
   render them. **Propose the exact WS message schema** (audio frame, control, cue, consent) so we
   can align the backend to it.
3. **Widget UI** — small, **always-on-top, draggable**, low-distraction. Simplest path: a lightweight
   **webview** rendering our SolidJS cue UI (so design stays in one place); evaluate native as an
   alt. Must be reposition-able and dismissable.
4. **Cross-platform + auto-installable + auto-update** — macOS, Windows, Linux. Installers
   (.dmg/.pkg, .msi/.exe, AppImage/.deb), silent auto-update, and **code-signing/notarization**
   (macOS Developer ID + notarization; Windows Authenticode/EV; Linux signing) — cover the real
   steps and costs.
5. **OS permissions & capture APIs** — macOS mic + system audio (**Core Audio process taps, macOS
   14.4+**, or ScreenCaptureKit; screen-recording permission); Windows **WASAPI loopback** + mic;
   Linux **PipeWire/PulseAudio monitor**. Document permission prompts and failure modes.
6. **Consent capture** — an all-party disclosure step at call start; **no audio leaves the machine
   until the rep confirms consent**.
7. **Latency** — target <1.5 s speech→cue end-to-end; keep capture+uplink ≈150 ms. Small footprint.
8. **Future-extensible** — plugin points for new cue types and an optional second-surface (phone/2nd
   monitor) renderer later.

## Framework — DECIDED (2026-07-25): Tauri v2, one full Rust app, cross-platform from day one
Do **not** re-litigate Electron vs native-shell. The stack is fixed: a **single Tauri v2 application**
with a **Rust capture core** and a **SolidJS** webview UI, shipping to **Windows, macOS, and Linux
from one codebase**. Your job is to detail *how*, not *whether*.
- **Capture core:** one `AudioCapture` trait; **`cpal`** for the mic + a native loopback backend per
  OS — **WASAPI** (Windows), **Core Audio process taps 14.4+ / ScreenCaptureKit** (macOS),
  **PipeWire/PulseAudio monitor** (Linux). Detect the running sound server on Linux at runtime. Keep
  the two streams (mic + system) **separate** for free speaker separation. Reference: `/tmp/md.markdown`.
- **Still research + decide within this stack:** exact Rust crates (`cpal`/`flexaudio`/`cidre` vs
  raw bindings), WASAPI-silence padding, macOS taps-vs-SCK trade-off, Tauri auto-update + code-signing/
  notarization steps and costs per OS, and which loopback backend to bring to first-light first.
- **Buy-to-validate: Recall.ai Desktop SDK** — bot-less local capture, fast Zoom/Meet demo; note its
  limits (Windows + Apple-Silicon only; **mixes** mic+system for non-meeting calls). Recommend
  whether to spike it in parallel while building the native Rust core.

## Deliverable
Write **`desktop-architecture.md`**: (1) Tauri/Rust stack details + crate choices + rationale, (2) full
architecture (Rust capture core w/ per-OS loopback behind one `AudioCapture` trait → WS protocol w/ the
concrete message schema → SolidJS widget → updater/signing), (3) phased build plan with milestones +
effort estimates, (4) a PoC checklist to a working demo on the **first-light OS** (Core Audio tap or
WASAPI), (5) risks + per-hour cost + per-OS signing/notarization costs. Cite current (2026) sources with URLs.

## Return (top of your reply)
One-paragraph recommendation + the chosen stack + the top 3 risks + the proposed WS message schema.
