## Direct Answer

Build a single Rust core (using `cpal` for mic input plus platform-native loopback backends: WASAPI on Windows, Core Audio/ScreenCaptureKit on macOS, PipeWire/PulseAudio on Linux), expose it as a shared library with thin bindings, and layer your AI agents on top via a local REST/WebSocket API — this gives you one lean codebase instead of three separate apps.[^1][^2]

## Why A Single Native Core Beats Electron-Only

Electron's `desktopCapturer`/WebRTC APIs can grab mic + system loopback since Electron 31, but they add ~150-200MB runtime overhead, weaker low-latency guarantees, and inconsistent Linux support (PipeWire portal support is patchy). A Rust core with `cpal` for cross-platform mic capture and native loopback shims is what production tools like screenpipe and the `flexaudio` crate use, giving near-zero overhead (~5-10% CPU, ~600MB RAM even for full 24/7 capture) while still supporting Windows, macOS, and Linux from one codebase. You can still ship a thin Electron/Tauri/SolidJS UI shell that calls into this native core via FFI or a local HTTP/WS server — the recording engine itself stays platform-agnostic Rust.[^3][^2][^4][^1]

## Recommended Lean Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Capture core | Rust + `cpal` (mic) + backend-specific loopback modules | Unified audio I/O across OSes [^1][^5] |
| Loopback shim | WASAPI (Win), Core Audio taps/ScreenCaptureKit (Mac), PipeWire (Linux) | System-output capture per platform [^6][^7][^8] |
| IPC/API | Local REST + WebSocket (e.g. on localhost:PORT) | Lets your Python/Node agents pull audio streams/events [^2] |
| Storage | SQLite + chunked audio files (e.g. 30s WAV/FLAC chunks) | Lightweight, queryable, matches your Postgres/agent workflow style |
| Agent layer | Your existing n8n / Claude-integrated agents | Consume transcripts/events via the API, not raw audio |

This mirrors the screenpipe architecture (Rust workspace with `screenpipe-audio`, `screenpipe-core`, REST + MCP server) that already runs across macOS, Windows, and Linux with an SDK for embedding into Electron/Tauri/Node apps.[^2][^9][^10]

## Per-Platform Capture Plan

### Windows
Use WASAPI loopback capture (`IAudioClient` in loopback mode) for system output, and standard WASAPI input for the microphone — both are natively supported and don't require special drivers. .NET/C# devs often use NAudio's `WasapiLoopbackCapture`, but for a Rust core, `cpal`'s WASAPI backend plus a loopback extension (as in the `flexaudio` crate) covers both mic and system audio in one API. Note: WASAPI loopback only fires data events while audio is actively playing, so silence must be explicitly padded if you need continuous streams.[^6][^11][^1]

### macOS
Microphone capture goes through Core Audio (`AVAudioEngine`/`cidre` in Rust), while system-output capture requires either Core Audio Process Taps (macOS 14.4+, one-click permission, no screen-recording prompt) or ScreenCaptureKit (macOS 12.3+, requires Screen Recording permission). Core Audio taps are preferred going forward since they don't require the heavier Screen Recording entitlement and won't falsely suggest your app records video. You must add `NSAudioCaptureUsageDescription` to `Info.plist` or captures will silently return empty buffers — a common gotcha developers hit.[^12][^7][^13]

### Linux
Microphone capture uses ALSA (low-level) or PulseAudio/PipeWire (higher-level) via `cpal`; system-output loopback is best done through PipeWire's monitor sources or a PulseAudio "monitor" sink, since Linux has no single universal loopback API. Screenpipe itself defaults to `libpulse-binding` for audio, since PulseAudio (or PipeWire's Pulse-compatible layer) has the most consistent cross-desktop-environment support. Distro variance (Ubuntu/PipeWire vs. older PulseAudio-only systems) means you should detect the running sound server at runtime and pick the matching backend rather than hardcoding one.[^14][^1][^2]

## Cross-Platform Library Options Compared

| Library | Language | Mic | System Loopback | Notes |
|---|---|---|---|---|
| cpal + flexaudio | Rust | ✅ all OSes | ✅ WASAPI/CoreAudio/PipeWire | Best fit for a lean native core [^1] |
| miniaudio | C (single file) | ✅ | Partial (no unified loopback API) | Extremely small footprint, public domain [^5] |
| screenpipe SDK | Rust core, multi-lang bindings | ✅ | ✅ | Production-hardened, embeddable in Electron/Tauri/Node/Swift, but has licensing/OEM terms | [^9]
| Electron desktopCapturer | JS/TS | ✅ | ✅ (Electron 31+) | Simplest to prototype, heavier runtime, weaker Linux loopback | [^4][^3]
| SoundFlow | C#/.NET | ✅ | Windows-only currently | Good if you're already in .NET, not fully cross-platform yet | [^15]

Given your stack (Rust-friendly automation background, need for lean footprint, and plans to layer AI agents on top), `cpal` + native loopback shims is the most maintainable single-codebase choice, with the screenpipe SDK as a faster-to-ship alternative if you don't mind an existing dependency.[^9][^1]

## Recommended Build Plan

1. **Core engine (Rust):** Implement one `AudioCapture` trait with three backend implementations (WASAPI, Core Audio/SCK, PipeWire), unified through `cpal` for mic and custom modules for loopback.[^7][^1][^6]
2. **Chunked storage:** Write rolling 15-30s WAV/Opus chunks to disk, indexed in SQLite — matches your Postgres/automation habits and keeps memory low for 24/7 runs.[^2]
3. **Local API layer:** Expose a REST + WebSocket server (FastAPI or a thin Rust Axum server) so your n8n workflows and Claude-integrated agents subscribe to live transcripts/audio events without touching raw platform APIs.[^2]
4. **Permissions handling per OS:** Bundle `NSAudioCaptureUsageDescription` (macOS Info.plist), Windows microphone privacy prompt handling, and a runtime check for PipeWire/PulseAudio availability on Linux.[^1][^7]
5. **Thin UI shell:** Use SolidJS + Tauri (lighter than Electron) to control start/stop/device-select, talking to the Rust core over local IPC — keeps your preferred SolidJS stack while avoiding Electron bloat.
6. **STT/agent hookup:** Feed chunked audio into local Whisper (or your Claude agent pipeline) exactly as screenpipe does, keeping everything local-first if privacy matters for your automation clients.[^16][^2]

## Key Risks to Plan For

- macOS Core Audio taps require macOS 14.4+; older systems need the ScreenCaptureKit fallback with its stricter Screen Recording permission and app-restart requirement.[^7]
- WASAPI loopback stays silent with no `DataAvailable` events during true silence, so you must inject silence padding to keep timestamps aligned.[^11]
- Linux has no OS-standard system-loopback API — you are effectively building against whatever PipeWire/PulseAudio setup the user has, so runtime backend detection is mandatory, not optional.[^14][^2]

---

## References

1. [flexaudio 0.2.0](https://docs.rs/crate/flexaudio/latest)

2. [screenpipe architecture: event-driven capture and storage](https://docs.screenpipe.com/architecture)

3. [alectrocute/mic-speaker-streamer: Cross-platform Electron ...](https://github.com/alectrocute/mic-speaker-streamer) - The app provides a simple interface to capture both microphone input and system audio output, transc...

4. [Recording System Audio is hard, but with Microphone, it's ...](https://www.reddit.com/r/electronjs/comments/1oqurs2/recording_system_audio_is_hard_but_with/) - You can record microphone and system audio on loopback as of Electron 31 now, which works cross-plat...

5. [miniaudio - A single file audio playback and capture library.](https://miniaud.io/) - Cross Platform miniaudio works on all the major desktop and mobile platforms, including Windows, mac...

6. [Loopback Recording - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording) - In loopback mode, a client of WASAPI can capture the audio stream that is being played by a renderin...

7. [System Audio Recording | RecordKit - Nonstrict](https://nonstrict.eu/recordkit/guides/system-audio-recording.html) - Recording SDK for macOS apps

8. [Decoupling Capture and Processing #2686](https://github.com/screenpipe/screenpipe/discussions/2686) - Hi Screenpipe team! 👋 First of all, I want to express my deep admiration for this project. Screenpip...

9. [Screenpipe SDK — screen capture as a library](https://screenpipe.com/sdk) - Embed Screenpipe in Electron, Swift, Tauri, and Node apps. Cross-platform screen + audio + OCR. OEM ...

10. [Screenpipe](https://github.com/screenpipe) - screenpipe has 15 repositories available. Follow their code on GitHub.

11. [NAudio/Docs/WasapiLoopbackCapture.md at master · naudio/NAudio](https://github.com/naudio/NAudio/blob/master/Docs/WasapiLoopbackCapture.md) - Audio and MIDI library for .NET. Contribute to naudio/NAudio development by creating an account on G...

12. [Why Core Audio Taps Silently Failed (And What Actually Works)](https://www.aitchdien.com/posts/capturing-system-audio-macos-core-audio-vs-screencapturekit) - I spent hours debugging why Core Audio process taps would start without error but never deliver audi...

13. [Capturing System Audio on macOS in 2026: What an iOS Dev ...](https://dgrlabs.co/blog/2026-04-25-capturing-system-audio-on-macos-in-2026.html) - Notes from porting Bounce, an iOS audio visualizer, to macOS — including the three Core Audio Proces...

14. [What is recommeded: Pulseaudio or Pipewire? - Audio](https://forum.manjaro.org/t/what-is-recommeded-pulseaudio-or-pipewire/131764)

15. [I built a cross-platform audio playback and processing ...](https://www.reddit.com/r/csharp/comments/1ikm5af/i_built_a_crossplatform_audio_playback_and/) - SoundFlow is designed to run on Windows, macOS, Loopback is explicitly supported (only on Windows) a...

16. [About screenpipe | Open source AI screen memory](https://screenpipe.com/about) - screenpipe is a local-first memory layer for your desktop. It records screen content, app text, brow...

