// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The app lives in the library crate so mobile shells (Android/iOS) can load it too; the desktop
// binary is just this thin launcher. See `lib.rs`.
fn main() {
    app_lib::run();
}
