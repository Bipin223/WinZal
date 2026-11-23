//! Synced lyrics for the closed music pill: Boidu (Better Lyrics) first when
//! it has timed word/mora segments, then Unison's community richsync, and
//! LRCLIB as the reliable fallback.
//!
//! Boidu and LRCLIB are queried in parallel; Unison is only asked when Boidu
//! did not return segments. The winner (including "no lyrics") is kept in a
//! bounded 24-track cache. LRCLIB returns line-level LRC and sometimes YAML;
//! Boidu/Unison return true word/mora timing, which makes Japanese lyrics
//! animate per syllable.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use quick_xml::events::{BytesStart, Event as XmlEvent};
use quick_xml::Reader as XmlReader;
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
pub struct LyricCredit {
    provider: String,
    name: String,
    url: String,
    song_url: String,
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
    /// "lrclib", "boidu" or "unison"; lets the UI/debug show which won.
    #[serde(default)]
    source: String,
    /// Required attribution when the winner is Unison.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    credit: Option<LyricCredit>,
}

/// Keep a bounded number of tracks. Lyrics are small, but an unbounded map
/// across a long listening session is exactly the kind of slow leak we avoid.
const LYRICS_CACHE_MAX: usize = 24;

#[derive(Default)]
struct LyricsCache {
    map: HashMap<String, Lyrics>,
    order: VecDeque<String>,
}

impl LyricsCache {
    fn get(&mut self, key: &str) -> Option<Lyrics> {
        let lyrics = self.map.get(key).cloned()?;
        self.order.retain(|item| item != key);
        self.order.push_back(key.to_string());
        Some(lyrics)
    }

    fn insert(&mut self, key: String, lyrics: Lyrics) {
        self.order.retain(|item| item != &key);
        self.map.insert(key.clone(), lyrics);
        self.order.push_back(key);
        while self.map.len() > LYRICS_CACHE_MAX {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
    }
}

#[derive(Default)]
pub struct LyricsState(Mutex<LyricsCache>);

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
            return Lyrics { instrumental: true, source: "lrclib".into(), ..Default::default() };
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
            source: "lrclib".into(),
            credit: None,
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

#[derive(Deserialize)]
struct BoiduResponse {
    #[serde(default)]
    ttml: Option<String>,
}

/// TTML times are either seconds ("38.455") or clock times ("00:38.455").
fn parse_time(raw: &str) -> Option<f64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let parts: Vec<&str> = raw.split(':').collect();
    match parts.len() {
        3 => {
            let hours: f64 = parts[0].parse().ok()?;
            let minutes: f64 = parts[1].parse().ok()?;
            let seconds: f64 = parts[2].parse().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + seconds)
        }
        2 => {
            let minutes: f64 = parts[0].parse().ok()?;
            let seconds: f64 = parts[1].parse().ok()?;
            Some(minutes * 60.0 + seconds)
        }
        _ => raw.parse().ok(),
    }
}

fn attr_value(element: &BytesStart<'_>, name: &str) -> Option<String> {
    for attr in element.attributes().with_checks(false).flatten() {
        if attr.key.local_name().as_ref() == name {
            return attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|value| value.into_owned());
        }
    }
    None
}

fn attr_time(element: &BytesStart<'_>, name: &str) -> f64 {
    attr_value(element, name)
        .and_then(|value| parse_time(&value))
        .unwrap_or(0.0)
}

/// Boidu returns Apple-style TTML: one <p> per line, one <span> per word or
/// syllable. Japanese spans are mora-sized, which is exactly what Spark needs.
fn parse_ttml(raw: &str) -> Vec<WordLine> {
    struct Span {
        begin: f64,
        text: String,
        skip: bool,
        has_child: bool,
    }
    struct LineState {
        begin: f64,
        end: f64,
        text: String,
        words: Vec<WordTime>,
    }

    let mut reader = XmlReader::from_str(raw);
    reader.config_mut().trim_text(false);
    let mut lines = Vec::new();
    let mut line: Option<LineState> = None;
    let mut spans: Vec<Span> = Vec::new();

    macro_rules! push_text {
        ($text:expr) => {{
            let text: &str = $text;
            if let Some(state) = line.as_mut() {
                if !text.is_empty() && !spans.iter().any(|span| span.skip) {
                    if let Some(span) = spans.last_mut() {
                        span.text.push_str(text);
                    } else if text.trim().is_empty() {
                        // Spaces between English <span>s belong to the word
                        // before them; indentation is ignored.
                        if text.contains(' ') && !text.contains('\n') {
                            if let Some(last) = state.words.last_mut() {
                                last.text.push(' ');
                                state.text.push(' ');
                            }
                        }
                    } else {
                        state.text.push_str(text);
                        if let Some(last) = state.words.last_mut() {
                            last.text.push_str(text);
                        }
                    }
                }
            }
        }};
    }

    loop {
        match reader.read_event() {
            Ok(XmlEvent::Start(event)) => match event.local_name().as_ref() {
                "p" => {
                    line = Some(LineState {
                        begin: attr_time(&event, "begin"),
                        end: attr_time(&event, "end"),
                        text: String::new(),
                        words: Vec::new(),
                    });
                    spans.clear();
                }
                "span" if line.is_some() => {
                    let role = attr_value(&event, "role").unwrap_or_default();
                    if let Some(parent) = spans.last_mut() {
                        parent.has_child = true;
                    }
                    spans.push(Span {
                        begin: attr_time(&event, "begin"),
                        text: String::new(),
                        skip: role.starts_with("x-"),
                        has_child: false,
                    });
                }
                _ => {}
            },
            Ok(XmlEvent::Text(event)) => push_text!(event.as_ref()),
            Ok(XmlEvent::CData(event)) => push_text!(event.as_ref()),
            Ok(XmlEvent::GeneralRef(event)) => {
                let resolved = if let Some(character) = event.resolve_char_ref().ok().flatten() {
                    character.to_string()
                } else {
                    match event.as_ref() {
                        "amp" => "&".to_string(),
                        "lt" => "<".to_string(),
                        "gt" => ">".to_string(),
                        "quot" => "\"".to_string(),
                        "apos" => "'".to_string(),
                        _ => String::new(),
                    }
                };
                push_text!(&resolved);
            }
            Ok(XmlEvent::End(event)) => match event.local_name().as_ref() {
                "span" if line.is_some() => {
                    if let Some(span) = spans.pop() {
                        if !span.skip && !span.has_child && !span.text.is_empty() {
                            let text = span.text;
                            if let Some(state) = line.as_mut() {
                                state.text.push_str(&text);
                                state.words.push(WordTime { text, at: span.begin });
                            }
                        }
                    }
                }
                "p" => {
                    if let Some(mut state) = line.take() {
                        let text = state.text.trim().to_string();
                        if text.is_empty() {
                            continue;
                        }
                        if let Some(last) = state.words.last_mut() {
                            last.text = last.text.trim_end().to_string();
                            if last.text.is_empty() {
                                state.words.pop();
                            }
                        }
                        let at = state.begin.max(0.0);
                        let end = if state.end > at { state.end } else { 0.0 };
                        lines.push(WordLine { text, at, end, words: state.words });
                    }
                }
                _ => {}
            },
            Ok(XmlEvent::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    lines.sort_by(|a, b| a.at.total_cmp(&b.at));
    for i in 0..lines.len() {
        if lines[i].end <= lines[i].at {
            lines[i].end = lines.get(i + 1).map(|next| next.at).unwrap_or(lines[i].at + 4.0);
        }
    }
    lines
}

fn lrc_from_lines(lines: &[WordLine]) -> String {
    lines
        .iter()
        .map(|line| {
            let minutes = (line.at / 60.0).floor() as i64;
            let seconds = line.at - minutes as f64 * 60.0;
            format!("[{:02}:{:05.2}]{}", minutes, seconds, line.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn boidu_lookup(
    http: &reqwest::Client,
    title: &str,
    artist: &str,
    album: Option<&str>,
    duration: f64,
) -> Option<Lyrics> {
    let mut url = reqwest::Url::parse("https://api.betterlyrics.org/getLyrics").ok()?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("s", title);
        query.append_pair("a", artist);
        if let Some(album) = album.filter(|value| !value.trim().is_empty()) {
            query.append_pair("al", album);
        }
        if duration > 1.0 {
            query.append_pair("d", &(duration.round() as i64).to_string());
        }
    }
    let response = http.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body: BoiduResponse = response.json().await.ok()?;
    let word_lines = parse_ttml(body.ttml.as_deref()?);
    if word_lines.is_empty() {
        return None;
    }
    let plain = word_lines.iter().map(|line| line.text.clone()).collect::<Vec<_>>().join("\n");
    Some(Lyrics {
        synced: Some(lrc_from_lines(&word_lines)),
        plain: Some(plain),
        instrumental: false,
        word_lines,
        source: "boidu".into(),
        credit: None,
    })
}

#[derive(Deserialize)]
struct UnisonEnvelope<T> {
    #[serde(default)]
    success: bool,
    data: Option<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnisonData {
    #[serde(default)]
    lyrics: String,
    #[serde(default)]
    format: String,
    #[serde(default)]
    sync_type: String,
    #[serde(default)]
    video_id: Option<String>,
    #[serde(default)]
    submitter: Option<UnisonSubmitter>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnisonSubmitter {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    key_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnisonCandidate {
    #[serde(default)]
    song: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    video_id: Option<String>,
    #[serde(default)]
    sync_type: String,
    #[serde(default)]
    match_score: f64,
}

fn unison_url(path: &str, pairs: &[(&str, String)]) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(&format!("https://unison.betterlyrics.org{path}")).ok()?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in pairs {
            if !value.is_empty() {
                query.append_pair(key, value);
            }
        }
    }
    Some(url)
}

async fn unison_direct(http: &reqwest::Client, url: reqwest::Url) -> Option<UnisonData> {
    let response = http.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let envelope: UnisonEnvelope<UnisonData> = response.json().await.ok()?;
    envelope.success.then_some(envelope.data).flatten()
}

fn unison_lyrics(data: UnisonData) -> Option<Lyrics> {
    let format = data.format.to_lowercase();
    let sync_type = data.sync_type.to_lowercase();
    if format == "plain" || sync_type == "plain" {
        return None;
    }
    let (synced, plain, word_lines) = match format.as_str() {
        "ttml" => {
            let lines = parse_ttml(&data.lyrics);
            if lines.is_empty() {
                return None;
            }
            let plain = lines.iter().map(|line| line.text.clone()).collect::<Vec<_>>().join("\n");
            (Some(lrc_from_lines(&lines)), Some(plain), lines)
        }
        "lrc" => {
            if data.lyrics.trim().is_empty() {
                return None;
            }
            (Some(data.lyrics), None, Vec::new())
        }
        _ => return None,
    };
    let name = data
        .submitter
        .as_ref()
        .and_then(|submitter| submitter.display_name.clone())
        .unwrap_or_else(|| "Unison contributor".into());
    let song_url = data
        .video_id
        .as_ref()
        .map(|video| format!("https://unison.betterlyrics.org/song/{video}"))
        .unwrap_or_else(|| "https://unison.betterlyrics.org".into());
    let url = data
        .submitter
        .as_ref()
        .and_then(|submitter| submitter.key_id.as_ref())
        .map(|key| format!("https://unison.betterlyrics.org/curator/{key}"))
        .unwrap_or_else(|| song_url.clone());
    Some(Lyrics {
        synced,
        plain,
        instrumental: false,
        word_lines,
        source: "unison".into(),
        credit: Some(LyricCredit {
            provider: "unison".into(),
            name,
            url,
            song_url,
        }),
    })
}

async fn unison_lookup(
    http: &reqwest::Client,
    title: &str,
    artist: &str,
    album: &str,
    duration: f64,
) -> Option<Lyrics> {
    let duration = if duration > 1.0 {
        (duration.round() as i64).to_string()
    } else {
        String::new()
    };
    // Exact metadata first, then the looser song/artist lookup. Unison can be
    // picky about album and duration, so both are worth one request.
    let direct = [
        unison_url(
            "/lyrics",
            &[
                ("song", title.to_string()),
                ("artist", artist.to_string()),
                ("album", album.to_string()),
                ("duration", duration.clone()),
            ],
        ),
        unison_url(
            "/lyrics",
            &[
                ("song", title.to_string()),
                ("artist", artist.to_string()),
            ],
        ),
    ];
    for url in direct.into_iter().flatten() {
        if let Some(data) = unison_direct(http, url).await {
            if let Some(lyrics) = unison_lyrics(data) {
                return Some(lyrics);
            }
        }
    }

    // Search fallback for romanized titles ("Idol" vs "アイドル"). The artist
    // must match and either the title or the search score must be convincing.
    let mut url = reqwest::Url::parse("https://unison.betterlyrics.org/lyrics/search").ok()?;
    url.query_pairs_mut().append_pair("q", &format!("{title} {artist}"));
    let response = http.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let envelope: UnisonEnvelope<Vec<UnisonCandidate>> = response.json().await.ok()?;
    if !envelope.success {
        return None;
    }
    let wanted_title = norm(title);
    let wanted_artist = norm(artist);
    let best = envelope
        .data
        .unwrap_or_default()
        .into_iter()
        .filter(|candidate| {
            let candidate_title = norm(&candidate.song);
            let candidate_artist = norm(&candidate.artist);
            let artist_ok = !wanted_artist.is_empty()
                && (candidate_artist == wanted_artist
                    || candidate_artist.contains(&wanted_artist)
                    || wanted_artist.contains(&candidate_artist));
            let title_ok = candidate_title == wanted_title
                || candidate_title.contains(&wanted_title)
                || wanted_title.contains(&candidate_title)
                || candidate.match_score >= 0.9;
            artist_ok
                && title_ok
                && candidate.video_id.is_some()
                && candidate.sync_type.to_lowercase() != "plain"
        })
        .max_by(|a, b| a.match_score.total_cmp(&b.match_score))?;
    let video = best.video_id?;
    let url = unison_url("/lyrics", &[("v", video)])?;
    let data = unison_direct(http, url).await?;
    unison_lyrics(data)
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

async fn lrclib_lookup(
    http: &reqwest::Client,
    title: &str,
    artist: &str,
    duration: f64,
) -> (Lyrics, bool) {
    let mut lyrics = Lyrics::default();
    // Only cache answers that LRCLIB actually confirmed. A timeout, 429 or 5xx
    // must not become a permanent "no lyrics" for the rest of the session.
    let mut cacheable = false;

    // Exact match first (LRCLIB's /get is stricter and faster).
    if let Some(url) = query("https://lrclib.net/api/get", title, artist, duration) {
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
        if let Some(url) = query("https://lrclib.net/api/search", title, artist, 0.0) {
            if let Ok(response) = http.get(url).send().await {
                if response.status().is_success() {
                    if let Ok(tracks) = response.json::<Vec<Track>>().await {
                        // Search is a definitive answer even when it returns no
                        // usable match, so an empty list is safe to cache.
                        cacheable = true;
                        if let Some(track) = tracks
                            .into_iter()
                            .filter(|track| score(track, title, artist, duration).is_finite())
                            .max_by(|a, b| {
                                score(a, title, artist, duration)
                                    .total_cmp(&score(b, title, artist, duration))
                            })
                        {
                            if score(&track, title, artist, duration) > 0.0 {
                                lyrics = track.into_lyrics();
                            }
                        }
                    }
                }
            }
        }
    }
    (lyrics, cacheable)
}

#[tauri::command]
pub async fn lyrics_get(
    title: String,
    artist: String,
    album: String,
    duration: f64,
    state: State<'_, LyricsState>,
) -> Result<Lyrics, String> {
    // Media sessions can hand out decomposed accents ("Buble" + U+0301). LRCLIB
    // stores composed text, so normalize before the lookup and the cache key.
    let title = title.trim().nfc().collect::<String>();
    let artist = artist.trim().nfc().collect::<String>();
    let album = album.trim().nfc().collect::<String>();
    if title.is_empty() {
        return Ok(Lyrics::default());
    }
    let key = format!(
        "{}|{}|{}|{}",
        title.to_lowercase(),
        artist.to_lowercase(),
        album.to_lowercase(),
        duration.round() as i64
    );
    if let Some(cached) = state.0.lock().unwrap().get(&key) {
        return Ok(cached);
    }

    let http = client()?;
    let album_arg = if album.is_empty() { None } else { Some(album.as_str()) };
    // Both sources in parallel: Boidu's Apple-style TTML has far better word
    // and mora timing than LRCLIB's line-level data, but it is cache-first and
    // often has no entry. LRCLIB is the reliable fallback.
    let (lrclib, boidu) = tokio::join!(
        lrclib_lookup(&http, &title, &artist, duration),
        tokio::time::timeout(
            Duration::from_secs(3),
            boidu_lookup(&http, &title, &artist, album_arg, duration),
        ),
    );
    let (lyrics, lrclib_confirmed) = lrclib;
    let boidu = boidu.ok().flatten();
    let boidu_confirmed = boidu.is_some();

    // Use Boidu whenever it actually returned timed segments. Line-level TTML
    // ("Stand by Me") is no better than LRCLIB. LRCLIB's "hasWordSync" is not
    // a quality guarantee either: for Beat It all words were stamped at the
    // line end, and for Idol it returned an English translation.
    let boidu_segments = boidu
        .as_ref()
        .is_some_and(|value| value.word_lines.iter().any(|line| !line.words.is_empty()));

    // Unison is the community database. Only ask it when Boidu did not already
    // give us timed segments; it is a fallback, not a request on every track.
    let unison = if !lyrics.instrumental && !boidu_segments {
        tokio::time::timeout(
            Duration::from_secs(5),
            unison_lookup(&http, &title, &artist, &album, duration),
        )
        .await
        .ok()
        .flatten()
    } else {
        None
    };
    let unison_confirmed = unison.is_some();
    let unison_segments = unison
        .as_ref()
        .is_some_and(|value| value.word_lines.iter().any(|line| !line.words.is_empty()));
    let unison_synced = unison.as_ref().is_some_and(|value| value.synced.is_some());

    let mut chosen = if lyrics.instrumental {
        lyrics
    } else if boidu_segments {
        boidu.unwrap_or_default()
    } else if unison_segments {
        unison.unwrap_or_default()
    } else if lyrics.synced.is_some() || !lyrics.word_lines.is_empty() {
        lyrics
    } else if unison_synced {
        unison.unwrap_or_default()
    } else if let Some(boidu) = boidu {
        boidu
    } else {
        lyrics
    };
    if chosen.source.is_empty() {
        chosen.source = "lrclib".into();
    }

    if lrclib_confirmed || boidu_confirmed || unison_confirmed {
        state.0.lock().unwrap().insert(key, chosen.clone());
    }
    Ok(chosen)
}

#[cfg(test)]
mod tests {
    use super::{parse_lyricsfile, parse_ttml, unison_lyrics, UnisonData, UnisonSubmitter};

    #[test]
    fn builds_unison_credit_and_segments() {
        let data = UnisonData {
            lyrics: r#"<tt><body><p begin="1" end="3"><span begin="1" end="1.5">Hello</span> <span begin="1.5" end="3">there</span></p></body></tt>"#.into(),
            format: "ttml".into(),
            sync_type: "richsync".into(),
            video_id: Some("video123".into()),
            submitter: Some(UnisonSubmitter {
                display_name: Some("Nando".into()),
                key_id: Some("key123".into()),
            }),
        };
        let lyrics = unison_lyrics(data).expect("unison lyrics");
        assert_eq!(lyrics.source, "unison");
        assert_eq!(lyrics.word_lines.len(), 1);
        assert_eq!(lyrics.word_lines[0].words.len(), 2);
        let credit = lyrics.credit.expect("credit");
        assert_eq!(credit.name, "Nando");
        assert!(credit.url.contains("key123"));
        assert!(credit.song_url.contains("video123"));
    }

    #[test]
    fn parses_boidu_ttml_words_and_mora() {
        let ttml = r#"<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Word">
<body>
<p begin="1.0" end="3.0"><span begin="1.0" end="1.4">They</span> <span begin="1.4" end="3.0">told</span></p>
<p begin="4.0" end="6.0"><span begin="4.0" end="4.4">夢</span><span begin="4.4" end="4.8">なら</span><span begin="4.8" end="6.0">ば</span></p>
</body>
</tt>"#;
        let lines = parse_ttml(ttml);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "They told");
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[0].text, "They ");
        assert!((lines[0].words[1].at - 1.4).abs() < 1e-9);
        assert_eq!(lines[1].text, "夢ならば");
        assert_eq!(lines[1].words.len(), 3);
        assert_eq!(lines[1].words[2].text, "ば");
    }

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
