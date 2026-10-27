//! Display: which monitor the notch sits on and whether it hides during fullscreen.
//!
//! A thread checks the foreground window every 400 ms. If it covers the notch's whole
//! monitor (game, video, presentation, borderless too), the window is hidden, otherwise
//! shown again. In "always" mode only "always on top" is reapplied in case another
//! app put itself above.
//!
//! Gaming mode "in fullscreen": the notch stays visible instead; Rust emits
//! `notch://fullscreen` and the frontend shows FPS and load.
//! `offset` moves the notch sideways (dragging), clamped to the monitor.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, IsZoomed, GW_OWNER,
};

use crate::hit_test::HitState;

const POLL: Duration = Duration::from_millis(400);

#[derive(Default)]
pub struct DisplayState(Mutex<Config>);

/// While a notification card is visible, keep the notch window shown even if
/// fullscreen hiding would normally hide it (movie/video fullscreen).
#[derive(Default)]
pub struct NotifyState(AtomicBool);

#[tauri::command]
pub fn notification_visible(active: bool, state: State<'_, NotifyState>) {
    state.0.store(active, Ordering::Relaxed);
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// true = hide during fullscreen.
    hide_fullscreen: bool,
    /// Monitor name ("\\.\DISPLAY2"); None = primary monitor.
    monitor: Option<String>,
    /// Horizontal offset from the center in CSS px.
    #[serde(default)]
    offset: f64,
    /// "off" | "games" | "always".
    #[serde(default)]
    gaming_mode: String,
    /// Hide the notch while a recognized game is foreground, even when the
    /// gaming overlay is on. Useful for iGPU/auto where the window itself
    /// competes with the game.
    #[serde(default)]
    gaming_hide: bool,
    /// Lowercase exe names whose foreground presence shows the gaming overlay.
    #[serde(default)]
    gaming_apps: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    name: String,
    primary: bool,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundInfo {
    app: String,
    title: String,
    fullscreen: bool,
    gaming: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleApp {
    id: String,
    name: String,
    title: String,
}

#[tauri::command]
pub fn display_monitors(window: WebviewWindow) -> Vec<MonitorInfo> {
    let primary = window.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let name = m.name().cloned().unwrap_or_default();
            let scale = m.scale_factor();
            MonitorInfo {
                primary: primary.as_deref() == Some(name.as_str()),
                width: (m.size().width as f64 / scale) as u32,
                height: (m.size().height as f64 / scale) as u32,
                name,
            }
        })
        .collect()
}

#[tauri::command]
pub fn display_apply(config: Config, window: WebviewWindow, state: State<'_, DisplayState>) {
    let moved = {
        let cur = state.0.lock().unwrap();
        cur.monitor != config.monitor || cur.offset != config.offset
    };
    *state.0.lock().unwrap() = config;
    if moved {
        let _ = place(&window, &state);
    }
}

/// Centered and flush at the top of the chosen monitor (primary otherwise).
pub fn place(window: &WebviewWindow, state: &DisplayState) -> tauri::Result<()> {
    let (wanted, offset) = {
        let c = state.0.lock().unwrap();
        (c.monitor.clone(), c.offset)
    };
    let monitors = window.available_monitors()?;
    let monitor = wanted
        .and_then(|name| monitors.into_iter().find(|m| m.name() == Some(&name)))
        .or(window.primary_monitor()?);
    let Some(monitor) = monitor else { return Ok(()) };
    // Set twice: when moving to a monitor with different scaling, the window size
    // only updates after the first move.
    for _ in 0..2 {
        let size = window.outer_size()?;
        let free = (monitor.size().width as i32 - size.width as i32).max(0);
        let shift = ((offset * monitor.scale_factor()) as i32).clamp(-free / 2, free / 2);
        let x = monitor.position().x + free / 2 + shift;
        window.set_position(PhysicalPosition::new(x, monitor.position().y))?;
    }
    Ok(())
}

pub fn spawn(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        let Ok(own) = window.hwnd() else { return };
        let mut hidden = false;
        let mut last_fullscreen = false;
        let mut last_foreground = HWND::default();
        let mut last_app = String::new();
        let mut last_title = String::new();
        let mut last_gaming = false;
        loop {
            thread::sleep(POLL);
            let state = app.state::<DisplayState>();
            let (hide_fullscreen, mode, apps, gaming_hide) = {
                let c = state.0.lock().unwrap();
                (c.hide_fullscreen, c.gaming_mode.clone(), c.gaming_apps.clone(), c.gaming_hide)
            };
            let foreground = unsafe { GetForegroundWindow() };
            let fullscreen = foreground != own && covers_monitor(foreground, own);
            let app_id = foreground_app(foreground);
            let title = window_title(foreground);
            let gaming = match mode.as_str() {
                "always" => true,
                "games" => !app_id.is_empty() && apps.iter().any(|item| item.eq_ignore_ascii_case(&app_id)),
                _ => false,
            };
            let fullscreen_changed = fullscreen != last_fullscreen;
            if fullscreen_changed {
                last_fullscreen = fullscreen;
                let _ = app.emit("notch://fullscreen", fullscreen);
            }
            if app_id != last_app || title != last_title || fullscreen_changed || gaming != last_gaming {
                last_app = app_id.clone();
                last_title = title.clone();
                last_gaming = gaming;
                let _ = app.emit(
                    "notch://foreground",
                    ForegroundInfo { app: app_id, title, fullscreen, gaming },
                );
            }
            let notify = app.state::<NotifyState>().0.load(Ordering::Relaxed);
            let hide = !notify && ((gaming && gaming_hide) || (fullscreen && hide_fullscreen && !gaming));

            if hide != hidden {
                hidden = hide;
                if hidden {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_always_on_top(true);
                    // Let the click-through state be set again after show() (the poll caches the old one).
                    app.state::<HitState>().refresh();
                }
            }
            // New foreground window: reapply "on top" in case it covered us.
            if !hidden && foreground != last_foreground {
                let _ = window.set_always_on_top(true);
            }
            last_foreground = foreground;
        }
    });
}

/// Start menu / shell / the notch itself are not interesting as games.
fn is_shell_app(id: &str) -> bool {
    matches!(
        id,
        "winzal.exe"
            | "explorer.exe"
            | "searchhost.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
            | "textinputhost.exe"
            | "applicationframehost.exe"
    )
}

/// Lowercase file name of the process owning `hwnd` (e.g. "limusic-app.exe").
fn foreground_app(hwnd: HWND) -> String {
    if hwnd.is_invalid() {
        return String::new();
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return String::new();
    }
    let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return String::new();
    };
    let mut buf = vec![0u16; 1024];
    let mut len = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.is_ok();
    let _ = unsafe { CloseHandle(handle) };
    if !ok {
        return String::new();
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn window_title(hwnd: HWND) -> String {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return String::new();
    }
    let mut buf = vec![0u16; len as usize + 1];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// Visible top-level windows, one row per exe, for the "games & apps" picker.
#[tauri::command]
pub fn apps_visible() -> Vec<VisibleApp> {
    struct Search {
        found: BTreeMap<String, VisibleApp>,
    }
    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        if !IsWindowVisible(hwnd).as_bool() || GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid()) {
            return true.into();
        }
        let title = window_title(hwnd);
        if title.is_empty() {
            return true.into();
        }
        let id = foreground_app(hwnd);
        if id.is_empty() || is_shell_app(&id) {
            return true.into();
        }
        search.found.entry(id.clone()).or_insert_with(|| VisibleApp {
            name: friendly_name(&id),
            id,
            title,
        });
        true.into()
    }

    let mut search = Search { found: BTreeMap::new() };
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut search as *mut Search as isize));
    }
    search.found.into_values().collect()
}

fn friendly_name(id: &str) -> String {
    id.trim_end_matches(".exe")
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Does `hwnd` cover the whole monitor the notch (`own`) is on?
fn covers_monitor(hwnd: HWND, own: HWND) -> bool {
    // Maximized windows aren't fullscreen, but with an auto-hiding taskbar they
    // cover the whole monitor too.
    if hwnd.is_invalid() || is_desktop(hwnd) || unsafe { IsZoomed(hwnd) }.as_bool() {
        return false;
    }
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST) {
            return false;
        }
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let mut rect = RECT::default();
        if !GetMonitorInfoW(monitor, &mut info).as_bool() || GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

/// Desktop and taskbar never count as fullscreen.
fn is_desktop(hwnd: HWND) -> bool {
    unsafe {
        if hwnd == GetDesktopWindow() || hwnd == GetShellWindow() {
            return true;
        }
        let mut buf = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut buf).max(0) as usize;
        let class = String::from_utf16_lossy(&buf[..len]);
        matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
    }
}
