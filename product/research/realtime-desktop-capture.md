# Real-Time Desktop Capture — Technical Research (AI Sales Coach)

Research date: 2026-07-24. Scope: desktop client that captures **system/speaker audio +
mic as two separate streams**, streams both to backend over WebSocket for real-time
transcription + coaching (<1.5s speech→cue), renders cues in an **always-on-top overlay
that is invisible to screen capture**, cross-platform (macOS/Windows/Linux).

## TL;DR verdict

1. **Audio capture (two separate streams) is a solved, bounded problem** on all three OSes
   natively, and Recall.ai can shortcut it — this is NOT the risky part.
2. **The genuinely hard requirement is "invisible to screen capture" on macOS.** It is
   **reliably solvable on Windows** (`WDA_EXCLUDEFROMCAPTURE`, DWM-enforced) but **NOT
   reliably solvable on macOS 15 (Sequoia) / 26 (Tahoe) for full-screen sharing** — Apple
   made ScreenCaptureKit ignore the exclusion flag, and there is **no public-API
   workaround** (confirmed by an Apple DTS engineer). It still works on macOS when the rep
   shares a **single window** rather than the whole display. This must reshape product
   expectations.
3. **Recommendation:** build **native two-stream capture** in an **Electron shell**,
   **macOS-first** (Core Audio process taps + mic), because it de-risks the core
   differentiator and works on any call medium. Use **Recall.ai Desktop SDK as the
   fast buy-to-validate fallback** for a Zoom/Meet/Teams-only demo.

---

## A. Recall.ai Desktop Recording SDK (the "buy" option) — evaluated hard

**It exists and is a real 2026 product** (distinct from their meeting-bot API). YC-launched
as "access real-time meeting data without bots."

- **Platforms:** **Windows + Apple-Silicon macOS only. NO Linux. No Intel Mac.**
  (Kills it as the single cross-platform answer.)
- **No bot joins the call** — fully local, on-device capture. Good.
- **Integrates into an Electron app "in under 5 minutes"**; marketing also lists Tauri,
  native mac, native Windows. Integration is via their infra/config API + native module,
  not a plain npm package.
- **Delivers audio AND transcript over WebSocket in real time.** Real-time transcription
  supports `prioritize_low_latency` mode (English only in low-latency mode). Events like
  `transcript.data` / `transcript.partial_data` via `desktop_sdk_callback`.
- **THE CATCH — separate streams:** For **meeting platforms (Zoom/Meet/Teams)** it detects
  the meeting and can label speakers from meeting metadata (per-participant). For
  **adhoc / in-person / dialer** (whole-desktop) capture, `prepareDesktopAudioRecording`
  **MIXES mic + speaker into ONE stream**, labels default to "Host"/"Guest", and to
  separate speakers you must run **machine diarization** on your STT. Raw
  **separate mic-vs-system streams are "currently not available"** in the Desktop SDK
  (they mix them); Recall invites you to request it. Note: their **per-participant
  separate raw audio** (`audio_separate_raw`, 16kHz mono PCM over WS) is a **Meeting-Bot-API**
  feature (bot joins), not the bot-less Desktop SDK.
  → So Recall's Desktop SDK does **not** deliver the "two clean OS-level streams on ANY
  call medium" that is this product's core premise. It's great for Zoom/Meet/Teams, weak
  for dialers/in-person.
- **Pricing (2026):** **$0.50 per recording hour** (Desktop SDK, prorated to the second),
  plus **$0.15/hr** if you use *their* real-time transcription. No monthly platform fee;
  pure usage-based.
- **Latency:** no published figure; adds their pipeline hop on top of STT. Their transcript
  is usable, but you have less latency control than owning streaming STT.

**Verdict:** Excellent *fast-path* to a working Zoom/Meet/Teams demo with real-time
transcript and zero native audio code. But (a) no Linux, (b) mixes audio on non-meeting
calls (defeating free speaker separation exactly where you'd need it), (c) $0.50/hr and
vendor lock on a core capability. Best used as **buy-to-validate**, not as the durable core.

Sources: https://www.recall.ai/product/desktop-recording-sdk ·
https://docs.recall.ai/docs/desktop-sdk ·
https://docs.recall.ai/docs/adhoc-meetings-in-person-meetings ·
https://docs.recall.ai/docs/dsdk-realtime-transcription ·
https://docs.recall.ai/docs/how-to-get-separate-audio-per-participant-realtime ·
https://www.recall.ai/blog/new-recall-ai-pricing-for-2026 ·
https://www.recall.ai/blog/speaker-diarization ·
https://www.ycombinator.com/launches/MId-recall-ai-desktop-recording-sdk-access-real-time-meeting-data-without-bots

---

## B. Native OS audio-capture APIs (build-it-ourselves path)

The two-separate-streams approach (capture the OS **output/loopback** as stream A, the
**mic** as stream B) is native on every OS and gives free speaker separation on ANY call
medium (Zoom, Meet, dialer, speakerphone) — because the prospect's voice comes out of the
speakers (stream A) and the rep's voice into the mic (stream B). Caveat: true **in-person**
(both voices only in the mic, nothing from speakers) has no "system audio" to separate —
that edge case still needs diarization.

### macOS — use Core Audio process taps (not ScreenCaptureKit) for audio-only
- **Recommended: Core Audio process/system taps** (`CATapDescription`,
  `AudioHardwareCreateProcessTap`, aggregate device + `AudioDeviceCreateIOProcIDWithBlock`),
  **macOS 14.4+**. Only needs **audio-recording permission** (`NSAudioCaptureUsageDescription`,
  a distinct TCC category), **not** the broad screen-recording permission — cleaner UX, no
  screen-recording indicator.
- **Mic** captured separately via **AVAudioEngine** (or CoreAudio) — this is the "stream B".
- **Why not ScreenCaptureKit for audio:** SCK *can* grab system audio but is
  "screen-recording-shaped" — requires screen-recording permission, ties audio to a capture
  session/target, shows the capture indicator, and its audio isn't isolated. Fine as a
  fallback for macOS 13, but taps are the right tool on 14.4+.
- **Effort/gotchas (real, from a 2026 field report):** moderately fiddly. Aggregate device
  must include a **real output device as main sub-device** with the tap as a sub-tap (tap-as-
  primary → silent zero samples); the `exclusive` param is **directional** (exclude-PIDs vs
  include-only-PIDs), inverting it → silence; **IOProc dispatch queue must be non-nil** (nil
  silently fails on macOS 26); process taps need a **stable signing identity** (unsigned
  builds get no permission prompt and don't work). Several calls return `noErr` but silently
  deliver no audio. **Working sample code exists:** `insidegui/AudioCap`. Budget ~1.5–2.5 wk
  for a solid, signed mac audio sidecar producing two clean streams over a local socket/WS.

Sources: https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps ·
https://github.com/insidegui/AudioCap ·
https://dgrlabs.co/blog/2026-04-25-capturing-system-audio-on-macos-in-2026.html ·
https://www.recall.ai/blog/how-to-get-access-to-system-audio

### Windows — WASAPI loopback (system) + WASAPI/WinMM (mic)
- **System audio:** **WASAPI loopback** — open the render endpoint (`IMMDevice`),
  `IAudioClient::Initialize` with `AUDCLNT_STREAMFLAGS_LOOPBACK`, read via
  `IAudioCaptureClient`. Well-documented, mature, no virtual device or admin needed.
  Per-app loopback (`AUDCLNT_STREAMFLAGS_...` process loopback / `ActivateAudioInterfaceAsync`)
  also available if you want just the meeting app's audio.
- **Mic:** a second WASAPI capture client on the capture endpoint → clean "stream B".
- **Gotcha:** **WASAPI has no built-in echo cancellation.** If the mic picks up speaker
  bleed you may want AEC (see Krisp, §E) — but with two separate streams you already have
  clean per-side signals for transcription, so AEC is a nice-to-have, not a v1 blocker.
- **Effort:** ~1.5–2.5 wk for a native module (C++/Rust) exposing two streams. Mature
  reference code exists (e.g., `huxinhai/audio-capture`).

Sources: https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording ·
https://github.com/huxinhai/audiotee-wasapi

### Linux — PipeWire monitor sources (fallback: PulseAudio)
- PipeWire exposes each sink's **monitor** source and each app as a separate node; capture
  the output device's monitor for "system audio" and the mic source for "stream B". This is
  exactly how OBS's PipeWire audio capture works (separate sources for output/input/apps).
- Lower priority (SMB sales reps are overwhelmingly on macOS/Windows). Budget ~1–2 wk.

Sources: https://docs.pipewire.org/page_man_pipewire-props_7.html ·
https://obsproject.com/forum/resources/pipewire-audio-capture.1458/ ·
https://wiki.archlinux.org/title/PipeWire

---

## C. App shell: Electron vs Tauri, and what shipping tools use

- **Both** can host a **SolidJS** renderer, do **transparent + always-on-top + click-through**
  (`setIgnoreMouseEvents` / Tauri equivalents), skip the taskbar, and toggle screen-capture
  exclusion with a one-liner (`setContentProtection` / `set_content_protected`).
- **Footprint:** Tauri v2 (system WebView + Rust) → <10MB installer, ~30–50MB RAM. Electron
  (bundled Chromium/Node) → 80–150MB installer, ~150–300MB RAM before your code runs. For a
  tool running *alongside* Zoom, Tauri's footprint is a real UX win, and developers have
  explicitly picked Tauri v2 for desktop overlays for this reason.
- **Ecosystem/maturity for THIS problem:** Electron wins. Native system-audio + capture-
  exclusion examples, `desktopCapturer`, and **Recall's Desktop SDK are Electron-first**;
  the "invisible overlay" recipes (Cluely-style) are almost all Electron.
- **The audio capture is a native sidecar (Swift/C++/Rust) either way** — so the shell choice
  is **not** coupled to the capture choice.
- **What real tools use:**
  - **Cluely / interview-coder-style "invisible" apps:** Electron + native OS tricks —
    `WDA_EXCLUDEFROMCAPTURE` (Win) and `sharingType=none` (mac).
  - **Granola / Otter / note-takers:** local macOS capture via ScreenCaptureKit/Core Audio
    (or a virtual audio device historically); several such note-takers use **Recall.ai's
    Desktop SDK** under the hood to avoid building native capture.
  - **Krisp:** ships a **C++ real-time voice SDK** (noise/echo/background-voice cancellation)
    embedded into apps incl. Electron — a processing layer, not a capture layer.

**Shell pick:** **Electron for the v1 spike** (fastest, most examples, Recall/Cluely-proven,
one-line `setContentProtection`, reuse SolidJS for the overlay UI). **Tauri v2 is the better
long-term shell** if footprint matters and you're willing to write more Rust glue.

Sources: https://www.electronjs.org/docs/latest/api/browser-window ·
https://blog.manasight.gg/why-i-chose-tauri-v2-for-a-desktop-overlay/ ·
https://www.electronjs.org/docs/latest/api/desktop-capturer ·
https://levelup.gitconnected.com/how-i-made-a-desktop-app-invisible-to-screen-sharing-electron-os-level-tricks-5734513c1e67

---

## D. Screen-capture EXCLUSION (the invisibility requirement) — the real risk

One cross-platform lever: Electron **`win.setContentProtection(true)`** (Tauri:
`set_content_protected(true)`), which maps to:

### Windows — SOLVED, reliable
- Maps to **`SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`** (0x11).
- **DWM/compositor-enforced** — the exclusion happens *before* pixels reach any capturer, so
  **Zoom, Meet, Teams, OBS, and OS recording (Game Bar/Snipping/Recall) cannot bypass it.**
  Requires **Windows 10 v2004 (build 19041)+** with DWM on. Older Windows → black box.
- **Caveats:** RDP sessions disable DWM (exclusion breaks); a physical phone photo of the
  screen obviously still sees it.

### macOS — NOT reliable on 15+/26 for full-screen sharing
- Maps to **`NSWindow.sharingType = .none`**. This worked through **macOS 14** (window was
  composited out of screen captures).
- **BROKEN on macOS 15 (Sequoia) and 26 (Tahoe):** ScreenCaptureKit reads the **final
  composited framebuffer** and **ignores** `sharingType`/`setContentProtection`. Since
  Zoom/Meet/Teams/QuickTime/OBS all use ScreenCaptureKit now, a **full-screen share shows
  the overlay.** Confirmed by **an Apple DTS engineer: "At this time there are no public
  APIs for preventing screen capture"**; Electron and Tauri both document the same
  limitation; independent researchers reproduced it (QuickTime/Zoom capture the "hidden"
  window). **No public-API workaround exists.**
- **BUT it still works for single-window sharing:** macOS's window picker only streams the
  **selected window's** pixels, so a *separate* overlay window is naturally not included when
  the rep shares one app window (the common "share my slides/CRM" case).

**Verdict on the hard requirement:**
- **Windows:** requirement fully met. ✅
- **macOS ≤14:** met. ✅
- **macOS 15/26, single-window share:** met (overlay isn't in the shared window). ✅
- **macOS 15/26, full-screen share:** **NOT met with public APIs.** ❌ — this is the load-
  bearing risk.

**Mitigations for macOS full-screen share (no silver bullet):**
1. **Windows-first** for the "guaranteed invisible" promise; be explicit that macOS
   full-display share is a known limitation.
2. **Encourage window-sharing** in product UX (works today; most reps share one window/tab).
3. **Detect capture and auto-hide/relocate cues** — imperfect (no clean public "am I being
   screen-shared" API on macOS; only heuristics/private APIs).
4. **Strongest fallback: render cues on a second surface** the rep controls — a companion
   phone/tablet web view or a non-shared second monitor — which **sidesteps the OS
   limitation entirely.** Worth designing for from day one.
5. File Apple Feedback; don't bet the roadmap on Apple reversing this.

Sources: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity ·
https://www.meziantou.net/how-to-exclude-your-windows-app-from-screen-capture-and-recall.htm ·
https://developer.apple.com/forums/thread/792152 ·
https://github.com/tauri-apps/tauri/issues/14200 ·
https://adamsvoboda.net/how-interview-cheating-tools-hide-from-zoom/ ·
https://pierce.dev/notes/building-a-kind-of-invisible-mac-app ·
https://www.interviewcoder.co/blog/is-cluely-detectable ·
https://www.electronjs.org/docs/latest/api/browser-window

---

## E. Alternative commercial SDKs/paths

- **Krisp Audio SDK** — real-time **C++** voice-processing SDK: noise cancellation, **echo
  cancellation (AEC)**, background-voice cancellation; Electron/WebRTC/Twilio bindings,
  cross-platform. **Not a capture SDK** — it's a **cleanup layer** you'd drop between raw
  capture and STT (e.g., to strip speaker bleed / echo from the mic stream, or clean noisy
  prospect audio). Nice-to-have for transcription quality; **not needed for v1.**
  (https://krisp.ai/developers/ · https://sdk-docs.krisp.ai/docs/electron)
- **LiveKit / Daily / Twilio** — WebRTC transport/SFU platforms for browser/mobile RTC.
  **Not built for desktop system-audio loopback capture.** A plain **WebSocket to the Express
  backend** is simpler and lower-latency for this use case. LiveKit could matter later if you
  want managed real-time infra (jitter buffers, scaling, its Agents framework), but it's not
  the capture answer. (https://docs.livekit.io/transport/sdk-platforms/)
- **STT for the backend (latency budget):** streaming STT over WebSocket is now **~300ms P50**
  (Deepgram Nova, AssemblyAI Universal-Streaming; ElevenLabs Scribe v2 RT <150ms). With
  native capture → streaming STT (~300ms) → LLM cue, the **<1.5s speech→cue target is
  achievable** if cue generation is kept tight (partial transcripts + small/fast model or
  cached prompts). ~$0.15–0.45/hr for streaming STT.
  (https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription ·
  https://deepgram.com/learn/streaming-speech-recognition-api)

---

## F. Build-vs-buy recommendation

### Primary path — v1 thin slice (macOS-first): **BUILD native, Electron shell**
Electron shell + a **native Swift audio sidecar**: **Core Audio process taps (14.4+) for
system audio + AVAudioEngine for mic = two clean separate streams**, streamed over WebSocket
to the Express backend; **streaming STT (Deepgram/AssemblyAI)**; overlay = transparent,
always-on-top Electron window (SolidJS UI) with `setContentProtection(true)`.

Why build even for v1: the two-separate-streams free-speaker-separation is THE differentiator
and must be de-risked directly; it works on **any call medium** (matching the product vision);
Recall doesn't deliver separated streams for non-meeting calls; and the mac audio path is a
bounded ~2-week effort with working sample code.

- **Effort:** mac audio sidecar ~1.5–2.5 wk; Electron overlay + exclusion + WS ~1 wk; backend
  WS ingest + STT + cue rendering ~1–1.5 wk → **~3–5 person-weeks to a macOS demo.**
- **Add Windows** (WASAPI loopback + mic + `WDA_EXCLUDEFROMCAPTURE`): **+1.5–2.5 wk.**
- **Add Linux** (PipeWire monitor): **+1–2 wk.** → **cross-platform ~7–11 person-weeks.**
- **Per-hour cost:** ~$0 capture (own code) + STT ~$0.15–0.45/hr + LLM cues ~$0.10–0.50/hr →
  **~$0.30–0.90/hr all-in**, mostly STT+LLM. Best margins; you own the stack.

### Runner-up — **BUY: Recall.ai Desktop SDK** (buy-to-validate)
Ship a **Zoom/Meet/Teams-only** demo in days with real-time transcript + speaker labels and
**zero native audio code**; overlay exclusion via `setContentProtection`.
- **Effort:** SDK integration ~0.5–1 wk; overlay ~0.5–1 wk; backend cue loop ~1 wk →
  **~2–3 person-weeks (Win + Apple-Silicon Mac, meeting platforms only).**
- **Per-hour cost:** **$0.50/hr** capture + ($0.15/hr Recall transcription *or* your own STT
  $0.15–0.45/hr) + LLM → **~$0.65–1.10/hr all-in.**
- **Limits:** no Linux ever; mixed audio on dialer/in-person (needs diarization); vendor lock
  on a core capability; less latency control.
- **Break-even:** native saves ~$0.50/hr vs Recall. A ~4–5 wk native build (~$30–50k eng)
  breaks even only at ~60k–100k call-hours — i.e., at SMB pilot scale Recall's fee is
  **negligible**, so the case for building native is **strategic (own the differentiator,
  any-call medium, Linux, margins at scale)**, not short-term cost.

### Suggested play
Optionally **run both in parallel for ~1 week**: a Recall.ai spike to validate the *coaching
UX* fast on Zoom/Meet, while building the native mac two-stream sidecar that becomes the
durable core. Ship **Windows early** for the clean "invisible" guarantee, and design the
**second-surface cue fallback** to neutralize the macOS full-screen-share limitation.

### Eventual cross-platform path
Native per-OS capture behind one interface: **macOS** Core Audio taps + AVAudioEngine;
**Windows** WASAPI loopback + WASAPI mic; **Linux** PipeWire monitor + mic. One Electron
(or later Tauri) shell; `setContentProtection` for exclusion (rock-solid on Windows, partial
on macOS per §D).
