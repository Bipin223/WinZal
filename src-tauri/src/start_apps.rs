//! Lightweight Start-menu names + AppIDs. `apps.rs` also uses this for its list.

use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Names and Apps-folder IDs in Start-menu order.
pub fn list() -> Vec<(String, String)> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
                  Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress";
    let Ok(output) = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(text.trim()) else {
        return Vec::new();
    };
    let rows = match raw {
        serde_json::Value::Array(rows) => rows,
        serde_json::Value::Object(_) => vec![raw],
        _ => Vec::new(),
    };
    rows.into_iter()
        .filter_map(|row| {
            let name = row.get("Name")?.as_str()?.trim();
            let id = row.get("AppID")?.as_str()?.trim();
            (!name.is_empty() && !id.is_empty()).then(|| (name.to_string(), id.to_string()))
        })
        .collect()
}

