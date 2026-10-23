//! Quick drop: real file paths for drag and drop from Explorer.
//!
//! Two paths, because WebView2's own drop handling differs between runtimes:
//! 1. Native OLE drop targets on the notch HWND and every WebView2 child. This is
//!    the reliable path: files are read as `CF_HDROP` and never touch the page.
//! 2. WebView2's `postMessageWithAdditionalObjects` bridge, used when the page does
//!    receive an HTML5 drop (`src/platform/drop.ts`). Kept as a fallback.
//!
//! Both end in the same `notch://drop` event with real paths.

use std::cell::Cell;
use std::io::Write;

use tauri::{Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
use webview2_com::WebMessageReceivedEventHandler;
use windows::core::{implement, Interface, Ref, BOOL, PWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINTL};
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, RevokeDragDrop, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragFinish, DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

/// Message the frontend sends with the files (see `src/platform/drop.ts`).
const MESSAGE: &str = "notch-drop";

/// Opt-in diagnostics: set `WINZAL_DROP_LOG=1` to append drop events to
/// `%TEMP%\winzal-drop.log`. Off by default and free when unset.
pub fn trace(message: &str) {
    if std::env::var_os("WINZAL_DROP_LOG").is_none() {
        return;
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("winzal-drop.log")) {
        let _ = writeln!(file, "{message}");
    }
}

pub fn install(window: &WebviewWindow) {
    install_bridge(window);
    install_native(window);
}

/// WebView2 bridge: the page posts File objects, here they become real paths.
fn install_bridge(window: &WebviewWindow) {
    let target = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let target = target.clone();
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut text = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut text).is_err() || text.is_null() {
                return Ok(());
            }
            let is_drop = text.to_string().is_ok_and(|t| t == MESSAGE);
            windows::Win32::System::Com::CoTaskMemFree(Some(text.0 as _));
            if !is_drop {
                return Ok(());
            }
            let paths = paths(&args);
            trace(&format!("webview message paths={}", paths.len()));
            if !paths.is_empty() {
                let _ = target.emit("notch://drop", paths);
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

unsafe fn paths(args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else { return out };
    let Ok(objects) = args.AdditionalObjects() else { return out };
    let mut count = 0u32;
    if objects.Count(&mut count).is_err() {
        return out;
    }
    for i in 0..count {
        let Some(file) = objects.GetValueAtIndex(i).ok().and_then(|o| o.cast::<ICoreWebView2File>().ok()) else { continue };
        let mut path = PWSTR::null();
        if file.Path(&mut path).is_ok() && !path.is_null() {
            if let Ok(p) = path.to_string() {
                out.push(p);
            }
            windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as _));
        }
    }
    out
}

// ── Native OLE drop target ────────────────────────────────────────────────────

#[implement(IDropTarget)]
struct NativeDrop {
    window: WebviewWindow,
    valid: Cell<bool>,
}

impl NativeDrop {
    fn can_drop(data: Ref<'_, IDataObject>) -> bool {
        unsafe { hdrop(data).is_some() }
    }
}

impl IDropTarget_Impl for NativeDrop_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        _point: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let files = NativeDrop::can_drop(data);
        trace(&format!("native DragEnter files={files}"));
        self.valid.set(files);
        unsafe { *effect = if files { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        if files {
            let _ = self.window.emit("notch://drop-enter", ());
        }
        Ok(())
    }

    fn DragOver(&self, _keys: MODIFIERKEYS_FLAGS, _point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        unsafe { *effect = if self.valid.get() { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        trace("native DragLeave");
        if self.valid.replace(false) {
            let _ = self.window.emit("notch://drop-leave", ());
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        _point: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let was_valid = self.valid.replace(false);
        let mut files = Vec::new();
        if let Some(hdrop) = unsafe { hdrop(data) } {
            unsafe { drag_paths(hdrop, &mut files) };
            unsafe { DragFinish(hdrop) };
        }
        unsafe { *effect = if was_valid && !files.is_empty() { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        trace(&format!("native Drop files={} valid={was_valid}", files.len()));
        if !files.is_empty() {
            let _ = self.window.emit("notch://drop", files);
        } else if was_valid {
            let _ = self.window.emit("notch://drop-leave", ());
        }
        Ok(())
    }
}

/// Returns the HDROP if the data object contains files. The caller owns it.
unsafe fn hdrop(data: Ref<'_, IDataObject>) -> Option<HDROP> {
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let medium = unsafe { data.as_ref()?.GetData(&format) }.ok()?;
    Some(HDROP(unsafe { medium.u.hGlobal.0 } as _))
}

unsafe fn drag_paths(hdrop: HDROP, out: &mut Vec<String>) {
    let count = unsafe { DragQueryFileW(hdrop, 0xFFFF_FFFF, None) };
    for i in 0..count {
        let len = unsafe { DragQueryFileW(hdrop, i, None) } as usize;
        let mut buf = vec![0u16; len + 1];
        unsafe { DragQueryFileW(hdrop, i, Some(&mut buf)) };
        out.push(String::from_utf16_lossy(&buf[..len]));
    }
}

/// Register our target on the window and every child (WebView2 creates several).
/// Runs on the UI thread through `with_webview`, because OLE delivers drops to the
/// thread that registered the target.
fn install_native(window: &WebviewWindow) {
    let target = window.clone();
    let _ = window.with_webview(move |_webview| unsafe {
        let Ok(hwnd) = target.hwnd() else { return };
        let top = HWND(hwnd.0);
        let _ = windows::Win32::System::Ole::OleInitialize(None);
        let drop: IDropTarget = NativeDrop { window: target.clone(), valid: Cell::new(false) }.into();
        // Keep the COM object alive for the window's lifetime. Registering a new
        // target on the same HWND replaces the old one, so re-installs are safe.
        let drop = Box::leak(Box::new(drop));

        register(top, drop);
        let mut count = 0usize;
        {
            let mut callback = |child: HWND| {
                register(child, drop);
                count += 1;
                true
            };
            let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
            let ptr = &mut trait_obj as *mut _ as *mut std::ffi::c_void;
            let _ = EnumChildWindows(
                Some(top),
                Some(enum_callback),
                LPARAM(ptr as isize),
            );
        }
        trace(&format!("native install top={top:?} children={count}"));
    });
}

unsafe fn register(hwnd: HWND, target: &IDropTarget) {
    // WebView2 may already own a target on this child; replace it with ours.
    let revoked = unsafe { RevokeDragDrop(hwnd) };
    let registered = unsafe { RegisterDragDrop(hwnd, target) };
    trace(&format!("native register {hwnd:?} revoke={} register={}", revoked.is_ok(), registered.is_ok()));
}

unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let callback = unsafe { &mut *(lparam.0 as *mut &mut dyn FnMut(HWND) -> bool) };
    callback(hwnd).into()
}

/// Called by the frontend once the page is up, to catch WebView2 children that
/// appeared after setup.
#[tauri::command]
pub fn drop_reinstall(window: WebviewWindow) {
    install_native(&window);
}
