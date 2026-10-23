//! Now Playing via GlobalSystemMediaTransportControls (GSMTC).
//!
//! Covers everything Windows shows in its volume flyout: Spotify, browsers
//! (YouTube, SoundCloud â€¦), Apple Music, VLC and so on. A thread polls the sessions
//! and emits `media://update` when something changes.
//! Polling instead of WinRT events: more robust when sessions switch, negligible cost.
//!
//! - The manager is requested fresh on every poll. A long-lived one goes stale when
//!   an app recreates its session (Spotify closed to the tray, reopened), and then
//!   keeps reporting the old status and position.
//! - Which session is shown: a playing one wins (Windows' current first, then the
//!   app shown before, then any). If nothing plays, the app shown before stays, so
//!   pausing with a media key doesn't make it jump to another app.
//! - Controls go to the shown app, not to whatever Windows considers current.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    /// Cover as a data URL, `None` if the app provides none.
    artwork: Option<String>,
    is_playing: bool,
    /// Seconds, already extrapolated to the time of the query.
    position: f64,
    /// Seconds; 0 = unknown (e.g. live streams).
    duration: f64,
    /// Does the app allow seeking? (Spotify, YouTube: yes; some players: no)
    can_seek: bool,
    app_id: String,
}

/// Last emitted state and when it was emitted.
#[derive(Default)]
pub struct MediaState {
    last: Mutex<Option<(NowPlaying, SystemTime)>>,
    /// App the user explicitly picked in the audio-session dropdown.
    selected: Mutex<Option<String>>,
}

impl MediaState {
    fn app_id(&self) -> String {
        self.last.lock().unwrap().as_ref().map(|(np, _)| np.app_id.clone()).unwrap_or_default()
    }

    fn selected(&self) -> Option<String> {
        self.selected.lock().unwrap().clone()
    }

    fn set_selected(&self, app_id: Option<String>) {
        *self.selected.lock().unwrap() = app_id;
    }

    /// App ID and title of the shown session (mixer, "open the app").
    pub fn shown(&self) -> Option<(String, String)> {
        self.last.lock().unwrap().as_ref().map(|(np, _)| (np.app_id.clone(), np.title.clone()))
    }
}

/// The current state, with the position extrapolated to now.
#[tauri::command]
pub fn media_get(state: State<'_, MediaState>) -> Option<NowPlaying> {
    let (mut np, at) = state.last.lock().unwrap().clone()?;
    if np.is_playing {
        np.position += at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0);
        if np.duration > 0.0 {
            np.position = np.position.min(np.duration);
        }
    }
    Some(np)
}

/// Pick an app explicitly from the audio-session dropdown. `None` follows the
/// normal Windows priority again.
#[tauri::command]
pub fn media_select(state: State<'_, MediaState>, app_id: Option<String>) {
    state.set_selected(app_id.filter(|id| !id.is_empty()));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    app_id: String,
    title: String,
    artist: String,
    is_playing: bool,
}

/// All media apps that currently expose a Windows session, one per app.
#[tauri::command]
pub async fn media_sessions() -> Result<Vec<MediaSession>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<MediaSession>, String> {
        let manager = SessionManager::RequestAsync().map_err(|e| e.message())?.join().map_err(|e| e.message())?;
        let mut list: Vec<MediaSession> = Vec::new();
        for session in sessions(&manager) {
            let app_id = session_app_id(&session);
            if app_id.is_empty() {
                continue;
            }
            let Ok(props) = session.TryGetMediaPropertiesAsync().and_then(|op| op.join()) else { continue };
            let title = props.Title().map(|v| v.to_string()).unwrap_or_default();
            let artist = props.Artist().map(|v| v.to_string()).unwrap_or_default();
            let playing = is_playing(&session);
            if let Some(existing) = list.iter_mut().find(|s| s.app_id == app_id) {
                if playing && !existing.is_playing {
                    existing.title = title;
                    existing.artist = artist;
                    existing.is_playing = true;
                }
                continue;
            }
            list.push(MediaSession { app_id, title, artist, is_playing: playing });
        }
        list.sort_by(|a, b| b.is_playing.cmp(&a.is_playing).then_with(|| a.app_id.cmp(&b.app_id)));
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Async so the blocking `join()` doesn't stall the main thread.
#[tauri::command]
pub async fn media_control(state: State<'_, MediaState>, action: String, position: Option<f64>) -> Result<(), String> {
    let shown = state.app_id();
    let run = || -> windows::core::Result<()> {
        let manager = SessionManager::RequestAsync()?.join()?;
        let session = match sessions(&manager).into_iter().find(|s| session_app_id(s) == shown) {
            Some(s) => s,
            None => manager.GetCurrentSession()?,
        };
        control_session(&session, &action, position)
    };
    run().map_err(|e| e.message())
}

/// Play/pause a specific app from the audio-session dropdown without switching
/// the main Now Playing view to it.
#[tauri::command]
pub async fn media_control_session(app_id: String, action: String) -> Result<(), String> {
    let run = || -> windows::core::Result<()> {
        let manager = SessionManager::RequestAsync()?.join()?;
        let session = sessions(&manager).into_iter().find(|s| session_app_id(s) == app_id);
        match session {
            Some(session) => control_session(&session, &action, None),
            None => Ok(()),
        }
    };
    run().map_err(|e| e.message())
}

fn control_session(session: &Session, action: &str, position: Option<f64>) -> windows::core::Result<()> {
    match action {
        "toggle" => session.TryTogglePlayPauseAsync()?.join()?,
        "next" => session.TrySkipNextAsync()?.join()?,
        "previous" => session.TrySkipPreviousAsync()?.join()?,
        "seek" => {
            // Position relative to the timeline start, in 100 ns ticks.
            let start = session.GetTimelineProperties()?.StartTime()?.Duration;
            let ticks = start + (position.unwrap_or(0.0).max(0.0) * 10_000_000.0) as i64;
            session.TryChangePlaybackPositionAsync(ticks)?.join()?
        }
        _ => false,
    };
    Ok(())
}

const POLL: Duration = Duration::from_millis(400);
/// How long after a track change the cover keeps being re-read, so a late one replaces
/// whatever Windows showed first.
const ARTWORK_SETTLE: Duration = Duration::from_secs(10);
/// Drift beyond which a position counts as a seek and is sent again.
const SEEK_THRESHOLD: f64 = 1.5;

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<NowPlaying> = None;
        let mut last_sent_at = SystemTime::now();
        let mut artwork = Artwork { key: String::new(), since: Instant::now(), data: None };
        // Requested once and reused: a new manager per poll is a cross-process
        // round trip every 400 ms. Dropped (and requested again) on an error.
        let mut manager: Option<SessionManager> = None;

        loop {
            if manager.is_none() {
                manager = SessionManager::RequestAsync().and_then(|op| op.join()).ok();
            }
            let Some(manager_ref) = manager.as_ref() else {
                thread::sleep(Duration::from_secs(2));
                continue;
            };
            let shown = last.as_ref().map(|np| np.app_id.as_str()).unwrap_or_default();
            let selected = app.state::<MediaState>().selected();
            let current = if let Some(id) = selected.as_deref() {
                let session = sessions(manager_ref).into_iter().find(|s| session_app_id(s) == id);
                match session {
                    Some(session) => read(&session, &mut artwork).ok(),
                    None => {
                        // The chosen app closed: fall back to another playing app.
                        app.state::<MediaState>().set_selected(None);
                        None
                    }
                }
            } else {
                None
            };
            let current = current.or_else(|| pick(manager_ref, shown).and_then(|session| read(&session, &mut artwork).ok()));
            // Nothing found: is the manager still alive (e.g. after an Explorer restart)?
            if current.is_none() && manager_ref.GetSessions().is_err() {
                manager = None;
            }

            if changed(&last, &current, last_sent_at) {
                last_sent_at = SystemTime::now();
                *app.state::<MediaState>().last.lock().unwrap() = current.clone().map(|np| (np, last_sent_at));
                let _ = app.emit("media://update", &current);
                last = current;
            }
            thread::sleep(POLL);
        }
    });
}

fn sessions(manager: &SessionManager) -> Vec<Session> {
    manager.GetSessions().map(|list| list.into_iter().collect()).unwrap_or_default()
}

fn session_app_id(session: &Session) -> String {
    session.SourceAppUserModelId().map(|id| id.to_string()).unwrap_or_default()
}

fn is_playing(session: &Session) -> bool {
    session.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).is_ok_and(|s| s == PlaybackStatus::Playing)
}

/// The session to show; `shown` is the app shown so far (see the module docs).
fn pick(manager: &SessionManager, shown: &str) -> Option<Session> {
    let current = manager.GetCurrentSession().ok();
    if current.as_ref().is_some_and(is_playing) {
        return current;
    }
    let all = sessions(manager);
    let by_shown = || all.iter().find(|s| session_app_id(s) == shown).cloned();
    by_shown()
        .filter(is_playing)
        .or_else(|| all.iter().find(|s| is_playing(s)).cloned())
        .or_else(by_shown)
        .or(current)
}

/// Cover of the shown track: reloaded on a track change and for a while after it.
struct Artwork {
    key: String,
    since: Instant,
    data: Option<String>,
}

fn read(session: &Session, artwork: &mut Artwork) -> windows::core::Result<NowPlaying> {
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    let app_id = session.SourceAppUserModelId()?.to_string();

    let key = format!("{app_id}\u{1}{title}\u{1}{artist}");
    if artwork.key != key {
        artwork.key = key;
        artwork.since = Instant::now();
        artwork.data = props.Thumbnail().ok().and_then(|t| load_thumbnail(&t).ok());
    } else if artwork.data.is_none() || artwork.since.elapsed() < ARTWORK_SETTLE {
        // Some apps deliver the cover shortly after the title, and until then
        // Windows may still hand out the previous track's cover (Spotifast).
        artwork.data = props.Thumbnail().ok().and_then(|t| load_thumbnail(&t).ok());
    }

    let playback = session.GetPlaybackInfo()?;
    let is_playing = playback.PlaybackStatus()? == PlaybackStatus::Playing;
    let can_seek = playback.Controls().and_then(|c| c.IsPlaybackPositionEnabled()).unwrap_or(false);
    let timeline = session.GetTimelineProperties()?;
    let duration = ticks_to_secs(timeline.EndTime()?.Duration - timeline.StartTime()?.Duration);
    let mut position = ticks_to_secs(timeline.Position()?.Duration);

    // GSMTC reports the position only sporadically, so extrapolate to now.
    if is_playing {
        let updated = timeline.LastUpdatedTime()?.UniversalTime;
        let elapsed = ticks_to_secs(now_filetime() - updated);
        if updated > 0 && (0.0..86_400.0).contains(&elapsed) {
            position += elapsed;
        }
    }
    if duration > 0.0 {
        position = position.clamp(0.0, duration);
    }

    Ok(NowPlaying { title, artist, artwork: artwork.data.clone(), is_playing, position, duration, can_seek, app_id })
}

fn load_thumbnail(reference: &windows::Storage::Streams::IRandomAccessStreamReference) -> windows::core::Result<String> {
    let stream = reference.OpenReadAsync()?.join()?;
    let size = stream.Size()? as u32;
    if size == 0 {
        return Err(windows::core::Error::empty());
    }
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size)?.join()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes)?;
    Ok(format!("data:{};base64,{}", image_mime(&bytes), base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// MIME type from the image bytes. The stream's ContentType can't be trusted: for a file
/// without an extension (Spotifast's cover cache) Windows reports "image/jpeg,image/jpe,image/jpg",
/// and the commas break the data URL (issue #1).
fn image_mime(bytes: &[u8]) -> &'static str {
    match image::guess_format(bytes) {
        Ok(image::ImageFormat::Jpeg) => "image/jpeg",
        Ok(image::ImageFormat::WebP) => "image/webp",
        Ok(image::ImageFormat::Gif) => "image/gif",
        Ok(image::ImageFormat::Bmp) => "image/bmp",
        _ => "image/png",
    }
}

/// Only emit when something visible changed or the user seeked.
fn changed(last: &Option<NowPlaying>, current: &Option<NowPlaying>, last_sent_at: SystemTime) -> bool {
    match (last, current) {
        (None, None) => false,
        (Some(a), Some(b)) => {
            if a.title != b.title || a.artist != b.artist || a.is_playing != b.is_playing
                || a.artwork != b.artwork || a.duration != b.duration || a.app_id != b.app_id
                || a.can_seek != b.can_seek
            {
                return true;
            }
            let elapsed = last_sent_at.elapsed().map(|d| d.as_secs_f64()).unwrap_or(0.0);
            let expected = if a.is_playing { a.position + elapsed } else { a.position };
            (expected - b.position).abs() > SEEK_THRESHOLD
        }
        _ => true,
    }
}

/// WinRT times are 100 ns ticks.
fn ticks_to_secs(ticks: i64) -> f64 {
    ticks as f64 / 10_000_000.0
}

/// Now as FILETIME (100 ns ticks since 1601), matching `DateTime::UniversalTime`.
fn now_filetime() -> i64 {
    const EPOCH_DIFF_SECS: i64 = 11_644_473_600;
    let since_unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    (since_unix.as_secs() as i64 + EPOCH_DIFF_SECS) * 10_000_000 + since_unix.subsec_nanos() as i64 / 100
}
