//! Ask: AI chat with streaming.
//!
//! Providers:
//! - `openrouter`, `openai`, `custom`: OpenAI-compatible `/chat/completions` (SSE).
//!   Effort as `reasoning_effort` (OpenRouter: `reasoning.effort`).
//! - `anthropic`: Claude Messages API (SSE), effort as `output_config.effort`.
//!
//! The key comes from Credential Manager (`ai.<provider>`) and only leaves Rust in the
//! Authorization header. Chunks go to the frontend as `ai://delta`; `ai_cancel` stops
//! a running stream.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::secrets;

const SYSTEM_PROMPT: &str = "Du bist Ask, ein schneller Assistent in einer kleinen Notch am oberen Bildschirmrand. \
Antworte knapp und direkt in der Sprache der Frage. Kein Markdown-Overhead: kurze Absätze, Listen nur wenn nötig.";

/// Claude models where the server falls back to a suitable model on refusal
/// (`fallbacks: "default"`).
const CLAUDE_FALLBACK_MODELS: &[&str] = &["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5-5"];

#[derive(Clone, Deserialize)]
pub struct Msg {
    role: String,
    content: String,
    /// Data URLs for vision models (images attached in Ask).
    #[serde(default)]
    images: Vec<String>,
}

fn message_json(m: &Msg) -> Value {
    if m.images.is_empty() {
        return json!({ "role": m.role, "content": m.content });
    }
    let mut parts = vec![json!({ "type": "text", "text": m.content })];
    for image in &m.images {
        parts.push(json!({ "type": "image_url", "image_url": { "url": image } }));
    }
    json!({ "role": m.role, "content": parts })
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConfig {
    pub provider: String,
    pub base_url: Option<String>,
    pub model: String,
    /// low | medium | high | xhigh
    pub effort: Option<String>,
}

#[derive(Default)]
pub struct AiState {
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
struct Delta<'a> {
    id: &'a str,
    text: &'a str,
}

#[tauri::command]
pub async fn ai_chat(id: String, config: ChatConfig, messages: Vec<Msg>, app: AppHandle, state: State<'_, AiState>) -> Result<(), String> {
    let key = secrets::read(&format!("ai.{}", config.provider)).ok_or("no-key")?;
    let result = stream_chat(&config, &key, &messages, |text| {
        let _ = app.emit("ai://delta", Delta { id: &id, text });
    }, || state.cancelled.lock().unwrap().contains(&id))
    .await;
    state.cancelled.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
pub fn ai_cancel(id: String, state: State<'_, AiState>) {
    state.cancelled.lock().unwrap().insert(id);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequest {
    provider: String,
    base_url: Option<String>,
}

/// Live model list straight from the provider. The key never reaches the WebView.
#[tauri::command]
pub async fn ai_models(req: ModelRequest) -> Result<Vec<String>, String> {
    let key = secrets::read(&format!("ai.{}", req.provider)).ok_or("no-key")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let (url, gemini) = match req.provider.as_str() {
        "gemini" => ("https://generativelanguage.googleapis.com/v1beta/models".to_string(), true),
        "groq" => ("https://api.groq.com/openai/v1/models".to_string(), false),
        "custom" => {
            let base = req
                .base_url
                .unwrap_or_default()
                .trim()
                .trim_end_matches('/')
                .trim_end_matches("/chat/completions")
                .to_string();
            if base.is_empty() {
                return Err("Base URL missing".into());
            }
            (format!("{base}/models"), false)
        }
        other => return Err(format!("Unknown provider: {other}")),
    };

    let url = if gemini {
        reqwest::Url::parse_with_params(&url, &[("key", key.as_str())]).map_err(|e| e.to_string())?
    } else {
        reqwest::Url::parse(&url).map_err(|e| e.to_string())?
    };
    let request = if gemini { client.get(url) } else { client.get(url).bearer_auth(&key) };
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Models request failed ({status}): {}", short(&body)));
    }

    let value: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let mut models: Vec<String> = if gemini {
        value
            .get("models")
            .and_then(|m| m.as_array())
            .into_iter()
            .flatten()
            .filter(|m| {
                m.get("supportedGenerationMethods")
                    .and_then(|x| x.as_array())
                    .map_or(true, |methods| methods.iter().any(|s| s.as_str() == Some("generateContent")))
            })
            .filter_map(|m| {
                m.get("name")
                    .and_then(|n| n.as_str())
                    .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
            })
            .filter(|name| chat_model(name))
            .collect()
    } else {
        value
            .get("data")
            .and_then(|m| m.as_array())
            .into_iter()
            .flatten()
            .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
            .collect()
    };
    models.sort();
    models.dedup();
    Ok(models)
}

/// Core without Tauri, so backend tests can use it too.
pub async fn stream_chat(
    config: &ChatConfig,
    key: &str,
    messages: &[Msg],
    mut on_delta: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err("Kein Modell eingetragen".into());
    }
    let effort = config.effort.as_deref().filter(|e| !e.is_empty());
    let anthropic = config.provider == "anthropic";

    let url = match config.provider.as_str() {
        "anthropic" => "https://api.anthropic.com/v1/messages".to_string(),
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".to_string(),
        "groq" => "https://api.groq.com/openai/v1/chat/completions".to_string(),
        "custom" => {
            let base = config.base_url.as_deref().unwrap_or("").trim().trim_end_matches('/');
            if !(base.starts_with("https://") || base.starts_with("http://localhost") || base.starts_with("http://127.0.0.1")) {
                return Err("Base-URL muss mit https:// beginnen".into());
            }
            format!("{base}/chat/completions")
        }
        other => return Err(format!("Unbekannter Anbieter: {other}")),
    };

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // Reasoning models can think for a while before the first token.
        .read_timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let request = if anthropic {
        let mut body = json!({
            "model": model,
            "max_tokens": 64000,
            "stream": true,
            "system": SYSTEM_PROMPT,
            "messages": messages.iter().map(message_json).collect::<Vec<_>>(),
        });
        if let Some(e) = effort {
            body["output_config"] = json!({ "effort": e });
        }
        let mut req = client.post(&url).header("x-api-key", key).header("anthropic-version", "2023-06-01");
        if CLAUDE_FALLBACK_MODELS.contains(&model) {
            body["fallbacks"] = json!("default");
            req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
        }
        req.json(&body)
    } else {
        let mut all = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
        all.extend(messages.iter().map(message_json));
        let mut body = json!({ "model": model, "stream": true, "messages": all });
        if let Some(e) = effort {
            // Gemini and Groq's OpenAI-compatible APIs accept low/medium/high.
            let e = if e == "xhigh" { "high" } else { e };
            let supported = match config.provider.as_str() {
                "gemini" | "custom" => true,
                // Groq only exposes reasoning effort for its GPT-OSS models.
                "groq" => model.starts_with("openai/gpt-oss"),
                _ => false,
            };
            if supported {
                body["reasoning_effort"] = json!(e);
            }
        }
        let req = client.post(&url).bearer_auth(key);
        req.json(&body)
    };

    let mut res = request.send().await.map_err(|e| format!("Keine Verbindung: {}", short(&e.to_string())))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(http_error(status, &text));
    }

    // Read SSE line by line; a chunk can end mid-line.
    let mut buffer = String::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("Verbindung abgebrochen: {}", short(&e.to_string())))? {
        if cancelled() {
            return Ok(());
        }
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=pos).collect();
            let Some(data) = line.trim().strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                return Ok(());
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(err) = event.get("error") {
                return Err(err["message"].as_str().unwrap_or("Fehler vom Anbieter").to_string());
            }
            let text = if anthropic {
                (event["type"] == "content_block_delta" && event["delta"]["type"] == "text_delta")
                    .then(|| event["delta"]["text"].as_str())
                    .flatten()
            } else {
                event["choices"][0]["delta"]["content"].as_str()
            };
            if let Some(t) = text.filter(|t| !t.is_empty()) {
                on_delta(t);
            }
        }
    }
    Ok(())
}

fn http_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().or(v["message"].as_str()).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(140).collect());
    match status {
        401 | 403 => format!("Schlüssel abgelehnt ({status}) – {}", short(&detail)),
        404 => format!("Nicht gefunden (404) – Base-URL oder Modell prüfen. {}", short(&detail)),
        429 => "Limit erreicht (429) – kurz warten".into(),
        _ => format!("Fehler {status}: {}", short(&detail)),
    }
}

/// Keep only text chat models. Image, TTS, transcription, research and the
/// retired 2.5 family are hidden; Gemma is hidden until the effort field is
/// handled separately (it rejects thinking levels).
fn chat_model(name: &str) -> bool {
    let n = name.to_lowercase();
    if n.starts_with("gemma-") || n.starts_with("gemini-2.5-") {
        return false;
    }
    if !n.starts_with("gemini-") {
        return false;
    }
    !["image", "tts", "transcribe", "lyria", "nano-banana", "deep-research", "computer-use", "robotics"]
        .iter()
        .any(|w| n.contains(w))
}

fn short(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() > 160 { format!("{}…", s.chars().take(160).collect::<String>()) } else { s.to_string() }
}
