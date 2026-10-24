//! CPU/GPU temperatures.
//!
//! - Lenovo Legion/LOQ: `LENOVO_GAMEZONE_DATA.GetCPUTemp/GetGPUTemp` via WMI.
//!   The provider only exposes its singleton instance to elevated processes, so
//!   this is used from the elevated FPS helper (or an elevated WinZal).
//! - Everyone else: GPU temperature from `nvidia-smi` (NVIDIA driver, no admin).
//!   CPU temperature stays unknown; Windows does not expose it without a driver.

use std::collections::HashMap;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::process::Command;

use wmi::{Variant, WMIConnection};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Opt-in diagnostics for the Lenovo WMI path (`WINZAL_TEMP_LOG=1`).
fn trace(message: &str) {
    if std::env::var_os("WINZAL_TEMP_LOG").is_none() {
        return;
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("winzal-temp.log")) {
        let _ = writeln!(file, "{message}");
    }
}

/// Lenovo returns `Data` plus a `ReturnValue` whose WMI type differs by model
/// (bool on some, uint32 on others). Serde ignores the extra field; only Data counts.
#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct LenovoTemp {
    #[serde(default)]
    Data: u32,
}

/// Reusable Lenovo WMI connection. Create it inside the thread that uses it.
pub struct Lenovo {
    wmi: WMIConnection,
    path: String,
}

impl Lenovo {
    pub fn open() -> Option<Self> {
        let wmi = match WMIConnection::with_namespace_path("ROOT\\WMI") {
            Ok(wmi) => wmi,
            Err(e) => {
                trace(&format!("wmi connect failed: {e:?}"));
                return None;
            }
        };
        let rows: Vec<HashMap<String, Variant>> = match wmi.raw_query("SELECT __PATH, InstanceName FROM LENOVO_GAMEZONE_DATA") {
            Ok(rows) => rows,
            Err(e) => {
                trace(&format!("lenovo query failed: {e:?}"));
                return None;
            }
        };
        let Some(row) = rows.first() else { return None };
        for (key, value) in row {
            trace(&format!("lenovo row {key} = {value:?}"));
        }
        let path = match row.get("__PATH") {
            Some(Variant::String(path)) => path.clone(),
            _ => {
                let instance = match row.get("InstanceName") {
                    Some(Variant::String(name)) => name.clone(),
                    _ => {
                        trace("lenovo InstanceName missing");
                        return None;
                    }
                };
                format!("\\\\.\\ROOT\\wmi:LENOVO_GAMEZONE_DATA.InstanceName=\"{}\"", instance.replace('\\', "\\\\").replace('"', "\\\""))
            }
        };
        trace(&format!("lenovo rows={} path={path:?}", rows.len()));
        Some(Self { wmi, path })
    }

    /// (CPU °C, GPU °C)
    pub fn temps(&self) -> (Option<u32>, Option<u32>) {
        (self.call("GetCPUTemp"), self.call("GetGPUTemp"))
    }

    fn call(&self, method: &str) -> Option<u32> {
        // The provider's methods are dynamic: the class object's GetMethod returns
        // nothing, but the instance's GetMethod works (same as ManagementObject).
        let mut output = None;
        if let Ok(instance) = self.wmi.get_object(&self.path) {
            if let Ok((input, _output)) = instance.get_method_in_out(method) {
                let params = input.and_then(|signature| signature.spawn_instance().ok());
                match self.wmi.exec_method(&self.path, method, params.as_ref()) {
                    Ok(out) => output = out,
                    Err(error) => trace(&format!("{method} exec failed: {error:?}")),
                }
            } else {
                trace(&format!("{method} signature failed; trying without params"));
            }
        } else {
            trace(&format!("{method} instance object failed"));
        }
        if output.is_none() {
            match self.wmi.exec_method(&self.path, method, None) {
                Ok(out) => output = out,
                Err(error) => trace(&format!("{method} no-params exec failed: {error:?}")),
            }
        }
        match output {
            Some(output) => {
                if std::env::var_os("WINZAL_TEMP_LOG").is_some() {
                    // Lenovo's ReturnValue type differs between models; only Data matters.
                    if let Ok(props) = output.list_properties() {
                        for prop in props {
                            trace(&format!("{method} out {prop} = {:?}", output.get_property(&prop)));
                        }
                    }
                }
                if let Ok(out) = output.into_desr::<LenovoTemp>() {
                    trace(&format!("{method} data={}", out.Data));
                    (out.Data > 0 && out.Data < 150).then_some(out.Data)
                } else {
                    trace(&format!("{method} output deserialize failed"));
                    None
                }
            }
            None => {
                trace(&format!("{method} returned no output"));
                None
            }
        }
    }
}

/// NVIDIA GPU temperature without admin rights: the driver ships `nvidia-smi`.
/// Called at most every other second from the system polling thread.
pub fn nvidia_smi() -> Option<u32> {
    let out = Command::new("nvidia-smi")
        .args(["--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()?
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|t| *t > 0 && *t < 150)
}
