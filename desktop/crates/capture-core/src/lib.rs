//! Cross-platform audio capture core for the AI Sales Coach desktop app.
//!
//! One [`AudioCapture`] trait, one [`PcmChunk`] output type (mono PCM16 at [`WIRE_RATE`]),
//! multiple backends chosen per channel/OS:
//! - **mic** → [`CpalMic`] (cpal, all platforms) — implemented.
//! - **system loopback** → per-OS behind the same trait: Linux Pulse/PipeWire monitor (live),
//!   Windows WASAPI loopback, macOS Core Audio process tap; chosen by [`open_capture`].
//! - **[`FakeSource`]** — a tone/silence generator that needs no audio hardware, so the whole
//!   pipeline (capture → resample → WS) runs headless on a build box and in CI.

pub mod dsp;
mod fake;
mod mic_cpal;

// System-loopback backends: one per OS, each gated so only the current target's file compiles.
#[cfg(target_os = "linux")]
mod sys_pulse;
#[cfg(target_os = "windows")]
mod sys_wasapi;
#[cfg(target_os = "macos")]
mod sys_macos;

pub use fake::{generate_tone, FakeSource};
pub use mic_cpal::CpalMic;
pub use ws_protocol::Channel;

use std::sync::mpsc::Sender;

/// Sample rate of every [`PcmChunk`] leaving this crate. Matches `PROTOCOL.md` default.
pub const WIRE_RATE: u32 = 16_000;

/// One channel's mono PCM16 chunk, tagged and timestamped, ready to become a WS audio frame.
#[derive(Debug, Clone, PartialEq)]
pub struct PcmChunk {
    pub channel: Channel,
    /// Milliseconds since the capture session started.
    pub ts_ms: u64,
    pub samples: Vec<i16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    NoDevice,
    Unsupported(String),
    Backend(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::NoDevice => write!(f, "no audio device available"),
            CaptureError::Unsupported(s) => write!(f, "unsupported: {s}"),
            CaptureError::Backend(s) => write!(f, "backend error: {s}"),
        }
    }
}
impl std::error::Error for CaptureError {}

/// A running or startable audio source. `start` streams [`PcmChunk`]s to `sink`; the backend
/// owns its own thread(s). `stop` tears it down.
pub trait AudioCapture: Send {
    fn start(&mut self, sink: Sender<PcmChunk>) -> Result<(), CaptureError>;
    fn stop(&mut self);
}

/// Open the default capture backend for a channel on the current OS.
///
/// `Channel::Mic` → [`CpalMic`] (cpal, all platforms). `Channel::System` → the platform loopback
/// backend: Linux Pulse/PipeWire monitor, Windows WASAPI loopback, or macOS Core Audio process tap.
/// Callers can still choose [`FakeSource`] to exercise the pipeline with no audio hardware.
pub fn open_capture(channel: Channel) -> Result<Box<dyn AudioCapture>, CaptureError> {
    match channel {
        Channel::Mic => Ok(Box::new(CpalMic::new())),
        Channel::System => open_system_capture(),
    }
}

#[cfg(target_os = "linux")]
fn open_system_capture() -> Result<Box<dyn AudioCapture>, CaptureError> {
    Ok(Box::new(sys_pulse::PulseMonitor::new()))
}

#[cfg(target_os = "windows")]
fn open_system_capture() -> Result<Box<dyn AudioCapture>, CaptureError> {
    Ok(Box::new(sys_wasapi::WasapiLoopback::new()))
}

#[cfg(target_os = "macos")]
fn open_system_capture() -> Result<Box<dyn AudioCapture>, CaptureError> {
    Ok(Box::new(sys_macos::MacSystemAudio::new()))
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn open_system_capture() -> Result<Box<dyn AudioCapture>, CaptureError> {
    Err(CaptureError::Unsupported("system loopback not supported on this OS".into()))
}
