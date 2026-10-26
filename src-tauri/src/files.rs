//! File helpers for Shelf and Ask: probe, preview, open, reveal, copy, read text.
//!
//! The former quick-drop converter was removed from the app (tabs, Tools and the
//! drop flow). Only the metadata helpers live here now; no conversion code.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine;
use serde::Serialize;

const IMAGE_IN: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "ico", "tif", "tiff", "dds", "tga"];
const AUDIO_IN: &[&str] = &["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"];
const VIDEO_IN: &[&str] = &["mp4", "mov", "mkv", "avi", "webm", "wmv", "m4v"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    path: String,
    name: String,
    /// "image" | "audio" | "video" | "document" | "table" | "other"
    kind: &'static str,
    ext: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    files: Vec<FileInfo>,
}

#[tauri::command]
pub fn file_probe(paths: Vec<String>) -> Probe {
    let files = paths
        .into_iter()
        .filter_map(|p| {
            let path = PathBuf::from(&p);
            let meta = std::fs::metadata(&path).ok().filter(|m| m.is_file())?;
            let ext = extension(&path);
            Some(FileInfo {
                name: path.file_name()?.to_string_lossy().into_owned(),
                kind: kind_of(&ext),
                ext,
                size: meta.len(),
                path: p,
            })
        })
        .collect();
    Probe { files }
}

#[tauri::command]
pub fn file_text(path: String) -> Result<String, String> {
    crate::documents::read_text(&path)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("File no longer exists".into());
    }
    // `explorer <file>` opens it with the associated app, without a console window.
    Command::new("explorer").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Puts files on the clipboard (Ctrl+V in Explorer pastes them).
#[tauri::command]
pub fn copy_files(paths: Vec<String>) -> Result<(), String> {
    let files: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).filter(|p| p.exists()).collect();
    if files.is_empty() {
        return Err("Files no longer exist".into());
    }
    arboard::Clipboard::new().and_then(|mut c| c.set().file_list(&files)).map_err(|e| e.to_string())
}

/// Preview for image files (PNG data URL), otherwise None.
#[tauri::command]
pub async fn file_preview(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        crate::clipboard::is_image_file(p).then(|| crate::clipboard::file_thumbnail(p)).flatten()
    })
    .await
    .ok()
    .flatten()
}

/// Large in-notch preview for an image file, with the original dimensions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImagePreview {
    src: String,
    width: u32,
    height: u32,
}

const PREVIEW_SIZE: u32 = 1400;

#[tauri::command]
pub async fn file_preview_large(path: String) -> Option<FileImagePreview> {
    tauri::async_runtime::spawn_blocking(move || {
        let rgba = image::open(path).ok()?.to_rgba8();
        let (width, height) = rgba.dimensions();
        let scale = (PREVIEW_SIZE as f32 / width.max(height) as f32).min(1.0);
        let (w, h) = (((width as f32 * scale) as u32).max(1), ((height as f32 * scale) as u32).max(1));
        let small = image::imageops::resize(&rgba, w, h, image::imageops::FilterType::Triangle);
        let mut png = Vec::new();
        small.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
        Some(FileImagePreview {
            src: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)),
            width,
            height,
        })
    })
    .await
    .ok()
    .flatten()
}

/// Shows the file selected in Explorer.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    Command::new("explorer").arg(format!("/select,{path}")).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn kind_of(ext: &str) -> &'static str {
    if IMAGE_IN.contains(&ext) {
        "image"
    } else if AUDIO_IN.contains(&ext) {
        "audio"
    } else if VIDEO_IN.contains(&ext) {
        "video"
    } else if crate::documents::DOC_IN.contains(&ext) {
        "document"
    } else if crate::documents::TABLE_IN.contains(&ext) {
        "table"
    } else {
        "other"
    }
}
