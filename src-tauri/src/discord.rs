//! Discord call in the notch: server icon, channel, who is speaking; mute, deafen, hang up.
//!
//! Uses the Discord client's local RPC (named pipe `\\.\pipe\discord-ipc-N`).
//! Discord only grants voice scopes (`rpc.voice.read/write`) to your own application
//! from the developer portal, hence client ID + client secret in the settings.
//! Flow: handshake → AUTHORIZE (Discord asks once) → exchange code for token
//! → AUTHENTICATE. The refresh token is kept in Credential Manager.
//!
//! State goes to the frontend as `discord://state`; actions come in via `discord_action`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::mpsc;

use crate::secrets;

const SCOPES: [&str; 4] = ["rpc", "rpc.voice.read", "rpc.voice.write", "identify"];
const RETRY: Duration = Duration::from_secs(5);
const TOKEN_URL: &str = "https://discord.com/api/oauth2/token";
/// Redirect the app needs in the developer portal: without it, Discord kept asking for
/// permission in a loop (issue #2). The token exchange tries without it first, then with it.
const REDIRECT: &str = "http://localhost";

#[derive(Default)]
pub struct DiscordState {
    /// Bumped on every (re)start; old loops then exit on their own.
    generation: AtomicU64,
    actions: Mutex<Option<mpsc::UnboundedSender<Action>>>,
    last: Mutex<Option<Snapshot>>,
    /// Most recent public cover URL lookup (title + artist -> URL).
    cover: Mutex<Option<(String, Option<String>)>>,
    /// Drops stale cover lookups when the user skips quickly.
    activity_seq: AtomicU64,
}

enum Action {
    Voice(String),
    Presence(Value),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityInfo {
    title: String,
    artist: String,
    position: f64,
    duration: f64,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// off | no-config | no-client | connecting | authorizing | ready | error
    status: String,
    error: Option<String>,
    call: Option<Call>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    channel_id: String,
    channel_name: String,
    guild_name: Option<String>,
    guild_icon: Option<String>,
    mute: bool,
    deaf: bool,
    speaking: bool,
    members: Vec<Member>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    id: String,
    name: String,
    avatar: String,
    speaking: bool,
    muted: bool,
}

#[tauri::command]
pub fn discord_configure(enabled: bool, client_id: String, app: AppHandle, state: State<'_, DiscordState>) {
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.actions.lock().unwrap() = None;
    let client_id = client_id.trim().to_string();
    if !enabled {
        return publish(&app, Snapshot { status: "off".into(), ..Default::default() });
    }
    if client_id.is_empty() || secrets::read("discord.secret").is_none() {
        return publish(&app, Snapshot { status: "no-config".into(), ..Default::default() });
    }
    let (tx, rx) = mpsc::unbounded_channel();
    *state.actions.lock().unwrap() = Some(tx);
    tauri::async_runtime::spawn(run(app, generation, client_id, rx));
}

#[tauri::command]
pub fn discord_action(action: String, state: State<'_, DiscordState>) {
    if let Some(tx) = state.actions.lock().unwrap().as_ref() {
        let _ = tx.send(Action::Voice(action));
    }
}

/// Publishes the current song as Discord Rich Presence. `None` clears it.
#[tauri::command]
pub async fn discord_activity(info: Option<ActivityInfo>, state: State<'_, DiscordState>) -> Result<(), String> {
    let seq = state.activity_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let activity = match info {
        None => Value::Null,
        Some(info) => {
            let title = clip(info.title.trim(), 128);
            let artist = clip(info.artist.trim(), 128);
            if title.is_empty() {
                Value::Null
            } else {
                let key = format!("{title}\u{1}{artist}");
                let cached = state.cover.lock().unwrap().clone().filter(|(k, _)| k == &key);
                let cover = match cached {
                    Some((_, cover)) => cover,
                    None => {
                        let cover = cover_art(&title, &artist).await;
                        *state.cover.lock().unwrap() = Some((key, cover.clone()));
                        cover
                    }
                };
                // A newer track was requested while the cover lookup was running.
                if state.activity_seq.load(Ordering::SeqCst) != seq {
                    return Ok(());
                }

                let mut activity = json!({ "type": 2, "details": &title });
                if !artist.is_empty() {
                    activity["state"] = json!(&artist);
                }
                if let Some(cover) = cover {
                    activity["assets"] = json!({ "large_image": cover, "large_text": &title });
                }
                if info.duration > 0.0 {
                    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                    let position = info.position.clamp(0.0, info.duration);
                    let start = now - position as i64;
                    let end = start + info.duration as i64;
                    activity["timestamps"] = json!({ "start": start, "end": end });
                }
                // Two buttons, like Spotify/LI Music's rich presence. Discord allows at most two.
                let search = url_encode(&format!("{title} {artist}"));
                activity["buttons"] = json!([
                    { "label": "Listen on YouTube Music", "url": format!("https://music.youtube.com/search?q={search}") },
                    { "label": "Get WinZal", "url": "https://github.com/Bipin223/WinZal" }
                ]);
                activity
            }
        }
    };

    let tx = state.actions.lock().unwrap().clone();
    match tx {
        Some(tx) => tx.send(Action::Presence(activity)).map_err(|_| "Discord is not connected".to_string()),
        None => Err("Discord is not connected".to_string()),
    }
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Minimal RFC 3986 encoder for the YouTube Music search button.
fn url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// iTunes is keyless and returns a usable, public cover URL for most tracks.
/// Discord fetches that URL through its own media proxy.
async fn cover_art(title: &str, artist: &str) -> Option<String> {
    let title = clean_title(title);
    let mut terms = Vec::new();
    if !artist.is_empty() {
        terms.push(format!("{title} {artist}"));
    }
    terms.push(title.clone());
    if !artist.is_empty() {
        terms.push(format!("{artist} {title}"));
    }

    for term in terms {
        if let Some(cover) = itunes_search(&term).await {
            return Some(cover);
        }
    }
    None
}

/// YouTube titles usually carry sections after `|` and labels like
/// "(Official Video)"; neither belongs in an iTunes search.
fn clean_title(title: &str) -> String {
    let mut clean = title.split('|').next().unwrap_or(title).trim();
    for marker in [" (Official", " [Official", " (Lyrics", " [Lyrics", " (Audio", " [Audio"] {
        if let Some(index) = clean.find(marker) {
            clean = clean[..index].trim();
        }
    }
    clean.to_string()
}

async fn itunes_search(term: &str) -> Option<String> {
    if term.trim().is_empty() {
        return None;
    }
    let url = format!(
        "https://itunes.apple.com/search?term={}&media=music&entity=song&limit=1",
        encode(term)
    );
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()?;
    let data: Value = client.get(url).send().await.ok()?.json().await.ok()?;
    let url = data["results"][0]["artworkUrl100"].as_str()?;
    Some(url.replace("100x100bb", "600x600bb"))
}

/// Last known state (for a reloaded frontend).
#[tauri::command]
pub fn discord_state(state: State<'_, DiscordState>) -> Snapshot {
    state.last.lock().unwrap().clone().unwrap_or(Snapshot { status: "off".into(), ..Default::default() })
}

fn publish(app: &AppHandle, snap: Snapshot) {
    *app.state::<DiscordState>().last.lock().unwrap() = Some(snap.clone());
    let _ = app.emit("discord://state", snap);
}

fn current(app: &AppHandle, generation: u64) -> bool {
    app.state::<DiscordState>().generation.load(Ordering::SeqCst) == generation
}

async fn run(app: AppHandle, generation: u64, client_id: String, mut actions: mpsc::UnboundedReceiver<Action>) {
    while current(&app, generation) {
        publish(&app, Snapshot { status: "connecting".into(), ..Default::default() });
        let Some(pipe) = connect().await else {
            publish(&app, Snapshot { status: "no-client".into(), ..Default::default() });
            tokio::time::sleep(RETRY).await;
            continue;
        };
        let mut session = Session::new(app.clone(), generation, client_id.clone(), pipe);
        if let Err(e) = session.serve(&mut actions).await {
            if !current(&app, generation) {
                return;
            }
            let status = if e == "closed" { "no-client" } else { "error" };
            publish(&app, Snapshot { status: status.into(), error: (e != "closed").then_some(e), call: None });
        }
        tokio::time::sleep(RETRY).await;
    }
}

async fn connect() -> Option<NamedPipeClient> {
    for i in 0..10 {
        if let Ok(pipe) = ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{i}")) {
            return Some(pipe);
        }
    }
    None
}

struct Session {
    app: AppHandle,
    generation: u64,
    client_id: String,
    reader: ReadHalf<NamedPipeClient>,
    writer: WriteHalf<NamedPipeClient>,
    nonce: u64,
    me: Option<String>,
    status: String,
    call: Option<Call>,
    guild_id: Option<String>,
    /// Who is speaking right now (user IDs).
    speaking: HashMap<String, bool>,
    mute: bool,
    deaf: bool,
}

type Res<T> = Result<T, String>;

impl Session {
    fn new(app: AppHandle, generation: u64, client_id: String, pipe: NamedPipeClient) -> Self {
        let (reader, writer) = tokio::io::split(pipe);
        Self {
            app,
            generation,
            client_id,
            reader,
            writer,
            nonce: 0,
            me: None,
            status: "connecting".into(),
            call: None,
            guild_id: None,
            speaking: HashMap::new(),
            mute: false,
            deaf: false,
        }
    }

    async fn serve(&mut self, actions: &mut mpsc::UnboundedReceiver<Action>) -> Res<()> {
        self.write(0, json!({ "v": 1, "client_id": self.client_id })).await?;
        loop {
            if !current(&self.app, self.generation) {
                return Ok(());
            }
            tokio::select! {
                frame = read_frame(&mut self.reader) => {
                    let (op, msg) = frame?;
                    match op {
                        1 => self.on_message(msg).await?,
                        2 => return Err(msg["message"].as_str().unwrap_or("closed").to_string()),
                        3 => self.write(4, msg).await?, // Ping → Pong
                        _ => {}
                    }
                }
                Some(action) = actions.recv() => self.on_action(action).await?,
                _ = tokio::time::sleep(Duration::from_secs(2)) => {}
            }
        }
    }

    async fn on_action(&mut self, action: Action) -> Res<()> {
        match action {
            Action::Voice(action) => match action.as_str() {
                "mute" => self.command("SET_VOICE_SETTINGS", json!({ "mute": !self.mute }), None).await,
                "deafen" => self.command("SET_VOICE_SETTINGS", json!({ "deaf": !self.deaf }), None).await,
                "leave" => self.command("SELECT_VOICE_CHANNEL", json!({ "channel_id": null, "force": true }), None).await,
                _ => Ok(()),
            },
            Action::Presence(activity) => {
                self.command("SET_ACTIVITY", json!({ "pid": std::process::id(), "activity": activity }), None).await
            }
        }
    }

    async fn on_message(&mut self, msg: Value) -> Res<()> {
        let cmd = msg["cmd"].as_str().unwrap_or_default();
        let evt = msg["evt"].as_str().unwrap_or_default();
        let data = &msg["data"];
        if evt == "ERROR" {
            return match cmd {
                // Token invalid: ask again.
                "AUTHENTICATE" => {
                    let _ = secrets::secret_delete("discord.token".into());
                    self.authorize().await
                }
                "AUTHORIZE" => {
                    let msg = data["message"].as_str().unwrap_or("Abgelehnt");
                    Err(if msg.contains("redirect_uri") || msg.contains("Redirect URI") { "Im Portal http://localhost als Redirect eintragen".into() } else { msg.to_string() })
                }
                _ => Ok(()),
            };
        }
        match (cmd, evt) {
            ("DISPATCH", "READY") => self.login().await?,
            ("AUTHORIZE", _) => {
                let code = data["code"].as_str().ok_or("Kein Code")?.to_string();
                let token = self.exchange(&[("grant_type", "authorization_code"), ("code", &code)]).await?;
                self.command("AUTHENTICATE", json!({ "access_token": token }), None).await?;
            }
            ("AUTHENTICATE", _) => {
                self.me = data["user"]["id"].as_str().map(String::from);
                self.status = "ready".into();
                self.subscribe("VOICE_CHANNEL_SELECT", json!({})).await?;
                self.subscribe("VOICE_SETTINGS_UPDATE", json!({})).await?;
                self.command("GET_VOICE_SETTINGS", json!({}), None).await?;
                self.command("GET_SELECTED_VOICE_CHANNEL", json!({}), None).await?;
                self.publish();
            }
            ("GET_VOICE_SETTINGS", _) | ("DISPATCH", "VOICE_SETTINGS_UPDATE") => {
                self.mute = data["mute"].as_bool().unwrap_or(self.mute);
                self.deaf = data["deaf"].as_bool().unwrap_or(self.deaf);
                self.publish();
            }
            ("GET_SELECTED_VOICE_CHANNEL", _) => self.set_channel(data).await?,
            ("DISPATCH", "VOICE_CHANNEL_SELECT") => {
                if data["channel_id"].is_null() {
                    self.set_channel(&Value::Null).await?;
                } else {
                    self.command("GET_SELECTED_VOICE_CHANNEL", json!({}), None).await?;
                }
            }
            ("GET_GUILD", _) => {
                if let Some(call) = self.call.as_mut() {
                    call.guild_name = data["name"].as_str().map(String::from);
                    call.guild_icon = data["icon_url"].as_str().map(String::from);
                }
                self.publish();
            }
            ("DISPATCH", "SPEAKING_START" | "SPEAKING_STOP") => {
                if let Some(id) = data["user_id"].as_str() {
                    self.speaking.insert(id.to_string(), evt == "SPEAKING_START");
                    self.publish();
                }
            }
            ("DISPATCH", "VOICE_STATE_CREATE" | "VOICE_STATE_UPDATE") => {
                let m = member(data);
                if let Some(call) = self.call.as_mut() {
                    match call.members.iter_mut().find(|x| x.id == m.id) {
                        Some(x) => *x = m,
                        None => call.members.push(m),
                    }
                }
                self.publish();
            }
            ("DISPATCH", "VOICE_STATE_DELETE") => {
                let id = data["user"]["id"].as_str().unwrap_or_default();
                if let Some(call) = self.call.as_mut() {
                    call.members.retain(|x| x.id != id);
                }
                self.publish();
            }
            _ => {}
        }
        Ok(())
    }

    /// Refreshes the stored token, otherwise asks once in Discord.
    async fn login(&mut self) -> Res<()> {
        if let Some(refresh) = secrets::read("discord.token") {
            if let Ok(token) = self.exchange(&[("grant_type", "refresh_token"), ("refresh_token", &refresh)]).await {
                return self.command("AUTHENTICATE", json!({ "access_token": token }), None).await;
            }
        }
        self.authorize().await
    }

    async fn authorize(&mut self) -> Res<()> {
        self.status = "authorizing".into();
        self.publish();
        let client_id = self.client_id.clone();
        self.command("AUTHORIZE", json!({ "client_id": client_id, "scopes": SCOPES }), None).await
    }

    /// Fetches an OAuth token (code or refresh token) and stores the new refresh token.
    async fn exchange(&self, grant: &[(&str, &str)]) -> Res<String> {
        let secret = secrets::read("discord.secret").ok_or("Client-Secret fehlt")?;
        let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
        let mut last = String::new();
        for redirect in [None, Some(REDIRECT)] {
            let mut fields: Vec<(&str, &str)> = vec![("client_id", &self.client_id), ("client_secret", &secret)];
            fields.extend_from_slice(grant);
            if let Some(r) = redirect {
                fields.push(("redirect_uri", r));
            }
            let body = fields.iter().map(|(k, v)| format!("{k}={}", encode(v))).collect::<Vec<_>>().join("&");
            let res = http
                .post(TOKEN_URL)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await
                .map_err(|_| "Keine Verbindung".to_string())?;
            let ok = res.status().is_success();
            let json: Value = res.json().await.unwrap_or_default();
            if ok {
                if let Some(refresh) = json["refresh_token"].as_str() {
                    let _ = secrets::secret_set("discord.token".into(), refresh.into());
                }
                return json["access_token"].as_str().map(String::from).ok_or_else(|| "Kein Token".into());
            }
            last = json["error_description"].as_str().or(json["error"].as_str()).unwrap_or("Token abgelehnt").to_string();
        }
        Err(last)
    }

    async fn set_channel(&mut self, data: &Value) -> Res<()> {
        let old = self.call.as_ref().map(|c| c.channel_id.clone());
        let new = data["id"].as_str().map(String::from);
        if old != new {
            if let Some(id) = &old {
                for evt in ["SPEAKING_START", "SPEAKING_STOP", "VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE"] {
                    self.command("UNSUBSCRIBE", json!({ "channel_id": id }), Some(evt)).await?;
                }
            }
            self.speaking.clear();
        }
        let Some(id) = new else {
            self.call = None;
            self.guild_id = None;
            self.publish();
            return Ok(());
        };
        let members = data["voice_states"].as_array().map(|v| v.iter().map(member).collect()).unwrap_or_default();
        let (guild_name, guild_icon) = self.call.as_ref().filter(|_| old.as_deref() == Some(&id)).map(|c| (c.guild_name.clone(), c.guild_icon.clone())).unwrap_or_default();
        self.call = Some(Call {
            channel_id: id.clone(),
            channel_name: data["name"].as_str().unwrap_or_default().to_string(),
            guild_name,
            guild_icon,
            members,
            ..Default::default()
        });
        self.guild_id = data["guild_id"].as_str().map(String::from);
        if old.as_deref() != Some(&id) {
            for evt in ["SPEAKING_START", "SPEAKING_STOP", "VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE"] {
                self.subscribe(evt, json!({ "channel_id": id })).await?;
            }
            if let Some(guild) = self.guild_id.clone() {
                self.command("GET_GUILD", json!({ "guild_id": guild }), None).await?;
            }
        }
        self.publish();
        Ok(())
    }

    fn publish(&self) {
        let call = self.call.clone().map(|mut c| {
            c.mute = self.mute;
            c.deaf = self.deaf;
            for m in &mut c.members {
                m.speaking = self.speaking.get(&m.id).copied().unwrap_or(false);
            }
            c.speaking = self.me.as_ref().is_some_and(|me| self.speaking.get(me).copied().unwrap_or(false));
            c
        });
        publish(&self.app, Snapshot { status: self.status.clone(), error: None, call });
    }

    async fn subscribe(&mut self, evt: &str, args: Value) -> Res<()> {
        self.command("SUBSCRIBE", args, Some(evt)).await
    }

    async fn command(&mut self, cmd: &str, args: Value, evt: Option<&str>) -> Res<()> {
        self.nonce += 1;
        let mut msg = json!({ "cmd": cmd, "args": args, "nonce": self.nonce.to_string() });
        if let Some(evt) = evt {
            msg["evt"] = json!(evt);
        }
        self.write(1, msg).await
    }

    async fn write(&mut self, op: u32, msg: Value) -> Res<()> {
        let body = serde_json::to_vec(&msg).map_err(|e| e.to_string())?;
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(&body);
        self.writer.write_all(&frame).await.map_err(|_| "closed".to_string())
    }
}

async fn read_frame(reader: &mut ReadHalf<NamedPipeClient>) -> Res<(u32, Value)> {
    let mut head = [0u8; 8];
    reader.read_exact(&mut head).await.map_err(|_| "closed".to_string())?;
    let op = u32::from_le_bytes(head[..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..].try_into().unwrap()) as usize;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await.map_err(|_| "closed".to_string())?;
    Ok((op, serde_json::from_slice(&body).unwrap_or_default()))
}

/// Entry from `voice_states` or a VOICE_STATE_* event.
fn member(v: &Value) -> Member {
    let user = &v["user"];
    let id = user["id"].as_str().unwrap_or_default().to_string();
    let avatar = match user["avatar"].as_str() {
        Some(hash) => format!("https://cdn.discordapp.com/avatars/{id}/{hash}.png?size=64"),
        None => format!("https://cdn.discordapp.com/embed/avatars/{}.png", id.parse::<u64>().map(|n| (n >> 22) % 6).unwrap_or(0)),
    };
    let name = v["nick"].as_str().or(user["global_name"].as_str()).or(user["username"].as_str()).unwrap_or_default().to_string();
    let vs = &v["voice_state"];
    let muted = ["mute", "self_mute", "deaf", "self_deaf"].iter().any(|k| vs[*k].as_bool().unwrap_or(false));
    Member { id, name, avatar, speaking: false, muted }
}

/// Minimal URL encoding for form fields.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
