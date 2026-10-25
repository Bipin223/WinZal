//! Dots like on iPhone: is anything using the mic or camera, or recording the screen?
//!
//! Windows tracks mic/camera/WGC use itself (Settings → Privacy → "Recent activity") under
//! `HKCU\…\CapabilityAccessManager\ConsentStore\<capability>`: one key per app with
//! `LastUsedTimeStart`/`LastUsedTimeStop`. Stop = 0 means "in use". Desktop apps
//! sit one level deeper under `NonPackaged`.
//!
//! Screen recording: `graphicsCaptureProgrammatic` / `graphicsCaptureWithoutBorder`
//! covers Windows.Graphics.Capture (Snipping Tool, OBS with WGC, Teams, …). Older
//! capture paths (DXGI desktop duplication) never write there, so OBS is additionally
//! read from its own log ("Recording Start/Stop", "Streaming Start/Stop"), and any known
//! recorder that is writing to disk/network fast right now counts as recording. That is
//! what catches OBS (including a rebranded/custom build) with DXGI capture.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ};
use windows::Win32::System::Threading::{GetProcessIoCounters, OpenProcess, IO_COUNTERS, PROCESS_QUERY_INFORMATION};

const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

#[derive(Serialize)]
pub struct Privacy {
    mic: bool,
    camera: bool,
    screen: bool,
}

#[tauri::command]
pub fn privacy_state() -> Privacy {
    let own = std::env::current_exe().ok().map(|p| p.to_string_lossy().replace('\\', "#").to_lowercase());
    let busy = |cap: &str| in_use(&format!(r"{BASE}\{cap}"), own.as_deref());
    let processes = process_list();
    let wgc = busy("graphicsCaptureProgrammatic") || busy("graphicsCaptureWithoutBorder");
    let screen = wgc || obs_recording(&processes) || recorder_writing(&processes);
    Privacy { mic: busy("microphone"), camera: busy("webcam"), screen }
}

/// Is any app under `path` (or `path\NonPackaged`) active right now?
fn in_use(path: &str, own: Option<&str>) -> bool {
    let Some(key) = open(HKEY_CURRENT_USER, path) else { return false };
    let mut active = false;
    for name in subkeys(key) {
        let Some(sub) = open(key, &name) else { continue };
        if name == "NonPackaged" {
            // Never count our own exe (the equalizer uses loopback, not the mic, but just in case).
            active |= subkeys(sub).iter().filter(|n| Some(n.to_lowercase().as_str()) != own).any(|n| open(sub, n).is_some_and(|k| running_close(k)));
        } else {
            active |= running(sub);
        }
        close(sub);
        if active {
            break;
        }
    }
    close(key);
    active
}

/// Start set and Stop = 0 → in use.
fn running(key: HKEY) -> bool {
    let start = qword(key, "LastUsedTimeStart");
    let stop = qword(key, "LastUsedTimeStop");
    start.is_some_and(|s| s > 0) && stop == Some(0)
}

fn running_close(key: HKEY) -> bool {
    let r = running(key);
    close(key);
    r
}

fn close(key: HKEY) {
    unsafe {
        let _ = RegCloseKey(key);
    }
}

fn open(parent: HKEY, path: &str) -> Option<HKEY> {
    let mut key = HKEY::default();
    let ok = unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), Some(0), KEY_READ, &mut key) } == ERROR_SUCCESS;
    ok.then_some(key)
}

fn subkeys(key: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    for i in 0.. {
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let status = unsafe { RegEnumKeyExW(key, i, Some(windows::core::PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) };
        if status != ERROR_SUCCESS {
            break;
        }
        out.push(String::from_utf16_lossy(&buf[..len as usize]));
    }
    out
}

fn qword(key: HKEY, name: &str) -> Option<u64> {
    let mut value = 0u64;
    let mut size = 8u32;
    let name = HSTRING::from(name);
    let status = unsafe { RegQueryValueExW(key, PCWSTR(name.as_ptr()), None, None, Some(&mut value as *mut u64 as *mut u8), Some(&mut size)) };
    (status == ERROR_SUCCESS).then_some(value)
}

// ── OBS / recorders ─────────────────────────────────────────────────────────

#[derive(Default)]
struct ObsCache {
    path: Option<PathBuf>,
    modified: Option<SystemTime>,
    recording: bool,
}

/// OBS writes "Recording Start/Stop" and "Streaming Start/Stop" to the current log.
/// The last marker wins. This works for every OBS-based recorder, regardless of the
/// capture method, and costs one small tail read when the log changes.
fn obs_recording(processes: &[(u32, String)]) -> bool {
    static CACHE: OnceLock<Mutex<ObsCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if !processes.iter().any(|(_, name)| is_obs(name)) {
        let mut c = cache.lock().unwrap();
        c.path = None;
        c.modified = None;
        c.recording = false;
        return false;
    }
    let Some(log) = latest_obs_log() else { return false };
    let modified = std::fs::metadata(&log).and_then(|m| m.modified()).ok();
    let mut c = cache.lock().unwrap();
    if c.path.as_ref() == Some(&log) && c.modified == modified {
        return c.recording;
    }
    let recording = tail_marker_state(&log);
    c.path = Some(log);
    c.modified = modified;
    c.recording = recording;
    recording
}

fn is_obs(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "obs64.exe" || n == "obs32.exe" || n == "obs.exe" || n.starts_with("obs-") || n.contains("mozzarella")
}

fn latest_obs_log() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let dir = PathBuf::from(appdata).join("obs-studio").join("logs");
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().is_none_or(|e| !e.eq_ignore_ascii_case("txt")) {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else { continue };
        if best.as_ref().is_none_or(|(t, _)| modified > *t) {
            best = Some((modified, path));
        }
    }
    best.map(|(_, p)| p)
}

/// Read the last 256 KB of a log and return true if the newest Start marker is a
/// recording/streaming start. OBS flushes these lines immediately.
fn tail_marker_state(path: &PathBuf) -> bool {
    let Ok(mut file) = File::open(path) else { return false };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let from = len.saturating_sub(256 * 1024);
    if file.seek(SeekFrom::Start(from)).is_err() {
        return false;
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return false;
    }
    let text = String::from_utf8_lossy(&bytes);
    for line in text.lines().rev() {
        if line.contains("Recording Start") || line.contains("Streaming Start") || line.contains("Replay Buffer Start") {
            return true;
        }
        if line.contains("Recording Stop") || line.contains("Streaming Stop") || line.contains("Replay Buffer Stop") {
            return false;
        }
    }
    false
}

/// Recorders that use DXGI duplication do not update the Windows consent store and
/// may not keep a readable log. If a known recorder is writing several MB/s right
/// now, it is recording. Idle recorders write almost nothing.
#[derive(Default)]
struct IoCache {
    at: Option<Instant>,
    rates: HashMap<u32, (u64, Instant)>,
}

fn recorder_writing(processes: &[(u32, String)]) -> bool {
    static CACHE: OnceLock<Mutex<IoCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let now = Instant::now();
    let mut c = cache.lock().unwrap();
    if c.at.is_some_and(|t| now.duration_since(t) < Duration::from_millis(900)) {
        return false;
    }
    c.at = Some(now);
    let mut active = false;
    let mut seen = Vec::new();
    for (pid, name) in processes {
        if !is_recorder(name) {
            continue;
        }
        seen.push(*pid);
        let Some(written) = writes(*pid) else { continue };
        if let Some((previous, at)) = c.rates.insert(*pid, (written, now)) {
            let seconds = now.duration_since(at).as_secs_f64().max(0.2);
            // 1.5 MB/s is far above an idle recorder's log writes and well below
            // a 1080p recording (usually 4–30 MB/s).
            if written.saturating_sub(previous) as f64 / seconds > 1_500_000.0 {
                active = true;
            }
        }
    }
    c.rates.retain(|pid, _| seen.contains(pid));
    active
}

fn is_recorder(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "obs64.exe"
        || n == "obs32.exe"
        || n == "obs.exe"
        || n.contains("mozzarella")
        || n.contains("recorder")
        || n.contains("screenrec")
        || n.contains("screen studio")
        || n == "camtasia.exe"
        || n == "camtasiastudio.exe"
        || n == "bandicam.exe"
        || n == "bdcam.exe"
        || n == "sharex.exe"
        || n == "action.exe"
        || n == "mirillis.exe"
        || n == "loom.exe"
}

fn process_list() -> Vec<(u32, String)> {
    let mut out = Vec::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else { return out };
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            out.push((entry.th32ProcessID, String::from_utf16_lossy(&entry.szExeFile[..end])));
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    out
}

fn writes(pid: u32) -> Option<u64> {
    let handle: HANDLE = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION, false, pid) }.ok()?;
    let mut counters = IO_COUNTERS::default();
    let ok = unsafe { GetProcessIoCounters(handle, &mut counters) }.is_ok();
    let _ = unsafe { CloseHandle(handle) };
    ok.then_some(counters.WriteTransferCount)
}
