//! Windows system-audio (loopback) capture via WASAPI: record what the default **render** endpoint
//! plays — the prospect's voice on the call — using a shared-mode loopback capture client. The
//! WASAPI event loop runs on a dedicated thread; each buffer is downmixed + resampled to mono PCM16
//! @[`WIRE_RATE`] with the shared [`crate::dsp`] path.
//!
//! `cfg(target_os = "windows")` — built/validated by CI (windows-latest), never on the Linux box.

use crate::dsp;
use crate::{AudioCapture, CaptureError, Channel, PcmChunk, WIRE_RATE};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Instant;
use wasapi::{
    initialize_mta, AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, Handle,
    SampleType, StreamMode, WaveFormat,
};

/// Format we request from WASAPI (autoconvert does any rate/format shift for us). 48k/stereo/f32
/// so the block layout is fixed and `dsp` does the downmix + 48k→16k resample.
const MON_RATE: u32 = 48_000;
const MON_CHANNELS: usize = 2;
/// Bytes per frame at the requested format: 2 channels × 4-byte f32.
const BLOCKALIGN: usize = MON_CHANNELS * 4;

pub struct WasapiLoopback {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl WasapiLoopback {
    pub fn new() -> Self {
        Self { stop: Arc::new(AtomicBool::new(false)), handle: None }
    }
}

impl Default for WasapiLoopback {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioCapture for WasapiLoopback {
    fn start(&mut self, sink: Sender<PcmChunk>) -> Result<(), CaptureError> {
        let stop = self.stop.clone();
        // COM + device setup happens on the capture thread (COM apartment is per-thread); its
        // success/failure is reported back so start() is fallible like the other backends.
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), CaptureError>>();
        let handle = thread::spawn(move || capture_loop(&stop, &sink, &ready_tx));
        self.handle = Some(handle);
        match ready_rx.recv() {
            Ok(res) => res,
            Err(_) => Err(CaptureError::Backend("wasapi capture thread died on start".into())),
        }
    }

    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Map any error carrying a `Display` into our backend error.
fn be(e: impl std::fmt::Display) -> CaptureError {
    CaptureError::Backend(e.to_string())
}

struct WasapiSession {
    audio_client: AudioClient,
    h_event: Handle,
    capture_client: AudioCaptureClient,
}

/// Activate a loopback capture client on the default render endpoint and start the stream.
fn setup() -> Result<WasapiSession, CaptureError> {
    // initialize_mta() returns an HRESULT; .ok() turns a failure code into an Err.
    initialize_mta().ok().map_err(be)?;
    let enumerator = DeviceEnumerator::new().map_err(be)?;
    // Loopback records the *render* endpoint; get_audiocaptureclient() on it yields the loopback tap.
    let device = enumerator.get_default_device(&Direction::Render).map_err(be)?;
    let mut audio_client = device.get_iaudioclient().map_err(be)?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, MON_RATE as usize, MON_CHANNELS, None);
    let (_default_period, min_period) = audio_client.get_device_period().map_err(be)?;
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: min_period };
    audio_client.initialize_client(&format, &Direction::Render, &mode).map_err(be)?;
    let h_event = audio_client.set_get_eventhandle().map_err(be)?;
    let capture_client = audio_client.get_audiocaptureclient().map_err(be)?;
    audio_client.start_stream().map_err(be)?;
    Ok(WasapiSession { audio_client, h_event, capture_client })
}

fn capture_loop(stop: &AtomicBool, sink: &Sender<PcmChunk>, ready_tx: &Sender<Result<(), CaptureError>>) {
    let session = match setup() {
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
    let mut queue: VecDeque<u8> = VecDeque::new();
    while !stop.load(Ordering::Relaxed) {
        // Event fires per buffer period; a timeout (silence) just loops back to re-check `stop`.
        if session.h_event.wait_for_event(500).is_err() {
            continue;
        }
        if let Err(e) = session.capture_client.read_from_device_to_deque(&mut queue) {
            eprintln!("wasapi loopback read error: {e}");
            break;
        }
        let frames = queue.len() / BLOCKALIGN;
        if frames == 0 {
            continue;
        }
        let mut bytes = vec![0u8; frames * BLOCKALIGN];
        for b in bytes.iter_mut() {
            *b = queue.pop_front().unwrap();
        }
        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        let mono = dsp::to_mono_pcm16(&samples, MON_CHANNELS, MON_RATE, WIRE_RATE);
        let ts_ms = start.elapsed().as_millis() as u64;
        if sink.send(PcmChunk { channel: Channel::System, ts_ms, samples: mono }).is_err() {
            break; // receiver gone
        }
    }
    let _ = session.audio_client.stop_stream();
}
