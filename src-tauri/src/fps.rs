//! FPS for gaming mode: counts present calls of the foreground process via ETW
//! (like PresentMon, heavily simplified).
//!
//! - Sources: Microsoft-Windows-DXGI (Present_Start, PresentMultiplaneOverlay_Start),
//!   Microsoft-Windows-D3D9 and Microsoft-Windows-DxgKrnl (present/history/blit in the
//!   kernel). Every API goes through DxgKrnl, so OpenGL (e.g. Minecraft Java) and Vulkan
//!   count too.
//! - One frame can fire several of these events depending on the API, so each event
//!   kind is counted separately and the highest count wins, never the sum.
//! - Real-time ETW needs admin rights or membership in "Performance Log Users".
//!   Instead of forcing a sign-out, the notch starts a tiny elevated helper
//!   (`WinZal.exe --fps-helper <pid>`, one UAC prompt). The helper owns the ETW session
//!   and publishes per-process present counters in shared memory; the normal,
//!   non-elevated notch only reads them. It stops with the app.
//! - The session only runs while polled (`IDLE`). It would survive a crash otherwise,
//!   so a leftover session with the same name is stopped on start.
//! - Direct ETW remains as a fallback when the app itself runs elevated or the account
//!   is already in "Performance Log Users" (e.g. after the old unlock flow).

use std::collections::HashMap;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{w, GUID, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_CANCELLED, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE, WIN32_ERROR,
};
use windows::Win32::System::Diagnostics::Etw::{
    CloseTrace, ControlTraceW, EnableTraceEx2, OpenTraceW, ProcessTrace, StartTraceW, CONTROLTRACE_HANDLE, EVENT_CONTROL_CODE_ENABLE_PROVIDER,
    EVENT_RECORD, EVENT_TRACE_CONTROL_STOP, EVENT_TRACE_LOGFILEW, EVENT_TRACE_PROPERTIES, EVENT_TRACE_REAL_TIME_MODE, PROCESSTRACE_HANDLE,
    PROCESS_TRACE_MODE_EVENT_RECORD, PROCESS_TRACE_MODE_REAL_TIME, WNODE_FLAG_TRACED_GUID,
};
use windows::Win32::System::Memory::{
    CreateFileMappingW, MapViewOfFile, OpenFileMappingW, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE,
};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, SW_HIDE};

const SESSION: &str = "NotchFps";
const HELPER_SESSION: &str = "NotchFpsHelper";
const HELPER_TASK: &str = "WinZalFpsHelper";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Fixed session GUID.
const SESSION_GUID: GUID = GUID::from_u128(0x6f3e2a41_8c5d_4b7e_9a12_4c4e6f746368);
/// The helper must not reuse the direct session's GUID: StartTrace treats a
/// second session with the same GUID as ERROR_ALREADY_EXISTS even if the name
/// differs, which made the helper exit immediately when direct ETW was active.
const HELPER_SESSION_GUID: GUID = GUID::from_u128(0x6f3e2a41_8c5d_4b7e_9a12_4c4e6f746369);
const DXGI: GUID = GUID::from_u128(0xca11c036_0102_4a2d_a6ad_f03cfed5d3c9);
const D3D9: GUID = GUID::from_u128(0x783aca0a_790e_4d7f_8451_aa850511c6b9);
const DXGKRNL: GUID = GUID::from_u128(0x802ec45a_1e99_4b83_9920_87c98277ba9d);
/// DXGI: Present_Start, PresentMultiplaneOverlay_Start. D3D9: Present_Start.
const DXGI_PRESENT: [u16; 2] = [42, 55];
const D3D9_PRESENT: u16 = 1;
/// DxgKrnl (Keyword "Present"): Blit_Info, PresentHistory_Start, Present_Info,
/// PresentHistoryDetailed_Start. All logged on the presenting process's thread.
const KMT_PRESENT: [u16; 4] = [166, 171, 184, 215];
const KMT_KEYWORD_PRESENT: u64 = 0x800_0000;
/// Stop the session after this long without a poll.
const IDLE: Duration = Duration::from_secs(10);
const TRACE_LEVEL_INFORMATION: u8 = 4;
/// Retry errors ("no-admin", "failed") after this long, e.g. after unlocking.
const RETRY: Duration = Duration::from_secs(5);
/// All event kinds we count separately. Max of the deltas is the FPS.
const KINDS: usize = 7;
const SLOTS: usize = 512;
const SHARED_NAME: &str = "Local\\WinZalFps-v2";
const SHARED_MAGIC: u32 = 0x575A_4650; // WZFP
const SHARED_VERSION: u32 = 2;
const ERR_NO_ADMIN: u32 = 1;
const ERR_FAILED: u32 = 2;

#[derive(Default)]
struct Counter {
    /// Presents per (process, event kind) since the last poll (direct mode).
    counts: HashMap<(u32, u16), u32>,
    since: Option<Instant>,
    wanted_at: Option<Instant>,
    running: bool,
    error: Option<&'static str>,
    error_at: Option<Instant>,
    /// Smoothed FPS of the last polled process.
    last: Option<(u32, f64)>,
    helper: Option<HelperSample>,
}

#[derive(Clone, Copy)]
struct HelperSample {
    pid: u32,
    epoch: u32,
    counts: [u64; KINDS],
    at: Instant,
}

fn counter() -> &'static Mutex<Counter> {
    static C: OnceLock<Mutex<Counter>> = OnceLock::new();
    C.get_or_init(Default::default)
}

#[derive(Serialize)]
pub struct Fps {
    fps: Option<f64>,
    /// "no-admin" | "failed"
    error: Option<&'static str>,
}

pub fn init() {
    if let Some(shared) = shared() {
        unsafe {
            (*shared).main_pid.store(GetCurrentProcessId(), Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn gaming_fps() -> Fps {
    let mut c = counter().lock().unwrap();
    c.wanted_at = Some(Instant::now());
    let pid = foreground_pid();

    // Elevated helper first: it can trace without this process being admin.
    if let Some(result) = helper_fps(&mut c, pid) {
        return result;
    }

    if c.error.is_some() && c.error_at.is_none_or(|t| t.elapsed() > RETRY) {
        c.error = None;
    }
    if !c.running && c.error.is_none() {
        c.running = true;
        c.since = Some(Instant::now());
        thread::spawn(run);
        return Fps { fps: None, error: None };
    }
    if let Some(error) = c.error {
        return Fps { fps: None, error: Some(error) };
    }

    let elapsed = c.since.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
    if elapsed < 0.25 {
        return Fps { fps: c.last.filter(|(p, _)| *p == pid).map(|(_, f)| f), error: None };
    }
    let frames = c.counts.iter().filter(|((p, _), _)| *p == pid).map(|(_, n)| *n).max().unwrap_or(0) as f64;
    c.counts.clear();
    c.since = Some(Instant::now());
    let now = frames / elapsed;
    // Smooth a little so the number doesn't flicker; a new process starts fresh.
    let fps = match c.last {
        Some((p, prev)) if p == pid && now > 0.0 => prev * 0.4 + now * 0.6,
        _ => now,
    };
    c.last = Some((pid, fps));
    Fps { fps: (fps > 0.0).then_some(fps), error: None }
}

fn foreground_pid() -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid)) };
    pid
}

// ── Shared memory (main ‹—› elevated helper) ────────────────────────────────

#[repr(C)]
struct FpsEntry {
    pid: AtomicU32,
    epoch: AtomicU32,
    last: AtomicU64,
    counts: [AtomicU64; KINDS],
}

#[repr(C)]
struct FpsShared {
    magic: AtomicU32,
    version: AtomicU32,
    helper_pid: AtomicU32,
    main_pid: AtomicU32,
    heartbeat: AtomicU64,
    error: AtomicU32,
    stop: AtomicU32,
    /// °C from the elevated Lenovo WMI helper; 0 = unavailable.
    cpu_temp: AtomicU32,
    gpu_temp: AtomicU32,
    temp_at: AtomicU64,
    /// Lenovo thermal mode read by the elevated helper: 1 quiet … 4 custom.
    lenovo_mode: AtomicU32,
    lenovo_mode_at: AtomicU64,
    /// Lenovo active-cooling / fan boost: 0 off, 1 on.
    fan_cooling: AtomicU32,
    fan_cooling_at: AtomicU64,
    /// WinZal Custom selected: performance mode + active cooling applied.
    custom_active: AtomicU32,
    /// Power-mode request from the notch: seq << 8 | mode (0 = none).
    power_req: AtomicU32,
    /// Helper answer: seq << 8 | (1 ok, 2 failed) (0 = idle).
    power_ack: AtomicU32,
    /// Elevated helper saw three quick clicks; the notch consumes this to wake.
    wake: AtomicU32,
    entries: [FpsEntry; SLOTS],
}

static SHARED: OnceLock<usize> = OnceLock::new();
static HELPER_SHARED: AtomicPtr<FpsShared> = AtomicPtr::new(std::ptr::null_mut());

fn shared() -> Option<*mut FpsShared> {
    if let Some(p) = SHARED.get() {
        return Some(*p as *mut FpsShared);
    }
    static INIT: Mutex<()> = Mutex::new(());
    let _guard = INIT.lock().unwrap();
    if let Some(p) = SHARED.get() {
        return Some(*p as *mut FpsShared);
    }
    let p = unsafe { open_mapping(false)? };
    let _ = SHARED.set(p as usize);
    Some(p)
}

unsafe fn open_mapping(helper: bool) -> Option<*mut FpsShared> {
    let size = std::mem::size_of::<FpsShared>();
    let name = wide(SHARED_NAME);
    let create = || unsafe { CreateFileMappingW(INVALID_HANDLE_VALUE, None, PAGE_READWRITE, 0, size as u32, PCWSTR(name.as_ptr())) };
    let open = || unsafe { OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, PCWSTR(name.as_ptr())) };
    let handle = if helper {
        // The normal notch created the mapping; do not create a second, disconnected one.
        open().or_else(|_| create())
    } else {
        create().or_else(|_| open())
    }
    .ok()?;
    let view: MEMORY_MAPPED_VIEW_ADDRESS = unsafe { MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, size) };
    if view.Value.is_null() {
        let _ = unsafe { CloseHandle(handle) };
        return None;
    }
    // Keep the mapping handle and view alive for the whole process; this is a
    // one-time ~37 KB section.
    let shared = view.Value as *mut FpsShared;
    unsafe {
        let _ = (*shared).magic.compare_exchange(0, SHARED_MAGIC, Ordering::AcqRel, Ordering::Relaxed);
        (*shared).version.store(SHARED_VERSION, Ordering::Relaxed);
        if helper {
            (*shared).helper_pid.store(GetCurrentProcessId(), Ordering::Relaxed);
        } else {
            (*shared).main_pid.store(GetCurrentProcessId(), Ordering::Relaxed);
        }
    }
    // HANDLE is just a raw value; not closing it keeps the named mapping alive for
    // the whole process lifetime (one-time ~37 KB section).
    let _ = handle;
    Some(shared)
}

fn helper_log(message: &str) {
    if std::env::var_os("WINZAL_HELPER_LOG").is_none() {
        return;
    }
    let path = std::env::temp_dir().join("winzal-helper.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

/// Did the elevated helper see a triple-click? Consumed once by the notch.
pub(crate) fn take_wake() -> bool {
    shared().is_some_and(|shared| unsafe { (*shared).wake.swap(0, Ordering::Relaxed) != 0 })
}

fn helper_alive(shared: *mut FpsShared) -> bool {
    let heartbeat = unsafe { (*shared).heartbeat.load(Ordering::Relaxed) };
    heartbeat != 0 && unsafe { GetTickCount64() }.saturating_sub(heartbeat) < 5000
}

/// CPU/GPU temperatures published by the elevated helper. `None` when the helper
/// is not running or the Lenovo WMI provider is unavailable.
pub(crate) fn helper_temps() -> (Option<u32>, Option<u32>) {
    let Some(shared) = shared() else { return (None, None) };
    if !helper_alive(shared) {
        return (None, None);
    }
    unsafe {
        let at = (*shared).temp_at.load(Ordering::Relaxed);
        if at == 0 || GetTickCount64().saturating_sub(at) > 6000 {
            return (None, None);
        }
        let cpu = (*shared).cpu_temp.load(Ordering::Relaxed);
        let gpu = (*shared).gpu_temp.load(Ordering::Relaxed);
        ((cpu > 0).then_some(cpu), (gpu > 0).then_some(gpu))
    }
}

/// Is the elevated helper alive (FPS / temperatures / Lenovo thermal modes)?
pub(crate) fn helper_ready() -> bool {
    shared().is_some_and(helper_alive)
}

/// Lenovo thermal mode reported by the helper: 1 quiet, 2 balanced,
/// 3 performance, 4 custom. `None` when the helper is not running or the
/// machine does not expose Lenovo's GameZone provider.
pub(crate) fn lenovo_mode() -> Option<u8> {
    let shared = shared()?;
    if !helper_alive(shared) {
        return None;
    }
    unsafe {
        let at = (*shared).lenovo_mode_at.load(Ordering::Relaxed);
        if at == 0 || GetTickCount64().saturating_sub(at) > 6000 {
            return None;
        }
        let mode = (*shared).lenovo_mode.load(Ordering::Relaxed);
        ((1..=3).contains(&mode) || mode == 0xE0 || mode == 0xFF).then_some(mode as u8)
    }
}

/// Lenovo active-cooling flag: 0 off, 1 on. `None` when unavailable.
pub(crate) fn lenovo_fan_cooling() -> Option<u8> {
    let shared = shared()?;
    if !helper_alive(shared) {
        return None;
    }
    unsafe {
        let at = (*shared).fan_cooling_at.load(Ordering::Relaxed);
        if at == 0 || GetTickCount64().saturating_sub(at) > 6000 {
            return None;
        }
        Some((*shared).fan_cooling.load(Ordering::Relaxed).min(1) as u8)
    }
}

/// True while WinZal Custom (performance + active cooling) is applied.
pub(crate) fn lenovo_custom_active() -> bool {
    let Some(shared) = shared() else { return false };
    if !helper_alive(shared) {
        return false;
    }
    unsafe { (*shared).custom_active.load(Ordering::Relaxed) == 1 }
}

/// Ask the elevated helper to set Lenovo's thermal mode. Blocks until the
/// helper answers (custom WMI calls usually take well under a second).
pub(crate) fn lenovo_set_mode(mode: u8) -> Result<(), String> {
    let shared = shared().ok_or_else(|| "helper".to_string())?;
    if !helper_alive(shared) {
        return Err("helper".into());
    }
    static SEQ: AtomicU32 = AtomicU32::new(1);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed) & 0x00FF_FFFF;
    let request = (seq << 8) | mode as u32;
    unsafe {
        (*shared).power_ack.store(0, Ordering::Relaxed);
        (*shared).power_req.store(request, Ordering::Relaxed);
    }
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        let ack = unsafe { (*shared).power_ack.load(Ordering::Relaxed) };
        if ack >> 8 == seq {
            unsafe {
                let _ = (*shared).power_req.compare_exchange(request, 0, Ordering::Relaxed, Ordering::Relaxed);
            }
            return if ack & 0xFF == 1 { Ok(()) } else { Err("failed".into()) };
        }
        thread::sleep(Duration::from_millis(40));
    }
    unsafe {
        let _ = (*shared).power_req.compare_exchange(request, 0, Ordering::Relaxed, Ordering::Relaxed);
    }
    Err("timeout".into())
}

/// Reads the helper counters for the foreground process. `None` means "no helper";
/// the caller then falls back to direct ETW.
fn helper_fps(c: &mut Counter, pid: u32) -> Option<Fps> {
    let shared = shared()?;
    if !helper_alive(shared) {
        c.helper = None;
        return None;
    }
    let error = unsafe { (*shared).error.load(Ordering::Relaxed) };
    if error == ERR_NO_ADMIN {
        return Some(Fps { fps: None, error: Some("no-admin") });
    }
    if error != 0 {
        return Some(Fps { fps: None, error: Some("failed") });
    }
    if pid == 0 {
        return Some(Fps { fps: None, error: None });
    }
    let shared = unsafe { &*shared };
    let entry = find_entry(shared, pid);
    if entry.pid.load(Ordering::Relaxed) != pid {
        c.helper = None;
        c.last = None;
        return Some(Fps { fps: None, error: None });
    }
    let epoch = entry.epoch.load(Ordering::Relaxed);
    let mut counts = [0u64; KINDS];
    for (slot, value) in counts.iter_mut().zip(entry.counts.iter()) {
        *slot = value.load(Ordering::Relaxed);
    }
    let now = Instant::now();
    if let Some(prev) = c.helper {
        if prev.pid == pid && prev.epoch == epoch {
            let elapsed = now.duration_since(prev.at).as_secs_f64();
            if elapsed < 0.2 {
                return Some(Fps { fps: c.last.filter(|(p, _)| *p == pid).map(|(_, f)| f), error: None });
            }
            let frames = (0..KINDS).map(|i| counts[i].saturating_sub(prev.counts[i])).max().unwrap_or(0) as f64;
            let value = frames / elapsed;
            let fps = match c.last {
                Some((p, old)) if p == pid && value > 0.0 => old * 0.4 + value * 0.6,
                _ => value,
            };
            c.last = Some((pid, fps));
            c.helper = Some(HelperSample { pid, epoch, counts, at: now });
            return Some(Fps { fps: (fps > 0.0).then_some(fps), error: None });
        }
    }
    c.helper = Some(HelperSample { pid, epoch, counts, at: now });
    if c.last.is_none_or(|(p, _)| p != pid) {
        c.last = None;
    }
    Some(Fps { fps: c.last.filter(|(p, _)| *p == pid).map(|(_, f)| f), error: None })
}

fn find_entry<'a>(shared: &'a FpsShared, pid: u32) -> &'a FpsEntry {
    let start = (pid as usize).wrapping_mul(2_654_435_761) % SLOTS;
    for i in 0..SLOTS {
        let entry = &shared.entries[(start + i) % SLOTS];
        let current = entry.pid.load(Ordering::Relaxed);
        if current == pid {
            return entry;
        }
        if current == 0 && entry.pid.compare_exchange(0, pid, Ordering::AcqRel, Ordering::Relaxed).is_ok() {
            entry.epoch.fetch_add(1, Ordering::AcqRel);
            for count in &entry.counts {
                count.store(0, Ordering::Relaxed);
            }
            entry.last.store(0, Ordering::Relaxed);
            return entry;
        }
    }
    &shared.entries[start]
}

// ── Elevated helper ─────────────────────────────────────────────────────────

/// Creates the logon task once (from the already elevated helper) so the user
/// only approves UAC on the first unlock. The task starts `--fps-helper 0`,
/// which waits for the notch process and then owns the ETW session.
fn ensure_helper_task(exe: &Path) {
    let exists = Command::new("schtasks")
        .args(["/Query", "/TN", HELPER_TASK])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if exists {
        return;
    }

    let user = match (std::env::var("USERDOMAIN"), std::env::var("USERNAME")) {
        (Ok(domain), Ok(name)) if !domain.is_empty() => format!("{domain}\\{name}"),
        (_, Ok(name)) => name,
        _ => return,
    };
    let exe = exe.display().to_string().replace('\'', "''");
    let user = user.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'\r\n\
         $action=New-ScheduledTaskAction -Execute '{exe}' -Argument '--fps-helper 0'\r\n\
         $trigger=New-ScheduledTaskTrigger -AtLogOn -User '{user}'\r\n\
         $principal=New-ScheduledTaskPrincipal -UserId '{user}' -LogonType Interactive -RunLevel Highest\r\n\
         $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew\r\n\
         Register-ScheduledTask -TaskName '{HELPER_TASK}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force\r\n"
    );
    let dir = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("app.winzal");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("install-fps-task.ps1");
    if std::fs::write(&path, script).is_ok() {
        let _ = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"])
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = std::fs::remove_file(&path);
    }
}

/// Starts the helper elevated (one UAC prompt) and waits until its ETW session is live.
fn start_helper_elevated() -> &'static str {
    let Some(shared) = shared() else { return "failed" };
    if helper_alive(shared) {
        return "ok";
    }
    unsafe {
        (*shared).heartbeat.store(0, Ordering::Relaxed);
        (*shared).error.store(0, Ordering::Relaxed);
        (*shared).stop.store(0, Ordering::Relaxed);
    }
    // Stop a direct session from an earlier poll; both use the same session GUID.
    stop_session(&wide(SESSION), SESSION_GUID);

    let Ok(exe) = std::env::current_exe() else { return "failed" };
    let exe: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
    let params = wide(&format!("--fps-helper {}", std::process::id()));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(exe.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        if let Err(e) = ShellExecuteExW(&mut info) {
            return if e.code() == ERROR_CANCELLED.to_hresult() { "cancelled" } else { "failed" };
        }
        if !info.hProcess.is_invalid() {
            let _ = CloseHandle(info.hProcess);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(150));
        unsafe {
            if (*shared).heartbeat.load(Ordering::Relaxed) != 0 {
                // A direct session from an earlier poll would double the trace.
                stop_session(&wide(SESSION), SESSION_GUID);
                return "ok";
            }
            match (*shared).error.load(Ordering::Relaxed) {
                ERR_NO_ADMIN | ERR_FAILED => return "failed",
                _ => {}
            }
        }
    }
    "failed"
}

/// Start the pre-created logon task without UAC. Returns false when the task is
/// missing or the current user is not allowed to run it.
fn start_helper_from_task() -> bool {
    if helper_ready() {
        return true;
    }
    let ran = Command::new("schtasks")
        .args(["/Run", "/TN", HELPER_TASK])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !ran {
        return false;
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(150));
        if helper_ready() {
            return true;
        }
    }
    false
}

fn start_helper() -> &'static str {
    if helper_ready() {
        return "ok";
    }
    if start_helper_from_task() {
        return "ok";
    }
    start_helper_elevated()
}

/// Starts the task-only helper at app startup, never showing a UAC prompt.
pub fn start_helper_task_only() -> bool {
    helper_ready() || start_helper_from_task()
}

/// Custom power also needs Lenovo's elevated thermal mode. Try the existing
/// task first, then fall back to the one-time UAC prompt.
pub(crate) fn ensure_helper_for_power() -> bool {
    start_helper() == "ok"
}

/// Is the elevated FPS helper alive right now? If the logon task exists, this
/// also restarts it silently after an app restart.
#[tauri::command]
pub async fn fps_helper_ready() -> bool {
    tauri::async_runtime::spawn_blocking(|| helper_ready() || start_helper_task_only())
        .await
        .unwrap_or(false)
}

/// One-time helper start from the UI. Returns ok | cancelled | failed (relogin kept
/// for the old frontend contract, never returned).
#[tauri::command]
pub async fn fps_unlock() -> &'static str {
    tauri::async_runtime::spawn_blocking(start_helper).await.unwrap_or("failed")
}

/// Ask the elevated helper to exit after the gaming overlay / Hardware view closes.
#[tauri::command]
pub fn fps_release() {
    if let Some(shared) = shared() {
        unsafe { (*shared).stop.store(1, Ordering::Relaxed) };
    }
}

/// Runs in the elevated process (`--fps-helper <main-pid>`), before Tauri starts.
pub fn run_helper(mut main_pid: u32) -> ! {
    helper_log(&format!("helper start main_pid={main_pid}"));
    let Some(shared) = (unsafe { open_mapping(true) }) else {
        helper_log("open_mapping failed");
        std::process::exit(2);
    };
    if helper_alive(shared) {
        helper_log("helper already alive");
        // The logon task and a manual unlock can race; one helper is enough.
        std::process::exit(0);
    }
    HELPER_SHARED.store(shared, Ordering::Release);
    if let Ok(exe) = std::env::current_exe() {
        ensure_helper_task(&exe);
    }
    unsafe {
        (*shared).helper_pid.store(GetCurrentProcessId(), Ordering::Relaxed);
        if main_pid != 0 {
            (*shared).main_pid.store(main_pid, Ordering::Relaxed);
        }
        (*shared).heartbeat.store(0, Ordering::Relaxed);
        (*shared).error.store(0, Ordering::Relaxed);
        (*shared).stop.store(0, Ordering::Relaxed);
        (*shared).cpu_temp.store(0, Ordering::Relaxed);
        (*shared).gpu_temp.store(0, Ordering::Relaxed);
        (*shared).temp_at.store(0, Ordering::Relaxed);
        (*shared).lenovo_mode.store(0, Ordering::Relaxed);
        (*shared).lenovo_mode_at.store(0, Ordering::Relaxed);
        (*shared).fan_cooling.store(0, Ordering::Relaxed);
        (*shared).fan_cooling_at.store(0, Ordering::Relaxed);
        (*shared).custom_active.store(0, Ordering::Relaxed);
        (*shared).power_req.store(0, Ordering::Relaxed);
        (*shared).power_ack.store(0, Ordering::Relaxed);
        (*shared).wake.store(0, Ordering::Relaxed);
        for entry in (*shared).entries.iter() {
            entry.pid.store(0, Ordering::Relaxed);
            entry.epoch.store(0, Ordering::Relaxed);
            entry.last.store(0, Ordering::Relaxed);
            for count in &entry.counts {
                count.store(0, Ordering::Relaxed);
            }
        }
    }

    // A logon task can start before the notch. Wait for it to publish its pid,
    // then attach the lifetime watcher to that process.
    if main_pid == 0 {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            main_pid = unsafe { (*shared).main_pid.load(Ordering::Relaxed) };
            if main_pid != 0 {
                break;
            }
            if Instant::now() >= deadline {
                helper_log("main pid timeout");
                unsafe { (*shared).heartbeat.store(0, Ordering::Relaxed) };
                std::process::exit(2);
            }
            thread::sleep(Duration::from_millis(250));
        }
    }
    helper_log(&format!("main_pid={main_pid}"));

    let name = wide(HELPER_SESSION);
    let (trace, logger) = match start_helper_trace(&name, shared) {
        Some(pair) => {
            helper_log("etw trace started");
            pair
        }
        None => {
            helper_log("etw trace failed");
            unsafe { (*shared).heartbeat.store(0, Ordering::Relaxed) };
            thread::sleep(Duration::from_secs(3));
            std::process::exit(2);
        }
    };
    let _keep_logger = logger;

    let main = if main_pid != 0 {
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, main_pid).ok() }
    } else {
        None
    };
    let watch_name = name.clone();
    let shared_addr = shared as usize;
    let main_raw = main.map(|handle| handle.0 as usize);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let shared = shared_addr as *mut FpsShared;
        let stop = unsafe { (*shared).stop.load(Ordering::Relaxed) != 0 };
        let gone = main_raw.is_some_and(|raw| unsafe { WaitForSingleObject(HANDLE(raw as *mut _), 0).0 == 0 });
        if stop || gone {
            stop_session(&watch_name, HELPER_SESSION_GUID);
            break;
        }
        unsafe { (*shared).heartbeat.store(GetTickCount64(), Ordering::Relaxed) };
    });

    // Temperatures need the same elevated token for Lenovo's WMI provider.
    let temp_addr = shared as usize;
    thread::spawn(move || temp_loop(temp_addr));
    // The main notch is not elevated, so in an elevated game it cannot see
    // clicks at all. Watch for the triple-click here and publish a wake flag.
    let wake_addr = shared as usize;
    thread::spawn(move || mouse_wake_loop(wake_addr));

    unsafe {
        helper_log("helper running");
        (*shared).heartbeat.store(GetTickCount64(), Ordering::Relaxed);
        let _ = ProcessTrace(&[trace], None, None);
        let _ = CloseTrace(trace);
        (*shared).heartbeat.store(0, Ordering::Relaxed);
    }
    helper_log("helper exiting");
    std::process::exit(0);
}

/// StartTrace + providers + OpenTrace for the helper. Returns the trace handle and the
/// logger-name buffer (must stay alive while ProcessTrace runs).
fn start_helper_trace(name: &[u16], shared: *mut FpsShared) -> Option<(PROCESSTRACE_HANDLE, Vec<u16>)> {
    let mut handle = CONTROLTRACE_HANDLE::default();
    let mut props = Props::new(HELPER_SESSION_GUID);
    let mut status = unsafe { StartTraceW(&mut handle, PCWSTR(name.as_ptr()), props.ptr()) };
    helper_log(&format!("StartTrace status={}", status.0));
    if status == ERROR_ALREADY_EXISTS {
        stop_session(name, HELPER_SESSION_GUID);
        props = Props::new(HELPER_SESSION_GUID);
        status = unsafe { StartTraceW(&mut handle, PCWSTR(name.as_ptr()), props.ptr()) };
        helper_log(&format!("StartTrace retry status={}", status.0));
    }
    if status != ERROR_SUCCESS {
        helper_log(&format!("StartTrace failed status={}", status.0));
        unsafe { (*shared).error.store(if status == ERROR_ACCESS_DENIED { ERR_NO_ADMIN } else { ERR_FAILED }, Ordering::Relaxed) };
        return None;
    }
    for (provider, keyword) in [(DXGI, 0), (D3D9, 0), (DXGKRNL, KMT_KEYWORD_PRESENT)] {
        let status = unsafe { EnableTraceEx2(handle, &provider, EVENT_CONTROL_CODE_ENABLE_PROVIDER.0, TRACE_LEVEL_INFORMATION, keyword, 0, 0, None) };
        helper_log(&format!("EnableTrace status={}", status.0));
        if WIN32_ERROR(status.0) != ERROR_SUCCESS {
            stop_session(name, HELPER_SESSION_GUID);
            unsafe { (*shared).error.store(if WIN32_ERROR(status.0) == ERROR_ACCESS_DENIED { ERR_NO_ADMIN } else { ERR_FAILED }, Ordering::Relaxed) };
            return None;
        }
    }
    let mut logger = name.to_vec();
    let mut logfile = EVENT_TRACE_LOGFILEW::default();
    logfile.LoggerName = PWSTR(logger.as_mut_ptr());
    logfile.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
    logfile.Anonymous2.EventRecordCallback = Some(helper_on_event);
    let trace = unsafe { OpenTraceW(&mut logfile) };
    helper_log(&format!("OpenTrace value={}", trace.Value));
    if trace.Value == u64::MAX {
        stop_session(name, HELPER_SESSION_GUID);
        unsafe { (*shared).error.store(ERR_FAILED, Ordering::Relaxed) };
        return None;
    }
    Some((trace, logger))
}

unsafe extern "system" fn helper_on_event(record: *mut EVENT_RECORD) {
    let Some(r) = (unsafe { record.as_ref() }) else { return };
    let Some(kind) = event_kind(r.EventHeader.ProviderId, r.EventHeader.EventDescriptor.Id) else { return };
    let Some(shared) = (unsafe { HELPER_SHARED.load(Ordering::Relaxed).as_ref() }) else { return };
    let pid = r.EventHeader.ProcessId;
    if pid == 0 {
        return;
    }
    let entry = find_entry(shared, pid);
    if entry.pid.load(Ordering::Relaxed) != pid {
        return;
    }
    entry.counts[kind].fetch_add(1, Ordering::Relaxed);
    entry.last.store(GetTickCount64(), Ordering::Relaxed);
}

fn event_kind(provider: GUID, id: u16) -> Option<usize> {
    if provider == DXGI {
        match id {
            42 => Some(0),
            55 => Some(1),
            _ => None,
        }
    } else if provider == D3D9 && id == D3D9_PRESENT {
        Some(2)
    } else if provider == DXGKRNL {
        match id {
            166 => Some(3),
            171 => Some(4),
            184 => Some(5),
            215 => Some(6),
            _ => None,
        }
    } else {
        None
    }
}

/// Elevated thread: three quick left clicks anywhere wake the ghosted notch.
/// Non-elevated processes cannot see input aimed at an elevated game.
fn mouse_wake_loop(shared_addr: usize) {
    let shared = shared_addr as *mut FpsShared;
    let mut clicks = 0u32;
    let mut last = Instant::now();
    let mut was_down = false;
    loop {
        thread::sleep(Duration::from_millis(12));
        if unsafe { (*shared).stop.load(Ordering::Relaxed) } != 0 {
            break;
        }
        let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000 != 0;
        if down && !was_down {
            let now = Instant::now();
            clicks = if now.duration_since(last) <= Duration::from_millis(1500) { clicks + 1 } else { 1 };
            last = now;
            if clicks >= 3 {
                clicks = 0;
                unsafe { (*shared).wake.store(1, Ordering::Relaxed) };
            }
        }
        was_down = down;
    }
}

/// Elevated thread: Lenovo GameZone WMI temperatures and thermal modes, with
/// nvidia-smi as the GPU fallback. Publishes into the shared block for the
/// normal notch process and answers thermal-mode requests.
fn temp_loop(shared_addr: usize) {
    let shared = shared_addr as *mut FpsShared;
    let mut lenovo: Option<crate::temps::Lenovo> = None;
    let mut acpi: Option<crate::temps::Acpi> = None;
    let mut last_open = Instant::now() - Duration::from_secs(60);
    let mut last_acpi_open = Instant::now() - Duration::from_secs(60);
    let mut last_read = Instant::now() - Duration::from_secs(10);
    loop {
        if unsafe { (*shared).stop.load(Ordering::Relaxed) } != 0 {
            break;
        }
        let request = unsafe { (*shared).power_req.load(Ordering::Relaxed) };
        // Open the provider immediately when the notch asks for a thermal mode;
        // otherwise retry every 10 s.
        if lenovo.is_none() && (request != 0 || last_open.elapsed() > Duration::from_secs(10)) {
            lenovo = crate::temps::Lenovo::open();
            last_open = Instant::now();
        }

        if request != 0 {
            let seq = request >> 8;
            let mode = (request & 0xFF) as u8;
            let (attempt, applied_mode, applied_cooling) = match &lenovo {
                Some(l) if mode == 255 => {
                    // Lenovo's hardware "custom" profile (Vantage purple mode).
                    // Setting 4 is max-power/Extreme on many models, not custom.
                    // If the model rejects 5, fall back to performance + active cooling.
                    match l.set_mode(255) {
                        Ok(()) => (Ok(()), 255u32, 0u32),
                        Err(_) => (l.set_mode(3).and_then(|_| l.set_fan_cooling(true)), 3u32, 1u32),
                    }
                }
                Some(l) if (1..=3).contains(&mode) => {
                    let result = l.set_mode(mode);
                    if result.is_ok() {
                        let _ = l.set_fan_cooling(false);
                    }
                    let cooling = if result.is_ok() { l.fan_cooling().unwrap_or(0) as u32 } else { 0 };
                    (result, mode as u32, cooling)
                }
                Some(_) => (Err("invalid mode".to_string()), 0, 0),
                None => (Err("no lenovo provider".to_string()), 0, 0),
            };
            let result = if attempt.is_ok() {
                unsafe {
                    (*shared).lenovo_mode.store(applied_mode, Ordering::Relaxed);
                    (*shared).lenovo_mode_at.store(GetTickCount64(), Ordering::Relaxed);
                    (*shared).fan_cooling.store(applied_cooling, Ordering::Relaxed);
                    (*shared).fan_cooling_at.store(GetTickCount64(), Ordering::Relaxed);
                    (*shared).custom_active.store((mode == 255) as u32, Ordering::Relaxed);
                }
                1
            } else {
                2
            };
            unsafe {
                (*shared).power_ack.store((seq << 8) | result, Ordering::Relaxed);
                let _ = (*shared).power_req.compare_exchange(request, 0, Ordering::Relaxed, Ordering::Relaxed);
            }
        }

        if last_read.elapsed() > Duration::from_secs(2) {
            last_read = Instant::now();
            let mut mode = None;
            let mut cooling = None;
            let (mut cpu, mut gpu) = match lenovo.as_ref() {
                Some(l) => {
                    mode = l.mode();
                    cooling = l.fan_cooling();
                    l.temps()
                }
                None => (None, None),
            };
            if let Some(mode) = mode {
                unsafe {
                    (*shared).lenovo_mode.store(mode as u32, Ordering::Relaxed);
                    (*shared).lenovo_mode_at.store(GetTickCount64(), Ordering::Relaxed);
                    // Do not touch `custom_active` here: Lenovo's EC can report the
                    // base fan mode (usually Balanced) while the custom cooling
                    // combination is still applied. The flag is owned by mode
                    // requests and survives readbacks.
                }
            }
            if let Some(cooling) = cooling {
                unsafe {
                    (*shared).fan_cooling.store(cooling as u32, Ordering::Relaxed);
                    (*shared).fan_cooling_at.store(GetTickCount64(), Ordering::Relaxed);
                }
            }
            if gpu.is_none() {
                gpu = crate::temps::nvidia_smi();
            }
            // Non-Lenovo machines often expose CPU temperature through the ACPI
            // thermal zone once the helper is elevated. Only use it when the Lenovo
            // provider is absent; on LOQ models its zone is a ~28 °C ambient sensor.
            if cpu.is_none() && lenovo.is_none() {
                if acpi.is_none() && last_acpi_open.elapsed() > Duration::from_secs(30) {
                    acpi = crate::temps::Acpi::open();
                    last_acpi_open = Instant::now();
                }
                if let Some(sensor) = &acpi {
                    cpu = sensor.cpu();
                }
            }
            if cpu.is_none() && gpu.is_none() && lenovo.is_some() && mode.is_none() {
                // The provider answered but has no sensors (e.g. non-Lenovo); retry later.
                lenovo = None;
            }
            unsafe {
                (*shared).cpu_temp.store(cpu.unwrap_or(0), Ordering::Relaxed);
                (*shared).gpu_temp.store(gpu.unwrap_or(0), Ordering::Relaxed);
                (*shared).temp_at.store(GetTickCount64(), Ordering::Relaxed);
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
}

// ── Direct ETW (fallback when already elevated / in Performance Log Users) ──

fn stop_session(name: &[u16], guid: GUID) {
    let mut props = Props::new(guid);
    unsafe {
        let _ = ControlTraceW(CONTROLTRACE_HANDLE::default(), PCWSTR(name.as_ptr()), props.ptr(), EVENT_TRACE_CONTROL_STOP);
    }
}

fn fail(error: &'static str) {
    let mut c = counter().lock().unwrap();
    c.running = false;
    c.error = Some(error);
    c.error_at = Some(Instant::now());
}

fn run() {
    let name = wide(SESSION);
    let mut handle = CONTROLTRACE_HANDLE::default();
    let mut props = Props::new(SESSION_GUID);
    let mut status = unsafe { StartTraceW(&mut handle, PCWSTR(name.as_ptr()), props.ptr()) };
    if status == ERROR_ALREADY_EXISTS {
        stop_session(&name, SESSION_GUID);
        props = Props::new(SESSION_GUID);
        status = unsafe { StartTraceW(&mut handle, PCWSTR(name.as_ptr()), props.ptr()) };
    }
    if status != ERROR_SUCCESS {
        return fail(if status == ERROR_ACCESS_DENIED { "no-admin" } else { "failed" });
    }

    // DxgKrnl is very chatty, so only the Present keyword. DXGI/D3D9 are quiet (0 = all).
    for (provider, keyword) in [(DXGI, 0), (D3D9, 0), (DXGKRNL, KMT_KEYWORD_PRESENT)] {
        let status = unsafe { EnableTraceEx2(handle, &provider, EVENT_CONTROL_CODE_ENABLE_PROVIDER.0, TRACE_LEVEL_INFORMATION, keyword, 0, 0, None) };
        if WIN32_ERROR(status.0) != ERROR_SUCCESS {
            stop_session(&name, SESSION_GUID);
            return fail(if WIN32_ERROR(status.0) == ERROR_ACCESS_DENIED { "no-admin" } else { "failed" });
        }
    }

    let mut logger = wide(SESSION);
    let mut logfile = EVENT_TRACE_LOGFILEW::default();
    logfile.LoggerName = PWSTR(logger.as_mut_ptr());
    logfile.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
    logfile.Anonymous2.EventRecordCallback = Some(on_event);
    let trace: PROCESSTRACE_HANDLE = unsafe { OpenTraceW(&mut logfile) };
    if trace.Value == u64::MAX {
        stop_session(&name, SESSION_GUID);
        return fail("failed");
    }

    // Watchdog: stop the session when nobody polls, so ProcessTrace returns.
    let watch_name = name.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let idle = counter().lock().unwrap().wanted_at.is_none_or(|t| t.elapsed() > IDLE);
        if idle {
            stop_session(&watch_name, SESSION_GUID);
            break;
        }
    });

    unsafe {
        let _ = ProcessTrace(&[trace], None, None);
        let _ = CloseTrace(trace);
    }
    let mut c = counter().lock().unwrap();
    c.running = false;
    c.counts.clear();
    c.last = None;
}

unsafe extern "system" fn on_event(record: *mut EVENT_RECORD) {
    let Some(r) = (unsafe { record.as_ref() }) else { return };
    let h = &r.EventHeader;
    let id = h.EventDescriptor.Id;
    // Kind = event ID; DXGI/D3D9 get their own ranges so they don't clash with DxgKrnl IDs.
    let kind = if h.ProviderId == DXGI && DXGI_PRESENT.contains(&id) {
        1000 + id
    } else if h.ProviderId == D3D9 && id == D3D9_PRESENT {
        2000 + id
    } else if h.ProviderId == DXGKRNL && KMT_PRESENT.contains(&id) {
        id
    } else {
        return;
    };
    if let Ok(mut c) = counter().lock() {
        *c.counts.entry((h.ProcessId, kind)).or_insert(0) += 1;
    }
}

// ── ETW plumbing ────────────────────────────────────────────────────────────

/// Buffer for EVENT_TRACE_PROPERTIES + session name (must follow directly).
struct Props {
    buf: Vec<u8>,
}

impl Props {
    fn new(guid: GUID) -> Self {
        // Room for any session name (incl. the probe); ControlTrace writes it back.
        let name_len = 1024 * 2;
        let size = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() + name_len;
        let mut buf = vec![0u8; size];
        let p = buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES;
        unsafe {
            (*p).Wnode.BufferSize = size as u32;
            (*p).Wnode.Flags = WNODE_FLAG_TRACED_GUID;
            (*p).Wnode.ClientContext = 1; // QPC
            (*p).Wnode.Guid = guid;
            (*p).LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
            (*p).LoggerNameOffset = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() as u32;
        }
        Self { buf }
    }

    fn ptr(&mut self) -> *mut EVENT_TRACE_PROPERTIES {
        self.buf.as_mut_ptr() as *mut _
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
