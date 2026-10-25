//! AI usage: one user-defined usage endpoint.
//!
//! WinZal no longer ships provider-specific integrations. Instead the user
//! configures a JSON endpoint (URL, auth header, JSON paths) and the result is
//! shown as a single limit window in the AI Usage tool. The header value lives
//! in Windows Credential Manager and never reaches the WebView.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

/// Minimum interval between real queries.
const CACHE_FOR: Duration = Duration::from_secs(2 * 60);
const BACKOFF_429: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct UsageState {
    /// Last result per config + earliest time (Unix ms) of the next real query.
    cache: Mutex<HashMap<String, (u64, Provider)>>,
    loaded: Mutex<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    id: String,
    /// User-facing name (the configured label).
    #[serde(default)]
    name: Option<String>,
    plan: Option<String>,
    windows: Vec<Window>,
    /// Error code for the frontend (translated there): not-configured,
    /// invalid-url, no-key, invalid-path, rate-limited, offline, failed.
    /// With `windows` present, the data is stale.
    error: Option<String>,
    /// Unix ms when the data was produced.
    updated_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// session | daily | weekly | monthly
    kind: String,
    used_percent: f64,
    /// Unix ms; None if unknown.
    resets_at: Option<u64>,
    /// Window length in seconds (for the "on track" marker).
    window_secs: Option<u64>,
}

/// What the settings form sends along with `usage_fetch`.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomConfig {
    name: String,
    url: String,
    /// Header name, e.g. "Authorization". Empty = no auth header.
    header: String,
    /// Dot path to the used value, e.g. "data.used".
    value_path: String,
    /// Optional dot path to the limit. Empty = the value is already a percentage.
    limit_path: String,
    /// Optional dot path to an ISO date or Unix time.
    reset_path: String,
    /// session | daily | weekly | monthly
    window: String,
    /// Optional plan label.
    plan: String,
}

#[tauri::command]
pub async fn usage_fetch(
    providers: Vec<String>,
    custom: Option<CustomConfig>,
    app: AppHandle,
    state: State<'_, UsageState>,
) -> Result<Vec<Provider>, String> {
    load_disk_cache(&app, &state);
    if !providers.iter().any(|p| p == "custom") {
        return Ok(Vec::new());
    }
    let Some(cfg) = custom else { return Ok(Vec::new()) };

    let key = cache_key(&cfg);
    let cached = state.cache.lock().unwrap().get(&key).cloned();
    if let Some((next_at, p)) = &cached {
        if now_ms() < *next_at {
            return Ok(vec![p.clone()]);
        }
    }

    let (provider, wait) = match (fetch_custom(&cfg).await, cached) {
        (Ok(p), _) => (p, CACHE_FOR),
        // Error → keep the last good result, just note the error.
        (Err(e), Some((_, mut old))) if !old.windows.is_empty() => {
            let wait = e.wait.unwrap_or(CACHE_FOR);
            old.error = Some(e.code);
            (old, wait)
        }
        (Err(e), _) => (
            Provider {
                id: "custom".into(),
                name: Some(display_name(&cfg)),
                plan: None,
                windows: vec![],
                error: Some(e.code.clone()),
                updated_at: now_ms(),
            },
            e.wait.unwrap_or(CACHE_FOR),
        ),
    };
    state.cache.lock().unwrap().insert(key, (now_ms() + wait.as_millis() as u64, provider.clone()));
    save_disk_cache(&app, &state);
    Ok(vec![provider])
}

struct Fail {
    code: String,
    /// Earliest time to ask again (after 429).
    wait: Option<Duration>,
}

impl Fail {
    fn new(code: &str) -> Self {
        Self { code: code.into(), wait: None }
    }
}

impl From<&str> for Fail {
    fn from(code: &str) -> Self {
        Fail::new(code)
    }
}

fn client() -> Result<reqwest::Client, Fail> {
    reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|_| Fail::new("failed"))
}

/// Maps HTTP status to error codes; 429 uses Retry-After (at least BACKOFF_429).
fn check(res: &reqwest::Response) -> Result<(), Fail> {
    match res.status().as_u16() {
        200 => Ok(()),
        401 | 403 => Err(Fail::new("expired")),
        429 => {
            let retry = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .map(Duration::from_secs)
                .unwrap_or(BACKOFF_429)
                .max(BACKOFF_429);
            Err(Fail { code: "rate-limited".into(), wait: Some(retry) })
        }
        _ => Err(Fail::new("failed")),
    }
}

async fn fetch_custom(cfg: &CustomConfig) -> Result<Provider, Fail> {
    let url = cfg.url.trim();
    let value_path = cfg.value_path.trim();
    if url.is_empty() || value_path.is_empty() {
        return Err("not-configured".into());
    }
    // Never send a secret over plain HTTP, except to this machine.
    let local = url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
    if !url.starts_with("https://") && !local {
        return Err("invalid-url".into());
    }

    let mut req = client()?.get(url);
    let header = cfg.header.trim();
    if !header.is_empty() {
        let secret = crate::secrets::read("usage.custom").ok_or("no-key")?;
        req = req.header(header, secret);
    }
    let res = req.send().await.map_err(|_| Fail::new("offline"))?;
    check(&res)?;
    let body: Value = res.json().await.map_err(|_| Fail::new("failed"))?;

    let used = number_at(&body, value_path).ok_or("invalid-path")?;
    let percent = if cfg.limit_path.trim().is_empty() {
        used
    } else {
        let limit = number_at(&body, cfg.limit_path.trim()).ok_or("invalid-path")?;
        if limit <= 0.0 {
            return Err("invalid-path".into());
        }
        used / limit * 100.0
    };
    let resets_at = if cfg.reset_path.trim().is_empty() {
        None
    } else {
        json_path(&body, cfg.reset_path.trim()).and_then(reset_ms)
    };

    Ok(Provider {
        id: "custom".into(),
        name: Some(display_name(cfg)),
        plan: Some(cfg.plan.trim().to_string()).filter(|s| !s.is_empty()),
        windows: vec![Window {
            kind: window_kind(&cfg.window),
            used_percent: percent.clamp(0.0, 100.0),
            resets_at,
            window_secs: Some(window_secs(&cfg.window)),
        }],
        error: None,
        updated_at: now_ms(),
    })
}

fn display_name(cfg: &CustomConfig) -> String {
    let name = cfg.name.trim();
    if name.is_empty() { "Custom".into() } else { name.into() }
}

fn cache_key(cfg: &CustomConfig) -> String {
    format!("custom:{}|{}|{}", cfg.url.trim(), cfg.value_path.trim(), cfg.limit_path.trim())
}

fn window_kind(kind: &str) -> String {
    match kind {
        "daily" | "weekly" | "monthly" => kind.to_string(),
        _ => "session".into(),
    }
}

fn window_secs(kind: &str) -> u64 {
    match kind {
        "daily" => 86_400,
        "weekly" => 7 * 86_400,
        "monthly" => 30 * 86_400,
        _ => 5 * 3600,
    }
}

/// Dot path with optional array indices: "data.usage", "data[0].percent".
fn json_path<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = root;
    for raw in path.split('.') {
        if raw.is_empty() {
            return None;
        }
        let (key, tail) = match raw.find('[') {
            Some(i) => (&raw[..i], &raw[i..]),
            None => (raw, ""),
        };
        if !key.is_empty() {
            cur = cur.get(key)?;
        }
        let mut rest = tail;
        while let Some(open) = rest.find('[') {
            let close = rest[open..].find(']')? + open;
            let index: usize = rest[open + 1..close].trim().parse().ok()?;
            cur = cur.get(index)?;
            rest = &rest[close + 1..];
        }
    }
    Some(cur)
}

fn number_at(body: &Value, path: &str) -> Option<f64> {
    let value = json_path(body, path)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
}

/// ISO date, Unix seconds or Unix milliseconds → Unix ms.
fn reset_ms(value: &Value) -> Option<u64> {
    if let Some(n) = value.as_u64() {
        return Some(if n < 10_000_000_000 { n * 1000 } else { n });
    }
    if let Some(f) = value.as_f64() {
        let n = f.max(0.0) as u64;
        return Some(if n < 10_000_000_000 { n * 1000 } else { n });
    }
    value.as_str().and_then(parse_iso_ms)
}

// ---------- Disk cache ----------

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("usage-cache.json"))
}

fn load_disk_cache(app: &AppHandle, state: &UsageState) {
    let mut loaded = state.loaded.lock().unwrap();
    if *loaded {
        return;
    }
    *loaded = true;
    let Some(saved) = cache_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<HashMap<String, (u64, Provider)>>(&b).ok())
    else {
        return;
    };
    // Drop entries from the removed built-in providers.
    state.cache.lock().unwrap().extend(saved.into_iter().filter(|(key, _)| key.starts_with("custom")));
}

fn save_disk_cache(app: &AppHandle, state: &UsageState) {
    let Some(path) = cache_path(app) else { return };
    let cache = state.cache.lock().unwrap();
    let keep: HashMap<&String, &(u64, Provider)> = cache.iter().filter(|(_, (_, p))| !p.windows.is_empty()).collect();
    let _ = std::fs::write(path, serde_json::to_vec(&keep).unwrap_or_default());
}

// ---------- Helpers ----------

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Minimal ISO 8601 parser ("2026-10-04T17:30:00.123+00:00" / "...Z") → Unix ms.
fn parse_iso_ms(s: &str) -> Option<u64> {
    let (date, rest) = s.split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let time_end = rest.find(|c: char| c == 'Z' || c == '+' || (c == '-' && rest.len() > 8)).unwrap_or(rest.len());
    let (time, tz) = rest.split_at(time_end);
    let mut t = time.split(':');
    let (h, min) = (t.next()?.parse::<i64>().ok()?, t.next()?.parse::<i64>().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    let offset_min = match tz.chars().next() {
        Some(sign @ ('+' | '-')) => {
            let mut p = tz[1..].split(':');
            let oh: i64 = p.next()?.parse().ok()?;
            let om: i64 = p.next().unwrap_or("0").parse().ok()?;
            (oh * 60 + om) * if sign == '-' { -1 } else { 1 }
        }
        _ => 0,
    };
    // Days since 1970 (Howard Hinnant's algorithm).
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + h * 3600 + min * 60 - offset_min * 60;
    Some((secs as f64 * 1000.0 + sec * 1000.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::{json_path, parse_iso_ms};
    use serde_json::json;

    #[test]
    fn iso() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-10-04T12:00:00Z"), Some(1_791_115_200_000));
        assert_eq!(parse_iso_ms("2026-10-04T14:00:00+02:00"), Some(1_791_115_200_000));
        assert_eq!(parse_iso_ms("2026-10-04T12:00:00.500Z"), Some(1_791_115_200_500));
    }

    #[test]
    fn paths() {
        let body = json!({ "data": { "used": 42.5, "limits": [ { "percent": 12 } ] } });
        assert_eq!(json_path(&body, "data.used").and_then(|v| v.as_f64()), Some(42.5));
        assert_eq!(json_path(&body, "data.limits[0].percent").and_then(|v| v.as_f64()), Some(12.0));
        assert_eq!(json_path(&body, "data.missing"), None);
    }
}
