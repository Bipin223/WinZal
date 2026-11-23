//! Screenshots for the Recording tool.
//!
//! Captures the whole virtual desktop with GDI, writes a fast PNG under
//! `Pictures\Notch`, and copies the image to the clipboard. The notch is
//! excluded from the capture (without hiding, so recordings don't blink).

use std::borrow::Cow;
use std::path::PathBuf;
use std::time::Duration;

use arboard::{Clipboard, ImageData};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::RgbaImage;
use serde::Serialize;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, GetWindowDisplayAffinity, SetWindowDisplayAffinity, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, WINDOW_DISPLAY_AFFINITY,
    WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

use crate::clipboard::{local_stamp, pictures_dir};

/// Time for DWM to apply the capture exclusion (or hide the window on older
/// systems) before the desktop pixels are read.
const SETTLE: Duration = Duration::from_millis(120);

#[derive(Serialize)]
pub struct CaptureResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// Whether the image also made it onto the clipboard.
    pub copied: bool,
}

#[tauri::command]
pub async fn screen_capture(window: tauri::WebviewWindow) -> Result<CaptureResult, String> {
    // HWND is not Send; keep the raw handle and rebuild it at each Win32 call.
    let raw = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let previous = display_affinity(HWND(raw as *mut _));
    let already_excluded = previous.is_some_and(|affinity| affinity.0 == WDA_EXCLUDEFROMCAPTURE.0);
    let mut fell_back = false;

    if !already_excluded {
        // Preferred path: keep the notch on screen but out of the capture.
        // This also means an in-progress OBS recording never sees it blink.
        if unsafe { SetWindowDisplayAffinity(HWND(raw as *mut _), WDA_EXCLUDEFROMCAPTURE) }.is_ok() {
            tokio::time::sleep(SETTLE).await;
        } else {
            // Older Windows builds may reject the affinity. Hiding still
            // guarantees the island is not in its own screenshot.
            let _ = window.hide();
            fell_back = true;
            tokio::time::sleep(SETTLE).await;
        }
    }

    let result = tauri::async_runtime::spawn_blocking(capture).await;

    if fell_back {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
    } else if !already_excluded {
        let affinity = previous.unwrap_or(WDA_NONE);
        let _ = unsafe { SetWindowDisplayAffinity(HWND(raw as *mut _), affinity) };
    }

    result.map_err(|error| error.to_string())?
}

fn display_affinity(hwnd: HWND) -> Option<WINDOW_DISPLAY_AFFINITY> {
    let mut value = 0u32;
    unsafe { GetWindowDisplayAffinity(hwnd, &mut value) }
        .ok()
        .map(|_| WINDOW_DISPLAY_AFFINITY(value))
}

fn capture() -> Result<CaptureResult, String> {
    let image = grab_desktop()?;
    let (width, height) = image.dimensions();

    let dir = pictures_dir().join("Notch");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = unique_path(&dir, &local_stamp());

    let mut png = Vec::new();
    // Fast compression: a 4K frame should not stall the capture for seconds.
    let encoder = PngEncoder::new_with_quality(
        &mut png,
        CompressionType::Fast,
        FilterType::Adaptive,
    );
    image
        .write_with_encoder(encoder)
        .map_err(|error| error.to_string())?;
    std::fs::write(&path, png).map_err(|error| error.to_string())?;

    // A clipboard failure should not throw away a saved screenshot.
    let copied = Clipboard::new()
        .and_then(|mut clipboard| {
            clipboard.set_image(ImageData {
                width: width as usize,
                height: height as usize,
                bytes: Cow::Owned(image.into_raw()),
            })
        })
        .is_ok();

    Ok(CaptureResult {
        path: path.display().to_string(),
        width,
        height,
        copied,
    })
}

/// "Screenshot 2026-11-23 20-41-03.png", with a numeric suffix if the same
/// second is captured twice.
fn unique_path(dir: &std::path::Path, stamp: &str) -> PathBuf {
    let mut path = dir.join(format!("Screenshot {stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("Screenshot {stamp} ({n}).png"));
        n += 1;
    }
    path
}

/// Reads the entire virtual desktop (all monitors) into a top-down RGBA image.
fn grab_desktop() -> Result<RgbaImage, String> {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if width <= 0 || height <= 0 {
            return Err("No display is available to capture.".into());
        }

        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("Could not read the screen.".into());
        }
        let memory = CreateCompatibleDC(Some(screen));
        if memory.is_invalid() {
            let _ = ReleaseDC(None, screen);
            return Err("Could not prepare the screen capture.".into());
        }
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        if bitmap.is_invalid() {
            let _ = DeleteDC(memory);
            let _ = ReleaseDC(None, screen);
            return Err("Could not allocate the screenshot.".into());
        }
        let previous = SelectObject(memory, bitmap.into());

        let bitblt = BitBlt(
            memory,
            0,
            0,
            width,
            height,
            Some(screen),
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        );

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let lines = if bitblt.is_ok() {
            GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };

        let _ = SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        let _ = ReleaseDC(None, screen);

        if lines == 0 {
            return Err("The screen capture came back empty.".into());
        }

        // GDI hands back BGRA; the alpha channel is unused for a desktop shot.
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        RgbaImage::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| "The screenshot has invalid dimensions.".into())
    }
}
