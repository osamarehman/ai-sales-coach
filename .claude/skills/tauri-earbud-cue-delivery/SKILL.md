---
name: tauri-earbud-cue-delivery
description: Use when delivering coaching cues as audio to the rep's earbuds (or any spoken-cue / text-to-speech output in the Tauri overlay), especially on mobile where the app is mic-only and cues can't be shown easily. Read before changing the overlay's cue-to-speech path in desktop/ui.
---

# Spoken cues to earbuds (Web Speech API in the overlay)

Mobile can't capture the far end, so cues reach the rep as **audio spoken into the attached output
device** (earbuds). The smallest slice that works needs **no protocol/backend/native change**: speak
the `cue` text the overlay already receives, using the webview's `speechSynthesis`. The OS routes
speech to whatever output is connected — you do not route to the earbuds yourself.

## Rules that make it actually work

1. **Feature-detect, don't assume.** `const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;`
   WKWebView (iOS/macOS) and WebView2 (Windows) always have it; some WebKitGTK (Linux) builds don't.
   Hide the toggle and no-op `speak()` when absent.
2. **Unlock on a user gesture.** Mobile WebViews gate the *first* `speechSynthesis.speak()` behind a
   user gesture. The consent button click is that gesture — speak a short confirmation there
   (e.g. "Coaching on.") which both unlocks the engine for later programmatic cues **and** doubles as
   an earbud audio check. Toggling speak-on is also a gesture that unlocks it.
3. **Newest wins.** Call `speechSynthesis.cancel()` before each `speak()`. In a live call a stale
   coaching cue is worse than none; never let a backlog of utterances queue up.
4. **Make it toggleable + persistent.** A 🔊/🔇 control, default on where `hasTTS`, persisted to
   `localStorage`. Cancel any in-flight speech immediately on mute / stop / unmount.
5. Keep the spoken text short; a slightly quick `rate` (~1.05) lands the cue while the moment's live.
   Give critical cues a spoken lead ("Heads up. …") so they're audibly distinct.

## Known limitation → the native follow-up (verifiable only on a device)

The webview `speechSynthesis` plays at full volume and **mixes** with call audio; it does not *duck*
the call. For production whisper-coaching you eventually want a **native audio-session category**:
- iOS: `AVAudioSession` with `.duckOthers` (or `.mixWithOthers`) so the cue lowers the call briefly.
- Android: request transient audio focus with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`.

If webview TTS proves flaky mid-call, escalate to native synthesis behind a Tauri command
(`AVSpeechSynthesizer` on iOS, `android.speech.tts.TextToSpeech` on Android). Neither can be tested
on the headless box — this is a device-validation item (see `headless-verify-discipline`).
