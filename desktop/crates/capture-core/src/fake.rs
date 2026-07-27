//! Hardware-free audio source: generates a sine tone (or silence at freq 0) so the capture →
//! resample → WS pipeline is runnable and testable on a box with no microphone or display.

use crate::{AudioCapture, CaptureError, Channel, PcmChunk, WIRE_RATE};
use std::f32::consts::TAU;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// One `frame_samples`-long frame of a `freq`-Hz sine (0.0 → silence) at [`WIRE_RATE`], advancing
/// `phase` so consecutive frames are continuous. Mono PCM16.
fn tone_frame(freq: f32, frame_samples: usize, phase: &mut f32) -> Vec<i16> {
    let step = if freq > 0.0 { TAU * freq / WIRE_RATE as f32 } else { 0.0 };
    let mut frame = Vec::with_capacity(frame_samples);
    for _ in 0..frame_samples {
        let s = if freq > 0.0 { (phase.sin() * 0.5 * i16::MAX as f32) as i16 } else { 0 };
        frame.push(s);
        *phase = (*phase + step) % TAU;
    }
    frame
}

/// Streams a continuous tone into the sink at roughly real time until stopped.
pub struct FakeSource {
    channel: Channel,
    freq: f32,
    frame_samples: usize,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl FakeSource {
    /// `freq` Hz tone on `channel`; 20 ms frames at [`WIRE_RATE`].
    pub fn new(channel: Channel, freq: f32) -> Self {
        Self {
            channel,
            freq,
            frame_samples: (WIRE_RATE / 50) as usize, // 20ms
            stop: Arc::new(AtomicBool::new(false)),
            handle: None,
        }
    }
}

impl AudioCapture for FakeSource {
    /// `_epoch` is ignored: the fake emits a deterministic `ts_ms` counter from 0 (tests rely on it)
    /// rather than wall-clock time, so it needs no shared session clock.
    fn start(&mut self, sink: Sender<PcmChunk>, _epoch: Instant) -> Result<(), CaptureError> {
        let stop = self.stop.clone();
        let channel = self.channel;
        let freq = self.freq;
        let frame_samples = self.frame_samples;
        let frame_ms = (frame_samples as u64 * 1000) / WIRE_RATE as u64;
        let handle = thread::spawn(move || {
            let mut phase: f32 = 0.0;
            let mut ts_ms: u64 = 0;
            while !stop.load(Ordering::Relaxed) {
                let samples = tone_frame(freq, frame_samples, &mut phase);
                if sink.send(PcmChunk { channel, ts_ms, samples }).is_err() {
                    break; // receiver gone
                }
                ts_ms += frame_ms;
                thread::sleep(Duration::from_millis(frame_ms));
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn tone_frame_is_sized_and_nonzero() {
        let mut phase = 0.0;
        let frame = tone_frame(440.0, 320, &mut phase);
        assert_eq!(frame.len(), 320);
        assert!(frame.iter().any(|&s| s != 0)); // a 440Hz tone is not all-zero
        assert_ne!(phase, 0.0); // phase advanced for the next frame
    }

    #[test]
    fn silence_frame_is_zero() {
        let mut phase = 0.0;
        let frame = tone_frame(0.0, 100, &mut phase);
        assert!(frame.iter().all(|&s| s == 0));
    }

    #[test]
    fn fake_source_streams_then_stops() {
        let (tx, rx) = mpsc::channel();
        let mut src = FakeSource::new(Channel::System, 220.0);
        src.start(tx, Instant::now()).unwrap();
        // Collect a few frames then stop.
        let first = rx.recv_timeout(Duration::from_millis(500)).expect("a chunk");
        assert_eq!(first.channel, Channel::System);
        assert_eq!(first.ts_ms, 0);
        assert_eq!(first.samples.len(), 320);
        src.stop();
    }
}
