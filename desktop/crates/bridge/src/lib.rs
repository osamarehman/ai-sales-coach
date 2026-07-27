//! Session bridge: owns the single WebSocket to the realtime backend and the capture backends.
//!
//! The Tauri layer drives this with [`SessionHandle`] (consent / stop) and drains [`AppEvent`]s
//! (status / cue / error) to forward to the SolidJS overlay. All audio + the WS live in Rust; the
//! webview is pure presentation. Consent-gated per `PROTOCOL.md`: capture does not start — and thus
//! no audio is sent — until the rep confirms consent.

use anyhow::{Context, Result};
use capture_core::{open_capture, AudioCapture, Channel, FakeSource, PcmChunk, WIRE_RATE};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use ws_protocol::{encode_audio_frame, ClientMsg, ConsentMethod, Platform, ServerMsg};

/// Which backend feeds a channel. `RealMic` = cpal mic (all platforms); `RealSystem` = the per-OS
/// loopback backend (Linux Pulse monitor / Windows WASAPI / macOS ScreenCaptureKit — desktop only);
/// `Fake` = a tone for headless/dev; `None` = no capture on this channel (mobile is mic-only).
#[derive(Debug, Clone, Copy)]
pub enum Source {
    RealMic,
    RealSystem,
    Fake { freq: f32 },
    None,
}

#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub url: String,
    pub token: String,
    pub app_version: String,
    pub platform: Platform,
    pub mic_source: Source,
    pub system_source: Source,
}

/// UI-facing events emitted by a running session.
#[derive(Debug, Clone)]
pub enum AppEvent {
    Status(String),
    Cue {
        id: String,
        tier: String,
        text: String,
        ttl_ms: u32,
        category: String,
    },
    Error(String),
    Ended,
}

/// Control messages the UI sends into a running session.
#[derive(Debug, Clone)]
pub enum Control {
    Consent { method: ConsentMethod },
    Stop,
}

/// Handle the Tauri layer keeps to drive a session. Cheap to clone (wraps an mpsc sender).
#[derive(Clone)]
pub struct SessionHandle {
    control_tx: mpsc::Sender<Control>,
}

impl SessionHandle {
    pub async fn consent(&self, method: ConsentMethod) {
        let _ = self.control_tx.send(Control::Consent { method }).await;
    }
    pub async fn stop(&self) {
        let _ = self.control_tx.send(Control::Stop).await;
    }
}

/// Spawn a session on the current tokio runtime. Returns the handle plus the event stream to drain.
pub fn spawn_session(cfg: SessionConfig) -> (SessionHandle, mpsc::Receiver<AppEvent>) {
    let (control_tx, control_rx) = mpsc::channel(16);
    let (event_tx, event_rx) = mpsc::channel(256);
    let event_tx2 = event_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = run_session(cfg, control_rx, event_tx).await {
            let _ = event_tx2.send(AppEvent::Error(format!("session: {e:#}"))).await;
        }
        let _ = event_tx2.send(AppEvent::Ended).await;
    });
    (SessionHandle { control_tx }, event_rx)
}

/// `Ok(None)` = this channel has no source (skip it), used for mic-only mobile.
fn make_capture(channel: Channel, source: Source) -> Result<Option<Box<dyn AudioCapture>>> {
    match source {
        Source::None => Ok(None),
        Source::Fake { freq } => Ok(Some(Box::new(FakeSource::new(channel, freq)))),
        Source::RealMic => open_capture(Channel::Mic).map(Some).map_err(|e| e.into()),
        Source::RealSystem => open_capture(Channel::System).map(Some).map_err(|e| e.into()),
    }
}

async fn run_session(
    cfg: SessionConfig,
    mut control_rx: mpsc::Receiver<Control>,
    event_tx: mpsc::Sender<AppEvent>,
) -> Result<()> {
    let emit = |ev: AppEvent| {
        let tx = event_tx.clone();
        async move {
            let _ = tx.send(ev).await;
        }
    };

    emit(AppEvent::Status("connecting".into())).await;
    let (ws_stream, _) = tokio_tungstenite::connect_async(&cfg.url)
        .await
        .context("websocket connect")?;
    let (mut write, mut read) = ws_stream.split();

    // Handshake.
    let hello = ClientMsg::Hello {
        session_token: cfg.token.clone(),
        app_version: cfg.app_version.clone(),
        platform: cfg.platform,
        sample_rate: WIRE_RATE,
        frame_samples: (WIRE_RATE / 50), // 20ms
    };
    write.send(Message::Text(serde_json::to_string(&hello)?)).await?;

    // Capture threads push PcmChunk over a std channel; a helper thread lifts them into async.
    let (pcm_tx, pcm_rx) = std::sync::mpsc::channel::<PcmChunk>();
    let (audio_tx, mut audio_rx) = mpsc::channel::<PcmChunk>(256);
    std::thread::spawn(move || {
        while let Ok(chunk) = pcm_rx.recv() {
            if audio_tx.blocking_send(chunk).is_err() {
                break;
            }
        }
    });

    let mut captures: Vec<Box<dyn AudioCapture>> = Vec::new();
    let mut consented = false;

    loop {
        tokio::select! {
            ctrl = control_rx.recv() => match ctrl {
                Some(Control::Consent { method }) => {
                    let c = ClientMsg::Consent { captured: true, method, ts_ms: 0 };
                    // Break (not `?`) on a send failure so the capture teardown after the loop still
                    // runs — a `?` return here would leak any already-started capture thread (mic).
                    if let Err(e) = write.send(Message::Text(serde_json::to_string(&c)?)).await {
                        emit(AppEvent::Error(format!("ws send consent: {e}"))).await;
                        break;
                    }
                    if !consented {
                        consented = true;
                        // One shared clock for both channels so their ts_ms line up (see AudioCapture).
                        let epoch = std::time::Instant::now();
                        for (ch, src) in [(Channel::Mic, cfg.mic_source), (Channel::System, cfg.system_source)] {
                            match make_capture(ch, src) {
                                Ok(Some(mut cap)) => match cap.start(pcm_tx.clone(), epoch) {
                                    Ok(()) => captures.push(cap),
                                    Err(e) => emit(AppEvent::Error(format!("{ch:?} capture start: {e}"))).await,
                                },
                                Ok(None) => {} // no source for this channel (e.g. mobile system) — skip
                                Err(e) => emit(AppEvent::Error(format!("{ch:?} capture open: {e}"))).await,
                            }
                        }
                        emit(AppEvent::Status("capturing".into())).await;
                    }
                }
                Some(Control::Stop) | None => {
                    let _ = write
                        .send(Message::Text(serde_json::to_string(&ClientMsg::Bye {
                            reason: Some("user_stopped".into()),
                        })?))
                        .await;
                    break;
                }
            },
            audio = audio_rx.recv() => {
                if let Some(chunk) = audio {
                    if consented {
                        let bytes = encode_audio_frame(chunk.channel, chunk.ts_ms, &chunk.samples);
                        // Break (not `?`) so capture teardown runs — a `?` here on a mid-call WS
                        // error would return past the cleanup and leave the mic + loopback threads
                        // running (hot mic after a dropped connection).
                        if let Err(e) = write.send(Message::Binary(bytes)).await {
                            emit(AppEvent::Error(format!("ws send audio: {e}"))).await;
                            break;
                        }
                    }
                }
            }
            incoming = read.next() => match incoming {
                Some(Ok(Message::Text(t))) => {
                    match serde_json::from_str::<ServerMsg>(&t) {
                        Ok(ServerMsg::Ready { session_id }) => emit(AppEvent::Status(format!("ready:{session_id}"))).await,
                        Ok(ServerMsg::Cue { id, tier, text, ttl_ms, category, .. }) => {
                            emit(AppEvent::Cue { id, tier: format!("{tier:?}").to_lowercase(), text, ttl_ms, category }).await
                        }
                        Ok(ServerMsg::Error { code, message }) => emit(AppEvent::Error(format!("{code}: {message}"))).await,
                        Ok(ServerMsg::Transcript { .. }) => {}
                        Err(_) => {} // ignore unknown/garbage frames
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    emit(AppEvent::Error(format!("ws read: {e}"))).await;
                    break;
                }
            },
        }
    }

    // stop() joins capture threads (a blocking op — and Pulse teardown can briefly park), so run it
    // off the async worker to avoid stalling the runtime's reactor while threads wind down.
    tokio::task::spawn_blocking(move || {
        for mut cap in captures {
            cap.stop();
        }
    })
    .await
    .ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message as SMsg;

    // Minimal in-process server: hello->ready, first audio frame -> one cue, bye -> close.
    async fn mock_server(listener: TcpListener) {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        let mut sent_cue = false;
        while let Some(Ok(msg)) = ws.next().await {
            match msg {
                SMsg::Text(t) => {
                    let v: serde_json::Value = serde_json::from_str(&t).unwrap();
                    match v["type"].as_str() {
                        Some("hello") => {
                            ws.send(SMsg::Text(r#"{"type":"ready","session_id":"s1"}"#.into()))
                                .await
                                .unwrap();
                        }
                        Some("bye") => break,
                        _ => {}
                    }
                }
                SMsg::Binary(_) => {
                    if !sent_cue {
                        sent_cue = true;
                        ws.send(SMsg::Text(
                            r#"{"type":"cue","id":"c1","tier":"crit","text":"ask a question","ttl_ms":7000,"category":"talk_ratio","ts_ms":1}"#.into(),
                        ))
                        .await
                        .unwrap();
                    }
                }
                SMsg::Close(_) => break,
                _ => {}
            }
        }
    }

    #[tokio::test]
    async fn full_session_handshake_consent_and_cue() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(mock_server(listener));

        let cfg = SessionConfig {
            url: format!("ws://{addr}"),
            token: "t".into(),
            app_version: "0.1.0".into(),
            platform: Platform::Linux,
            mic_source: Source::Fake { freq: 440.0 }, // no real mic on CI/build box
            system_source: Source::Fake { freq: 220.0 },
        };
        let (handle, mut events) = spawn_session(cfg);

        // Expect a "ready:..." status, then after consent a cue.
        let mut saw_ready = false;
        let mut saw_cue = false;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_millis(500), events.recv()).await {
                Ok(Some(AppEvent::Status(s))) if s.starts_with("ready") => {
                    saw_ready = true;
                    handle.consent(ConsentMethod::Checkbox).await; // unblocks capture -> audio -> cue
                }
                Ok(Some(AppEvent::Cue { text, tier, .. })) => {
                    assert_eq!(tier, "crit");
                    assert_eq!(text, "ask a question");
                    saw_cue = true;
                    break;
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(_) => {}
            }
        }
        handle.stop().await;
        assert!(saw_ready, "never got ready");
        assert!(saw_cue, "never got a cue after consent");
    }
}
