---
name: tauri-v2-mobile-build
description: Use when adding, fixing, or debugging Tauri v2 Android/iOS builds — the desktop/src-tauri lib/main split, the .github mobile-build workflow, Android SDK/NDK versions, iOS init/build flags, or turning one Tauri codebase into desktop + mobile targets. Read before editing mobile CI or the src-tauri crate structure.
---

# Tauri v2 mobile (Android + iOS) builds

We build mobile **only in CI** (never on the dev box). These are the settings that make the *first*
CI run pass instead of failing on a template mismatch or an interactive hang.

## Crate structure: lib + thin main (required for mobile)

Mobile shells load the app as a native library, so the app logic lives in `lib.rs`, not `main.rs`:

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default() /* ... */ .run(tauri::generate_context!())... }

// src-tauri/src/main.rs  — thin launcher
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { app_lib::run(); }
```

```toml
# src-tauri/Cargo.toml
[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]   # staticlib=iOS, cdylib=Android, rlib=desktop bin
```

- **Gate desktop-only features by target**, not unconditionally. `tray-icon` has no Android/iOS
  equivalent, so add it only for desktop:
  ```toml
  [target.'cfg(any(target_os="windows", target_os="macos", target_os="linux"))'.dependencies]
  tauri = { version = "2", features = ["tray-icon"] }
  ```
  Cargo unions features, so desktop gets it and mobile builds without it.
- `src-tauri` is **excluded from the Cargo workspace** so headless `cargo test` never pulls the
  Tauri/webkit tree. `.gitignore` `src-tauri/gen/` — the Android/iOS projects are generated per-build.

## Android CI gotchas

- **Install API 36 + build-tools 36.** The Tauri v2 Android template pins `compileSdk 36`; an older
  platform/build-tools set fails the generated Gradle build with a compileSdk mismatch:
  ```
  sdkmanager "ndk;<ver>" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
  ```
- JDK **17**, `android-actions/setup-android@v3`, export `NDK_HOME`, add the Rust Android targets
  (`aarch64/armv7/i686/x86_64-linux-android`), build the frontend, then:
  `cargo tauri android init` → `cargo tauri android build --debug --apk --target aarch64`.
- A release **AAB** for Play needs a signing keystore wired into `gen/android` (`ANDROID_KEY_BASE64`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Debug APK is unsigned and fine for validation.

## iOS CI gotchas

- Runner: `macos-latest` (currently macOS 26.x / Xcode 26.x — new enough for `screencapturekit`'s
  `macos_26_0` feature; don't downgrade blindly). Add Rust iOS targets.
- **`cargo tauri ios init --ci`** — the `--ci` flag is essential: without it, init can prompt for a
  development team and **hang the job on stdin**.
- Hard compile gate before packaging: `cargo build --lib --target aarch64-apple-ios` (proves the whole
  Rust app, incl. the cpal CoreAudio mic, builds for a real device arch). `generate_context!` embeds
  `../ui/dist`, so build the frontend first.
- `cargo tauri ios build --target aarch64-sim` needs **no** signing (simulator). A device `.ipa`
  needs Apple creds (`APPLE_DEVELOPMENT_TEAM`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  provisioning profile) — mark it `continue-on-error` until those secrets exist.

## Pin the CLI

`cargo install tauri-cli --version "2.11.5" --locked` (a concrete version, not `^2.0`). The mobile
init/build templates change between CLI minor versions; an unpinned CLI is a source of silent drift
where CI worked yesterday and breaks today with no code change.

## Capability reality

Mobile is **mic-only** (see `tauri-system-audio-capture`). Don't attempt system/far-end capture on
Android/iOS — the OS forbids it. Cue delivery on mobile is audio-to-earbuds + on-screen.
