//! Overview: system volume and Windows focus.
//!
//! - Volume: default output device via `IAudioEndpointVolume` (same as the taskbar slider).
//! - Focus: Windows Do Not Disturb through the undocumented `QuietHoursSettings`
//!   COM class (`UserSelectedProfile`), the same value the taskbar DND button writes.

use std::ffi::c_void;

use serde::{Deserialize, Serialize};

use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

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

// Windows' Do Not Disturb is stored in the undocumented QuietHoursSettings
// COM class. Reading `UserSelectedProfile` is the same value the taskbar DND
// button changes; setting it to PriorityOnly/Unrestricted toggles the real
// system-wide Do Not Disturb state (verified against ToastNotificationMode).
const CLSID_QUIET_HOURS: windows::core::GUID = windows::core::GUID::from_u128(0xf53321fa34f84b7fb9a3361877cb94cf);
const IID_QUIET_HOURS: windows::core::GUID = windows::core::GUID::from_u128(0x6bff473281ec4ffbae67b6c1bc29631f);
const PROFILE_PRIORITY: &str = "Microsoft.QuietHoursProfile.PriorityOnly";
const PROFILE_OFF: &str = "Microsoft.QuietHoursProfile.Unrestricted";

#[repr(C)]
struct QuietHoursVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const windows::core::GUID, *mut *mut c_void) -> windows::core::HRESULT,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_profile: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> windows::core::HRESULT,
    set_profile: unsafe extern "system" fn(*mut c_void, *const u16) -> windows::core::HRESULT,
}

#[repr(C)]
struct QuietHours {
    vtbl: *const QuietHoursVtbl,
    /// The real interface pointer from `CoCreateInstance`; COM methods need this
    /// as `this`, not the address of this local wrapper.
    interface: *mut c_void,
}

#[link(name = "ole32")]
unsafe extern "system" {
    #[link_name = "CoCreateInstance"]
    fn raw_co_create_instance(
        rclsid: *const windows::core::GUID,
        punkouter: *mut c_void,
        dwclscontext: u32,
        riid: *const windows::core::GUID,
        ppv: *mut *mut c_void,
    ) -> windows::core::HRESULT;
    #[link_name = "CoTaskMemFree"]
    fn raw_co_task_mem_free(ptr: *const c_void);
}

/// Runs a COM operation on a fresh MTA thread, so it never depends on Tauri's
/// apartment state and needs no message pump.
fn with_quiet_hours<T: Send + 'static>(action: impl FnOnce(&QuietHours) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let join = std::thread::spawn(move || {
        let initiated = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let mut raw: *mut c_void = std::ptr::null_mut();
        let created = unsafe {
            raw_co_create_instance(&CLSID_QUIET_HOURS, std::ptr::null_mut(), 4 /* CLSCTX_LOCAL_SERVER */, &IID_QUIET_HOURS, &mut raw)
        };
        if created.is_err() || raw.is_null() {
            if initiated {
                unsafe { CoUninitialize() };
            }
            return Err(format!("Do Not Disturb COM unavailable ({created:?})"));
        }
        let vtbl = unsafe { *(raw as *const *const QuietHoursVtbl) };
        let object = QuietHours { vtbl, interface: raw };
        let result = action(&object);
        unsafe {
            if let Some(vtbl) = object.vtbl.as_ref() {
                let _ = (vtbl.release)(object.interface);
            }
        }
        if initiated {
            unsafe { CoUninitialize() };
        }
        result
    });
    join.join().map_err(|_| "Do Not Disturb thread failed".to_string())?
}

fn quiet_hours_profile() -> Result<String, String> {
    with_quiet_hours(|object| unsafe {
        let vtbl = object.vtbl.as_ref().ok_or("Do Not Disturb COM unavailable")?;
        let mut out: *mut u16 = std::ptr::null_mut();
        let hr = (vtbl.get_profile)(object.interface, &mut out);
        if hr.is_err() || out.is_null() {
            return Err(format!("Do Not Disturb read failed ({hr:?})"));
        }
        let mut len = 0usize;
        while *out.add(len) != 0 {
            len += 1;
        }
        let value = String::from_utf16_lossy(std::slice::from_raw_parts(out, len));
        raw_co_task_mem_free(out as *const c_void);
        Ok(value)
    })
}

fn set_quiet_hours_profile(profile: &str) -> Result<(), String> {
    let profile = profile.to_string();
    with_quiet_hours(move |object| unsafe {
        let vtbl = object.vtbl.as_ref().ok_or("Do Not Disturb COM unavailable")?;
        let wide: Vec<u16> = profile.encode_utf16().chain(Some(0)).collect();
        let hr = (vtbl.set_profile)(object.interface, wide.as_ptr());
        if hr.is_err() {
            return Err(format!("Do Not Disturb write failed ({hr:?})"));
        }
        Ok(())
    })
}

fn dnd_active() -> bool {
    quiet_hours_profile()
        .map(|profile| !profile.to_ascii_lowercase().ends_with(".unrestricted"))
        .unwrap_or(false)
}

fn set_dnd(on: bool) -> Result<(), String> {
    set_quiet_hours_profile(if on { PROFILE_PRIORITY } else { PROFILE_OFF })
}
fn read_focus() -> Focus {
    Focus { active: dnd_active(), kind: "dnd" }
}

#[tauri::command]
pub async fn focus_get() -> Focus {
    tauri::async_runtime::spawn_blocking(read_focus).await.unwrap_or(Focus { active: false, kind: "dnd" })
}

#[tauri::command]
pub async fn focus_set(active: bool) -> Result<Focus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_dnd(active)?;
        Ok(read_focus())
    })
    .await
    .map_err(|e| e.to_string())?
}
