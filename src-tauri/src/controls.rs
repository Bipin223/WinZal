//! Overview: system volume and Windows focus.
//!
//! - Volume: default output device via `IAudioEndpointVolume` (same as the taskbar slider).
//! - Focus: Windows 11 focus session (`FocusSessionManager`, also turns on Do Not Disturb).
//!   Without that API (older builds), Do Not Disturb is set directly through the WNF state
//!   `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED`, which is what the toggle in the
//!   notification center does.

use std::ffi::c_void;

use serde::{Deserialize, Serialize};
use windows::UI::Shell::FocusSessionManager;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

#[derive(Serialize)]
pub struct Volume {
    /// 0..1
    level: f32,
    muted: bool,
}

#[derive(Serialize)]
pub struct Focus {
    active: bool,
    /// "focus" = focus session, "dnd" = only Do Not Disturb available
    kind: &'static str,
}

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        // Own thread per call (spawn_blocking) → MTA; "already initialized" is fine.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        devices.GetDefaultAudioEndpoint(eRender, eConsole)?.Activate(CLSCTX_ALL, None)
    }
}

fn read_volume() -> windows::core::Result<Volume> {
    let ep = endpoint()?;
    unsafe { Ok(Volume { level: ep.GetMasterVolumeLevelScalar()?, muted: ep.GetMute()?.as_bool() }) }
}

#[tauri::command]
pub async fn volume_get() -> Result<Volume, String> {
    tauri::async_runtime::spawn_blocking(|| read_volume().map_err(|e| e.message()))
        .await
        .map_err(|e| e.to_string())?
}

/// Sets `level` 0..1 and/or `muted`. Raising the volume unmutes, like Windows does.
#[tauri::command]
pub async fn volume_set(level: Option<f32>, muted: Option<bool>) -> Result<Volume, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ep = endpoint().map_err(|e| e.message())?;
        unsafe {
            if let Some(l) = level {
                ep.SetMasterVolumeLevelScalar(l.clamp(0.0, 1.0), std::ptr::null()).map_err(|e| e.message())?;
                if l > 0.0 && muted.is_none() {
                    let _ = ep.SetMute(false, std::ptr::null());
                }
            }
            if let Some(m) = muted {
                ep.SetMute(m, std::ptr::null()).map_err(|e| e.message())?;
            }
        }
        read_volume().map_err(|e| e.message())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Brightness ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct Brightness {
    /// 0..100
    level: u32,
    /// false when no display exposes a brightness control (e.g. most desktops)
    supported: bool,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct WmiMonitorBrightness {
    CurrentBrightness: u8,
}

#[derive(Deserialize)]
#[allow(non_camel_case_types, non_snake_case)]
struct WmiMonitorBrightnessMethods {
    __Path: String,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
struct SetBrightnessIn {
    Timeout: u32,
    Brightness: u8,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct SetBrightnessOut {
    ReturnValue: bool,
}

fn brightness_connection() -> Result<wmi::WMIConnection, String> {
    wmi::WMIConnection::with_namespace_path("ROOT\\WMI").map_err(|e| e.to_string())
}

fn read_brightness() -> Result<Brightness, String> {
    let con = brightness_connection()?;
    let rows: Vec<WmiMonitorBrightness> = con
        .raw_query("SELECT CurrentBrightness FROM WmiMonitorBrightness")
        .map_err(|e| e.to_string())?;
    Ok(match rows.first() {
        Some(row) => Brightness { level: u32::from(row.CurrentBrightness), supported: true },
        None => Brightness { level: 0, supported: false },
    })
}

#[tauri::command]
pub async fn brightness_get() -> Result<Brightness, String> {
    tauri::async_runtime::spawn_blocking(read_brightness)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn brightness_set(level: u32) -> Result<Brightness, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let level = level.min(100);
        let con = brightness_connection()?;
        let methods: Vec<WmiMonitorBrightnessMethods> = con
            .raw_query("SELECT __Path FROM WmiMonitorBrightnessMethods")
            .map_err(|e| e.to_string())?;
        let path = methods.first().ok_or("This display has no brightness control")?;
        let out: SetBrightnessOut = con
            .exec_instance_method::<WmiMonitorBrightnessMethods, _>(
                &path.__Path,
                "WmiSetBrightness",
                SetBrightnessIn { Timeout: 1, Brightness: level as u8 },
            )
            .map_err(|e| e.to_string())?;
        if !out.ReturnValue {
            return Err("The display rejected the brightness change".into());
        }
        Ok(Brightness { level, supported: true })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Focus / Do Not Disturb ────────────────────────────────────────────────────

const WNF_QUIET_HOURS: u64 = 0x0D83_063E_A3BF_1C75;

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryWnfStateData(state: *const u64, type_id: *const c_void, scope: *const c_void, stamp: *mut u32, buffer: *mut c_void, size: *mut u32) -> i32;
    fn NtUpdateWnfStateData(state: *const u64, buffer: *const c_void, length: u32, type_id: *const c_void, scope: *const c_void, matching_stamp: u32, check_stamp: u32) -> i32;
}

/// 0 = off, 1 = priority only, 2 = alarms only.
fn dnd_profile() -> Option<u32> {
    let (mut stamp, mut value, mut size) = (0u32, 0u32, 4u32);
    let status = unsafe { NtQueryWnfStateData(&WNF_QUIET_HOURS, std::ptr::null(), std::ptr::null(), &mut stamp, (&mut value as *mut u32).cast(), &mut size) };
    (status >= 0).then_some(if size == 0 { 0 } else { value })
}

fn set_dnd(on: bool) -> Result<(), String> {
    let value: u32 = if on { 1 } else { 0 };
    let status = unsafe { NtUpdateWnfStateData(&WNF_QUIET_HOURS, (&value as *const u32).cast(), 4, std::ptr::null(), std::ptr::null(), 0, 0) };
    if status >= 0 { Ok(()) } else { Err(format!("Nicht stören ließ sich nicht schalten ({status:#x})")) }
}

fn sessions() -> Option<FocusSessionManager> {
    FocusSessionManager::IsSupported().ok().filter(|&s| s).and_then(|_| FocusSessionManager::GetDefault().ok())
}

fn read_focus() -> Focus {
    let dnd = dnd_profile().is_some_and(|p| p != 0);
    match sessions() {
        Some(m) => Focus { active: m.IsFocusActive().unwrap_or(false) || dnd, kind: "focus" },
        None => Focus { active: dnd, kind: "dnd" },
    }
}

#[tauri::command]
pub async fn focus_get() -> Focus {
    tauri::async_runtime::spawn_blocking(read_focus).await.unwrap_or(Focus { active: false, kind: "dnd" })
}

#[tauri::command]
pub async fn focus_set(active: bool) -> Result<Focus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = sessions();
        if active {
            // Prefer a focus session; if that fails, at least Do Not Disturb.
            if manager.as_ref().and_then(|m| m.TryStartFocusSession().ok()).is_none() {
                set_dnd(true)?;
            }
        } else {
            if let Some(m) = &manager {
                let _ = m.DeactivateFocus();
            }
            if dnd_profile().is_some_and(|p| p != 0) {
                set_dnd(false)?;
            }
        }
        Ok(read_focus())
    })
    .await
    .map_err(|e| e.to_string())?
}
