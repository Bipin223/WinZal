//! Shared Windows icon conversion for the mixer and the Apps tool.

use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, HICON, ICONINFO};

/// Converts an owned HBITMAP to PNG. The caller keeps ownership of the bitmap.
pub unsafe fn hbitmap_to_png(bitmap: HBITMAP) -> Option<Vec<u8>> {
    if bitmap.is_invalid() {
        return None;
    }
    let mut bm = BITMAP::default();
    if GetObjectW(
        bitmap.into(),
        std::mem::size_of::<BITMAP>() as i32,
        Some((&mut bm as *mut BITMAP).cast()),
    ) == 0
    {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight);
    if w <= 0 || h <= 0 {
        return None;
    }
    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h, // top-down
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let dc = CreateCompatibleDC(None);
    let lines = GetDIBits(dc, bitmap, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut bmi, DIB_RGB_COLORS);
    let _ = DeleteDC(dc);
    if lines == 0 {
        return None;
    }
    // BGRA -> RGBA; old icons without alpha are fully opaque.
    let no_alpha = px.chunks(4).all(|p| p[3] == 0);
    for p in px.chunks_mut(4) {
        p.swap(0, 2);
        if no_alpha {
            p[3] = 255;
        }
    }
    let img = image::RgbaImage::from_raw(w as u32, h as u32, px)?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(png)
}

/// Converts an HICON to PNG and frees the icon's helper bitmaps. The caller
/// still owns and destroys the HICON itself.
pub unsafe fn hicon_to_png(icon: HICON) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    GetIconInfo(icon, &mut info).ok()?;
    let result = hbitmap_to_png(info.hbmColor);
    if !info.hbmColor.is_invalid() {
        let _ = DeleteObject(info.hbmColor.into());
    }
    if !info.hbmMask.is_invalid() {
        let _ = DeleteObject(info.hbmMask.into());
    }
    result
}
