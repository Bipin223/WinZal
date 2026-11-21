//! The profile shown in the Overview: Windows name and account picture.
//! A photo picked in Settings overrides the Windows picture on the frontend.

use std::env;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::Engine;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    name: String,
    /// Small JPEG data URL, when Windows has an account picture.
    photo: Option<String>,
}

#[tauri::command]
pub fn account_profile() -> AccountProfile {
    AccountProfile {
        name: env::var("USERNAME")
            .ok()
            .filter(|name| !name.trim().is_empty())
            .or_else(|| env::var("USER").ok())
            .unwrap_or_default(),
        photo: account_photo(),
    }
}

fn account_photo() -> Option<String> {
    let dir = PathBuf::from(env::var_os("APPDATA")?)
        .join("Microsoft")
        .join("Windows")
        .join("AccountPictures");
    let path = newest_image(&dir)?;
    let image = image::open(&path).ok()?;
    let thumb = image.thumbnail(256, 256).to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 84)
        .encode_image(&thumb)
        .ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    ))
}

fn newest_image(dir: &Path) -> Option<PathBuf> {
    let mut files = Vec::new();
    collect_images(dir, &mut files, 0);
    files.sort_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    files.pop()
}

fn collect_images(dir: &Path, files: &mut Vec<PathBuf>, depth: u8) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect_images(&path, files, depth + 1);
        } else if kind.is_file() {
            let ext = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "bmp" | "webp") {
                files.push(path);
            }
        }
    }
}
