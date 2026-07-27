---
name: tauri-system-audio-capture
description: Use when implementing or changing cross-platform audio capture in the Rust/Tauri desktop app — the rep mic and/or the prospect "system loopback" stream, per-OS backends behind the AudioCapture trait (Linux Pulse, Windows WASAPI, macOS ScreenCaptureKit), their teardown, or mobile mic-only capture. Read before touching anything under desktop/crates/capture-core or the bridge's capture orchestration.
---

# Cross-platform system-audio capture (mic + loopback)

One `AudioCapture` trait, one output type `PcmChunk` (mono PCM16 @ `WIRE_RATE`=16000), one shared
`dsp` path (downmix → resample → i16). The **mic** is `cpal` on every target (unconditional). The
**system/loopback** channel is per-OS, `cfg(target_os)`-gated so only the current OS's file compiles,
dispatched by `open_system_capture()`. This file records the traps that cost real debugging time.

## The one that will bite you: Windows WASAPI loopback direction

To capture what the speakers play (the prospect), you use the **default _Render_ device** but you
**initialize the client as `Direction::Capture`**. That mismatch is exactly what sets the loopback
flag. Getting this wrong compiles, type-checks, and passes CI's *build* — then captures **silence**.

```rust
let device = enumerator.get_default_device(&Direction::Render)?;   // render endpoint
let mut client = device.get_iaudioclient()?;                       // client.direction == Render
// LOOPBACK, not a typo — device=Render + init=Capture + Shared is the ONLY combo that sets it:
client.initialize_client(&fmt, &Direction::Capture, &mode)?;       // NOT &Direction::Render
```

Why: in `wasapi` 0.23 `src/api.rs` the stream-flags match is
`(&self.direction /*device*/, direction /*init*/, sharemode)`:
- `(Render, Capture, Shared)  => AUDCLNT_STREAMFLAGS_LOOPBACK`  ← what you want
- `(Render, Capture, Exclusive) => Err(LoopbackWithExclusiveMode)`
- `(Capture, Render, _)       => Err(RenderToCaptureDevice)`
- everything else (incl. `Render, Render`) => `0` — **no loopback, no error, just silence**

Other WASAPI facts (verified against the crate, don't re-litigate):
- **Event-driven loopback IS supported.** `StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: min_period }` + `set_get_eventhandle()` + `wait_for_event(ms)` is the crate's own `record.rs` recipe. You do **not** have to poll.
- `initialize_mta().ok().map_err(...)?` — `initialize_mta()` returns an HRESULT; `.ok()` converts it to a `Result` first. `initialize_mta().map_err(...)?` does **not** compile (HRESULT has no `map_err`). This bug only shows up under a Windows cross-check, never a Linux build.
- COM is per-thread: do `initialize_mta()` + all device setup **on the capture thread**, report success/failure back over a ready-channel so `start()` stays fallible.
- Request 48k/stereo/f32 with `autoconvert: true` and let `dsp` do the downmix + 48k→16k resample. Read frames with `read_from_device_to_deque(&mut VecDeque<u8>)`; drain with `queue.drain(..frames*blockalign)`.

## Linux (PulseAudio / PipeWire)

- Record the **monitor of the default sink**: source name `@DEFAULT_MONITOR@` (PipeWire's pulse shim
  resolves it too). Blocking `libpulse_simple_binding::Simple::read` on its own thread.
- **Never** fall back to the default *source* if the monitor is missing — the default source is the
  **mic**, so you'd echo the rep onto the prospect channel. A missing monitor is a hard error the UI
  surfaces. Allow an `AISC_MONITOR_SOURCE` env override (find names via `pactl list sources short`).

## macOS (ScreenCaptureKit)

- Use `ruhear` (wraps SCStream + the CMSampleBuffer→f32 extraction). Delivers **planar** f32 @48k
  (`Vec<Vec<f32>>`), average channels → mono → resample. `RUHear` owns non-`Send` SCK objects, so it
  must live entirely on one thread. Needs the **Screen Recording** permission; until granted, no
  buffers arrive (app just shows no cues — not an error).

## Teardown & error-path correctness (all backends)

These are the bugs a green test suite won't catch:

1. **Blocking reads need a bounded stop().** A backend parked in a blocking read on a *suspended*
   source (Pulse on an idle sink) never returns, so `handle.join()` in `stop()` hangs **forever**.
   Set the stop flag, then join with a timeout and **detach** if it doesn't finish:
   ```rust
   fn join_bounded(h: JoinHandle<()>, timeout: Duration) {
       let (tx, rx) = mpsc::channel();
       thread::spawn(move || { let _ = h.join(); let _ = tx.send(()); });
       let _ = rx.recv_timeout(timeout);   // give up after `timeout`, let the thread finish detached
   }
   ```
2. **Call `stop()` off the async runtime.** `cap.stop()` joins threads (blocking). From async, wrap
   in `tokio::task::spawn_blocking(move || { for mut c in captures { c.stop(); } }).await` or you
   stall the reactor. `Box<dyn AudioCapture>` is `Send` (the trait requires `Send`), so it moves in.
3. **Never `?` past cleanup.** In the bridge loop, a WS send that returns via `?` skips the post-loop
   `cap.stop()` → the **mic stays hot** after a dropped connection. `emit(Error) + break` instead, so
   teardown always runs.
4. **Share one session epoch.** Pass a single `Instant` into every `start(sink, epoch)` and stamp
   `ts_ms = epoch.elapsed()`. Per-backend `Instant::now()` skews mic vs system by however long the
   second `start()`'s connect took (tens–hundreds of ms on WASAPI/Pulse) — that misaligns the merged
   transcript. The `FakeSource` ignores `epoch` (deterministic counter for tests).
5. `dsp::downmix_to_mono` must guard `channels == 0` (else `chunks(0)` panics).

## Mobile = mic-only (OS-enforced, not a TODO)

iOS exposes **no** API to capture another app's / the system's audio. Android's
`AudioPlaybackCapture` **cannot** capture `VOICE_COMMUNICATION` (VoIP/call) audio. So on mobile you
capture the **mic only** and deliver cues another way (see `tauri-earbud-cue-delivery`). Wire the
system channel as `Source::None` (bridge skips it); keep `cpal` mic unconditional across all targets.

## Validation on a headless box

See `headless-verify-discipline`. Short version: `cargo test` covers the pure `dsp`/`ws-protocol`/
bridge logic; `cargo check -p capture-core --target x86_64-pc-windows-msvc` type-checks the Windows
file blind (catches signature bugs); **runtime OS/FFI semantics (like the loopback direction) it
canNOT catch — verify those against the crate's on-disk source in `~/.cargo/registry/src/.../<crate>`
and its `examples/`.** macOS can't be cross-checked (screencapturekit's build.rs compiles Swift).
