//! Dev helper: which Windows Do Not Disturb path works on this build?
//! Run: cargo run --release --example focus_debug

use std::time::Duration;

use windows::UI::Shell::FocusSessionManager;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryWnfStateData(state: *const u64, type_id: *const core::ffi::c_void, scope: *const core::ffi::c_void, stamp: *mut u32, buffer: *mut core::ffi::c_void, size: *mut u32) -> i32;
    fn NtUpdateWnfStateData(state: *const u64, buffer: *const core::ffi::c_void, length: u32, type_id: *const core::ffi::c_void, scope: *const core::ffi::c_void, matching_stamp: u32, check_stamp: u32) -> i32;
}

const WNF_QUIET_HOURS: u64 = 0x0D83_063E_A3BF_1C75;

fn dnd() -> Option<u32> {
    let (mut stamp, mut value, mut size) = (0u32, 0u32, 4u32);
    let status = unsafe { NtQueryWnfStateData(&WNF_QUIET_HOURS, std::ptr::null(), std::ptr::null(), &mut stamp, (&mut value as *mut u32).cast(), &mut size) };
    println!("wnf query status={status:#x} size={size} value={value}");
    (status >= 0).then_some(value)
}

fn main() {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    println!("supported: {:?}", FocusSessionManager::IsSupported());
    if let Ok(manager) = FocusSessionManager::GetDefault() {
        println!("focus active: {:?}", manager.IsFocusActive());
        match manager.TryStartFocusSession() {
            Ok(session) => {
                println!("started: {:?} active={:?}", session.Id(), manager.IsFocusActive());
                std::thread::sleep(Duration::from_millis(500));
                dnd();
                println!("end: {:?}", session.End());
                std::thread::sleep(Duration::from_millis(500));
                println!("after end active={:?}", manager.IsFocusActive());
                dnd();
            }
            Err(e) => println!("start failed: {e:?}"),
        }
    } else {
        println!("no default focus manager");
    }

    let value = 1u32;
    let status = unsafe { NtUpdateWnfStateData(&WNF_QUIET_HOURS, (&value as *const u32).cast(), 4, std::ptr::null(), std::ptr::null(), 0, 0) };
    println!("wnf set 1 status={status:#x}");
    dnd();
    let value = 0u32;
    let status = unsafe { NtUpdateWnfStateData(&WNF_QUIET_HOURS, (&value as *const u32).cast(), 4, std::ptr::null(), std::ptr::null(), 0, 0) };
    println!("wnf set 0 status={status:#x}");
    dnd();
}
