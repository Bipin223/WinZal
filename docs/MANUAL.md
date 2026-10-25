# WinZal — Manual

**Version 1.7.7** · Windows 10 / 11 x64 · by **Bipin Rizal**

The illustrated version is [`manual.html`](manual.html). Open it in a browser for the full design, icons and diagrams.

---

## Quick start

- Hover the notch to wake it.
- Click it to open the active tool.
- Click outside or press `Esc` to close.
- `Ctrl + Alt + Space` opens or closes it from anywhere.
- Triple-click the closed notch to toggle Windows Do Not Disturb.

![Notch states](manual/notch.svg)

1. **Closed pill** — time first; media, lyrics, weather or gaming stats when active.
2. **Extended** — header, active tool and the dock.
3. **Line** — a thin strip with an amber locator dot.

### Closed pill text

**Settings → Notch → Closed pill** has the same structure as the pill itself:

- **Text size** — 10–24 px. The whole clock line scales: time, period, date/day and temperature.
- **Weight** — the clock weight slider below.
- The preview above shows the real time, period, date sample and temperature, including the Weather/Date/Day toggles.

The pill widens with larger text; use the **Length** slider if you want more room.

---

## Header icons

| Icon | What it does |
|---|---|
| 👁 **Eye** | **Presentation mode** — hides clipboard previews and the vault while sharing. Auto-enables for Windows Graphics Capture apps (Teams, Snipping Tool) and OBS. |
| 👻 **Ghost** | **Silent mode** — 28% ghost + fully click-through. Triple-click its area, `Ctrl + Alt + S`, or the tray to wake it. |
| 🌙 **Moon** | **Do Not Disturb** — the real Windows DND state. |
| 📌 **Pin** | **Keep open** — stops closing when the pointer leaves. |

Presentation mode and Silent mode are different: presentation protects content; silent makes the notch itself invisible to the mouse.

---

## Tools

Enable, disable and reorder them in **Settings → Tools**.

| Tool | What it does |
|---|---|
| **Overview** | Clock, weather, quick tiles, power mode and system status. |
| **Now Playing** | Artwork, title, artist, seek, transport, output mixer, volume, synced lyrics. |
| **Timer** | Countdown, alarm and a live activity that opens the notch when time is up. |
| **To-Dos** | Fast local checklist. |
| **Notes** | Plain notes, saved instantly on this PC. |
| **Clipboard** | Text, links and images; redacted while presenting. |
| **Shelf** | Drop files for a temporary shelf and drag them back out. |
| **Ask** | Local AI chat (Gemini, Groq or a custom OpenAI-compatible endpoint). |
| **AI Usage** | One custom JSON usage endpoint with a name, paths and a test button. |
| **Weather** | Current, hourly and daily forecast; automatic or fixed location. |
| **Hardware** | CPU, GPU, RAM, temperatures, ping and one minute of history. |
| **Discord** | Voice call, participants, mute states and Rich Presence. |
| **Vault** | Passwords and 2FA codes, encrypted locally. PIN or Windows Hello. |
| **Settings** | The gear at the end of the dock. |

---

## Settings map

| Page | Contains |
|---|---|
| **General** | Startup, language, weather location, updates. |
| **Notch** | Closed pill/line, size, **closed text size and weight**, clock accent, weather/date/day. |
| **Appearance** | Theme, material/glass, corners, accent, island style. |
| **Display** | Visibility, monitor, position, silent, DND, recording dots, **Font**, **Gaming**, presentation. |
| **Performance** | Motion intensity, GPU acceleration, iGPU/dGPU, FPS unlock. |
| **Music** | Music in the pill, lyrics layout, size, weight, min width, auto width, height, offset, visualizer, animation. |
| **Tools** | Tool order and visibility; vault settings. |
| **Timer** | Alarm sound, volume, duration. |
| **AI** | Ask provider/model/key; custom AI Usage endpoint. |
| **Discord** | Client ID, secret, Rich Presence. |
| **About** | Version, update check, changelog, author. |

---

## Font — Display → Font

Five roles share one scale. Pick a role, adjust **size** and **weight**, and the whole UI follows.

![Font roles](manual/typography.svg)

| Role | Default |
|---|---|
| Caption | 12 px · 500 |
| Footnote | 13 px · 450 |
| Body | 14 px · 450 |
| Title | 16 px · 650 |
| Display | 24 px · 700 |

- **0 = default.** Every slider is an offset, not an absolute value.
- Size range: **−4 → +8 px**, 0.5 px steps. Line height follows.
- Weight range: **−300 → +300**, 50 steps. Inter is variable, so 450 and 650 are real weights.
- **Reset font** sets all five roles back to 0.
- The selected role is previewed with its live size/weight above the sliders.
- The original L4 notch uses 11/12/13/15/22; WinZal is intentionally one step larger and slightly bolder.

## Gaming — Display → Gaming

The preview is the real pill: toggles change it immediately.

![Gaming overlay styles](manual/gaming.svg)

- **Show:** FPS, CPU, Temperatures, GPU, RAM.
- **Stat style:** Text, Bars or Graph.
- **Dynamic width:** the pill shrinks to fit the visible stats (**220–580 px**).
- **Gaming overlay:** on/off; the preview shows **ON/OFF**.
- **Transparent in games:** reuses the existing **Glass 0.62** alpha while a game is in front.
- **Custom power in games:** switches Lenovo to Custom when a chosen game starts and restores the previous power mode when it exits (also heals after a crash).
- Hiding GPU/temperatures also stops the GPU counter polling; only CPU/RAM are read.

---

## Privacy

### Presentation mode
- Hides clipboard previews and the vault.
- Blocks copying redacted clipboard cards.
- Auto-enables for Windows Graphics Capture and OBS.
- Toggle: Overview eye, Settings → Display, `Ctrl + Alt + P`, or tray.
- Discord’s DXGI screen share may not be detected automatically; use the eye.

### Silent mode
- The notch fades to **28%** and becomes click-through.
- Hover and clicks are ignored.
- Wake with three quick clicks over its area, `Ctrl + Alt + S`, or tray → Silent mode.
- Persists across restarts.

---

## Performance

| Setting | What it does |
|---|---|
| **Motion intensity** | 0–100% slider. 0 = off, mid = reduced, 100 = full. Preview animates only on hover. |
| **GPU acceleration** | Off = CPU/software, lowest RAM. On = GPU. Auto/iGPU/dGPU choose the adapter. Restart applies. |
| **FPS unlock** | One-time elevated helper; stays after restarts. Enables FPS, CPU temperature and Lenovo fan modes. |
| **Gaming stats** | Per-stat toggles; hiding GPU/temps skips GPU counters. |

Idle memory is roughly **10 MB UI + 20 MB helper**, plus WebView2 shared processes. The notch trims its working set while closed.

---

## Music & lyrics

- Lyrics come from LRCLIB and are cached per track.
- Transitions: **Apple Music**, **Word by Word**, **Kinetic** (per-word 3D) and **Reveal**.
- Old and new lines never overlap: the old line leaves before the new one enters.
- **Lyrics offset:** ±1 s in 0.1 s steps; positive makes lines appear later.
- **Visualizer:** Wave, Pulse, Dots, Ripple or Aurora in the cover accent. Settings previews animate only on hover.

---

### Lyric pill

Settings → Music → Songtext has a live preview and its own pill controls:

- **Text size** 10–15 px, **weight** 400–900.
- **Min width** 284–640 px. The pill never shrinks below this.
- **Auto width** is on by default: it grows with the line and shrinks back, but never below the minimum. Turn it off for a fixed width.
- **Pill height** 24–44 px.
- Instrumental tracks show **Instrumental**; tracks without synced lyrics show **Music**.
- LRCLIB results are matched by title, artist and closest duration, so the right edit of a song wins.

## Shortcuts

| Keys | Action |
|---|---|
| `Ctrl + Alt + Space` | Open / close the notch |
| `Ctrl + Alt + P` | Toggle Presentation mode |
| `Ctrl + Alt + S` | Toggle Silent mode |
| `Esc` | Close the open notch (with keyboard focus) |
| `1` … `9` | Jump to a dock tool |
| Triple-click | Toggle DND; while silent, wake the notch |

Tray menu: Open, Settings, Do not disturb, Silent mode, Presentation mode, Start with Windows, Quit.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Notch invisible | Silent mode. Triple-click, `Ctrl + Alt + S`, or tray → Silent mode. |
| Shortcut does nothing | Another app owns the keys. Use the tray or header buttons. |
| FPS shows a lock | Settings → Performance → FPS unlock once. |
| SmartScreen on install | Unsigned build: **More info → Run anyway**. |
| Windows Hello prompt | The notch hides while the secure prompt is open, then returns. |
| Fonts too large/small | Display → Font → **Reset font**. |
| Look changed too much | Appearance and Notch have their own reset buttons. |

---

## Notes

- Local-only app: no account, no telemetry, no background analytics.
- Settings, vault, notes, to-dos and history stay on this PC.
- Built with Tauri + React + Rust; WebView2 for rendering.

**WinZal 1.7.7** — by **Bipin Rizal**.
