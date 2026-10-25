//! Playback device list and default-output switching.
//!
//! Windows exposes the render endpoints through WASAPI, but setting the default
//! is still the (undocumented) `IPolicyConfig::SetDefaultEndpoint` call used by
//! the Sound control panel. We only need that one method; the slots before it
//! are declared as placeholders so the vtable order stays correct.

#![allow(non_snake_case)]

use serde::Serialize;
use windows::core::{interface, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::{
    PKEY_Device_DeviceDesc, PKEY_Device_EnumeratorName, PKEY_Device_FriendlyName,
};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::{
    eCommunications, eConsole, eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    PKEY_AudioEndpoint_FormFactor, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{
    PropVariantClear, PropVariantToStringAlloc, PropVariantToUInt32,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutput {
    id: String,
    /// Raw Windows friendly name, kept for sorting and tooltips.
    name: String,
    /// One-line label shown in the picker: device name for Bluetooth, otherwise
    /// the output type ("Speaker", "Headphones", "Headset", "Display").
    label: String,
    /// `bluetooth`, `headphones`, `headset`, `display` or `speaker`.
    kind: String,
    is_default: bool,
}

#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: windows::core::IUnknown {
    unsafe fn Reserved1(&self) -> windows::core::HRESULT;
    unsafe fn Reserved2(&self) -> windows::core::HRESULT;
    unsafe fn Reserved3(&self) -> windows::core::HRESULT;
    unsafe fn Reserved4(&self) -> windows::core::HRESULT;
    unsafe fn Reserved5(&self) -> windows::core::HRESULT;
    unsafe fn Reserved6(&self) -> windows::core::HRESULT;
    unsafe fn Reserved7(&self) -> windows::core::HRESULT;
    unsafe fn Reserved8(&self) -> windows::core::HRESULT;
    unsafe fn Reserved9(&self) -> windows::core::HRESULT;
    unsafe fn Reserved10(&self) -> windows::core::HRESULT;
    unsafe fn SetDefaultEndpoint(&self, id: *const u16, role: windows::Win32::Media::Audio::ERole) -> windows::core::HRESULT;
    unsafe fn SetEndpointVisibility(&self, id: *const u16, visible: windows::core::BOOL) -> windows::core::HRESULT;
}

const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

fn take_pwstr(value: PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    unsafe {
        let text = value.to_string().unwrap_or_default();
        CoTaskMemFree(Some(value.0 as *const _));
        text
    }
}

fn string_prop(store: &IPropertyStore, key: &PROPERTYKEY) -> String {
    unsafe {
        let Ok(mut value) = store.GetValue(key) else {
            return String::new();
        };
        let text = PropVariantToStringAlloc(&value)
            .map(|p| take_pwstr(p))
            .unwrap_or_default();
        let _ = PropVariantClear(&mut value);
        text
    }
}

fn u32_prop(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<u32> {
    unsafe {
        let mut value = store.GetValue(key).ok()?;
        let number = PropVariantToUInt32(&value).ok();
        let _ = PropVariantClear(&mut value);
        number
    }
}

/// "Headphones (CODE2)" → "CODE2"; names without a parenthetical stay as-is.
fn parenthetical_name(name: &str) -> String {
    let trimmed = name.trim();
    if let (Some(open), Some(close)) = (trimmed.find('('), trimmed.rfind(')')) {
        if close > open + 1 {
            let inner = trimmed[open + 1..close].trim();
            if !inner.is_empty() {
                return inner.to_string();
            }
        }
    }
    trimmed.to_string()
}

/// The picker shows one short line per endpoint. Bluetooth keeps the real
/// device name (that is what the user picks); wired outputs use their type.
fn classify(name: &str, enumerator: &str, description: &str, form_factor: u32) -> (String, String) {
    let enumerator = enumerator.to_ascii_lowercase();
    let description = description.to_ascii_lowercase();
    let friendly = name.to_ascii_lowercase();
    let bluetooth = enumerator.contains("bthenum")
        || enumerator.contains("bthhfenum")
        || description.contains("bluetooth")
        || friendly.contains("bluetooth");
    if bluetooth {
        return ("bluetooth".into(), parenthetical_name(name));
    }
    match form_factor {
        3 => ("headphones".into(), "Headphones".into()),
        5 | 6 => ("headset".into(), "Headset".into()),
        9 => ("display".into(), "Display".into()),
        _ => ("speaker".into(), "Speaker".into()),
    }
}

fn enumerate() -> windows::core::Result<Vec<AudioOutput>> {
    unsafe {
        // Commands run on their own worker thread; MTA is what the audio APIs want.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .and_then(|device| device.GetId())
            .map(|id| take_pwstr(id))
            .unwrap_or_default();
        let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let count = collection.GetCount()?;
        let mut out = Vec::with_capacity(count as usize);
        for i in 0..count {
            let Ok(device) = collection.Item(i) else { continue };
            let Ok(id_ptr) = device.GetId() else { continue };
            let id = take_pwstr(id_ptr);
            if id.is_empty() {
                continue;
            }
            let store = device.OpenPropertyStore(STGM_READ).ok();
            let name = store
                .as_ref()
                .map(|store| string_prop(store, &PKEY_Device_FriendlyName))
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| id.clone());
            let enumerator = store
                .as_ref()
                .map(|store| string_prop(store, &PKEY_Device_EnumeratorName))
                .unwrap_or_default();
            let description = store
                .as_ref()
                .map(|store| string_prop(store, &PKEY_Device_DeviceDesc))
                .unwrap_or_default();
            let form_factor = store
                .as_ref()
                .and_then(|store| u32_prop(store, &PKEY_AudioEndpoint_FormFactor))
                .unwrap_or(0);
            let (kind, label) = classify(&name, &enumerator, &description, form_factor);
            out.push(AudioOutput { id: id.clone(), name, label, kind, is_default: id == default_id });
        }
        out.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }
}

fn set_default(id: &str) -> windows::core::Result<()> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let config: IPolicyConfig = CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL)?;
        let wide = HSTRING::from(id);
        let ptr = PCWSTR(wide.as_ptr());
        let mut last = windows::core::HRESULT(0);
        let mut any = false;
        for role in [eConsole, eMultimedia, eCommunications] {
            let hr = config.SetDefaultEndpoint(ptr.0, role);
            if hr.is_ok() {
                any = true;
            } else {
                last = hr;
            }
        }
        if any { Ok(()) } else { last.ok() }
    }
}

#[tauri::command]
pub async fn audio_outputs() -> Result<Vec<AudioOutput>, String> {
    tauri::async_runtime::spawn_blocking(|| enumerate().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn audio_set_output(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_default(&id).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bluetooth_uses_the_device_name_and_an_icon_kind() {
        assert_eq!(classify("Headphones (CODE2)", "BTHENUM", "", 3), ("bluetooth".into(), "CODE2".into()));
        assert_eq!(classify("Headset Earphone (WH-1000XM4)", "BTHHFENUM", "", 5), ("bluetooth".into(), "WH-1000XM4".into()));
    }

    #[test]
    fn wired_outputs_use_short_type_labels() {
        assert_eq!(classify("Speakers (Realtek(R) Audio)", "HDAUDIO", "", 1), ("speaker".into(), "Speaker".into()));
        assert_eq!(classify("Headphones (HyperX Cloud)", "USB", "", 3), ("headphones".into(), "Headphones".into()));
        assert_eq!(classify("PHL 275V8", "HDAUDIO", "", 9), ("display".into(), "Display".into()));
    }

    #[test]
    fn lists_outputs_and_keeps_the_default() {
        let outputs = enumerate().expect("enumerate render endpoints");
        assert!(!outputs.is_empty(), "expected at least one render endpoint");
        for output in &outputs {
            println!("{} -> {} ({})", output.name, output.label, output.kind);
            assert!(!output.label.contains('('), "picker label should not show the parenthetical: {}", output.label);
        }
        let default = outputs.iter().find(|d| d.is_default).expect("one default endpoint");
        set_default(&default.id).expect("set the already-default endpoint");
    }
}
