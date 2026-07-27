//! Linux system-audio (loopback) capture: record the **monitor source** of the default output
//! sink over the PulseAudio protocol — this is what the prospect says/plays on the call. Works on
//! classic PulseAudio and on PipeWire (via its pulse shim). The blocking "simple" record API runs
//! on a dedicated thread; each buffer is downmixed + resampled to mono PCM16 @[`WIRE_RATE`] with the
//! same tested [`crate::dsp`] path the mic uses.
//!
//! Source selection: `@DEFAULT_MONITOR@` (the monitor of the current default sink) unless
//! `AISC_MONITOR_SOURCE` overrides it. We never fall back to the default *source* (that's the mic) —
//! recording the mic onto the system channel would echo the rep onto the prospect stream, so a
//! missing monitor is a hard error the UI surfaces instead of silent wrong audio.

use crate::dsp;
use crate::{AudioCapture, CaptureError, Channel, PcmChunk, WIRE_RATE};
use libpulse_binding::sample::{Format, Spec};
use libpulse_binding::stream::Direction;
use libpulse_simple_binding::Simple;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Instant;

/// Format we ask PulseAudio to deliver. 48k/stereo/f32 is the near-universal monitor native format,
/// so the server does little/no conversion and we own the downmix + 48k→16k resample.
const MON_RATE: u32 = 48_000;
const MON_CHANNELS: u8 = 2;
/// 20 ms per read → 960 stereo f32 frames = 7680 bytes → 320 mono samples @16k (matches mic cadence).
const FRAME_BYTES: usize = (MON_RATE as usize / 50) * MON_CHANNELS as usize * 4;

/// Override the monitor source name (find yours with `pactl list sources short | grep monitor`).
const MONITOR_ENV: &str = "AISC_MONITOR_SOURCE";
/// Special name PulseAudio/PipeWire resolves to the monitor of the current default sink.
const DEFAULT_MONITOR: &str = "@DEFAULT_MONITOR@";

fn monitor_source_name() -> String {
    std::env::var(MONITOR_ENV)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MONITOR.to_string())
}

/// Interleaved little-endian f32 bytes (as PulseAudio delivers) → mono PCM16 @[`WIRE_RATE`].
/// Pure + headless-testable; the live capture path needs a running audio server (a real desktop).
fn frame_to_mono16k(bytes: &[u8], channels: usize, in_rate: u32) -> Vec<i16> {
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    dsp::to_mono_pcm16(&samples, channels, in_rate, WIRE_RATE)
}

pub struct PulseMonitor {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl PulseMonitor {
    pub fn new() -> Self {
        Self { stop: Arc::new(AtomicBool::new(false)), handle: None }
    }
}

impl Default for PulseMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioCapture for PulseMonitor {
    fn start(&mut self, sink: Sender<PcmChunk>) -> Result<(), CaptureError> {
        let stop = self.stop.clone();
        // Surface a failed monitor connect back to the caller before returning (mirrors CpalMic).
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), CaptureError>>();
        let handle = thread::spawn(move || {
            let simple = match connect() {
                Ok(s) => {
                    let _ = ready_tx.send(Ok(()));
                    s
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let start = Instant::now();
            let mut buf = vec![0u8; FRAME_BYTES];
            while !stop.load(Ordering::Relaxed) {
                // Blocking read fills the whole buffer. On an idle/suspended sink the monitor
                // produces no data and this parks until audio resumes or the process exits — fine
                // for a live call where the prospect's audio keeps the sink running.
                if let Err(e) = simple.read(&mut buf) {
                    eprintln!("pulse monitor read error: {e}");
                    break;
                }
                let samples = frame_to_mono16k(&buf, MON_CHANNELS as usize, MON_RATE);
                let ts_ms = start.elapsed().as_millis() as u64;
                if sink.send(PcmChunk { channel: Channel::System, ts_ms, samples }).is_err() {
                    break; // receiver gone
                }
            }
        });
        self.handle = Some(handle);
        match ready_rx.recv() {
            Ok(res) => res,
            Err(_) => Err(CaptureError::Backend("pulse capture thread died on start".into())),
        }
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Connect a blocking record stream to the default sink's monitor source.
fn connect() -> Result<Simple, CaptureError> {
    let spec = Spec { format: Format::F32le, channels: MON_CHANNELS, rate: MON_RATE };
    if !spec.is_valid() {
        return Err(CaptureError::Backend("invalid pulse sample spec".into()));
    }
    let source = monitor_source_name();
    Simple::new(
        None,             // default server
        "AI Sales Coach", // application name (shows in `pactl list source-outputs`)
        Direction::Record,
        Some(&source),      // monitor source to record
        "system-loopback",  // stream description
        &spec,
        None, // default channel map
        None, // default buffering
    )
    .map_err(|e| {
        CaptureError::Backend(format!(
            "connect monitor source {source:?}: {e} \
             (set {MONITOR_ENV} to a name from `pactl list sources short`)"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_len_matches_20ms() {
        // 960 stereo frames of f32 (7680 bytes) -> 320 mono samples @16k (one 20ms frame).
        assert_eq!(FRAME_BYTES, 7680);
        let out = frame_to_mono16k(&vec![0u8; FRAME_BYTES], MON_CHANNELS as usize, MON_RATE);
        assert_eq!(out.len(), 320);
        assert!(out.iter().all(|&s| s == 0)); // all-zero f32 -> silence
    }

    #[test]
    fn frame_downmixes_opposite_channels_to_zero() {
        // L=+1.0, R=-1.0 per stereo frame averages to 0; in_rate==WIRE_RATE so no resample.
        let mut bytes = Vec::new();
        for _ in 0..4 {
            bytes.extend_from_slice(&1.0f32.to_le_bytes());
            bytes.extend_from_slice(&(-1.0f32).to_le_bytes());
        }
        let out = frame_to_mono16k(&bytes, 2, WIRE_RATE);
        assert_eq!(out.len(), 4);
        assert!(out.iter().all(|&s| s == 0));
    }

    #[test]
    fn monitor_name_defaults_when_env_unset() {
        if std::env::var(MONITOR_ENV).is_err() {
            assert_eq!(monitor_source_name(), DEFAULT_MONITOR);
        }
    }
}
