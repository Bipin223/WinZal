//! Start-menu apps for the Apps tool: names, real shell icons, and launch.

use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

use base64::Engine;
use serde::Serialize;
use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::DeleteObject;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::UI::Shell::{
    IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK,
    SIIGBF_ICONONLY,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const ICON_SIZE: i32 = 40;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    /// Stable Apps-folder id from Windows, or the absolute exe path.
    id: String,
    name: String,
    /// PNG data URL; the UI falls back to an initial when empty.
    icon: Option<String>,
}

#[tauri::command]
pub async fn apps_list() -> Result<Vec<AppEntry>, String> {
    tauri::async_runtime::spawn_blocking(list_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn list_sync() -> Result<Vec<AppEntry>, String> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for (name, id) in crate::start_apps::list() {
        if non_app(&id) || !seen.insert(id.clone()) {
            continue;
        }
        entries.push((name, id));
    }
    if entries.is_empty() {
        return Err("Could not read the Start menu".into());
    }

    // Shell icon extraction is the slow part. Four short-lived workers keep the
    // first Apps open quick without leaving any background work behind.
    let chunk = entries.len().div_ceil(4).max(1);
    let apps = Mutex::new(Vec::with_capacity(entries.len()));
    std::thread::scope(|scope| {
        for part in entries.chunks(chunk) {
            let apps = &apps;
            scope.spawn(move || {
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                let mut local = Vec::with_capacity(part.len());
                for (name, id) in part {
                    local.push(AppEntry { id: id.clone(), name: name.clone(), icon: shell_icon(id) });
                }
                apps.lock().unwrap().extend(local);
            });
        }
    });
    let mut apps = apps.into_inner().unwrap();
    apps.sort_by_key(|app| app.name.to_lowercase());
    Ok(apps)
}

/// Documentation/web links in the Start menu are not apps.
fn non_app(id: &str) -> bool {
    let id = id.to_lowercase();
    id.starts_with("http://")
        || id.starts_with("https://")
        || [
            ".chm", ".hlp", ".url", ".pdf", ".txt", ".rtf", ".htm", ".html", ".doc", ".docx", ".xls",
            ".xlsx", ".ppt", ".pptx",
        ]
        .iter()
        .any(|ext| id.ends_with(ext))
}

fn shell_icon(app_id: &str) -> Option<String> {
    unsafe {
        let target = if Path::new(app_id).is_absolute() {
            app_id.to_string()
        } else {
            format!("shell:AppsFolder\\{app_id}")
        };
        let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(target), None).ok()?;
        let factory: IShellItemImageFactory = item.cast().ok()?;
        let flags = SIIGBF(SIIGBF_ICONONLY.0 | SIIGBF_BIGGERSIZEOK.0);
        let bitmap = factory.GetImage(SIZE { cx: ICON_SIZE, cy: ICON_SIZE }, flags).ok()?;
        let png = crate::winicons::hbitmap_to_png(bitmap);
        let _ = DeleteObject(bitmap.into());
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png?)
        ))
    }
}

/// Opens an app exactly the way the Start menu does.
#[tauri::command]
pub fn app_open(app_id: String) -> Result<(), String> {
    let id = app_id.trim();
    if id.is_empty() {
        return Err("No app selected".into());
    }
    let target = if Path::new(id).is_absolute() {
        id.to_string()
    } else {
        format!("shell:AppsFolder\\{id}")
    };
    Command::new("explorer.exe")
        .arg(target)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
