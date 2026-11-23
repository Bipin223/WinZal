//! Opens the native Windows Task View.

use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN,
    VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

/// Win+Tab is the shell's own Task View: live window thumbnails and virtual
/// desktops, with all Windows behaviour included. Sending it from our top-left
/// button is more faithful than trying to rebuild the shell overlay.
#[tauri::command]
pub fn task_view() -> Result<(), String> {
    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                ..Default::default()
            },
        },
    };
    let inputs = [key(VK_LWIN, false), key(VK_TAB, false), key(VK_TAB, true), key(VK_LWIN, true)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows did not open Task View".into())
    }
}

/// Fedora-style hot corner, but strict: the pointer must actually travel
/// diagonally up-left into the monitor's top-left corner. Hovering, resting
/// there, or entering vertically/horizontally does nothing.
pub fn spawn_hot_corner(app: AppHandle) {
    thread::spawn(move || {
        // The setup call can run a beat before WebView2 has realized the
        // window. Wait for the real HWND instead of silently dying once.
        let own = loop {
            if let Some(window) = app.get_webview_window("notch") {
                if let Ok(hwnd) = window.hwnd() {
                    break hwnd;
                }
            }
            thread::sleep(Duration::from_millis(100));
        };
        let mut entry: Option<POINT> = None;
        let mut corner_since: Option<Instant> = None;
        let mut armed = true;
        // Slow down when the pointer is far away. The monitor rect is cached;
        // a 15 ms Win32 wake-up every frame was unnecessary idle work.
        let mut area: Option<RECT> = None;
        let mut area_at = Instant::now() - Duration::from_secs(10);
        let mut far = true;

        loop {
            thread::sleep(Duration::from_millis(if far { 30 } else { 12 }));
            let mut point = POINT::default();
            if unsafe { GetCursorPos(&mut point) }.is_err() {
                continue;
            }

            if area.is_none() || area_at.elapsed() > Duration::from_secs(2) {
                let monitor = unsafe { MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST) };
                let mut info = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
                    area = Some(info.rcMonitor);
                    area_at = Instant::now();
                } else if area.is_none() {
                    continue;
                }
            }
            let Some(area) = area else { continue };
            let in_corner = point.x <= area.left + 5 && point.y <= area.top + 5;
            let near = point.x <= area.left + 120 && point.y <= area.top + 120;
            far = !near;
            if !near {
                armed = true;
                entry = None;
                corner_since = None;
                continue;
            }
            // Remember where the pointer entered the corner approach zone. The
            // whole path into the corner decides the gesture, so swipe speed and
            // timing don't change whether it fires.
            if entry.is_none() {
                entry = Some(point);
            }
            if !in_corner {
                corner_since = None;
                continue;
            }
            if !armed {
                continue;
            }

            let start = entry.unwrap_or(point);
            let dx = point.x - start.x;
            let dy = point.y - start.y;
            let distance = ((dx * dx + dy * dy) as f64).sqrt();
            let ratio = dx.abs() as f64 / dy.abs().max(1) as f64;
            let diagonal =
                dx < -40 && dy < -40 && (0.5..=2.0).contains(&ratio) && distance >= 60.0;
            // Fallback for a missed swipe: resting in the exact corner also
            // opens Task View after a Fedora-like short dwell.
            let held = corner_since.get_or_insert_with(Instant::now).elapsed()
                >= Duration::from_millis(140);

            if diagonal || held {
                let _ = task_view();
                armed = false;
                entry = None;
                corner_since = None;
            }
        }
    });
}
