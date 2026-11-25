//! Screenshots for the Recording tool.
//!
//! Captures the whole virtual desktop with GDI, writes a fast PNG under
//! `Pictures\Notch`, and copies the image to the clipboard. The notch is
//! excluded from the capture (without hiding, so recordings don't blink).

use std::borrow::Cow;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use arboard::{Clipboard, ImageData};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::RgbaImage;
use serde::Serialize;
use tauri::Manager;
use windows::core::w;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    SRCCOPY,
};
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetSystemMetrics, GetWindowDisplayAffinity, SetForegroundWindow,
    SetWindowDisplayAffinity, SetWindowPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, WINDOW_DISPLAY_AFFINITY, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

use crate::clipboard::{local_stamp, pictures_dir};

/// Time for DWM to apply the capture exclusion (or hide the window on older
/// systems) before the desktop pixels are read.
const SETTLE: Duration = Duration::from_millis(120);
/// Hide cmd.exe's console when launching the Snipping Tool URI.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct CaptureResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// Whether the image also made it onto the clipboard.
    pub copied: bool,
}

#[tauri::command]
pub async fn screen_capture(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<CaptureResult, String> {
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
            app.state::<crate::display::ShowGuard>().hold(true);
            let _ = window.hide();
            fell_back = true;
            tokio::time::sleep(SETTLE).await;
        }
    }

    let result = tauri::async_runtime::spawn_blocking(capture).await;

    if fell_back {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        app.state::<crate::display::ShowGuard>().hold(false);
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

#[tauri::command]
pub async fn screen_capture_region(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<CaptureResult, String> {
    let raw = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let previous = display_affinity(HWND(raw as *mut _));
    // Keep the notch on screen, below the snip overlay, but out of the actual
    // pixels. WDA_EXCLUDEFROMCAPTURE is honored by Snipping Tool.
    let _ = unsafe { SetWindowDisplayAffinity(HWND(raw as *mut _), WDA_EXCLUDEFROMCAPTURE) };
    app.state::<crate::display::ShowGuard>().hold(true);
    let _ = window.show();
    let _ = window.set_always_on_top(false);
    let _ = unsafe {
        SetWindowPos(
            HWND(raw as *mut _),
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
    tokio::time::sleep(Duration::from_millis(180)).await;

    let result = tauri::async_runtime::spawn_blocking(capture_region).await;

    let affinity = previous.unwrap_or(WDA_NONE);
    let _ = unsafe { SetWindowDisplayAffinity(HWND(raw as *mut _), affinity) };
    let _ = window.set_always_on_top(true);
    let _ = unsafe {
        SetWindowPos(
            HWND(raw as *mut _),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
    app.state::<crate::display::ShowGuard>().hold(false);
    result.map_err(|error| error.to_string())?
}

/// `ms-screenclip:` sometimes opens the overlay without taking focus, because
/// it was launched by a just-hidden topmost window. The overlay then draws but
/// its crosshair does not receive the pointer, which looks like a frozen cursor.
/// Bring it forward explicitly; if the title is localized, the plain launch
/// still works and this simply times out.
/// `ms-screenclip:` sometimes opens the overlay without taking focus, because
/// it was launched by a just-hidden topmost window. The overlay then draws but
/// its crosshair does not receive the pointer, which looks like a frozen cursor.
/// Bring it forward explicitly; if the title is localized, the plain launch
/// still works and this simply times out.
fn focus_snip_overlay() {
    for _ in 0..25 {
        if let Ok(hwnd) = unsafe { FindWindowW(None, w!("Snipping Tool Overlay")) } {
            if !hwnd.is_invalid() {
                let _ = unsafe { SetForegroundWindow(hwnd) };
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}

fn capture_region() -> Result<CaptureResult, String> {
    let before = unsafe { GetClipboardSequenceNumber() };
    Command::new("cmd")
        .args(["/C", "start", "", "ms-screenclip:"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("Could not open the screen selector: {error}"))?;
    focus_snip_overlay();

    let started = Instant::now();
    // Esc is the Snipping Tool's cancel key. Polling it lets the notch come
    // back immediately instead of staying hidden until a timeout.
    while started.elapsed() < Duration::from_secs(40) {
        let esc = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) };
        if (esc as u16) & 0x8000 != 0 {
            return Err("Screen capture cancelled.".into());
        }
        std::thread::sleep(Duration::from_millis(80));
        if unsafe { GetClipboardSequenceNumber() } == before {
            continue;
        }
        // Snipping Tool sometimes sets a file list first; give the bitmap a
        // moment to land, then take the image.
        std::thread::sleep(Duration::from_millis(120));
        let Ok(mut clipboard) = Clipboard::new() else { continue };
        let Ok(image) = clipboard.get_image() else { continue };
        let Some(rgba) = RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        ) else {
            return Err("The selected capture is unreadable.".into());
        };
        return save_image(rgba, true, "Region");
    }
    Err("Screen capture cancelled.".into())
}

fn capture() -> Result<CaptureResult, String> {
    let image = grab_desktop()?;
    save_image(image, false, "Screenshot")
}

fn save_image(mut image: RgbaImage, already_copied: bool, prefix: &str) -> Result<CaptureResult, String> {
    let (width, height) = image.dimensions();
    let dir = pictures_dir().join("Screenshots");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = unique_path(&dir, prefix, &local_stamp());

    // Region captures come from the clipboard with premultiplied/zero alpha.
    if already_copied {
        for pixel in image.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }

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

    // A clipboard failure should not throw away a saved screenshot. Retry:
    // another app (or our own clipboard watcher) can hold the clipboard open
    // for a few milliseconds right after the capture.
    let copied = already_copied || copy_image(&image);
    Ok(CaptureResult {
        path: path.display().to_string(),
        width,
        height,
        copied,
    })
}

fn copy_image(image: &RgbaImage) -> bool {
    let (width, height) = image.dimensions();
    let bytes = image.as_raw();
    for attempt in 0..4 {
        if let Ok(mut clipboard) = Clipboard::new() {
            if clipboard
                .set_image(ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(bytes.to_vec()),
                })
                .is_ok()
            {
                return true;
            }
        }
        if attempt < 3 {
            std::thread::sleep(Duration::from_millis(70));
        }
    }
    false
}

/// "Screenshot 2026-11-23 20-41-03.png", with a numeric suffix if the same
/// second is captured twice.
fn unique_path(dir: &std::path::Path, prefix: &str, stamp: &str) -> PathBuf {
    let mut path = dir.join(format!("{prefix} {stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{prefix} {stamp} ({n}).png"));
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
