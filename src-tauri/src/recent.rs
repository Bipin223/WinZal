//! A lightweight task switcher: visible top-level windows in Z-order,
//! one row per window, newest/most-recent first.

use std::collections::{HashMap, HashSet};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsIconic, IsWindow, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use crate::mixer::{bring_to_front, display_name, icon_png, process_path};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWindow {
    /// Opaque window handle; only used by recent_focus.
    id: String,
    name: String,
    title: String,
    icon: Option<String>,
    minimized: bool,
    /// A hidden main window of an app that lives in the system tray.
    tray: bool,
}

struct Search {
    own: u32,
    tray: HashSet<String>,
    seen_exes: HashSet<String>,
    starts: HashMap<String, String>,
    cache: HashMap<String, (String, Option<String>)>,
    found: Vec<RecentWindow>,
}

#[tauri::command]
pub async fn recent_apps() -> Vec<RecentWindow> {
    tauri::async_runtime::spawn_blocking(list)
        .await
        .unwrap_or_default()
}

fn list() -> Vec<RecentWindow> {
    let tray = tray_executables();
    let starts = if tray.is_empty() {
        HashMap::new()
    } else {
        crate::start_apps::name_map().clone()
    };
    let mut search = Search {
        own: unsafe { GetCurrentProcessId() },
        tray: tray.clone(),
        seen_exes: HashSet::new(),
        starts,
        cache: HashMap::new(),
        found: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut search as *mut Search as isize));
    }

    // Some tray apps have no enumerable window (or hide it on another desktop).
    // Add the running ones from Windows' notification-icon list; clicking will
    // either reveal their hidden window or start the app.
    let running = running_exes();
    for path in tray {
        if search.found.len() >= 30 {
            break;
        }
        let key = path.to_lowercase();
        let exe = Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if exe == "winzal.exe"
            || is_shell(&exe)
            || search.seen_exes.contains(&key)
            || !running.contains(&key)
        {
            continue;
        }
        let name = display_name(&path);
        let id = search
            .starts
            .get(&crate::start_apps::key(&name))
            .map(|app_id| format!("start:{app_id}"))
            .unwrap_or_else(|| format!("tray:{path}"));
        search.found.push(RecentWindow {
            id,
            title: name.clone(),
            name,
            icon: icon_png(&path),
            minimized: false,
            tray: true,
        });
    }
    search.found
}

fn running_exes() -> HashSet<String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.processes()
        .values()
        .filter_map(|process| process.exe())
        .map(|path| path.to_string_lossy().to_lowercase())
        .collect()
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let search = &mut *(lparam.0 as *mut Search);
    if !IsWindowVisible(hwnd).as_bool()
        || GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid())
    {
        return true.into();
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return true.into();
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 || pid == search.own {
        return true.into();
    }
    let Some(exe_path) = process_path(pid) else {
        return true.into();
    };
    let exe = Path::new(&exe_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if is_shell(&exe) {
        return true.into();
    }
    // Visible windows are the taskbar apps. Hidden windows are only useful for
    // tray apps (Discord and friends keep their main window hidden there).
    let visible = IsWindowVisible(hwnd).as_bool();
    let tray = !visible && search.tray.contains(&exe_path.to_lowercase());
    if !visible && !tray {
        return true.into();
    }
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
        return true.into();
    }

    let mut buf = vec![0u16; len as usize + 1];
    let n = GetWindowTextW(hwnd, &mut buf);
    let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
    if title.is_empty() || title == "Program Manager" {
        return true.into();
    }
    let key = exe_path.to_lowercase();
    // One row per hidden tray app. Multiple hidden helper windows would all
    // open the same app.
    if tray && search.seen_exes.contains(&key) {
        return true.into();
    }
    let (name, icon) = if exe == "applicationframehost.exe" {
        // UWP apps are hosted by this process. The window title names the app;
        // there is no per-package icon on the host process.
        ("Windows app".to_string(), None)
    } else {
        search.cache.get(&exe_path).cloned().unwrap_or_else(|| {
            let info = (display_name(&exe_path), icon_png(&exe_path));
            search.cache.insert(exe_path.clone(), info.clone());
            info
        })
    };

    search.seen_exes.insert(key);
    // A hidden tray window cannot be shown directly: Chromium/Electron apps
    // render it but the app does not react. Activate its Start-menu AppID,
    // exactly like clicking the app's tray/Start entry.
    let start = tray
        .then(|| search.starts.get(&crate::start_apps::key(&name)).cloned())
        .flatten();
    search.found.push(RecentWindow {
        id: start
            .map(|app_id| format!("start:{app_id}"))
            .or_else(|| tray.then(|| format!("tray:{exe_path}")))
            .unwrap_or_else(|| (hwnd.0 as usize).to_string()),
        name,
        title,
        icon,
        minimized: IsIconic(hwnd).as_bool(),
        tray,
    });
    // A task switcher does not need an unbounded list.
    if search.found.len() >= 30 {
        return false.into();
    }
    true.into()
}

/// Executables that currently own a Windows notification-area icon.
fn tray_executables() -> HashSet<String> {
    let mut exes = HashSet::new();
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Control Panel\NotifyIconSettings") else {
        return exes;
    };
    for name in key.enum_keys().flatten() {
        let Ok(sub) = key.open_subkey(name) else { continue };
        let Ok(path) = sub.get_value::<String, _>("ExecutablePath") else { continue };
        let path = path.trim();
        if !path.is_empty() && Path::new(path).is_file() {
            exes.insert(path.to_lowercase());
        }
    }
    exes
}

fn is_shell(exe: &str) -> bool {
    matches!(
        exe,
        "winzal.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
            | "searchhost.exe"
            | "textinputhost.exe"
    )
}

#[tauri::command]
pub fn recent_focus(id: String) -> Result<(), String> {
    if let Some(app_id) = id.strip_prefix("start:") {
        return crate::apps::app_open(app_id.to_string());
    }
    if let Some(path) = id.strip_prefix("tray:") {
        if !Path::new(path).is_file() {
            return Err("That app is no longer installed".into());
        }
        // Same effect as clicking the app's tray/Start icon: let the app itself
        // reopen its real window instead of forcing a hidden browser window up.
        return Command::new(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string());
    }
    let raw = id.parse::<usize>().map_err(|_| "Invalid window".to_string())?;
    let hwnd = HWND(raw as *mut _);
    if !unsafe { IsWindow(Some(hwnd)).as_bool() } {
        return Err("That window is gone".into());
    }
    if bring_to_front(hwnd) {
        Ok(())
    } else {
        Err("Windows would not bring that app forward".into())
    }
}
