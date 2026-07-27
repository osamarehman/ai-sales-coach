# AI Sales Coach — Desktop App

One **Tauri v2** application (Rust core + SolidJS UI) that captures the rep's **mic** and the
prospect's **system audio** as two separate local streams, sends them to the realtime backend over
WebSocket, and renders live coaching cues on an always-on-top overlay. Cross-platform: **Linux,
macOS, Windows** from one codebase. Architecture rationale: `../product/research/realtime-desktop-rust.md`
and `../product/realtime-plan.md` (§AMENDMENTS v2).

## Build here, run there
This repo's build box is **headless** (no audio device, no display). It **compiles and unit-tests**
everything and runs the `FakeSource` pipeline, but **real audio capture + the GUI overlay run on a
real desktop** — your Linux machine first, then macOS/Windows. The code is split so the pure parts
test in CI and only the Tauri shell needs a display.

## Layout
| Path | What | Runs headless? |
|---|---|---|
| `PROTOCOL.md` | **The WS contract** — the seam shared with the `realtime` backend lane | — |
| `crates/ws-protocol` | Rust mirror of the contract (serde types + binary frame codec) | ✅ `cargo test` |
| `crates/capture-core` | `AudioCapture` trait, DSP, `FakeSource`, cpal mic + per-OS system loopback (Pulse / WASAPI / ScreenCaptureKit) | ✅ `cargo test` |
| `crates/bridge` | WS session + capture orchestration (consent-gated); in-process mock-server test | ✅ `cargo test` |
| `dev-stub/` | Bun WS server implementing PROTOCOL.md — run the app with no real backend | ✅ `bun run` |
| `src-tauri/` | Tauri app: `lib.rs` (`run()` + mobile entry) + thin `main.rs`; commands `start_session`/`set_consent`/`stop_session` → emits `cue`/`status` | CI only |
| `ui/` | SolidJS overlay (Vite + bun): setup → consent gate → live cue cards | CI only |
| `.github/workflows/desktop-release.yml` | Desktop build matrix (Linux/macOS/Windows) → GitHub Release | GitHub CI |
| `.github/workflows/mobile-build.yml` | Experimental Android + iOS build jobs (unsigned/dev artifacts) | GitHub CI |

`src-tauri` is **excluded from the Cargo workspace** so `cargo test` never pulls the Tauri/webkit
tree; it's a standalone crate CI builds per-OS.

## Run the pieces
```bash
# 1. Headless: unit + integration tests (protocol, DSP, fake source, WS bridge)
cd desktop && cargo test              # 17 tests, no display/audio needed

# 2. Headless: protocol smoke test (handshake + consent gate + cue)
cd desktop/dev-stub && bun run smoke.ts

# 3. Dev backend stub (leave running in one terminal; the app connects to it)
cd desktop/dev-stub && PORT=8787 bun run server.ts

# 4. The app — ON A REAL DESKTOP (needs mic + display), NOT the build box:
cd desktop/ui && bun install          # once
cd desktop && cargo tauri dev         # opens the overlay; enter ws://localhost:8787 → Start
#   → click "I confirm" to pass the consent gate; the stub streams fake cue cards.
#   Both streams are real on Linux now: mic = cpal, prospect = Pulse/PipeWire monitor (play some
#   audio so the monitor source has signal). Windows/macOS loopback are validated in CI.
```

## Releases (no local desktop builds)
Cross-platform installers are built by **GitHub Actions**, never here:
```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```
The matrix (ubuntu/macos/windows) runs `tauri-action`, producing `.deb`/`.AppImage`, `.dmg`, and
`.msi`/`.exe` attached to a **draft** GitHub Release. Signing/notarization secrets are wired as
commented placeholders in the workflow (unsigned builds still install with an OS warning).

Mobile (experimental) builds via `.github/workflows/mobile-build.yml` — push a `mobile-v0.1.0` tag
(or run it manually) to produce an unsigned debug **Android APK** and an unsigned **iOS simulator**
app as CI artifacts. Store-ready signing needs the secrets noted in that workflow.

## Capture backends (behind one `AudioCapture` trait)
| Channel | Linux | Windows | macOS | Mobile (iOS / Android) |
|---|---|---|---|---|
| **mic** (rep) | ✅ cpal (ALSA) | ✅ cpal (WASAPI) | ✅ cpal (CoreAudio) | ✅ cpal (mic only) |
| **system loopback** (prospect) | ✅ Pulse/PipeWire monitor | ✅ WASAPI loopback | ✅ ScreenCaptureKit (via `ruhear`) | ✖ OS-blocked |

All three **desktop** system-loopback backends are implemented behind the same trait; each is
`cfg(target_os)`-gated so only the current OS's file compiles. Linux is unit-tested on the build
box; the Windows path is additionally cross-`cargo check`ed here; macOS + mobile compile in CI.

**Mobile is mic-only by OS design:** iOS exposes no API to capture another app's / the system's
audio, and Android's `AudioPlaybackCapture` explicitly cannot capture `VOICE_COMMUNICATION` (call)
audio. So mobile captures the rep's mic and delivers cues on-screen (and, planned, as audio to
earbuds); the prospect/far-end stream stays desktop-only. Set `AISC_MONITOR_SOURCE` on Linux to
override the monitor source if `@DEFAULT_MONITOR@` doesn't resolve (`pactl list sources short`).

## Status (RT-1)
Done: WS contract + Rust mirror, capture trait + DSP + cpal mic, `FakeSource`, **all three desktop
system-loopback backends** (Linux Pulse monitor, Windows WASAPI, macOS ScreenCaptureKit), `bridge`
(consent-gated), dev-stub, Tauri shell + SolidJS overlay, icon set, mobile-ready `lib.rs`/`main.rs`
split, GitHub Actions **desktop release matrix** + **experimental Android/iOS build** workflow.
**17 Rust tests + 1 protocol smoke, green headless; the Windows path is also cross-type-checked
here.** The Tauri compile (desktop + mobile) is validated by CI, by design — no GUI/installer builds
on the box. Next: audio-cue delivery to earbuds on mobile; signing/notarization for store artifacts.
