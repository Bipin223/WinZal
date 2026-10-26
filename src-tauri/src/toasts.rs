use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotificationChangedEventArgs};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemToast {
    pub id: u32,
    pub app_id: String,
    pub app: String,
    pub title: String,
    pub body: String,
}

fn status_from(value: UserNotificationListenerAccessStatus) -> &'static str {
    if value == UserNotificationListenerAccessStatus::Allowed {
        "allowed"
    } else if value == UserNotificationListenerAccessStatus::Denied {
        "denied"
    } else {
        "unspecified"
    }
}

pub fn access_status() -> &'static str {
    match UserNotificationListener::Current().and_then(|listener| listener.GetAccessStatus()) {
        Ok(value) => status_from(value),
        Err(_) => "unavailable",
    }
}

fn read_toasts() -> Result<Vec<SystemToast>, String> {
    let listener = UserNotificationListener::Current().map_err(|error| error.message())?;
    let list = listener
        .GetNotificationsAsync(NotificationKinds::Toast)
        .map_err(|error| error.message())?
        .join()
        .map_err(|error| error.message())?;
    let size = list.Size().map_err(|error| error.message())?;
    let mut out = Vec::new();
    for index in 0..size {
        let Ok(item) = list.GetAt(index) else { continue };
        let id = item.Id().unwrap_or(0);
        if id == 0 {
            continue;
        }
        let info = item.AppInfo().ok();
        let app_id = info
            .as_ref()
            .and_then(|info| info.AppUserModelId().ok())
            .map(|id| id.to_string())
            .unwrap_or_default();
        let app = info
            .as_ref()
            .and_then(|info| info.DisplayInfo().ok())
            .and_then(|display| display.DisplayName().ok())
            .map(|name| name.to_string())
            .filter(|name| !name.trim().is_empty())
            .or_else(|| (!app_id.is_empty()).then(|| app_id.clone()))
            .unwrap_or_default();
        if app.eq_ignore_ascii_case("WinZal") {
            continue;
        }
        let Ok(notification) = item.Notification() else { continue };
        let Ok(visual) = notification.Visual() else { continue };
        let Ok(template) = KnownNotificationBindings::ToastGeneric() else { continue };
        let Ok(binding) = visual.GetBinding(&template) else { continue };
        let Ok(elements) = binding.GetTextElements() else { continue };
        let count = elements.Size().unwrap_or(0);
        let mut texts = Vec::new();
        for i in 0..count {
            if let Ok(text) = elements.GetAt(i) {
                if let Ok(value) = text.Text() {
                    let value = value.to_string();
                    if !value.trim().is_empty() {
                        texts.push(value);
                    }
                }
            }
        }
        let title = texts.first().cloned().unwrap_or_default();
        let body = texts.iter().skip(1).cloned().collect::<Vec<_>>().join(" · ");
        if title.is_empty() && body.is_empty() {
            continue;
        }
        out.push(SystemToast { id, app_id, app, title, body });
    }
    Ok(out)
}

#[tauri::command]
pub fn toast_access() -> &'static str {
    access_status()
}

static WATCH_ON: AtomicBool = AtomicBool::new(false);
static WATCH_TX: OnceLock<Mutex<mpsc::Sender<()>>> = OnceLock::new();

/// Turn the Windows toast listener on or off. Off drops the WinRT listener and
/// its event thread, so nothing is checked while notifications are disabled.
#[tauri::command]
pub fn toast_watch(enabled: bool) {
    WATCH_ON.store(enabled, Ordering::Relaxed);
    if let Some(tx) = WATCH_TX.get() {
        let _ = tx.lock().unwrap().send(());
    }
}

struct Watch {
    listener: UserNotificationListener,
    /// Held so WinRT keeps the event handler alive; never read directly.
    _handler: TypedEventHandler<UserNotificationListener, UserNotificationChangedEventArgs>,
    token: i64,
}

impl Watch {
    fn start(app: AppHandle) -> Option<Self> {
        let listener = UserNotificationListener::Current().ok()?;
        let (tx, rx) = mpsc::channel::<()>();
        thread::spawn(move || {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            while rx.recv().is_ok() {
                // Coalesce a burst of change events into one read.
                while rx.try_recv().is_ok() {}
                if let Ok(items) = read_toasts() {
                    let _ = app.emit("notification://toasts", &items);
                }
            }
        });
        let handler = TypedEventHandler::<UserNotificationListener, UserNotificationChangedEventArgs>::new(
            move |_, _| {
                let _ = tx.send(());
                Ok(())
            },
        );
        let token = listener.NotificationChanged(&handler).ok()?;
        Some(Self { listener, _handler: handler, token })
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        let _ = self.listener.RemoveNotificationChanged(self.token);
    }
}

/// Event-driven Windows toast watch. The listener emits only when the toast
/// list changes; the frontend has no periodic poll. Disabled by default until
/// the frontend restores the user's notification setting.
pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let (tx, rx) = mpsc::channel::<()>();
        let _ = WATCH_TX.set(Mutex::new(tx));
        let mut watch: Option<Watch> = None;
        loop {
            let want = WATCH_ON.load(Ordering::Relaxed);
            if want && watch.is_none() {
                if access_status() == "allowed" {
                    watch = Watch::start(app.clone());
                }
            } else if !want && watch.is_some() {
                // Dropping Watch removes the handler and releases the listener.
                watch = None;
            }
            if want && watch.is_none() {
                // Enabled but not subscribed yet (permission/COM): retry.
                let _ = rx.recv_timeout(Duration::from_secs(2));
            } else {
                // Subscribed or disabled: sleep until the setting changes.
                let _ = rx.recv();
            }
        }
    });
}


#[tauri::command]
pub async fn toast_request(app: AppHandle) -> Result<&'static str, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let listener = UserNotificationListener::Current().map_err(|error| error.message())?;
            let operation = listener.RequestAccessAsync().map_err(|error| error.message())?;
            let tx = tx.clone();
            operation
                .when(move |result| {
                    let _ = tx.send(result.map(status_from).map_err(|error| error.message()));
                })
                .map_err(|error| error.message())?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = tx.send(Err(error));
        }
    })
    .map_err(|error| error.to_string())?;
    let status = rx.recv_timeout(Duration::from_secs(30)).map_err(|_| "timeout".to_string())??;
    Ok(status)
}

#[tauri::command]
pub fn toast_list() -> Result<Vec<SystemToast>, String> {
    read_toasts()
}
