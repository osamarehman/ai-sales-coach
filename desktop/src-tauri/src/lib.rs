//! AI Sales Coach app core. Lives in a library crate (`app_lib`) with a [`run`] entry point so the
//! same code powers the desktop binary (`main.rs`) **and** the mobile shells (Android/iOS), which
//! load the app as a native library via `#[tauri::mobile_entry_point]`.

use std::sync::Mutex;

use bridge::{spawn_session, AppEvent, SessionConfig, SessionHandle, Source};
use tauri::{Emitter, State};
use ws_protocol::{ConsentMethod, Platform};

/// One live session at a time. The overlay is single-call by design.
#[derive(Default)]
struct AppState {
    session: Mutex<Option<SessionHandle>>,
}

fn current_platform() -> Platform {
    #[cfg(target_os = "macos")]
    {
        Platform::Macos
    }
    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }
    #[cfg(target_os = "android")]
    {
        Platform::Android
    }
    #[cfg(target_os = "ios")]
    {
        Platform::Ios
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "android", target_os = "ios")))]
    {
        Platform::Linux
    }
}

/// Start a session: connect to the realtime backend (or dev-stub) and stream capture.
/// Desktop captures **both** streams — mic (cpal) + real system loopback (Linux Pulse monitor /
/// Windows WASAPI / macOS ScreenCaptureKit). Mobile is **mic-only**: iOS/Android forbid capturing
/// the far end of a call, so the system channel is disabled there.
#[tauri::command]
async fn start_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    token: String,
) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    let system_source = Source::RealSystem;
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    let system_source = Source::None;

    let cfg = SessionConfig {
        url,
        token,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: current_platform(),
        mic_source: Source::RealMic,
        system_source,
    };

    let (handle, mut events) = spawn_session(cfg);
    *state.session.lock().unwrap() = Some(handle);

    // Forward session events to the overlay webview.
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = events.recv().await {
            let _ = match ev {
                AppEvent::Status(s) => app.emit("status", s),
                AppEvent::Error(e) => app.emit("session-error", e),
                AppEvent::Cue { id, tier, text, ttl_ms, category } => app.emit(
                    "cue",
                    serde_json::json!({ "id": id, "tier": tier, "text": text, "ttl_ms": ttl_ms, "category": category }),
                ),
                AppEvent::Ended => {
                    let _ = app.emit("ended", ());
                    break;
                }
            };
        }
    });
    Ok(())
}

#[tauri::command]
async fn set_consent(state: State<'_, AppState>, method: String) -> Result<(), String> {
    let method = match method.as_str() {
        "spoken" => ConsentMethod::Spoken,
        _ => ConsentMethod::Checkbox,
    };
    let handle = state.session.lock().unwrap().clone();
    match handle {
        Some(h) => {
            h.consent(method).await;
            Ok(())
        }
        None => Err("no active session".into()),
    }
}

#[tauri::command]
async fn stop_session(state: State<'_, AppState>) -> Result<(), String> {
    let handle = state.session.lock().unwrap().take();
    if let Some(h) = handle {
        h.stop().await;
    }
    Ok(())
}

/// App entry point, shared by the desktop binary and the mobile shells. On Android/iOS the
/// `mobile_entry_point` attribute exports this as the native entry the platform shell calls.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)] // `mut` is only used on desktop, where the plugins are added below.
    let mut builder = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![start_session, set_consent, stop_session]);

    // Desktop-only auto-update: fetch + verify + install a signed update, then relaunch via the
    // process plugin. Mobile updates go through the app stores, so these plugins are compiled out
    // there (see the cfg-gated deps in Cargo.toml). Relaunch brings the app back at the idle screen,
    // so the next call is a fresh session by construction.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
