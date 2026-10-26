//! Lower WebView2 memory while the notch sits closed.
//!
//! WebView2's own knob for this: `MemoryUsageTargetLevel = Low` lets the renderer trim
//! caches and page out what it doesn't need. The frontend switches it on after the notch
//! has been closed for a while and back to normal as soon as the cursor touches it
//! (peek), so the hover delay covers paging memory back in before it opens.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA};

static TRIMMING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn memory_low(low: bool, window: WebviewWindow) {
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        // Older WebView2 runtimes (< 1.0.2210) don't have it; then nothing changes.
        let Ok(core) = core.cast::<ICoreWebView2_19>() else { return };
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        let _ = core.SetMemoryUsageTargetLevel(level);
    });

    if low {
        trim_async();
    }
}

/// Page out the WebView2 tree without changing the memory target. Used periodically
/// while the notch is open; the next paint pages the hot bits back in.
#[tauri::command]
pub fn trim_memory() {
    trim_async();
}

fn trim_async() {
    if TRIMMING.swap(true, Ordering::AcqRel) {
        return;
    }
    // The target level only lets Chromium trim; it may keep a large working set.
    // Paging the WebView2 tree out keeps idle RAM low. It pages back in on the next
    // hover/paint (covered by the hover delay).
    std::thread::spawn(|| {
        trim_working_sets();
        TRIMMING.store(false, Ordering::Release);
    });
}

fn trim_working_sets() {
    let me = sysinfo::Pid::from_u32(std::process::id());
    // `new_all` also refreshes CPU/memory/disks; one process refresh is enough
    // to build the parent map and keeps this 20 s job cheap.
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut pids = Vec::new();
    collect_children(&sys, me, &mut pids);
    // Descendants first, our own process last.
    pids.push(std::process::id());

    for pid in pids {
        let Ok(handle) = (unsafe {
            OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, false, pid)
        }) else {
            continue;
        };
        unsafe {
            let _ = EmptyWorkingSet(handle);
            let _ = CloseHandle(handle);
        }
    }
}

fn collect_children(sys: &sysinfo::System, parent: sysinfo::Pid, out: &mut Vec<u32>) {
    for (pid, process) in sys.processes() {
        if process.parent() == Some(parent) {
            out.push(pid.as_u32());
            collect_children(sys, *pid, out);
        }
    }
}
