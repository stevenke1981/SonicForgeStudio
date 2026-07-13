#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    platform: &'static str,
    shell: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioStatus {
    state: &'static str,
    device_name: Option<&'static str>,
    sample_rate: u32,
    buffer_size: u32,
    xrun_count: u64,
    engine_available: bool,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "SonicForge Studio",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        shell: "tauri-rust",
    }
}

#[tauri::command]
fn get_audio_status() -> AudioStatus {
    AudioStatus {
        state: "unavailable",
        device_name: None,
        sample_rate: 48_000,
        buffer_size: 256,
        xrun_count: 0,
        engine_available: false,
    }
}

fn main() {
    let result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_app_info, get_audio_status])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("error while running SonicForge Studio: {error}");
        std::process::exit(1);
    }
}
