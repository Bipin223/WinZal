//! Ambient laptop controls: Wi-Fi status, Bluetooth radio, power mode,
//! Windows Night Light ("Glim"), quick power actions and a tiny URI opener.

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use windows::core::GUID;
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice};
use windows::Devices::Enumeration::DeviceInformation;
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Win32::Devices::Bluetooth::{
    BluetoothFindFirstRadio, BluetoothFindRadioClose, BluetoothGetDeviceInfo, BluetoothSetServiceState,
    BLUETOOTH_ADDRESS, BLUETOOTH_ADDRESS_0, BLUETOOTH_DEVICE_INFO, BLUETOOTH_FIND_RADIO_PARAMS,
    BLUETOOTH_SERVICE_ENABLE, BLUETOOTH_SERVICE_DISABLE,
};
use windows::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE, HLOCAL, LPARAM, WPARAM};
use windows::Win32::System::Power::{
    GetSystemPowerStatus, PowerGetActiveScheme, PowerSetActiveScheme, SetSuspendState, SYSTEM_POWER_STATUS,
};
use windows::Win32::System::Shutdown::LockWorkStation;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
    SendMessageW, HWND_BROADCAST, SC_MONITORPOWER, WM_SYSCOMMAND,
};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, RegType};
use winreg::{RegKey, RegValue};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// â”€â”€ Network â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Serialize)]
pub struct Network {
    connected: bool,
    wifi: bool,
    name: String,
    /// The Wi-Fi radio itself is switched on, even if no network is connected.
    enabled: bool,
}

/// Find a radio through the WinRT radio API (same API Windows Settings uses).
fn find_radio(kind: RadioKind) -> windows::core::Result<Option<Radio>> {
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    let radios = Radio::GetRadiosAsync()?.join()?;
    let count = radios.Size()?;
    for i in 0..count {
        let radio = radios.GetAt(i)?;
        if radio.Kind()? == kind {
            return Ok(Some(radio));
        }
    }
    Ok(None)
}

fn radio_state(kind: RadioKind) -> Option<RadioState> {
    find_radio(kind).ok().flatten().and_then(|radio| radio.State().ok())
}

/// Switch a radio and wait briefly until Windows reports the new state.
fn set_radio(kind: RadioKind, on: bool) -> Result<bool, String> {
    let radio = find_radio(kind)
        .map_err(|e| format!("Could not access the radio: {e}"))?
        .ok_or("No matching radio found")?;
    let target = if on { RadioState::On } else { RadioState::Off };

    let access = radio
        .SetStateAsync(target)
        .and_then(|operation| operation.join())
        .map_err(|e| format!("Could not change the radio: {e}"))?;
    if access != RadioAccessStatus::Allowed {
        return Err(format!("Windows denied the radio change ({access:?})"));
    }

    // The request is queued, so the state can trail the returned access status.
    // Bluetooth radios in particular can take several seconds to come back.
    for _ in 0..60 {
        if radio.State().ok() == Some(target) {
            return Ok(true);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    match radio.State() {
        Ok(state) if state == target => Ok(true),
        Ok(state) => Err(format!("The radio did not change state ({state:?})")),
        Err(e) => Err(format!("Could not read the radio state: {e}")),
    }
}

/// Wi-Fi status through `netsh`: no COM/WinRT, no admin, no extra memory.
/// The SSID line is the most locale-stable part of the output.
fn network_status() -> Network {
    let enabled = radio_state(RadioKind::WiFi) == Some(RadioState::On);
    let out = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    if let Ok(out) = out {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("SSID") {
                if let Some((_, value)) = rest.split_once(':') {
                    let name = value.trim();
                    if !name.is_empty() {
                        return Network { connected: true, wifi: true, name: name.to_string(), enabled };
                    }
                }
            }
        }
    }

    Network { connected: false, wifi: false, name: String::new(), enabled }
}

#[tauri::command]
pub async fn network_get() -> Result<Network, String> {
    tauri::async_runtime::spawn_blocking(|| Ok(network_status()))
        .await
        .map_err(|e| e.to_string())?
}

/// Toggle the whole Wi-Fi radio, like the Wi-Fi button in Windows quick settings.
#[tauri::command]
pub async fn wifi_set(on: bool) -> Result<Network, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_radio(RadioKind::WiFi, on)?;
        // Read the real state instead of echoing the request: Windows can take a
        // moment, and the UI polls in the background.
        let mut status = network_status();
        if !on {
            status.connected = false;
            status.wifi = false;
            status.name.clear();
        }
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct WifiNetwork {
    ssid: String,
    signal: u32,
    secured: bool,
    connected: bool,
    known: bool,
}

fn wifi_profiles() -> Vec<String> {
    let out = Command::new("netsh")
        .args(["wlan", "show", "profiles"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let mut profiles = Vec::new();
    if let Ok(out) = out {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            // Profile rows are indented and look like "    All User Profile : Name"
            // in every Windows language. Reading the value after the first colon
            // avoids depending on the localized label.
            if !(line.starts_with(' ') || line.starts_with('\t')) {
                continue;
            }
            let Some((_, value)) = line.split_once(':') else { continue };
            let value = value.trim();
            if !value.is_empty() && value != "<None>" {
                profiles.push(value.to_string());
            }
        }
    }
    profiles
}

/// Visible Wi-Fi networks for the notch's dropdown. Reading only; no admin.
#[tauri::command]
pub async fn wifi_networks() -> Result<Vec<WifiNetwork>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = Command::new("netsh")
            .args(["wlan", "show", "networks", "mode=bssid"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout);
        let profiles = wifi_profiles();
        let current = network_status();

        let mut found: Vec<WifiNetwork> = Vec::new();
        let mut ssid: Option<String> = None;
        let mut secured = true;
        let mut signal = 0u32;

        let flush = |name: Option<String>, secured: bool, signal: u32, found: &mut Vec<WifiNetwork>| {
            let Some(name) = name else { return };
            if name.is_empty() || found.iter().any(|n| n.ssid == name) {
                return;
            }
            let connected = current.connected && current.name == name;
            let known = profiles.iter().any(|p| p.eq_ignore_ascii_case(&name));
            found.push(WifiNetwork { ssid: name, signal, secured, connected, known });
        };

        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("SSID ") {
                flush(ssid.take(), secured, signal, &mut found);
                secured = true;
                signal = 0;
                ssid = rest.split_once(':').map(|(_, value)| value.trim().to_string());
            } else if ssid.is_some() {
                if let Some((_, value)) = line.split_once(':') {
                    let value = value.trim();
                    if line.starts_with("Authentication") {
                        secured = !value.eq_ignore_ascii_case("open");
                    } else if signal == 0 {
                        // The signal row is "Signal : 86%" in English and has the
                        // same "%" value in localized builds.
                        if let Some(percent) = value.strip_suffix('%') {
                            signal = percent.trim().parse().unwrap_or(0);
                        }
                    }
                }
            }
        }
        flush(ssid.take(), secured, signal, &mut found);

        found.sort_by(|a, b| {
            b.connected
                .cmp(&a.connected)
                .then_with(|| b.known.cmp(&a.known))
                .then_with(|| b.signal.cmp(&a.signal))
        });
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Connect to a visible network that already has a Windows profile.
/// New networks use the native password prompt through `ms-availablenetworks:`.
#[tauri::command]
pub async fn wifi_connect(ssid: String) -> Result<Network, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let profile = wifi_profiles()
            .into_iter()
            .find(|p| p.eq_ignore_ascii_case(&ssid))
            .ok_or("This network is not saved yet")?;

        let status = Command::new("netsh")
            .args([
                "wlan",
                "connect",
                &format!("name={profile}"),
                &format!("ssid={ssid}"),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !status.status.success() {
            return Err(String::from_utf8_lossy(&status.stdout).trim().to_string());
        }

        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let current = network_status();
            if current.connected && current.name == ssid {
                return Ok(current);
            }
        }
        Err("Could not connect to this network".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

// â”€â”€ Bluetooth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Serialize)]
pub struct Bluetooth {
    available: bool,
    on: bool,
}

#[tauri::command]
pub async fn bluetooth_get() -> Result<Bluetooth, String> {
    tauri::async_runtime::spawn_blocking(|| {
        match radio_state(RadioKind::Bluetooth) {
            Some(state) => Bluetooth { available: true, on: state == RadioState::On },
            None => Bluetooth { available: false, on: false },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Toggle the Bluetooth radio, like the Bluetooth button in Windows quick settings.
#[tauri::command]
pub async fn bluetooth_set(on: bool) -> Result<Bluetooth, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_radio(RadioKind::Bluetooth, on)?;
        match radio_state(RadioKind::Bluetooth) {
            Some(state) => Ok(Bluetooth { available: true, on: state == RadioState::On }),
            None => Err("Bluetooth radio disappeared while switching".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct BluetoothPeer {
    name: String,
    address: u64,
    connected: bool,
}

const A2DP_SOURCE: GUID = GUID::from_u128(0x0000110a_0000_1000_8000_00805f9b34fb);
const HANDSFREE: GUID = GUID::from_u128(0x0000111e_0000_1000_8000_00805f9b34fb);

/// Paired Bluetooth devices for the notch dropdown.
#[tauri::command]
pub async fn bluetooth_devices() -> Result<Vec<BluetoothPeer>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let selector = BluetoothDevice::GetDeviceSelectorFromPairingState(true).map_err(|e| e.to_string())?;
        let devices = DeviceInformation::FindAllAsyncAqsFilter(&selector)
            .map_err(|e| e.to_string())?
            .join()
            .map_err(|e| e.to_string())?;
        let count = devices.Size().map_err(|e| e.to_string())?;
        let mut list: Vec<BluetoothPeer> = Vec::new();
        for i in 0..count {
            let Ok(info) = devices.GetAt(i) else { continue };
            let name = info.Name().map(|n| n.to_string()).unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let Ok(id) = info.Id() else { continue };
            let Ok(device) = BluetoothDevice::FromIdAsync(&id).and_then(|op| op.join()) else { continue };
            let Ok(address) = device.BluetoothAddress() else { continue };
            if list.iter().any(|p| p.address == address) {
                continue;
            }
            let connected = device.ConnectionStatus().map(|s| s == BluetoothConnectionStatus::Connected).unwrap_or(false);
            list.push(BluetoothPeer { name, address, connected });
        }
        list.sort_by(|a, b| b.connected.cmp(&a.connected).then_with(|| a.name.cmp(&b.name)));
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Best effort: wake a paired classic Bluetooth device by enabling its audio
/// services. Windows has no public "connect paired audio device" API, so this
/// may need to cycle the service once when the device is asleep.
#[tauri::command]
pub async fn bluetooth_connect(address: u64) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || connect_bluetooth(address))
        .await
        .map_err(|e| e.to_string())?
}

fn connect_bluetooth(address: u64) -> Result<bool, String> {
    let params = BLUETOOTH_FIND_RADIO_PARAMS { dwSize: std::mem::size_of::<BLUETOOTH_FIND_RADIO_PARAMS>() as u32 };
    let mut radio = HANDLE::default();
    let find = unsafe { BluetoothFindFirstRadio(&params, &mut radio) }.map_err(|e| e.to_string())?;

    let result = (|| -> Result<bool, String> {
        let mut info = BLUETOOTH_DEVICE_INFO {
            dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_INFO>() as u32,
            Address: BLUETOOTH_ADDRESS { Anonymous: BLUETOOTH_ADDRESS_0 { ullLong: address } },
            ..Default::default()
        };
        let code = unsafe { BluetoothGetDeviceInfo(Some(radio), &mut info) };
        if code != 0 {
            return Err(format!("Bluetooth device lookup failed ({code})"));
        }
        if info.fConnected.as_bool() {
            return Ok(true);
        }

        let services = [A2DP_SOURCE, HANDSFREE];
        for service in services {
            unsafe {
                BluetoothSetServiceState(Some(radio), &info, &service, BLUETOOTH_SERVICE_ENABLE);
            }
        }
        for _ in 0..10 {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let code = unsafe { BluetoothGetDeviceInfo(Some(radio), &mut info) };
            if code == 0 && info.fConnected.as_bool() {
                return Ok(true);
            }
        }

        // Some devices keep the service enabled while asleep, so a disable/enable
        // cycle is the only way to wake the audio link.
        for service in services {
            unsafe {
                BluetoothSetServiceState(Some(radio), &info, &service, BLUETOOTH_SERVICE_DISABLE);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(350));
        for service in services {
            unsafe {
                BluetoothSetServiceState(Some(radio), &info, &service, BLUETOOTH_SERVICE_ENABLE);
            }
        }
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let code = unsafe { BluetoothGetDeviceInfo(Some(radio), &mut info) };
            if code == 0 && info.fConnected.as_bool() {
                return Ok(true);
            }
        }
        Ok(false)
    })();

    let _ = unsafe { BluetoothFindRadioClose(find) };
    let _ = unsafe { CloseHandle(radio) };
    result
}

// â”€â”€ Energy: the Windows power mode overlay (Energy Saver Standard) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const EFFICIENCY: GUID = GUID::from_u128(0x961cc777_2547_4f9d_8174_7d86181b8a7a);
const BALANCED: GUID = GUID::from_u128(0);
const PERFORMANCE: GUID = GUID::from_u128(0xded574b5_45a0_4f42_8737_46345c09c238);
const BALANCED_PLAN: GUID = GUID::from_u128(0x381b4222_f694_41f0_9685_ff5bb260df2e);
const CUSTOM_PLAN: GUID = GUID::from_u128(0xb6f5e3a1_7c2d_4e8f_9a10_6d5c4b3a2918);
const BALANCED_PLAN_STR: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
const CUSTOM_PLAN_STR: &str = "b6f5e3a1-7c2d-4e8f-9a10-6d5c4b3a2918";

#[link(name = "powrprof", kind = "raw-dylib")]
extern "system" {
    fn PowerGetEffectiveOverlayScheme(effective: *mut GUID) -> u32;
    fn PowerSetActiveOverlayScheme(overlay: *const GUID) -> u32;
}

#[derive(Serialize)]
pub struct Energy {
    saver: bool,
    /// "saver" | "balanced" | "max" | "custom"
    scheme: &'static str,
    /// AC adapter connected. Max and Custom are only available while plugged in.
    plugged: bool,
    /// The fourth, purple Custom mode (a WinZal power plan) is available.
    custom: bool,
}

fn effective_overlay() -> Result<GUID, String> {
    let mut guid = GUID::from_u128(0);
    let ret = unsafe { PowerGetEffectiveOverlayScheme(&mut guid) };
    if ret != 0 {
        return Err(format!("Could not read the power mode ({ret})"));
    }
    Ok(guid)
}

fn set_overlay(overlay: &GUID) -> Result<(), String> {
    let ret = unsafe { PowerSetActiveOverlayScheme(overlay) };
    if ret != 0 {
        return Err(format!("Could not change the power mode ({ret})"));
    }
    Ok(())
}

fn overlay_name(guid: &GUID) -> &'static str {
    if *guid == EFFICIENCY {
        "saver"
    } else if *guid == PERFORMANCE {
        "max"
    } else if *guid == BALANCED {
        "balanced"
    } else {
        "max"
    }
}

fn ac_connected() -> bool {
    let mut status = SYSTEM_POWER_STATUS::default();
    let _ = unsafe { GetSystemPowerStatus(&mut status) };
    // 0 = battery, 1 = AC, 255 = unknown (treat as plugged so no mode disappears).
    status.ACLineStatus != 0
}

fn active_plan() -> Option<GUID> {
    let mut plan: *mut GUID = std::ptr::null_mut();
    let error = unsafe { PowerGetActiveScheme(None, &mut plan) };
    if error != ERROR_SUCCESS || plan.is_null() {
        return None;
    }
    let guid = unsafe { *plan };
    let _ = unsafe { LocalFree(Some(HLOCAL(plan as *mut _))) };
    Some(guid)
}

fn activate_plan(plan: &GUID) -> Result<(), String> {
    let error = unsafe { PowerSetActiveScheme(None, Some(plan)) };
    if error == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("Could not activate the power plan ({})", error.0))
    }
}

fn powercfg(args: &[&str]) -> bool {
    Command::new("powercfg").args(args).creation_flags(CREATE_NO_WINDOW).status().map(|status| status.success()).unwrap_or(false)
}

/// Create/refresh WinZal's fourth mode: a copy of Balanced with processor
/// throttling opened up and active cooling. No admin required; once per run.
fn ensure_custom_plan() -> Result<(), String> {
    static ONCE: OnceLock<Result<(), String>> = OnceLock::new();
    ONCE.get_or_init(|| {
        let list = Command::new("powercfg")
            .arg("/list")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| error.to_string())?;
        let text = String::from_utf8_lossy(&list.stdout).to_lowercase();
        if !text.contains(CUSTOM_PLAN_STR) {
            if !powercfg(&["/duplicatescheme", BALANCED_PLAN_STR, CUSTOM_PLAN_STR]) {
                return Err("Could not create the custom power plan".into());
            }
        }
        let _ = powercfg(&["/changename", CUSTOM_PLAN_STR, "WinZal Custom"]);
        let processor = "54533251-82be-4824-96c1-47b60b740d00";
        let min = "893dee8e-2bef-41e0-89c6-b55d0929964c";
        let max = "bc5038f7-23e0-4960-96da-33abaf5935ec";
        let cooling = "94d3a615-a899-4ac5-ae2b-e4d8f634367f";
        for (command, policy) in [("/setacvalueindex", "1"), ("/setdcvalueindex", "0")] {
            let _ = powercfg(&[command, CUSTOM_PLAN_STR, processor, min, "5"]);
            let _ = powercfg(&[command, CUSTOM_PLAN_STR, processor, max, "100"]);
            let _ = powercfg(&[command, CUSTOM_PLAN_STR, processor, cooling, policy]);
        }
        Ok(())
    })
    .clone()
}

fn energy_status() -> Result<Energy, String> {
    let guid = effective_overlay()?;
    let plugged = ac_connected();
    let active = active_plan();
    let mut scheme = if plugged && active == Some(CUSTOM_PLAN) {
        "custom"
    } else {
        // A Lenovo thermal mode is more specific than the Windows overlay when
        // the elevated helper is running (e.g. after Fn+Q).
        match crate::fps::lenovo_mode() {
            Some(1) => "saver",
            Some(2) => "balanced",
            Some(3) => "max",
            Some(4) => "custom",
            _ => overlay_name(&guid),
        }
    };
    if !plugged && scheme == "custom" {
        scheme = "balanced";
    }
    Ok(Energy { saver: scheme == "saver", scheme, plugged, custom: true })
}

/// Keep the promise of only two modes on battery: if the custom plan was left
/// active when the charger disappeared, glide back to Balanced.
pub fn spawn_energy_watch() {
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(2));
        if !ac_connected() && active_plan() == Some(CUSTOM_PLAN) {
            let _ = activate_plan(&BALANCED_PLAN);
            let _ = set_overlay(&BALANCED);
        }
    });
}

#[tauri::command]
pub fn energy_get() -> Result<Energy, String> {
    energy_status()
}

/// Set a power mode. Saver/Balanced/Max use the Windows overlay (and Lenovo's
/// fan mode when the helper is already running). Custom is WinZal's own power
/// plan: Balanced internals with processor throttling open and active cooling.
#[tauri::command]
pub async fn energy_set(mode: String) -> Result<Energy, String> {
    tauri::async_runtime::spawn_blocking(move || apply_energy(&mode)).await.map_err(|error| error.to_string())?
}

fn apply_energy(mode: &str) -> Result<Energy, String> {
    let mode = if mode == "high" { "max" } else { mode };
    let plugged = ac_connected();
    if !plugged && matches!(mode, "max" | "custom") {
        return Err("plugged".into());
    }
    let overlay = match mode {
        "saver" => EFFICIENCY,
        "balanced" => BALANCED,
        "max" => PERFORMANCE,
        "custom" => PERFORMANCE,
        other => return Err(format!("Unknown power mode: {other}")),
    };
    if mode == "custom" {
        ensure_custom_plan()?;
        activate_plan(&CUSTOM_PLAN)?;
    } else {
        activate_plan(&BALANCED_PLAN)?;
    }
    set_overlay(&overlay)?;

    // Keep Lenovo's fan profile in sync when the helper is already running.
    // Custom uses Performance cooling as well; it does not pretend to be
    // Vantage's purple fan curve, it is WinZal's own fourth power plan.
    let thermal = match mode {
        "saver" => 1,
        "balanced" => 2,
        "max" | "custom" => 3,
        _ => 0,
    };
    if thermal != 0 && crate::fps::helper_ready() {
        let _ = crate::fps::lenovo_set_mode(thermal);
    }

    energy_status()
}

// â”€â”€ Glim: the actual Windows Night Light â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NIGHT_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";

#[derive(Serialize)]
pub struct Glim {
    supported: bool,
    on: bool,
}

fn night_light() -> Result<(RegKey, Vec<u8>), String> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(NIGHT_KEY, KEY_READ | KEY_WRITE)
        .map_err(|e| e.to_string())?;
    let data = key.get_raw_value("Data").map_err(|e| e.to_string())?.bytes;
    Ok((key, data))
}

fn night_on(data: &[u8]) -> bool {
    data.len() > 18 && data[18] == 0x15
}

fn glim_status() -> Glim {
    match night_light() {
        Ok((_, data)) => Glim { supported: true, on: night_on(&data) },
        Err(_) => Glim { supported: false, on: false },
    }
}

#[tauri::command]
pub fn glim_get() -> Glim {
    glim_status()
}

#[tauri::command]
pub fn glim_set(on: bool) -> Result<Glim, String> {
    let (key, data) = night_light()?;
    let currently = night_on(&data);

    if currently != on {
        let mut next = vec![0u8; if currently { 41 } else { 43 }];

        if currently {
            let head = data.len().min(22);
            next[..head].copy_from_slice(&data[..head]);
            let tail = data.len().saturating_sub(25).min(18);
            if tail > 0 {
                next[23..23 + tail].copy_from_slice(&data[25..25 + tail]);
            }
            next[18] = 0x13;
        } else {
            let head = data.len().min(22);
            next[..head].copy_from_slice(&data[..head]);
            let tail = data.len().saturating_sub(23).min(18);
            if tail > 0 {
                next[25..25 + tail].copy_from_slice(&data[23..23 + tail]);
            }
            next[18] = 0x15;
            next[23] = 0x10;
            next[24] = 0x00;
        }

        // CloudStore's timestamp bytes: bump the first byte that isn't 0xff.
        for i in 10..15 {
            if next[i] != 0xff {
                next[i] = next[i].wrapping_add(1);
                break;
            }
        }

        key.set_raw_value("Data", &RegValue { bytes: next, vtype: RegType::REG_BINARY })
            .map_err(|e| e.to_string())?;
    }

    Ok(glim_status())
}

// â”€â”€ Power actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[tauri::command]
pub fn power_action(action: String) -> Result<(), String> {
    match action.as_str() {
        "lock" => unsafe { LockWorkStation().map_err(|e| e.message()) },
        "sleep" => {
            if unsafe { SetSuspendState(false, false, false) } {
                Ok(())
            } else {
                Err("Could not suspend the PC".into())
            }
        }
        "screen-off" => {
            unsafe {
                SendMessageW(
                    HWND_BROADCAST,
                    WM_SYSCOMMAND,
                    Some(WPARAM(SC_MONITORPOWER as usize)),
                    Some(LPARAM(2)),
                );
            }
            Ok(())
        }
        "restart" => Command::new("shutdown")
            .args(["/r", "/t", "0"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string()),
        "shutdown" => Command::new("shutdown")
            .args(["/s", "/t", "0"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string()),
        _ => Err("Unknown power action".into()),
    }
}

// â”€â”€ URI opener (whitelisted) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ALLOWED_URIS: &[&str] = &[
    "ms-availablenetworks:",
    "ms-settings:network-wifi",
    "ms-settings:bluetooth",
    "ms-settings:batterysaver",
    "ms-settings:nightlight",
    "https://github.com/Bipin223",
    "https://github.com/Bipin223/WinZal",
    "https://bipin-rijal.vercel.app",
];

#[tauri::command]
pub fn open_uri(uri: String) -> Result<(), String> {
    if !ALLOWED_URIS.contains(&uri.as_str()) {
        return Err("URI is not allowed".into());
    }
    Command::new("cmd")
        .args(["/C", "start", "", uri.as_str()])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
