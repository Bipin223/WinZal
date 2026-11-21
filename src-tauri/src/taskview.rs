//! Opens the native Windows Task View.

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN,
    VK_TAB,
};

/// Win+Tab is the shell's own Task View: live window thumbnails and virtual
/// desktops, with all Windows behaviour included. Sending it from our top-left
/// button is more faithful than trying to rebuild the shell overlay.
#[tauri::command]
pub fn task_view() -> Result<(), String> {
    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                ..Default::default()
            },
        },
    };
    let inputs = [key(VK_LWIN, false), key(VK_TAB, false), key(VK_TAB, true), key(VK_LWIN, true)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows did not open Task View".into())
    }
}
