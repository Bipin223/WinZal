//! Synced lyrics for the closed music pill, from LRCLIB (free, no key).
//!
//! One request per track; the result (including "no lyrics") is cached in memory.
//! The frontend only asks while the lyrics option is on, so the default app stays
//! quiet. LRCLIB returns line-level LRC timestamps, which is enough for a calm
//! one-line karaoke display without per-frame work.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    synced: Option<String>,
    plain: Option<String>,
}

#[derive(Default)]
pub struct LyricsState(Mutex<HashMap<String, Lyrics>>);

#[derive(Deserialize)]
struct Track {
    #[serde(rename = "syncedLyrics")]
    synced: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain: Option<String>,
    #[serde(default)]
    instrumental: bool,
}

impl Track {
    fn into_lyrics(self) -> Lyrics {
        if self.instrumental {
            return Lyrics::default();
        }
        Lyrics {
            synced: self.synced.filter(|text| !text.trim().is_empty()),
            plain: self.plain.filter(|text| !text.trim().is_empty()),
        }
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("WinZal/1.6.0 (https://github.com/Bipin223/WinZal)")
        .build()
        .map_err(|e| e.to_string())
}

fn query(base: &str, title: &str, artist: &str, duration: f64) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(base).ok()?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("track_name", title);
        pairs.append_pair("artist_name", artist);
        if duration > 1.0 {
            pairs.append_pair("duration", &(duration.round() as i64).to_string());
        }
    }
    Some(url)
}

#[tauri::command]
pub async fn lyrics_get(title: String, artist: String, duration: f64, state: State<'_, LyricsState>) -> Result<Lyrics, String> {
    let title = title.trim().to_string();
    let artist = artist.trim().to_string();
    if title.is_empty() {
        return Ok(Lyrics::default());
    }
    let key = format!("{}|{}|{}", title.to_lowercase(), artist.to_lowercase(), duration.round() as i64);
    if let Some(cached) = state.0.lock().unwrap().get(&key).cloned() {
        return Ok(cached);
    }

    let http = client()?;
    let mut lyrics = Lyrics::default();

    // Exact match first (LRCLIB's /get is stricter and faster).
    if let Some(url) = query("https://lrclib.net/api/get", &title, &artist, duration) {
        if let Ok(response) = http.get(url).send().await {
            if response.status().is_success() {
                if let Ok(track) = response.json::<Track>().await {
                    lyrics = track.into_lyrics();
                }
            }
        }
    }

    // Search fallback for local files whose duration differs from LRCLIB.
    if lyrics.synced.is_none() {
        if let Some(url) = query("https://lrclib.net/api/search", &title, &artist, 0.0) {
            if let Ok(response) = http.get(url).send().await {
                if response.status().is_success() {
                    if let Ok(tracks) = response.json::<Vec<Track>>().await {
                        if let Some(track) = tracks.into_iter().find(|t| !t.instrumental && t.synced.as_ref().is_some_and(|s| !s.trim().is_empty())) {
                            lyrics = track.into_lyrics();
                        }
                    }
                }
            }
        }
    }

    let mut cache = state.0.lock().unwrap();
    if cache.len() >= 200 {
        cache.clear();
    }
    cache.insert(key, lyrics.clone());
    Ok(lyrics)
}
