---
name: tauri-desktop-auto-update
description: Use when working on desktop auto-update (the Tauri v2 updater/process plugins), the updater signing key, the GitHub Releases update feed, app versioning for releases, or the macOS "app is damaged" Gatekeeper problem. Read before touching desktop-release.yml's release flags, tauri.conf.json's version/plugins.updater/bundle, the src-tauri updater wiring, or the overlay's update UI.
---

# Desktop auto-update (Tauri v2 updater) + macOS code-signing / Gatekeeper

Installed desktop apps update themselves: on launch the app asks GitHub for the newest signed build,
and if one exists it offers **Install & restart**. Download → signature-verify → swap bundle →
`relaunch()`. Relaunch comes back at the idle screen, so the next call is a fresh session.

This is **desktop-only**. Mobile ships updates through the app stores; the updater plugin doesn't
support iOS/Android. Everything below is gated so mobile builds never see it.

## The wiring (all six pieces are required — miss one and it silently no-ops)

1. **Rust deps — desktop-gated** (`src-tauri/Cargo.toml`), in the existing
   `cfg(any(windows, macos, linux))` target block so mobile never pulls them:
   ```toml
   tauri-plugin-updater = "2"
   tauri-plugin-process  = "2"   # for relaunch()
   ```
2. **Register under `#[cfg(desktop)]`** (`src-tauri/src/lib.rs`) — the builder is shared with mobile,
   so the plugins must be added only on desktop:
   ```rust
   #[allow(unused_mut)]                     // `mut` is unused on mobile
   let mut builder = tauri::Builder::default().manage(...).invoke_handler(...);
   #[cfg(desktop)]
   { builder = builder.plugin(tauri_plugin_process::init())
                      .plugin(tauri_plugin_updater::Builder::new().build()); }
   builder.run(tauri::generate_context!())...
   ```
3. **Config** (`tauri.conf.json`): `bundle.createUpdaterArtifacts: true` **and**
   ```json
   "plugins": { "updater": {
     "endpoints": ["https://github.com/<owner>/<repo>/releases/latest/download/latest.json"],
     "pubkey": "<the .pub contents, base64>"
   } }
   ```
4. **Capability, scoped to desktop platforms** — a *separate* file (`capabilities/desktop.json`) with
   `"platforms": ["linux","macOS","windows"]`, permissions `["updater:default","process:allow-restart"]`,
   windows `["overlay"]`. **Do NOT** put these in the default (all-platform) capability: mobile builds
   don't compile the plugins, so their permissions don't exist there → capability-resolution build error.
5. **Frontend** (`ui/src/App.tsx`): `check()` from `@tauri-apps/plugin-updater`, `relaunch()` from
   `@tauri-apps/plugin-process` (add both to `ui/package.json`). Check once on mount inside a
   `try/catch` — on mobile / a webview without the plugin `check()` **throws**; swallow it. Offer the
   update **only between calls**, never mid-session (a restart prompt during a live call is a disaster).
6. **CI signs it** (`desktop-release.yml`): set `TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the tauri-action `env`. `createUpdaterArtifacts` still runs
   without them, but the artifacts are **unsigned and the updater rejects them** — so it looks built
   but never updates.

## The signing keypair (Tauri's own Ed25519 — NOT Apple signing)

`bunx @tauri-apps/cli@2 signer generate --ci -p "<password>" -w <keyfile>` → writes `<keyfile>`
(private) + `<keyfile>.pub` (public).
- **Public key** (`.pub` contents) → `tauri.conf.json` `plugins.updater.pubkey`. Committed; it's public.
- **Private key** + its password → the two repo Actions secrets (`gh secret set NAME < file`, so the
  key never lands in a shell log). **Never commit the private key.** Keep it in a gitignored dir
  (`desktop/.tauri-signing/`, already in `.gitignore`) and **back it up out-of-band** (password
  manager) — if it's lost you can't ship an update that verifies against the embedded pubkey; you'd
  have to change the pubkey and push a **manual** install to every user.

## Traps that cost real time

- **GitHub's "latest" excludes drafts AND prereleases.** The endpoint is
  `/releases/latest/download/latest.json`, so a `releaseDraft: true` or `prerelease: true` build is
  **invisible to the updater** — installed apps see no update. Updater releases must be published as
  full releases: `releaseDraft: false`, `prerelease: false`. (Bonus: this also fixes the "I can't see
  the release" draft-visibility complaint.)
- **The first updater-enabled release must be installed manually.** Any build shipped *before* the
  updater plugin existed has no updater, so it can't pull itself forward. Install the first
  updater-capable version by hand on each platform; auto-update works from **that version onward**.
- **Bump the version in BOTH places, in sync.** `tauri.conf.json` `version` drives the bundle name and
  the updater's *current-version* comparison; `Cargo.toml [package] version` drives
  `env!("CARGO_PKG_VERSION")` (the `app_version` the client reports to the backend). Bump only one and
  they disagree. The updater compares `latest.json`'s version against the running app's
  tauri.conf.json version — ship a **higher** version or no update is offered.
- **Private repo breaks the GitHub feed.** `/releases/latest/download/latest.json` 404s for
  unauthenticated clients once the repo is private. Before going private, either keep *releases* in a
  public repo, or move the update feed to your own backend (serve `latest.json` + assets, inject a
  token server-side). Embedding a GitHub token in the client is not an option — it's extractable.

## macOS "app is damaged and can't be opened" (Gatekeeper) — the same signing theme

Our macOS builds are **unsigned / ad-hoc** (no Apple Developer ID yet). A browser download gets a
`com.apple.quarantine` xattr, and Gatekeeper shows an unsigned quarantined app as **"damaged"** (not
"unidentified developer") — especially on Apple Silicon, which requires at least an ad-hoc signature
to run at all.
- **To test right now:** download the `…_aarch64.dmg` (not `.app.tar.gz` — that's the updater
  artifact), drag to `/Applications`, then `xattr -cr "/Applications/AI Sales Coach.app"` and launch.
  Do **not** recommend `spctl --master-disable` (disables Gatekeeper globally).
- **Our build is arm64-only.** On an **Intel** Mac the `aarch64` build won't run and `xattr` won't
  help — an Intel Mac needs its own `macos-13` (x86_64) matrix leg (see `tauri-system-audio-capture`).
- **The real fix** is Apple Developer ID signing + notarization ($99/yr): set `APPLE_*` secrets in
  `desktop-release.yml` and the "damaged" prompt disappears for everyone.
- **Auto-updates dodge this entirely:** the updater swaps the bundle itself, so no browser sets the
  quarantine bit — the updated app just launches. So the manual `xattr` is a one-time cost to get the
  first updater-enabled build running; updates after that are clean.

## Validation on the headless box (see `headless-verify-discipline`)

- `cargo check` (in `src-tauri`) compiles the updater + process plugins for the host target and runs
  build.rs over the capabilities — catches missing deps, bad `#[cfg]` gating, and capability/permission
  typos.
- `bun run build` bundles the JS; **also run `bunx tsc --noEmit`** — vite/esbuild strips types without
  checking them, so the `DownloadEvent` discriminated-union handling only gets verified by tsc.
- You **cannot** test an actual update round-trip here: it needs two real signed builds and a published
  release. Verify the *wiring* locally; verify the *update* by installing vN, then publishing vN+1 and
  watching the installed app offer it.
