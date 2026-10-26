use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};

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
