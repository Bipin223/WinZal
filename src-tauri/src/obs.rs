//! OBS Studio control through its built-in WebSocket server (OBS 28+).
//!
//! The Recording tab reads the OBS WebSocket config, authenticates locally and
//! sends StartRecord / StopRecord / PauseRecord. The password never leaves the
//! machine and is never logged.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration as StdDuration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const DEFAULT_PORT: u16 = 4455;
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);
/// OBS WebSocket event category: high-volume audio meters (1 << 16).
const INPUT_VOLUME_METERS: i64 = 1 << 16;
static METERS_ON: AtomicBool = AtomicBool::new(false);
static METERS_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    installed: bool,
    running: bool,
    websocket: bool,
    connected: bool,
    recording: bool,
    paused: bool,
    timecode: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct ObsConfig {
    #[serde(default)]
    server_enabled: bool,
    #[serde(default = "default_port")]
    server_port: u16,
    #[serde(default)]
    auth_required: bool,
    #[serde(default)]
    server_password: String,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn config_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("obs-studio")
            .join("plugin_config")
            .join("obs-websocket")
            .join("config.json"),
    )
}

fn read_config() -> Option<ObsConfig> {
    let text = std::fs::read_to_string(config_path()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn obs_running() -> bool {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "obs64.exe" || name == "obs32.exe" || name == "obs.exe"
    })
}

fn standard_exe(path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(path);
    path.is_file().then_some(path)
}

fn find_exe() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("obs-studio/bin/64bit/obs64.exe"));
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files).join("obs-studio/bin/64bit/obs64.exe"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local).join("Programs/obs-studio/bin/64bit/obs64.exe"));
        candidates.push(PathBuf::from(local).join("obs-studio/bin/64bit/obs64.exe"));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // Portable or custom installs: OBS registers its icon path in Uninstall.
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for sub in [
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ] {
            let Ok(root) = RegKey::predef(hive).open_subkey(sub) else { continue };
            for key in root.enum_keys().flatten() {
                let Ok(app) = root.open_subkey(&key) else { continue };
                let display: String = app.get_value("DisplayName").unwrap_or_default();
                if !display.to_ascii_lowercase().contains("obs") {
                    continue;
                }
                let icon: String = app.get_value("DisplayIcon").unwrap_or_default();
                let path = icon.split(',').next().unwrap_or("").trim().trim_matches('"');
                if let Some(found) = standard_exe(path) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn obs_installed() -> bool {
    config_path().is_some_and(|path| path.exists()) || find_exe().is_some()
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn read_json(ws: &mut Ws) -> Result<Value, String> {
    let message = tokio::time::timeout(StdDuration::from_secs(4), ws.next())
        .await
        .map_err(|_| "OBS WebSocket timed out".to_string())?
        .ok_or_else(|| "OBS WebSocket closed".to_string())?
        .map_err(|e| format!("OBS WebSocket: {e}"))?;
    match message {
        Message::Text(text) => serde_json::from_str(&text).map_err(|e| format!("OBS reply: {e}")),
        Message::Close(_) => Err("OBS closed the WebSocket".into()),
        _ => Err("Unexpected OBS WebSocket message".into()),
    }
}

async fn send_json(ws: &mut Ws, value: &Value) -> Result<(), String> {
    ws.send(Message::Text(value.to_string().into()))
        .await
        .map_err(|e| format!("OBS WebSocket: {e}"))
}

fn auth_string(password: &str, salt: &str, challenge: &str) -> String {
    let secret = STANDARD.encode(Sha256::digest(format!("{password}{salt}").as_bytes()));
    STANDARD.encode(Sha256::digest(format!("{secret}{challenge}").as_bytes()))
}

async fn open_socket(config: &ObsConfig, event_subscriptions: i64) -> Result<Ws, String> {
    let url = format!("ws://127.0.0.1:{}", config.server_port);
    let (mut ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("OBS WebSocket is not reachable: {e}"))?;

    let hello = read_json(&mut ws).await?;
    if hello["op"].as_i64() != Some(0) {
        return Err("OBS handshake failed".into());
    }
    let auth = if config.auth_required {
        let challenge = hello["d"]["authentication"]["challenge"].as_str().unwrap_or_default();
        let salt = hello["d"]["authentication"]["salt"].as_str().unwrap_or_default();
        Some(auth_string(&config.server_password, salt, challenge))
    } else {
        None
    };
    let mut identify =
        json!({ "op": 1, "d": { "rpcVersion": 1, "eventSubscriptions": event_subscriptions } });
    if let Some(auth) = auth {
        identify["d"]["authentication"] = json!(auth);
    }
    send_json(&mut ws, &identify).await?;

    loop {
        let message = read_json(&mut ws).await?;
        match message["op"].as_i64() {
            Some(2) => break,
            Some(1) => return Err("OBS rejected the WebSocket password".into()),
            _ => continue,
        }
    }
    Ok(ws)
}

async fn obs_call_inner(request: &str, request_data: Value) -> Result<Value, String> {
    let config = read_config().ok_or("OBS WebSocket config not found")?;
    if !config.server_enabled {
        return Err("OBS WebSocket server is off".into());
    }
    let mut ws = open_socket(&config, 0).await?;

    let id = format!("winzal-{}", REQUEST_ID.fetch_add(1, Ordering::Relaxed));
    send_json(
        &mut ws,
        &json!({
            "op": 6,
            "d": { "requestType": request, "requestId": id, "requestData": request_data }
        }),
    )
    .await?;

    loop {
        let message = read_json(&mut ws).await?;
        if message["op"].as_i64() != Some(7) || message["d"]["requestId"].as_str() != Some(id.as_str()) {
            continue;
        }
        let status = &message["d"]["requestStatus"];
        if status["result"].as_bool() != Some(true) {
            return Err(status["comment"].as_str().unwrap_or("OBS request failed").to_string());
        }
        // OBS WebSocket v5 returns the payload in `responseData`; older docs
        // call it `requestData`, so accept either.
        let data = &message["d"]["responseData"];
        return Ok(if data.is_null() { message["d"]["requestData"].clone() } else { data.clone() });
    }
}

async fn obs_call(request: &str, request_data: Value) -> Result<Value, String> {
    tokio::time::timeout(StdDuration::from_secs(6), obs_call_inner(request, request_data))
        .await
        .map_err(|_| "OBS WebSocket timed out".to_string())?
}

/// One post-fader peak across every active OBS audio input (mic, desktop, …).
async fn meter_session(app: &AppHandle) -> Result<(), String> {
    let config = read_config().ok_or("OBS WebSocket config not found")?;
    if !config.server_enabled {
        return Err("OBS WebSocket server is off".into());
    }
    let mut ws = open_socket(&config, INPUT_VOLUME_METERS).await?;

    loop {
        if !METERS_ON.load(Ordering::Relaxed) {
            return Ok(());
        }
        match tokio::time::timeout(StdDuration::from_millis(600), ws.next()).await {
            Err(_) => {
                // No meters at all (no active audio inputs): let the bars fall.
                let _ = app.emit("obs://levels", 0.0f32);
            }
            Ok(None) => return Ok(()),
            Ok(Some(Err(error))) => return Err(format!("OBS WebSocket: {error}")),
            Ok(Some(Ok(Message::Text(text)))) => {
                let Ok(message) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if message["op"].as_i64() != Some(5) {
                    continue;
                }
                if message["d"]["eventType"].as_str() != Some("InputVolumeMeters") {
                    continue;
                }
                let mut level = 0.0f32;
                if let Some(inputs) = message["d"]["eventData"]["inputs"].as_array() {
                    for input in inputs {
                        let Some(channels) = input["inputLevelsMul"].as_array() else {
                            continue;
                        };
                        for channel in channels {
                            let Some(values) = channel.as_array() else {
                                continue;
                            };
                            // [VU, post-fader, pre-fader]; post-fader is what the recording hears.
                            if let Some(value) = values.get(1).and_then(|value| value.as_f64()) {
                                let value = value as f32;
                                if value.is_finite() && value > 0.0 {
                                    level = level.max(value);
                                }
                            }
                        }
                    }
                }
                let _ = app.emit("obs://levels", level.min(1.0));
            }
            Ok(Some(Ok(_))) => {}
        }
    }
}

/// Turn the OBS audio meter stream on/off. One background task is started the first
/// time it is enabled; it reconnects on its own when OBS starts or closes.
#[tauri::command]
pub fn obs_meter(enabled: bool, app: AppHandle) {
    METERS_ON.store(enabled, Ordering::Relaxed);
    if !enabled || METERS_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            if METERS_ON.load(Ordering::Relaxed) {
                let _ = meter_session(&app).await;
            }
            tokio::time::sleep(StdDuration::from_millis(800)).await;
        }
    });
}

#[tauri::command]
pub async fn obs_status() -> ObsStatus {
    let installed = obs_installed();
    let running = obs_running();
    let Some(config) = read_config() else {
        return ObsStatus {
            installed,
            running,
            error: Some("OBS WebSocket config not found".into()),
            ..Default::default()
        };
    };
    if !config.server_enabled {
        return ObsStatus {
            installed,
            running,
            websocket: false,
            error: Some("OBS WebSocket server is off".into()),
            ..Default::default()
        };
    }
    match obs_call("GetRecordStatus", json!({})).await {
        Ok(data) => ObsStatus {
            installed,
            running,
            websocket: true,
            connected: true,
            recording: data["outputActive"].as_bool().unwrap_or(false),
            paused: data["outputPaused"].as_bool().unwrap_or(false),
            timecode: data["outputTimecode"].as_str().unwrap_or("00:00:00.000").to_string(),
            error: None,
        },
        Err(error) => ObsStatus {
            installed,
            running,
            websocket: true,
            connected: false,
            error: Some(error),
            ..Default::default()
        },
    }
}

#[tauri::command]
pub async fn obs_start() -> Result<(), String> {
    obs_call("StartRecord", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn obs_stop() -> Result<(), String> {
    obs_call("StopRecord", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn obs_pause() -> Result<(), String> {
    obs_call("PauseRecord", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn obs_resume() -> Result<(), String> {
    obs_call("ResumeRecord", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub fn obs_show() -> Result<(), String> {
    if obs_running() {
        return Ok(());
    }
    let exe = find_exe().ok_or("OBS Studio was not found")?;
    let dir = exe.parent().ok_or("OBS Studio was not found")?;
    Command::new(&exe)
        .current_dir(dir)
        .spawn()
        .map_err(|e| format!("Could not open OBS: {e}"))?;
    Ok(())
}

/// Turn the OBS WebSocket server on while OBS is closed, then open OBS.
/// When OBS is already running its settings must be changed inside OBS.
#[tauri::command]
pub fn obs_prepare() -> Result<String, String> {
    if obs_running() {
        return Err("OBS is running. Enable Tools → WebSocket Server Settings → Enable WebSocket server, then try again.".into());
    }
    let path = config_path().ok_or("OBS WebSocket config not found")?;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("OBS config: {e}"))?;
    let mut value: Value = serde_json::from_str(&text).map_err(|e| format!("OBS config: {e}"))?;
    value["server_enabled"] = json!(true);
    std::fs::write(&path, serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?)
        .map_err(|e| format!("OBS config: {e}"))?;
    let exe = find_exe().ok_or("OBS Studio was not found")?;
    let dir = exe.parent().ok_or("OBS Studio was not found")?;
    Command::new(&exe)
        .current_dir(dir)
        .spawn()
        .map_err(|e| format!("WebSocket enabled, but OBS did not open: {e}"))?;
    Ok("OBS WebSocket enabled. OBS is starting…".into())
}
