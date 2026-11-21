//! File helpers for Shelf and Ask: preview, open, reveal, copy, read text.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine;
use serde::Serialize;

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

