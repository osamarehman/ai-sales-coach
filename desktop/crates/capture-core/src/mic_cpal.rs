//! Microphone capture via [`cpal`] (cross-platform: ALSA on Linux, WASAPI on Windows, Core Audio
//! on macOS). Device audio (any rate/format/channel count) is downmixed + resampled to mono PCM16
//! at [`WIRE_RATE`] on the fly. Runs the cpal stream on its own thread (cpal `Stream` is `!Send`).

use crate::dsp;
use crate::{AudioCapture, CaptureError, Channel, PcmChunk, WIRE_RATE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub struct CpalMic {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl CpalMic {
    pub fn new() -> Self {
        Self { stop: Arc::new(AtomicBool::new(false)), handle: None }
    }
}

impl Default for CpalMic {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioCapture for CpalMic {
    fn start(&mut self, sink: Sender<PcmChunk>, epoch: Instant) -> Result<(), CaptureError> {
        let stop = self.stop.clone();
        // Propagate the (fallible) stream build back to the caller before returning.
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), CaptureError>>();
        let handle = thread::spawn(move || match build_and_play(sink, epoch) {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                // Keep the stream alive on this thread until stopped.
                while !stop.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(50));
                }
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        });
        self.handle = Some(handle);
        match ready_rx.recv() {
            Ok(res) => res,
            Err(_) => Err(CaptureError::Backend("capture thread died on start".into())),
        }
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Build + play the default input stream, converting every callback buffer to mono PCM16 @16k.
/// `epoch` is the shared session clock (see [`AudioCapture::start`]).
fn build_and_play(sink: Sender<PcmChunk>, epoch: Instant) -> Result<cpal::Stream, CaptureError> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or(CaptureError::NoDevice)?;
    let supported = device
        .default_input_config()
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let channels = config.channels as usize;
    let in_rate = config.sample_rate.0;

    let err_fn = |e| eprintln!("cpal mic stream error: {e}");

    let emit = move |mono_pcm: Vec<i16>, sink: &Sender<PcmChunk>| {
        let ts_ms = epoch.elapsed().as_millis() as u64;
        let _ = sink.send(PcmChunk { channel: Channel::Mic, ts_ms, samples: mono_pcm });
    };

    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &_| emit(dsp::to_mono_pcm16(data, channels, in_rate, WIRE_RATE), &sink),
            err_fn,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &_| {
                let f: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                emit(dsp::to_mono_pcm16(&f, channels, in_rate, WIRE_RATE), &sink)
            },
            err_fn,
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &_| {
                let f: Vec<f32> = data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect();
                emit(dsp::to_mono_pcm16(&f, channels, in_rate, WIRE_RATE), &sink)
            },
            err_fn,
            None,
        ),
        other => return Err(CaptureError::Unsupported(format!("sample format {other:?}"))),
    }
    .map_err(|e| CaptureError::Backend(e.to_string()))?;

    stream.play().map_err(|e| CaptureError::Backend(e.to_string()))?;
    Ok(stream)
}
