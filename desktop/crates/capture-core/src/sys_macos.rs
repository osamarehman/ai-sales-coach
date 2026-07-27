//! macOS system-audio (loopback) capture via ScreenCaptureKit, wrapped by the `ruhear` crate — it
//! owns the SCStream setup and the CMSampleBuffer→f32 extraction. Delivered planar f32 @48k is
//! averaged to mono, resampled, and emitted as mono PCM16 @[`WIRE_RATE`] via the shared [`crate::dsp`].
//!
//! `cfg(target_os = "macos")` — built/validated by CI (macos-latest) + the user's Mac, never on the
//! Linux box. Requires the **Screen Recording** permission (granted once per app) to capture system
//! audio; until granted, no buffers arrive (the app simply shows no cues).

use crate::dsp;
use crate::{AudioCapture, CaptureError, Channel, PcmChunk, WIRE_RATE};
use ruhear::{rucallback, RUBuffers, RUHear};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// ruhear delivers macOS system audio at 48 kHz.
const MON_RATE: u32 = 48_000;

pub struct MacSystemAudio {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl MacSystemAudio {
    pub fn new() -> Self {
        Self { stop: Arc::new(AtomicBool::new(false)), handle: None }
    }
}

impl Default for MacSystemAudio {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioCapture for MacSystemAudio {
    fn start(&mut self, sink: Sender<PcmChunk>, epoch: Instant) -> Result<(), CaptureError> {
        let stop = self.stop.clone();
        // RUHear owns ScreenCaptureKit objects that aren't Send, so it lives entirely on this
        // thread: create it here, start it (it drives its own delivery thread), then park until
        // stopped. The capture callback runs on ruhear's thread and just forwards chunks.
        let handle = thread::spawn(move || {
            let cb = move |buffers: RUBuffers| {
                let samples = planar_to_mono16k(&buffers, MON_RATE);
                if samples.is_empty() {
                    return;
                }
                let ts_ms = epoch.elapsed().as_millis() as u64;
                let _ = sink.send(PcmChunk { channel: Channel::System, ts_ms, samples });
            };
            let mut ru = RUHear::new(rucallback!(cb));
            let _ = ru.start();
            while !stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(50));
            }
            let _ = ru.stop();
        });
        self.handle = Some(handle);
        Ok(())
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Planar per-channel f32 (ruhear layout: `buffers[channel][sample]`) → mono PCM16 @[`WIRE_RATE`].
fn planar_to_mono16k(buffers: &RUBuffers, in_rate: u32) -> Vec<i16> {
    let channels = buffers.len();
    if channels == 0 {
        return Vec::new();
    }
    let frames = buffers.iter().map(|c| c.len()).min().unwrap_or(0);
    let mut mono = Vec::with_capacity(frames);
    for i in 0..frames {
        let sum: f32 = buffers.iter().map(|c| c[i]).sum();
        mono.push(sum / channels as f32);
    }
    let resampled = dsp::resample_linear(&mono, in_rate, WIRE_RATE);
    dsp::f32_to_i16(&resampled)
}
