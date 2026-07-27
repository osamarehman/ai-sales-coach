---
name: headless-verify-discipline
description: Use when validating desktop/mobile app work on this headless build box (no display, no audio device, can't build GUIs/installers), when deciding whether something is actually verified vs merely compiling, or when tempted to call an OS/FFI code path "validated" from a type-check. Read before claiming a cross-platform change works.
---

# Build here, run there — what a green check actually proves

This box is **headless** (no display, no audio, can't cross-build a mac `.dmg` / win `.msi` / mobile
app). GUI, installer, macOS, mobile, and real audio all validate in **CI or on a device**, by design.
The failure mode to avoid is **overclaiming**: reporting "Windows is validated" because it *compiles*.
A type-check cannot see runtime OS/FFI semantics. (Real example from this repo: the WASAPI loopback
path type-checked perfectly and captured **silence** because the init `Direction` was wrong — caught
only by reading the crate source, not by any build.)

## What each check actually proves

| Check (runs on this box) | Proves | Does NOT prove |
|---|---|---|
| `cargo test` (pure crates: dsp, ws-protocol, bridge w/ FakeSource) | Logic, serialization, wiring | Any real device / OS behavior |
| `cargo check -p <crate> --target x86_64-pc-windows-msvc` | Windows code **type-checks**; signatures/API shapes match (catches e.g. `initialize_mta()` HRESULT misuse) | **Runtime WASAPI/OS semantics** (loopback flags, event delivery, permissions) |
| `bunx tsc --noEmit` + `vite build` (webview) | UI type-checks + bundles | Webview runtime APIs (SpeechSynthesis, audio routing) on the actual platform |
| `cargo clippy --all-targets` | Lints clean | Correctness |

- Whole-workspace `cargo check --target *-windows-msvc` will **fail to link** here on crates with C
  deps (e.g. rustls' crypto backend needs `lib.exe`). That's environmental, not a code error —
  scope the cross-check to the pure-Rust crate that holds the platform code (`-p capture-core`).
- macOS **cannot** be cross-checked at all (e.g. `screencapturekit`'s build.rs compiles a Swift
  bridge needing the macOS SDK). It only builds in CI. Don't pretend otherwise.

## Verify FFI/OS behavior against the source, not memory

When a change depends on how a native crate behaves (stream flags, direction, error variants):

1. The crate is on disk: `~/.cargo/registry/src/index.crates.io-*/<crate>-<ver>/`. Read `src/` and
   especially `examples/` — the author's own example is the canonical usage.
2. Prefer on-disk source over auto-generated memory notes. Haiku-summarized observations conflicted
   with each other here (one claimed loopback inits with `Direction::Render` — wrong). The `api.rs`
   match arm and the `record.rs` example were ground truth.
3. If two sources disagree, the compiled code wins — go read it before shipping a "critical" fix.

## Reporting rule

State exactly what was verified and how. "type-checks for windows-msvc; runtime unverified — CI/device
will confirm" is honest. "Windows validated" from a type-check is not. If a step was skipped or a
path is CI-only, say so plainly. The first CI/device run is a real part of the test plan — expect it
to surface things the box structurally cannot.

## Don't build platform artifacts on the box

Never run desktop/mobile GUI or installer builds locally (owner rule + it can't cross-compile anyway).
Tag → GitHub Actions produces the installers. Local scope = edit + the headless checks above.
