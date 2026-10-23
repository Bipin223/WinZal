//! Probes the Gemini text models with the key stored as Notch/ai.gemini.
//! Dev-only helper; the key never leaves Rust. Run:
//!   cargo run --release --example ai_models_check

use std::time::{Duration, Instant};

use winzal_lib::ai::{stream_chat, ChatConfig};
use winzal_lib::secrets;

fn main() {
    let key = secrets::read("ai.gemini").expect("no Gemini key stored");
    let models = [
        "gemini-4-argon",
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-flash-latest",
        "gemini-3.1-pro-preview",
    ];

    for model in models {
        let config = ChatConfig {
            provider: "gemini".into(),
            base_url: None,
            model: model.into(),
            effort: Some("low".into()),
        };
        let messages: Vec<winzal_lib::ai::Msg> = serde_json::from_value(serde_json::json!([
            { "role": "user", "content": "Reply with the single word OK." }
        ]))
        .unwrap();
        std::thread::sleep(Duration::from_secs(5));
        let start = Instant::now();
        let result = tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                Duration::from_secs(30),
                stream_chat(&config, &key, &messages, |_| {}, || false),
            )
            .await
        });
        match result {
            Ok(Ok(())) => println!("OK   {model}  {:.1}s", start.elapsed().as_secs_f32()),
            Ok(Err(e)) => println!("FAIL {model}: {e}"),
            Err(_) => println!("TIMEOUT {model}"),
        }
    }
}

