# Project skills

Reusable, hard-won guidance distilled from building this repo. Claude Code auto-loads these from
`.claude/skills/*/SKILL.md`; a human can just read them. Each captures traps that cost real
debugging time so we don't rediscover them.

| Skill | Read before… |
|---|---|
| [`tauri-system-audio-capture`](tauri-system-audio-capture/SKILL.md) | touching capture-core / the mic + system-loopback backends. **Has the WASAPI loopback-direction gotcha** + teardown-correctness patterns. |
| [`tauri-v2-mobile-build`](tauri-v2-mobile-build/SKILL.md) | editing the Android/iOS CI or the `src-tauri` lib/main split. SDK/CLI versions that fail the first CI run. |
| [`tauri-desktop-auto-update`](tauri-desktop-auto-update/SKILL.md) | wiring the Tauri v2 updater, the signing key, the GitHub update feed, release versioning, or the macOS "app is damaged" Gatekeeper issue. |
| [`tauri-earbud-cue-delivery`](tauri-earbud-cue-delivery/SKILL.md) | changing the overlay's spoken-cue (earbud) path. Web Speech gotchas + the native ducking follow-up. |
| [`headless-verify-discipline`](headless-verify-discipline/SKILL.md) | claiming a cross-platform change "works" from a build box with no display/audio. What a green check does and doesn't prove. |
