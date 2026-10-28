pub mod ai;
mod ambient;
mod ask_history;
mod audio;
mod audio_out;
mod charging_sound;
mod clipboard;
mod controls;
mod convert;
mod files;
mod discord;
mod display;
mod documents;
mod drop;
mod fps;
mod hit_test;
mod lyrics;
mod media;
mod memory;
mod mixer;
mod privacy;
pub mod secrets;
mod system;
mod temps;
mod toasts;
mod vault;

use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

/// Opens/closes the notch from anywhere. Ctrl+Alt = AltGr on German keyboards;
/// AltGr+Space types nothing, so there's no conflict.
const SHORTCUT_LABEL: &str = "Ctrl+Alt+Space";

/// For main.rs: elevated FPS helper (see fps::run_helper).
pub fn fps_helper(main_pid: u32) -> ! {
    fps::run_helper(main_pid)
}

/// WebView2 args shared by both render modes.
const WEBVIEW_BASE_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,msEdgeTranslate,SpareRendererForSitePerProcess,OptimizationHints,MediaRouter,AutofillServerCommunication,AudioServiceOutOfProcess --disable-background-networking --disable-component-update --disable-sync --no-pings --renderer-process-limit=1 --in-process-gpu --enable-low-end-device-mode --enable-features=NetworkServiceInProcess --js-flags=--max-old-space-size=64";

fn render_mode_path() -> Option<std::path::PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(std::path::PathBuf::from(local).join("app.winzal").join("render-mode"))
}

fn gpu_preference_path() -> Option<std::path::PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(std::path::PathBuf::from(local).join("app.winzal").join("gpu-preference"))
}

/// auto | igpu | dgpu (personal build defaults to the discrete GPU).
fn gpu_preference() -> String {
    gpu_preference_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "dgpu".into())
}

/// CPU (software) is the default. GPU is opt-in through Performance; it uses
/// the integrated GPU unless the user picks the discrete one.
fn webview_args() -> String {
    let gpu = render_mode_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .is_some_and(|s| s.trim() == "gpu");
    if gpu {
        let mut args = WEBVIEW_BASE_ARGS.to_string();
        // Chromium 145+ honors these on Windows (WebView2 155 here).
        match gpu_preference().as_str() {
            "igpu" => args.push_str(" --force_low_power_gpu"),
            "dgpu" => args.push_str(" --force_high_performance_gpu"),
            _ => {}
        }
        args
    } else {
        format!("{WEBVIEW_BASE_ARGS} --disable-gpu")
    }
}

/// Persist which renderer to use. One call writes both files so the choice is
/// atomic and the app restarts into exactly CPU, iGPU, or dGPU.
#[tauri::command]
fn set_rendering(mode: String) -> Result<(), String> {
    let (render, preference) = match mode.as_str() {
        "cpu" => ("cpu", None),
        "igpu" => ("gpu", Some("igpu")),
        "dgpu" => ("gpu", Some("dgpu")),
        other => return Err(format!("Unknown rendering mode: {other}")),
    };
    let render_path = render_mode_path().ok_or("LOCALAPPDATA is not available")?;
    if let Some(dir) = render_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&render_path, render).map_err(|e| e.to_string())?;
    if let Some(preference) = preference {
        let pref_path = gpu_preference_path().ok_or("LOCALAPPDATA is not available")?;
        std::fs::write(pref_path, preference).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Persist the render mode; the frontend relaunches the app afterwards.
#[tauri::command]
fn set_webview_render_mode(mode: String) -> Result<(), String> {
    let value = match mode.as_str() {
        "gpu" => "gpu",
        "cpu" => "cpu",
        other => return Err(format!("Unknown render mode: {other}")),
    };
    let path = render_mode_path().ok_or("LOCALAPPDATA is not available")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, value).map_err(|e| e.to_string())
}

/// Persist which GPU the WebView should prefer; applies after a restart.
#[tauri::command]
fn set_gpu_preference(mode: String) -> Result<(), String> {
    let value = match mode.as_str() {
        "auto" => "auto",
        "igpu" => "igpu",
        "dgpu" => "dgpu",
        other => return Err(format!("Unknown GPU preference: {other}")),
    };
    let path = gpu_preference_path().ok_or("LOCALAPPDATA is not available")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, value).map_err(|e| e.to_string())
}

pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let presentation = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP);
    let silent = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS);
    let power = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), Code::KeyM);
    let (h_shortcut, h_presentation, h_silent, h_power) = (shortcut.clone(), presentation.clone(), silent.clone(), power.clone());

    tauri::Builder::default()
        // A second launch doesn't open a second notch.
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        // Updates: signed installers from GitHub, only on click in the settings.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, pressed, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if pressed == &h_shortcut {
                        let _ = app.emit("notch://shortcut", ());
                    } else if pressed == &h_presentation {
                        let _ = app.emit("notch://presentation-toggle", ());
                    } else if pressed == &h_silent {
                        let _ = app.emit("notch://silent-toggle", ());
                    } else if pressed == &h_power {
                        let _ = app.emit("notch://power-cycle", ());
                    }
                })
                .build(),
        )
        .manage(hit_test::HitState::default())
        .manage(media::MediaState::default())
        .manage(lyrics::LyricsState::default())
        .manage(mixer::MixerState::default())
        .manage(clipboard::ClipboardState::default())
        .manage(FocusState::default())
        .manage(TrayItems::default())
        .manage(audio::AudioState::default())
        .manage(ai::AiState::default())
        .manage(system::SystemState::default())
        .manage(display::DisplayState::default())
        .manage(display::NotifyState::default())
        .manage(discord::DiscordState::default())
        .manage(vault::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            hit_test::set_hit_rect,
            hit_test::set_pinned,
            hit_test::set_silent,
            media::media_get,
            lyrics::lyrics_get,
            media::media_control,
            media::media_control_session,
            media::media_sessions,
            media::media_select,
            memory::memory_low,
            memory::trim_memory,
            drop::drop_reinstall,
            clipboard::clipboard_list,
            clipboard::clipboard_mode,
            clipboard::clipboard_copy,
            clipboard::clipboard_pin,
            clipboard::clipboard_delete,
            clipboard::clipboard_clear,
            clipboard::clipboard_preview,
            clipboard::clipboard_paste_files,
            keyboard_focus,
            set_notch_height,
            set_notch_width,
            notch_prompt_mode,
            set_webview_render_mode,
            set_gpu_preference,
            set_rendering,
            audio::audio_levels,
            ai::ai_chat,
            ai::ai_cancel,
            ai::ai_models,
            ask_history::ask_history_list,
            ask_history::ask_history_load,
            ask_history::ask_history_save,
            ask_history::ask_history_delete,
    ask_history::ask_history_clear,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_has,
            system::system_stats,
            files::file_probe,
            files::file_text,
            files::reveal_file,
            files::open_path,
            files::copy_files,
            files::file_preview,
            files::file_preview_large,
            convert::convert_probe,
            convert::convert_files,
            display::display_monitors,
            display::display_apply,
            display::notification_visible,
            display::apps_visible,
            fps::gaming_fps,
            fps::fps_unlock,
            fps::fps_helper_ready,
            fps::fps_release,
            toasts::toast_access,
            toasts::toast_request,
            toasts::toast_list,
            toasts::open_notification_app,
            toasts::toast_watch,
            controls::volume_get,
            controls::volume_set,
            mixer::mixer_list,
            mixer::mixer_set,
            mixer::media_open_source,
            audio_out::audio_outputs,
            audio_out::audio_set_output,
            tray_focus,
            tray_silent,
            tray_presentation,
            controls::focus_get,
            controls::focus_set,
            controls::brightness_get,
            controls::brightness_set,
            ambient::network_get,
            ambient::wifi_set,
            ambient::wifi_networks,
            ambient::wifi_connect,
            ambient::bluetooth_get,
            ambient::bluetooth_set,
            ambient::bluetooth_devices,
            ambient::bluetooth_connect,
            ambient::energy_get,
            ambient::energy_set,
            ambient::battery_status,
            ambient::glim_get,
            ambient::glim_set,
            ambient::power_action,
            ambient::open_uri,
            privacy::privacy_state,
            discord::discord_configure,
            discord::discord_action,
            discord::discord_activity,
            discord::discord_state,
            vault::vault_status,
            vault::vault_setup,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_save_password,
            vault::vault_add_totp,
            vault::vault_delete,
            vault::vault_reveal,
            vault::vault_copy,
            vault::vault_codes,
            vault::vault_options,
            vault::vault_change_pin,
            vault::vault_reset,
            vault::vault_scan,
            vault::vault_hello_supported,
            vault::vault_hello_unlock,
            vault::vault_hello_enable,
            vault::vault_hello_disable,
            set_language,
            autostart_get,
            autostart_set,
        ])
        .setup(move |app| {
            // Shared FPS counters (created by the normal app, read by the elevated
            // helper). After single-instance, so a second launch cannot grab it.
            fps::init();
            // The WebView2 arguments must be chosen at runtime, so this window is
            // built here instead of by Tauri's automatic config creation.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "notch")
                .cloned()
                .expect("window 'notch' missing in config");
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .additional_browser_args(&webview_args())
                .build()?;
            display::place(&window, &app.state::<display::DisplayState>())?;
            window.show()?;
            // Only after show(): this fails on a window that was never shown.
            window.set_ignore_cursor_events(true)?;
            drop::install(&window);
            hit_test::spawn(app.handle().clone(), window.clone());
            display::spawn(app.handle().clone(), window);
            ambient::spawn_energy_watch();
            ambient::restore_power(app.handle().clone());
            charging_sound::spawn();
            media::spawn(app.handle().clone());
            clipboard::spawn(app.handle().clone());
            toasts::spawn(app.handle().clone());
            audio::spawn(app.handle().clone(), &app.state::<audio::AudioState>());
            // If another app owns the shortcut, the notch still runs, just without it.
            let _ = app.global_shortcut().register(shortcut);
            let _ = app.global_shortcut().register(presentation);
            let _ = app.global_shortcut().register(silent);
            let _ = app.global_shortcut().register(power);
            enable_autostart_once(app.handle());
            build_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start WinZal");
}

/// Window that was in the foreground before the shortcut opened the notch.
#[derive(Default)]
struct FocusState(Mutex<isize>);

/// Compact the transparent notch window while it is closed. A 760×560
/// always-on-top window over a game is much more compositor work than the
/// visible pill; 120 px still fits the closed pill, lyrics and notification cards.
#[tauri::command]
fn set_notch_height(height: f64, window: WebviewWindow) -> Result<(), String> {
    let height = height.clamp(120.0, 700.0);
    window
        .set_size(tauri::LogicalSize::new(1260.0, height))
        .map_err(|error| error.to_string())
}

/// Widen the transparent window for an attached flyout. The notch is centered
/// inside the window, so the window is re-centered on the monitor after the
/// resize; otherwise the notch would jump sideways.
#[tauri::command]
fn set_notch_width(width: f64, window: WebviewWindow, state: State<'_, display::DisplayState>) -> Result<(), String> {
    // Never make the transparent window wider than the monitor: the notch is
    // centered inside it, so an oversized window would push the pill sideways.
    let max_width = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.size().width as f64 / monitor.scale_factor())
        .unwrap_or(1400.0)
        .max(760.0);
    let width = width.clamp(760.0, max_width.min(1400.0));
    let scale = window.scale_factor().unwrap_or(1.0);
    let height = window
        .outer_size()
        .map(|size| size.height as f64 / scale)
        .unwrap_or(560.0);
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    display::place(&window, &state).map_err(|error| error.to_string())
}

/// Opened via shortcut → take focus (for Esc/typing).
/// Closed → give focus back to the previous app, otherwise typing goes nowhere.
#[tauri::command]
fn keyboard_focus(focus: bool, window: WebviewWindow, state: State<'_, FocusState>) {
    let Ok(own) = window.hwnd() else { return };
    let own = own.0 as isize;
    let foreground = unsafe { GetForegroundWindow() }.0 as isize;
    let mut previous = state.0.lock().unwrap();

    if focus {
        if foreground != own {
            *previous = foreground;
        }
        let _ = window.set_focus();
    } else if foreground == own && *previous != 0 {
        let _ = unsafe { SetForegroundWindow(HWND(*previous as *mut _)) };
        *previous = 0;
    }
}

/// Windows Hello shows its own secure prompt. Drop the notch's always-on-top
/// flag while the prompt is open, then restore it, so the Hello field is usable.
#[tauri::command]
fn notch_prompt_mode(active: bool, window: WebviewWindow) {
    let _ = window.set_always_on_top(!active);
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(enabled: bool, app: AppHandle) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())
}

/// Enables autostart on the very first launch; after that the tray check and settings decide.
fn enable_autostart_once(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let marker = dir.join("autostart-initialized");
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, "");
    }
}

/// Tray items whose text or check state changes at runtime.
struct Tray {
    open: MenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    focus: CheckMenuItem<tauri::Wry>,
    silent: CheckMenuItem<tauri::Wry>,
    presentation: CheckMenuItem<tauri::Wry>,
    autostart: CheckMenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(Default)]
struct TrayItems(Mutex<Option<Tray>>);

/// English-only tray menu. Open (shortcut right-aligned via tab, like Windows
/// menus), settings, focus mode, silent, presentation, autostart, quit.
fn tray_texts(_lang: &str) -> [String; 7] {
    [
        format!("Open WinZal\t{SHORTCUT_LABEL}"),
        "Settings…".into(),
        "Do not disturb".into(),
        "Silent mode".into(),
        "Presentation mode".into(),
        "Start with Windows".into(),
        "Quit WinZal".into(),
    ]
}

#[tauri::command]
fn set_language(lang: String, state: State<'_, TrayItems>) {
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let [a, b, c, d, e, f, g] = tray_texts(&lang);
        let _ = tray.open.set_text(a);
        let _ = tray.settings.set_text(b);
        let _ = tray.focus.set_text(c);
        let _ = tray.silent.set_text(d);
        let _ = tray.presentation.set_text(e);
        let _ = tray.autostart.set_text(f);
        let _ = tray.quit.set_text(g);
    }
}

/// The frontend owns focus mode; the tray check only mirrors it.
#[tauri::command]
fn tray_focus(on: bool, state: State<'_, TrayItems>) {
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.focus.set_checked(on);
    }
}

#[tauri::command]
fn tray_silent(on: bool, state: State<'_, TrayItems>) {
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.silent.set_checked(on);
    }
}

#[tauri::command]
fn tray_presentation(on: bool, state: State<'_, TrayItems>) {
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.presentation.set_checked(on);
    }
}

/// Dark tray menu to match the notch instead of the light default.
/// uxtheme only exports this by ordinal: SetPreferredAppMode = 135, FlushMenuThemes = 136
/// (Windows 10 1903+). If missing, the menu just stays light.
fn dark_menus() {
    use windows::core::{w, PCSTR};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    const FORCE_DARK: i32 = 2;
    unsafe {
        let Ok(uxtheme) = LoadLibraryW(w!("uxtheme.dll")) else { return };
        if let Some(f) = GetProcAddress(uxtheme, PCSTR(135 as *const u8)) {
            let set_preferred_app_mode: extern "system" fn(i32) -> i32 = std::mem::transmute(f);
            set_preferred_app_mode(FORCE_DARK);
        }
        if let Some(f) = GetProcAddress(uxtheme, PCSTR(136 as *const u8)) {
            let flush_menu_themes: extern "system" fn() = std::mem::transmute(f);
            flush_menu_themes();
        }
    }
}

/// Without a taskbar entry, the tray is where you open, configure and quit.
/// Left click opens the notch, right click shows the menu.
fn build_tray(app: &App) -> tauri::Result<()> {
    dark_menus();
    let enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let [open_text, settings_text, focus_text, silent_text, presentation_text, autostart_text, quit_text] = tray_texts("en");
    let open = MenuItem::with_id(app, "open", open_text, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", settings_text, true, None::<&str>)?;
    // The real state follows right after start (the frontend calls tray_focus).
    let focus = CheckMenuItem::with_id(app, "focus", focus_text, true, false, None::<&str>)?;
    let silent = CheckMenuItem::with_id(app, "silent", silent_text, true, false, None::<&str>)?;
    let presentation = CheckMenuItem::with_id(app, "presentation", presentation_text, true, false, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", autostart_text, true, enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_text, true, None::<&str>)?;
    *app.state::<TrayItems>().0.lock().unwrap() = Some(Tray {
        open: open.clone(),
        settings: settings.clone(),
        focus: focus.clone(),
        silent: silent.clone(),
        presentation: presentation.clone(),
        autostart: autostart.clone(),
        quit: quit.clone(),
    });
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &focus,
            &silent,
            &presentation,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let autostart_item = autostart.clone();
    let focus_item = focus.clone();
    let silent_item = silent.clone();
    let presentation_item = presentation.clone();
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("WinZal")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = tray.app_handle().emit("notch://open", None::<&str>);
            }
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                let _ = app.emit("notch://open", None::<&str>);
            }
            "settings" => {
                let _ = app.emit("notch://open", Some("settings"));
            }
            "quit" => app.exit(0),
            "focus" => {
                // The click already toggled the check; the frontend applies it and mirrors it back.
                let on = focus_item.is_checked().unwrap_or(false);
                let _ = app.emit("notch://focus-set", on);
            }
            "silent" => {
                let on = silent_item.is_checked().unwrap_or(false);
                let _ = app.emit("notch://silent-set", on);
            }
            "presentation" => {
                let on = presentation_item.is_checked().unwrap_or(false);
                let _ = app.emit("notch://presentation-set", on);
            }
            "autostart" => {
                // The check item toggles itself on click; read the new state.
                let on = autostart_item.is_checked().unwrap_or(false);
                let manager = app.autolaunch();
                let _ = if on { manager.enable() } else { manager.disable() };
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
