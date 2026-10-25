//! Playback device list and default-output switching.
//!
//! Windows exposes the render endpoints through WASAPI, but setting the default
//! is still the (undocumented) `IPolicyConfig::SetDefaultEndpoint` call used by
//! the Sound control panel. We only need that one method; the slots before it
//! are declared as placeholders so the vtable order stays correct.

#![allow(non_snake_case)]

use serde::Serialize;
use windows::core::{interface, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{
    eCommunications, eConsole, eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutput {
    id: String,
    name: String,
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
            let name = device
                .OpenPropertyStore(STGM_READ)
                .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
                .map(|mut value| {
                    let name = PropVariantToStringAlloc(&value).map(|p| take_pwstr(p)).unwrap_or_default();
                    let _ = PropVariantClear(&mut value);
                    name
                })
                .unwrap_or_else(|_| id.clone());
            out.push(AudioOutput { id: id.clone(), name, is_default: id == default_id });
        }
        out.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
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
    fn lists_outputs_and_keeps_the_default() {
        let outputs = enumerate().expect("enumerate render endpoints");
        assert!(!outputs.is_empty(), "expected at least one render endpoint");
        let default = outputs.iter().find(|d| d.is_default).expect("one default endpoint");
        set_default(&default.id).expect("set the already-default endpoint");
    }
}
