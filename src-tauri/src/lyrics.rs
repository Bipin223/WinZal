//! Synced lyrics for the closed music pill, from LRCLIB (free, no key).
//!
//! One request per track; the result (including "no lyrics") is cached in memory.
//! The frontend only asks while the lyrics option is on, so the default app stays
//! quiet. LRCLIB returns line-level LRC timestamps and, when the record has
//! `hasWordSync`, a YAML lyricsfile with word-level timings.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Default, Serialize)]
pub struct WordTime {
    text: String,
    at: f64,
}

#[derive(Clone, Default, Serialize)]
pub struct WordLine {
    text: String,
    at: f64,
    end: f64,
    words: Vec<WordTime>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    synced: Option<String>,
    plain: Option<String>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    word_lines: Vec<WordLine>,
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
    #[serde(default)]
    duration: f64,
    #[serde(rename = "trackName", default)]
    track_name: Option<String>,
    #[serde(rename = "artistName", default)]
    artist_name: Option<String>,
    #[serde(rename = "hasWordSync", default)]
    has_word_sync: bool,
    #[serde(default)]
    lyricsfile: Option<String>,
}

impl Track {
    fn playable(&self) -> bool {
        !self.instrumental && self.synced.as_ref().is_some_and(|s| !s.trim().is_empty())
    }

    fn into_lyrics(self) -> Lyrics {
        if self.instrumental {
            return Lyrics { instrumental: true, ..Default::default() };
        }
        // Word timings live in the YAML lyricsfile; only parse it when LRCLIB
        // says the record actually has them. Everything else stays line-level.
        let word_lines = if self.has_word_sync {
            self.lyricsfile.as_deref().map(parse_lyricsfile).unwrap_or_default()
        } else {
            Vec::new()
        };
        Lyrics {
            synced: self.synced.filter(|text| !text.trim().is_empty()),
            plain: self.plain.filter(|text| !text.trim().is_empty()),
            instrumental: false,
            word_lines,
        }
    }
}

#[derive(Deserialize)]
struct FileDoc {
    #[serde(default)]
    lines: Vec<FileLine>,
}

#[derive(Deserialize)]
struct FileLine {
    #[serde(default)]
    text: String,
    #[serde(default)]
    start_ms: f64,
    #[serde(default)]
    end_ms: Option<f64>,
    #[serde(default)]
    words: Vec<FileWord>,
}

#[derive(Deserialize)]
struct FileWord {
    #[serde(default)]
    text: String,
    #[serde(default)]
    start_ms: f64,
}

fn parse_lyricsfile(raw: &str) -> Vec<WordLine> {
    let doc: FileDoc = match serde_yaml::from_str(raw) {
        Ok(doc) => doc,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<WordLine> = doc
        .lines
        .into_iter()
        .filter_map(|line| {
            let text = line.text.trim().to_string();
            if text.is_empty() {
                return None;
            }
            let at = line.start_ms / 1000.0;
            let end = line.end_ms.map(|ms| ms / 1000.0).filter(|end| *end > at).unwrap_or(0.0);
            let words = line
                .words
                .into_iter()
                .filter_map(|word| {
                    let text = word.text.trim().to_string();
                    if text.is_empty() {
                        return None;
                    }
                    Some(WordTime { text, at: word.start_ms / 1000.0 })
                })
                .collect();
            Some(WordLine { text, at, end, words })
        })
        .collect();
    out.sort_by(|a, b| a.at.total_cmp(&b.at));
    for i in 0..out.len() {
        if out[i].end <= out[i].at {
            out[i].end = out.get(i + 1).map(|next| next.at).unwrap_or(out[i].at + 4.0);
        }
    }
    out
}

fn norm(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Closest duration wins; exact title/artist gets a bonus. Wrong edits of the
/// same song are the usual reason lyrics run ahead or behind.
fn score(track: &Track, title: &str, artist: &str, actual: f64) -> f64 {
    if !track.playable() {
        return f64::NEG_INFINITY;
    }
    let mut score = 0.0;
    if actual > 1.0 && track.duration > 1.0 {
        let delta = (track.duration - actual).abs();
        score -= delta * 20.0;
        if delta <= 3.0 {
            score += 400.0;
        }
    }
    let t = norm(title);
    let a = norm(artist);
    if let Some(name) = &track.track_name {
        let n = norm(name);
        if n == t {
            score += 300.0;
        } else if n.contains(&t) || t.contains(&n) {
            score += 120.0;
        }
    }
    if let Some(name) = &track.artist_name {
        let n = norm(name);
        if !a.is_empty() && n == a {
            score += 150.0;
        } else if !a.is_empty() {
            // Covers with the same title/duration must not outrank the artist.
            score -= 250.0;
        }
    }
    score
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent(concat!("WinZal/", env!("CARGO_PKG_VERSION"), " (https://github.com/Bipin223/WinZal)"))
        .build()
        .map_err(|e| e.to_string())
}

fn query(base: &str, title: &str, artist: &str, duration: f64) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(base).ok()?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("track_name", title);
        if !artist.is_empty() {
            pairs.append_pair("artist_name", artist);
        }
        if duration > 1.0 {
            pairs.append_pair("duration", &(duration.round() as i64).to_string());
        }
    }
    Some(url)
}

#[tauri::command]
pub async fn lyrics_get(title: String, artist: String, duration: f64, state: State<'_, LyricsState>) -> Result<Lyrics, String> {
    // Media sessions can hand out decomposed accents ("Buble" + U+0301). LRCLIB
    // stores composed text, so normalize before the lookup and the cache key.
    let title = title.trim().nfc().collect::<String>();
    let artist = artist.trim().nfc().collect::<String>();
    if title.is_empty() {
        return Ok(Lyrics::default());
    }
    let key = format!("{}|{}|{}", title.to_lowercase(), artist.to_lowercase(), duration.round() as i64);
    if let Some(cached) = state.0.lock().unwrap().get(&key).cloned() {
        return Ok(cached);
    }

    let http = client()?;
    let mut lyrics = Lyrics::default();
    // Only cache answers that LRCLIB actually confirmed. A timeout, 429 or 5xx
    // must not become a permanent "no lyrics" for the rest of the session.
    let mut cacheable = false;

    // Exact match first (LRCLIB's /get is stricter and faster).
    if let Some(url) = query("https://lrclib.net/api/get", &title, &artist, duration) {
        if let Ok(response) = http.get(url).send().await {
            if response.status().is_success() {
                if let Ok(track) = response.json::<Track>().await {
                    lyrics = track.into_lyrics();
                    cacheable = lyrics.synced.is_some() || lyrics.instrumental;
                }
            }
        }
    }

    // Search fallback for local files whose duration differs from LRCLIB.
    if lyrics.synced.is_none() && !lyrics.instrumental {
        if let Some(url) = query("https://lrclib.net/api/search", &title, &artist, 0.0) {
            if let Ok(response) = http.get(url).send().await {
                if response.status().is_success() {
                    if let Ok(tracks) = response.json::<Vec<Track>>().await {
                        // Search is a definitive answer even when it returns no
                        // usable match, so an empty list is safe to cache.
                        cacheable = true;
                        if let Some(track) = tracks
                            .into_iter()
                            .filter(|track| score(track, &title, &artist, duration).is_finite())
                            .max_by(|a, b| score(a, &title, &artist, duration).total_cmp(&score(b, &title, &artist, duration)))
                        {
                            if score(&track, &title, &artist, duration) > 0.0 {
                                lyrics = track.into_lyrics();
                            }
                        }
                    }
                }
            }
        }
    }

    if cacheable {
        let mut cache = state.0.lock().unwrap();
        if cache.len() >= 40 {
            cache.clear();
        }
        cache.insert(key, lyrics.clone());
    }
    Ok(lyrics)
}

#[cfg(test)]
mod tests {
    use super::parse_lyricsfile;

    #[test]
    fn parses_word_level_lyricsfile() {
        let raw = r#"
version: "1.0"
lines:
  - text: Hello there
    start_ms: 1000
    end_ms: 2200
    words:
      - text: "Hello "
        start_ms: 1000
      - text: there
        start_ms: 1600
  - text: Second line
    start_ms: 3000
    words:
      - text: Second
        start_ms: 3000
"#;
        let lines = parse_lyricsfile(raw);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[1].text, "there");
        assert!((lines[0].words[1].at - 1.6).abs() < 1e-9);
        assert!((lines[0].end - 2.2).abs() < 1e-9);
        // Missing end_ms falls forward to the next line start.
        assert!((lines[1].end - 7.0).abs() < 1e-9);
    }

}
