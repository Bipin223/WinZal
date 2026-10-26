//! System stats for the Hardware tool: CPU, RAM, GPU (load + VRAM), ping.
//! Polled ~1×/s while shown (Hardware tool open, gaming mode); in the background every
//! 3 s with CPU and RAM only (`full = false`).
//!
//! - GPU load: performance counter "GPU Engine(*engtype_3D)", the same value as
//!   Task Manager, vendor-independent (NVIDIA, AMD, Intel).
//! - VRAM: "GPU Adapter Memory(*)\Dedicated Usage" + total size from DXGI.
//! - Ping: ICMP echo to 1.1.1.1 on its own thread (every 2 s, only while polled).

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::System;
use tauri::State;
use windows::core::w;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
    PDH_HCOUNTER, PDH_HQUERY,
};

use crate::temps;

/// 1.1.1.1 in network byte order.
const PING_TARGET: u32 = u32::from_le_bytes([1, 1, 1, 1]);
const PING_EVERY: Duration = Duration::from_secs(2);
/// The ping thread pauses after this long without a poll.
const PING_IDLE: Duration = Duration::from_secs(5);
/// "No ping" (timeout / offline).
const NO_PING: u64 = u64::MAX;
/// The temperature thread pauses after this long without a poll.
const TEMP_IDLE: Duration = Duration::from_secs(5);

pub struct SystemState(Mutex<Probe>);

struct Probe {
    sys: System,
    gpu: Option<Gpu>,
    gpu_name: Option<String>,
    gpu_total: u64,
    ping: Arc<Ping>,
    temp: Arc<Temp>,
}

/// CPU/GPU temperatures, cached in the background; 0 = unknown.
struct Temp {
    cpu: AtomicU32,
    gpu: AtomicU32,
    /// Last poll (ms since start); decides whether the thread reads sensors.
    wanted_at: Mutex<Instant>,
}

struct Ping {
    ms: AtomicU64,
    /// Last poll (ms since start); decides whether the thread pings.
    wanted_at: Mutex<Instant>,
}

/// PDH query for GPU load and VRAM.
struct Gpu {
    query: PDH_HQUERY,
    util: PDH_HCOUNTER,
    mem: PDH_HCOUNTER,
}

// PDH handles are pointers; only touch them under the mutex.
unsafe impl Send for Gpu {}

impl Default for SystemState {
    fn default() -> Self {
        let (gpu_name, gpu_total) = adapter().unzip();
        let ping = Arc::new(Ping { ms: AtomicU64::new(NO_PING), wanted_at: Mutex::new(Instant::now() - PING_IDLE) });
        spawn_ping(ping.clone());
        let temp = Arc::new(Temp { cpu: AtomicU32::new(0), gpu: AtomicU32::new(0), wanted_at: Mutex::new(Instant::now() - TEMP_IDLE) });
        spawn_temp(temp.clone());
        Self(Mutex::new(Probe { sys: System::new(), gpu: Gpu::open(), gpu_name, gpu_total: gpu_total.flatten().unwrap_or(0), ping, temp }))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    cpu: f32,
    cpu_name: String,
    mem_used: u64,
    mem_total: u64,
    /// None if the GPU counters are missing.
    gpu: Option<f64>,
    gpu_name: Option<String>,
    gpu_mem_used: u64,
    gpu_mem_total: u64,
    /// °C; None = no sensor.
    cpu_temp: Option<u32>,
    gpu_temp: Option<u32>,
    /// Milliseconds; None = no reply.
    ping: Option<u64>,
}

#[tauri::command]
pub fn system_stats(full: bool, state: State<'_, SystemState>) -> Stats {
    let mut p = state.0.lock().unwrap();
    p.sys.refresh_cpu_usage();
    p.sys.refresh_memory();
    if p.sys.cpus().is_empty() || p.sys.cpus()[0].brand().is_empty() {
        p.sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    }
    // Background (notch closed): CPU and RAM only. The GPU counters walk every process's
    // engines and the ping goes over the network, so both only run while shown.
    if full {
        *p.ping.wanted_at.lock().unwrap() = Instant::now();
        *p.temp.wanted_at.lock().unwrap() = Instant::now();
    }

    let (gpu, gpu_mem_used) = if full { p.gpu.as_ref().map(Gpu::read).unwrap_or((None, 0)) } else { (None, 0) };
    let ping = if full { p.ping.ms.load(Ordering::Relaxed) } else { NO_PING };
    // The elevated helper publishes Lenovo temps; otherwise use the background
    // sensor thread (elevated Lenovo WMI / nvidia-smi).
    let (helper_cpu, helper_gpu) = if full { crate::fps::helper_temps() } else { (None, None) };
    let (local_cpu, local_gpu) = if full { p.temp.read() } else { (None, None) };
    Stats {
        cpu: p.sys.global_cpu_usage(),
        cpu_name: p.sys.cpus().first().map(|c| clean_name(c.brand())).unwrap_or_default(),
        mem_used: p.sys.used_memory(),
        mem_total: p.sys.total_memory(),
        gpu,
        gpu_name: p.gpu_name.clone(),
        gpu_mem_used,
        gpu_mem_total: p.gpu_total,
        cpu_temp: helper_cpu.or(local_cpu),
        gpu_temp: helper_gpu.or(local_gpu),
        ping: (ping != NO_PING).then_some(ping),
    }
}

impl Gpu {
    fn open() -> Option<Self> {
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            let mut util = PDH_HCOUNTER::default();
            let mut mem = PDH_HCOUNTER::default();
            if PdhAddEnglishCounterW(query, w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"), 0, &mut util) != 0 {
                return None;
            }
            let _ = PdhAddEnglishCounterW(query, w!("\\GPU Adapter Memory(*)\\Dedicated Usage"), 0, &mut mem);
            // Load is a rate and needs two samples; this is the first.
            PdhCollectQueryData(query);
            Some(Self { query, util, mem })
        }
    }

    /// (load %, used VRAM in bytes)
    fn read(&self) -> (Option<f64>, u64) {
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return (None, 0);
            }
        }
        // One instance per process: sum them up (like Task Manager), capped at 100.
        let util = sum_counter(self.util).map(|v| v.min(100.0));
        let mem = sum_counter(self.mem).unwrap_or(0.0) as u64;
        (util, mem)
    }
}

fn sum_counter(counter: PDH_HCOUNTER) -> Option<f64> {
    unsafe {
        let (mut size, mut count) = (0u32, 0u32);
        PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
        if size == 0 {
            return None;
        }
        // Buffer aligned as u64; holds the items followed by the instance names.
        let mut buf = vec![0u64; (size as usize).div_ceil(8)];
        let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        if PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) != 0 {
            return None;
        }
        let slice = std::slice::from_raw_parts(items, count as usize);
        Some(slice.iter().filter(|i| i.FmtValue.CStatus == 0).map(|i| i.FmtValue.Anonymous.doubleValue).sum())
    }
}

/// Name and VRAM of the strongest real GPU (most dedicated VRAM).
fn adapter() -> Option<(String, Option<u64>)> {
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let mut best: Option<(String, u64)> = None;
        for i in 0.. {
            let Ok(adapter) = factory.EnumAdapters1(i) else { break };
            let Ok(desc) = adapter.GetDesc1() else { continue };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            let vram = desc.DedicatedVideoMemory as u64;
            if best.as_ref().is_none_or(|(_, b)| vram > *b) {
                let len = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
                best = Some((clean_name(&String::from_utf16_lossy(&desc.Description[..len])), vram));
            }
        }
        best.map(|(name, vram)| (name, Some(vram)))
    }
}

/// "NVIDIA GeForce RTX 4070 Ti" → "GeForce RTX 4070 Ti"; strips "(R)", "(TM)", "CPU @ …".
fn clean_name(name: &str) -> String {
    let mut s = name.replace("(R)", "").replace("(TM)", "").replace("(tm)", "");
    if let Some(i) = s.find(" @ ") {
        s.truncate(i);
    }
    for prefix in ["NVIDIA ", "AMD ", "Intel "] {
        if s.starts_with(prefix) && s.len() > prefix.len() + 6 {
            s = s[prefix.len()..].to_string();
        }
    }
    s.replace(" CPU", "").replace("  ", " ").replace(" Processor", "").trim().to_string()
}

impl Temp {
    fn read(&self) -> (Option<u32>, Option<u32>) {
        let cpu = self.cpu.load(Ordering::Relaxed);
        let gpu = self.gpu.load(Ordering::Relaxed);
        ((cpu > 0).then_some(cpu), (gpu > 0).then_some(gpu))
    }
}

/// Reads Lenovo WMI (if this process is elevated) or nvidia-smi every other second
/// while the Hardware/gaming overlay is visible. The elevated helper already
/// publishes the Lenovo values, so this thread stays idle in that case.
fn spawn_temp(temp: Arc<Temp>) {
    thread::spawn(move || {
        let mut lenovo = None;
        let mut last_open = Instant::now() - Duration::from_secs(60);
        loop {
            if temp.wanted_at.lock().unwrap().elapsed() > TEMP_IDLE {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            let (helper_cpu, helper_gpu) = crate::fps::helper_temps();
            if helper_cpu.is_some() && helper_gpu.is_some() {
                // system_stats prefers the helper's values; don't duplicate WMI.
                temp.cpu.store(0, Ordering::Relaxed);
                temp.gpu.store(0, Ordering::Relaxed);
            } else {
                if lenovo.is_none() && last_open.elapsed() > Duration::from_secs(30) {
                    lenovo = temps::Lenovo::open();
                    last_open = Instant::now();
                }
                let (cpu, gpu) = lenovo.as_ref().map(|l| l.temps()).unwrap_or((None, None));
                let gpu = gpu.or_else(temps::nvidia_smi);
                // Do not fall back to the ACPI/thermal-zone counter here: on many
                // laptops it is a chassis/ambient zone (a permanent ~28 °C), not
                // the CPU. The elevated helper owns the real CPU temperature.
                temp.cpu.store(if helper_cpu.is_some() { 0 } else { cpu.unwrap_or(0) }, Ordering::Relaxed);
                temp.gpu.store(if helper_gpu.is_some() { 0 } else { gpu.unwrap_or(0) }, Ordering::Relaxed);
            }
            thread::sleep(Duration::from_secs(2));
        }
    });
}

fn spawn_ping(ping: Arc<Ping>) {    thread::spawn(move || {
        let Ok(handle) = (unsafe { IcmpCreateFile() }) else { return };
        let payload = [0u8; 32];
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8];
        loop {
            if ping.wanted_at.lock().unwrap().elapsed() > PING_IDLE {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            let n = unsafe {
                IcmpSendEcho(handle, PING_TARGET, payload.as_ptr().cast(), payload.len() as u16, None, reply.as_mut_ptr().cast(), reply.len() as u32, 1000)
            };
            let ms = if n > 0 {
                let r = unsafe { &*(reply.as_ptr() as *const ICMP_ECHO_REPLY) };
                if r.Status == 0 { r.RoundTripTime as u64 } else { NO_PING }
            } else {
                NO_PING
            };
            ping.ms.store(ms, Ordering::Relaxed);
            thread::sleep(PING_EVERY);
        }
        #[allow(unreachable_code)]
        unsafe {
            let _ = IcmpCloseHandle(handle);
        }
    });
}
