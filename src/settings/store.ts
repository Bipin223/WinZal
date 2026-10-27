import { createStore } from "../lib/store";
import type { AlarmDuration, AlarmSound } from "../lib/sound";
import type { MotionStyle } from "../design/motion";
import { isClockStyle, type ClockStyle } from "../notch/clockStyles";

export type AskProvider = "gemini" | "groq" | "custom";
export type AskEffort = "low" | "medium" | "high" | "xhigh";

export interface AskProviderConfig {
  model: string;
  effort: AskEffort;
  /** Only for "custom": OpenAI-compatible base, e.g. https://…/v1 */
  baseUrl: string;
}

export type TypeRole = "caption" | "footnote" | "body" | "title" | "display";
export type TypeAxis = { size: number; weight: number };

/** Lyric entrance effects; `word` is the retained original. */
export type LyricAnimation =
  | "word"
  | "apple"
  | "fill"
  | "glitch"
  | "liquid"
  | "spot"
  | "spark"
  | "orbit"
  | "ambient";
export type LyricEqualizerStyle = "bars" | "mirror" | "ticks";
export type LyricGlowStyle = "none" | "wave" | "aurora" | "bokeh" | "leaves";

export const DEFAULT_TYPOGRAPHY: Record<TypeRole, TypeAxis> = {
  caption: { size: 0, weight: 0 },
  footnote: { size: 0, weight: 0 },
  body: { size: 0, weight: 0 },
  title: { size: 0, weight: 0 },
  display: { size: 0, weight: 0 },
};

export interface Settings {
  /** Open on hover or only on click. */
  openMode: "hover" | "click";
  hoverDelay: "fast" | "normal" | "patient";
  /** Order = order in the tool bar. */
  tools: { id: string; enabled: boolean }[];
  /** `saveHistory` off keeps chats in memory only; existing files are never deleted by the switch. */
  ask: { provider: AskProvider; configs: Record<AskProvider, AskProviderConfig>; saveHistory: boolean };
  /** `auto` = detected via IP (again on every start); a picked location stays. */
  weather: { name: string; lat: number; lon: number; auto?: boolean } | null;
  /**
   * Display: always on top or hidden in fullscreen; monitor name (null = primary);
   * `offset` = horizontal offset from the center in CSS px (set by dragging).
   */
  display: {
    visibility: "always" | "hide-fullscreen";
    monitor: string | null;
    offset: number;
    /**
     * Closed look outside focus mode: the notch, or a thin line (no music etc.; only a
     * finished timer opens it into the notch until dismissed). Hover and click work as usual.
     */
    idleStyle: "notch" | "line";
  };
  /** Gaming mode: FPS + load in the closed notch: off, for chosen games/apps, or always. */
  gaming: {
    mode: "off" | "games";
    apps: string[];
    transparent: boolean;
    showFps: boolean;
    showCpu: boolean;
    showTemps: boolean;
    showGpu: boolean;
    showRam: boolean;
    /** How CPU/GPU/RAM values are drawn. */
    style: "text" | "bars";
    /** Thin separator between the left (FPS/CPU) and right (GPU/RAM) groups. */
    divider: boolean;
    /** Hide the whole notch while a game is foreground (best for iGPU/auto). */
    hideInGames: boolean;
  };
  /** Dots like on iPhone: mic/camera (green) or screen recording (red) in use. */
  privacyDots: boolean;
  /** Windows toasts + island notification cards. Off stops the native listener. */
  notifications: boolean;
  /** Per-role size/weight offsets; 0 = the built-in default. */
  typography: Record<TypeRole, TypeAxis>;
  /** Notch colours and shape. `accent: "auto"` follows the album art. */
  appearance: {
    accent: string;
    material: "solid" | "dark" | "glass";
    corners: "rounded" | "squared";
    /** Dark, light, follow Windows, or a custom island color with matching text. */
    theme: "dark" | "light" | "system" | "custom";
    /** Surface color for the custom theme. Text switches automatically. */
    themeColor: string;
    /** Dynamic = attached notch, Windows = floating island with a rim. */
    style: "dynamic" | "windows";
    /** Extra width in px for the closed island (including music). */
    islandWidth: number;
    /** Closed island height in px (music and live activities included). */
    islandHeight: number;
    /** Length of the thin idle line in px. */
    lineWidth: number;
    /** Thickness of the thin idle line in px. */
    lineThickness: number;
    /** Squeeze/bounce while dragging the notch. */
    dragAnimation: boolean;
    /** Show time + weather in the closed island. */
    clockWeather: boolean;
    /** Closed clock extras; the time itself is always shown when the clock is on. */
    clockShowWeather: boolean;
    clockShowDate: boolean;
    clockShowDay: boolean;
    /** Show the playing track in the closed pill at all (music only in the Now Playing tab when off). */
    musicInPill: boolean;
    /** Colour of the first clock digit (OnePlus-style accent); red by default. */
    clockAccent: string;
    /** Closed clock pill: compact or bigger/bolder text (large default). */
    /** Closed pill clock font size in px. */
    clockClosedSize: number;
    /** Closed pill clock weight (400–900). */
    clockClosedWeight: number;
    /** Open/extended header clock weight (400–900). */
    clockOpenWeight: number;
    /** Larger + 900-weight hour in the clock (OnePlus style). Off = uniform clock. */
    clockEmphasis: boolean;
    /** Expanded clock face; the closed pill uses a compact version of it. */
    clockStyle: ClockStyle;
    /** Split face: divider height as a percentage of the digit height. */
    clockSplitHeight: number;
    /** Keep the notch fully solid while ghosted/click-through. */
    ghostSolid: boolean;
    /** Show the current synced lyric line in the closed music pill instead of the title. */
    lyricsInPill: boolean;
    /** One line (inline) or the current + next line. */
    lyricsLayout: "inline" | "lines";
    /** Global motion intensity, 0 = off, 100 = full. */
    motion: number;
    /** Global chrome spring feel: default (current) or iOS. */
    motionStyle: MotionStyle;
    /** Continuous lyric font size in px; the pill and visualizer grow with it. */
    lyricsTextSize: number;
    /** Global seconds added to lyric timestamps (+ = lines appear later). */
    lyricsOffset: number;
    /** Per-track corrections in seconds, keyed by lyricTrackKey(title, artist). */
    lyricsTrackOffsets: Record<string, number>;
    /** Use exact word timings when available, or only one timestamp per line. */
    lyricsSyncMode: "word" | "line";
    /** Minimum width of the closed lyric pill. */
    lyricsPillMinWidth: number;
    /** Maximum width when auto width is on; fixed width when it is off. */
    lyricsPillLength: number;
    /** true: grow/shrink with the text (never below the minimum); false: fixed width. */
    lyricsPillAuto: boolean;
    /** Lyric pill height. */
    lyricsPillHeight: number;
    /** Lyric text weight. */
    lyricsTextWeight: number;
    /** Subtle waveform behind the lyric, in the cover's accent color. */
    lyricsVisualizer: boolean;
    /** Equalizer style at the right of the lyrics pill. */
    lyricsVisualizerStyle: LyricEqualizerStyle;
    /** Soft light layer behind the lyric. */
    lyricsGlowStyle: LyricGlowStyle;
    /** Line entrance effect. */
    lyricsAnimation: LyricAnimation;
    /** true = hardware acceleration (smoother, more RAM); false = software/CPU (less RAM, more CPU). */
    gpuAcceleration: boolean;
    /** GPU mode when acceleration is on: auto, integrated, or discrete. */
    gpuPreference: "auto" | "igpu" | "dgpu";
  };
  /** Discord call in the notch (local RPC, on = Discord tool enabled). The client secret is stored with the secrets. */
  discord: { clientId: string; presence: boolean; appName: string; statusLine: "title" | "artist" | "app"; musicDuringCall: boolean };
  alarm: { sound: AlarmSound; volume: number; duration: AlarmDuration };
  /** English is the only language in this build. */
  language: "en";
  /** Celsius by default; the clock still follows the Windows region. */
  units: { temp: "c" | "f"; clock: "24" | "12" };
  /**
   * Presentation mode: hides clipboard previews, balances and the vault while sharing
   * the screen. `manual` = switched on by hand, `auto` = on while a recording is detected.
   */
  presentation: { manual: boolean; auto: boolean };
  /** Check for a new version once a day, anonymously (installs only on click). */
  updates: { auto: boolean; install: boolean };
}

/** All tool IDs in default order. Must match `src/notch/tabs.ts`. */
export const TOOL_IDS = [
  "overview",
  "media",
  "timer",
  "todos",
  "notes",
  "clipboard",
  "shelf",
  "ask",
  "convert",
  "weather",
  "system",
  "discord",
  "vault",
] as const;

const DEFAULT_OFF = new Set<string>(["discord", "vault"]);

const defaults: Settings = {
  openMode: "hover",
  hoverDelay: "normal",
  notifications: true,
  tools: TOOL_IDS.map((id) => ({ id, enabled: !DEFAULT_OFF.has(id) })),
  ask: {
    provider: "gemini",
    configs: {
      gemini: { model: "gemini-3.5-flash", effort: "medium", baseUrl: "" },
      groq: { model: "llama-3.3-70b-versatile", effort: "medium", baseUrl: "" },
      custom: { model: "", effort: "medium", baseUrl: "" },
    },
    saveHistory: true,
  },
  weather: null,
  display: { visibility: "always", monitor: null, offset: 0, idleStyle: "notch" },
  gaming: {
    mode: "off",
    apps: ["GenshinImpact.exe", "YuanShen.exe"],
    transparent: false,
    showFps: true,
    showCpu: true,
    showTemps: true,
    showGpu: true,
    showRam: true,
    style: "text",
    divider: false,
    hideInGames: false,
  },
  typography: { ...DEFAULT_TYPOGRAPHY },
  privacyDots: true,
  appearance: {
    accent: "auto",
    material: "solid",
    corners: "rounded",
    theme: "dark",
    themeColor: "#141416",
    style: "dynamic",
    islandWidth: 0,
    islandHeight: 30,
    lineWidth: 150,
    lineThickness: 5,
    dragAnimation: true,
    clockWeather: true,
  clockShowWeather: true,
  clockShowDate: true,
  clockShowDay: true,
    musicInPill: true,
    clockAccent: "#ff453a",
    clockClosedSize: 15,
    clockClosedWeight: 800,
    clockOpenWeight: 700,
    clockEmphasis: true,
    clockStyle: "classic",
    clockSplitHeight: 62,
    ghostSolid: false,
    lyricsInPill: false,
    lyricsLayout: "inline",
    motion: 100,
    motionStyle: "default",
    lyricsTextSize: 12,
    lyricsOffset: 0,
    lyricsTrackOffsets: {},
    lyricsSyncMode: "word",
    lyricsPillMinWidth: 284,
    lyricsPillLength: 640,
    lyricsPillAuto: true,
    lyricsPillHeight: 30,
    lyricsTextWeight: 600,
    lyricsVisualizer: true,
    lyricsVisualizerStyle: "bars",
    lyricsGlowStyle: "aurora",
    lyricsAnimation: "word",
    gpuAcceleration: false,
    gpuPreference: "dgpu",
  },
  discord: { clientId: "", presence: true, appName: "Bipin Rizal's WinZal app", statusLine: "title", musicDuringCall: false },
  alarm: { sound: "chime", volume: 0.7, duration: 5 },
  language: "en",
  units: regionUnits(),
  presentation: { manual: false, auto: true },
  updates: { auto: true, install: true },
};

/** °F and 12 h where the Windows region uses them (US & co.), otherwise °C and 24 h. */
function regionUnits(): Settings["units"] {
  const loc = navigator.language || "en-US";
  let cycle: string | undefined;
  try {
    cycle = new Intl.DateTimeFormat(loc, { hour: "numeric" }).resolvedOptions().hourCycle;
  } catch {
    // Unknown locale â†’ metric, 24 h.
  }
  return {
    temp: "c",
    clock: cycle === "h12" || cycle === "h11" ? "12" : "24",
  };
}

export const hoverDelayMs: Record<Settings["hoverDelay"], number> = { fast: 90, normal: 220, patient: 480 };

/** No settings saved yet = fresh install (read before the store writes its defaults). */
export const firstRun = (() => {
  try {
    return localStorage.getItem("notch:settings") === null;
  } catch {
    return false;
  }
})();

export const settings = createStore<Settings>(defaults, { persist: "settings" });

// Fill in settings from older versions: new fields + append new tools.
settings.set((s) => {
  const known = new Set<string>(TOOL_IDS);
  const tools = (s.tools ?? []).filter((t) => known.has(t.id));
  for (const id of TOOL_IDS) {
    if (tools.some((t) => t.id === id)) continue;
    // Overview is the start page, so put it first for existing installs.
    if (id === "overview") tools.unshift({ id, enabled: true });
    else tools.push({ id, enabled: !DEFAULT_OFF.has(id) });
  }
  return {
    ...defaults,
    ...s,
    tools,
    typography: {
      caption: { ...defaults.typography.caption, ...s.typography?.caption },
      footnote: { ...defaults.typography.footnote, ...s.typography?.footnote },
      body: { ...defaults.typography.body, ...s.typography?.body },
      title: { ...defaults.typography.title, ...s.typography?.title },
      display: { ...defaults.typography.display, ...s.typography?.display },
    },
    display: { ...defaults.display, ...s.display },
    gaming: migrateGaming(s.gaming),
    appearance: {
      ...defaults.appearance,
      ...s.appearance,
      theme: (() => {
        const stored = (s.appearance as { theme?: string } | undefined)?.theme;
        return stored === "light" || stored === "system" || stored === "custom" ? stored : "dark";
      })(),
      themeColor: (() => {
        const stored = (s.appearance as { themeColor?: string } | undefined)?.themeColor;
        return typeof stored === "string" && /^#[0-9a-f]{6}$/i.test(stored) ? stored : defaults.appearance.themeColor;
      })(),
      // Only the word-by-word effect survives from the old set; the animation lab
      // supplies the new effects.
      lyricsAnimation: (() => {
        const stored = (s.appearance as { lyricsAnimation?: string } | undefined)?.lyricsAnimation;
        const valid: LyricAnimation[] = ["word", "apple", "fill", "glitch", "liquid", "spot", "spark", "orbit", "ambient"];
        if (stored === "focus" || stored === "stripe" || stored === "warp") return "spot";
        if (stored === "sway" || stored === "float") return "ambient";
        if (stored === "irid") return "fill";
        if (stored === "duet") return "word";
        return valid.includes(stored as LyricAnimation) ? (stored as LyricAnimation) : "word";
      })(),
      // Old Default / Large / Small / Big / Biggest become one continuous size.
      lyricsTextSize: (() => {
        const legacy = s.appearance as { lyricsTextSize?: number; lyricsSize?: string } | undefined;
        if (typeof legacy?.lyricsTextSize === "number") return Math.min(15, Math.max(10, legacy.lyricsTextSize));
        if (legacy?.lyricsSize === "biggest") return 14;
        return 12;
      })(),
      lyricsVisualizer: s.appearance?.lyricsVisualizer ?? defaults.appearance.lyricsVisualizer,
      // Old bold/regular choice became two continuous weight sliders.
      clockClosedWeight: (() => {
        const stored = (s.appearance as { clockClosedWeight?: number } | undefined)?.clockClosedWeight;
        if (typeof stored === "number") return Math.min(900, Math.max(400, stored));
        return (s.appearance as { clockText?: string } | undefined)?.clockText === "compact" ? 700 : 800;
      })(),
      clockClosedSize: (() => {
        const legacy = s.appearance as { clockClosedSize?: number; clockText?: string } | undefined;
        if (typeof legacy?.clockClosedSize === "number") return Math.min(24, Math.max(10, legacy.clockClosedSize));
        return legacy?.clockText === "compact" ? 13 : 15;
      })(),
      clockOpenWeight: (() => {
        const legacy = s.appearance as { clockOpenWeight?: number; clockBold?: boolean } | undefined;
        if (typeof legacy?.clockOpenWeight === "number") return Math.min(900, Math.max(400, legacy.clockOpenWeight));
        return legacy?.clockBold === false ? 600 : 700;
      })(),
      clockStyle: (() => {
        const stored = (s.appearance as { clockStyle?: string } | undefined)?.clockStyle;
        // "vertical" was replaced by the Split face before release.
        if (stored === "vertical") return "split" as const;
        return isClockStyle(stored) ? stored : defaults.appearance.clockStyle;
      })(),
      clockSplitHeight: (() => {
        const stored = (s.appearance as { clockSplitHeight?: number } | undefined)?.clockSplitHeight;
        return typeof stored === "number" ? Math.min(100, Math.max(20, Math.round(stored))) : defaults.appearance.clockSplitHeight;
      })(),
      lyricsVisualizerStyle: "bars",
      lyricsGlowStyle: (() => {
        const stored = (s.appearance as { lyricsGlowStyle?: string } | undefined)?.lyricsGlowStyle;
        const valid: LyricGlowStyle[] = ["none", "wave", "aurora", "bokeh", "leaves"];
        if (valid.includes(stored as LyricGlowStyle)) return stored as LyricGlowStyle;
        // Bloom and Night sky were removed; other old picks fall back to Aurora.
        return "aurora";
      })(),
      lyricsPillLength: (() => {
        const a = s.appearance as { lyricsPillLength?: number; lyricsPillMinWidth?: number; lyricsPillAuto?: boolean } | undefined;
        if (typeof a?.lyricsPillLength === "number") return Math.min(640, Math.max(284, Math.round(a.lyricsPillLength)));
        const min =
          typeof a?.lyricsPillMinWidth === "number"
            ? Math.min(640, Math.max(284, Math.round(a.lyricsPillMinWidth)))
            : defaults.appearance.lyricsPillMinWidth;
        // Older fixed-width pills used Min width as their actual length.
        return a?.lyricsPillAuto === false ? min : defaults.appearance.lyricsPillLength;
      })(),
      lyricsOffset: (() => {
        const stored = (s.appearance as { lyricsOffset?: number } | undefined)?.lyricsOffset;
        return typeof stored === "number" ? Math.min(5, Math.max(-5, stored)) : 0;
      })(),
      lyricsTrackOffsets: (() => {
        const stored = (s.appearance as { lyricsTrackOffsets?: unknown } | undefined)?.lyricsTrackOffsets;
        if (!stored || typeof stored !== "object") return {};
        const out: Record<string, number> = {};
        for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          const offset = Math.round(Math.min(5, Math.max(-5, value)) * 100) / 100;
          if (offset !== 0) out[key] = offset;
        }
        return out;
      })(),
      lyricsSyncMode: (s.appearance as { lyricsSyncMode?: string } | undefined)?.lyricsSyncMode === "line" ? "line" : "word",
      motion: (() => {
        const stored = (s.appearance as { motion?: number } | undefined)?.motion;
        return typeof stored === "number" ? Math.min(100, Math.max(0, stored)) : 100;
      })(),
      motionStyle: (() => {
        const stored = (s.appearance as { motionStyle?: string } | undefined)?.motionStyle;
        return stored === "ios" ? "ios" : "default";
      })(),
      // The experimental RGB accent was removed; fall back to auto.
      accent: s.appearance?.accent === "rgb" ? defaults.appearance.accent : s.appearance?.accent ?? defaults.appearance.accent,
      // Extra width is additive air now: 0 auto-fits exactly, and negative
      // values from the old fixed-width slider become 0 instead of clipping.
      islandWidth: (() => {
        const value = (s.appearance as { islandWidth?: number } | undefined)?.islandWidth;
        return typeof value === "number" ? Math.min(214, Math.max(0, Math.round(value))) : defaults.appearance.islandWidth;
      })(),
      islandHeight: (() => {
        const value = (s.appearance as { islandHeight?: number } | undefined)?.islandHeight;
        return typeof value === "number" ? Math.min(40, Math.max(26, Math.round(value))) : defaults.appearance.islandHeight;
      })(),
      // The line keeps its own length and thickness, so switching Notch/Line
      // restores the size that belongs to that look.
      lineWidth: (() => {
        const value = (s.appearance as { lineWidth?: number } | undefined)?.lineWidth;
        return typeof value === "number" ? Math.min(420, Math.max(100, Math.round(value))) : defaults.appearance.lineWidth;
      })(),
      lineThickness: (() => {
        const value = (s.appearance as { lineThickness?: number } | undefined)?.lineThickness;
        return typeof value === "number" ? Math.min(12, Math.max(2, Math.round(value))) : defaults.appearance.lineThickness;
      })(),
    },
    discord: { ...defaults.discord, ...s.discord },
    alarm: { ...defaults.alarm, ...s.alarm },
    language: "en",
    units: { ...defaults.units, ...s.units, temp: "c" },
    presentation: { ...defaults.presentation, ...s.presentation },
    updates: { ...defaults.updates, ...s.updates },
    ask: migrateAsk(s.ask),
  };
});

// Give the Discord card its default author name once. A name the user typed
// themselves is never overwritten; clearing it afterwards also sticks.
try {
  if (!localStorage.getItem("notch:discord-app-name")) {
    settings.set((s) => (s.discord.appName ? s : { ...s, discord: { ...s.discord, appName: "Bipin Rizal’s WinZal app" } }));
    localStorage.setItem("notch:discord-app-name", "1");
  }
} catch {
  // localStorage unavailable: the default is already set.
}

/** Old gaming modes were off / fullscreen / always; now off / games / always. */
function migrateGaming(old: unknown): Settings["gaming"] {
  const legacy = (old ?? {}) as {
    mode?: string;
    apps?: unknown;
    minimal?: unknown;
    transparent?: unknown;
    showFps?: unknown;
    showCpu?: unknown;
    showTemps?: unknown;
    showGpu?: unknown;
    showRam?: unknown;
    style?: unknown;
    divider?: unknown;
    hideInGames?: unknown;
  };
  const mode = legacy.mode === "off" ? "off" : "games";
  let apps = Array.isArray(legacy.apps) ? legacy.apps.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  // One-time cleanup for the old "pick any running app" list: keep Genshin and
  // let the user add custom exe names again from the new field.
  try {
    if (localStorage.getItem("winzal:gaming-genshin-only") === null) {
      apps = ["GenshinImpact.exe", "YuanShen.exe"];
      localStorage.setItem("winzal:gaming-genshin-only", "1");
    }
  } catch {
    // localStorage unavailable: fall back to the current list.
  }
  const genshin = ["genshinimpact.exe", "yuanshen.exe"];
  const normalized = [...new Set(apps.map((id) => id.trim().replace(/^.*[\\/]/, "").toLowerCase()).filter((id) => id.endsWith(".exe")))];
  for (const id of genshin) if (!normalized.includes(id)) normalized.push(id);
  const minimal = legacy.minimal === true;
  return {
    mode,
    apps: normalized,
    transparent: legacy.transparent === true,
    showFps: legacy.showFps !== false,
    showCpu: legacy.showCpu !== false,
    showTemps: legacy.showTemps !== false && !minimal,
    showGpu: legacy.showGpu !== false && !minimal,
    showRam: legacy.showRam !== false && !minimal,
    style: legacy.style === "bars" || legacy.style === "dots" || legacy.style === "graph" ? "bars" : "text",
    divider: legacy.divider === true,
    hideInGames: legacy.hideInGames === true,
  };
}

/** Migrates the old shape ({ provider: "demo", model }) and adds missing providers. */
function migrateAsk(old: Partial<Settings["ask"]> | undefined): Settings["ask"] {
  const known = Object.keys(defaults.ask.configs) as AskProvider[];
  const provider = old?.provider && known.includes(old.provider) ? old.provider : defaults.ask.provider;
  const configs = { ...defaults.ask.configs };
  for (const p of known) {
    const merged = { ...defaults.ask.configs[p], ...old?.configs?.[p] };
    // Empty models and the retired Gemini 2.5 family fall back to the working default.
    if (!merged.model.trim() || merged.model.startsWith("gemini-2.5-")) merged.model = defaults.ask.configs[p].model;
    configs[p] = merged;
  }
  // Existing installs default to saving; only an explicit false turns it off.
  return { provider, configs, saveHistory: typeof old?.saveHistory === "boolean" ? old.saveHistory : true };
}

export function updateAsk(provider: AskProvider, patch: Partial<AskProviderConfig>) {
  settings.set((s) => ({ ...s, ask: { ...s.ask, configs: { ...s.ask.configs, [provider]: { ...s.ask.configs[provider], ...patch } } } }));
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) {
  settings.set((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
}

const OFFSET_KEY_SEP = "\u0001";
const MAX_TRACK_OFFSETS = 120;

/** Stable per-track key for a saved lyric correction (title + artist, case-insensitive). */
export function lyricTrackKey(title: string, artist: string): string {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(title)}${OFFSET_KEY_SEP}${norm(artist)}`;
}

/** Save (or clear at 0) one track's lyric correction in seconds; capped at ±5 s. */
export function setLyricTrackOffset(key: string, seconds: number) {
  const value = Math.round(Math.min(5, Math.max(-5, seconds)) * 100) / 100;
  settings.set((s) => {
    const offsets = { ...s.appearance.lyricsTrackOffsets };
    if (value === 0) delete offsets[key];
    else offsets[key] = value;
    // Keep localStorage bounded; the oldest saved track falls out first.
    while (Object.keys(offsets).length > MAX_TRACK_OFFSETS) {
      delete offsets[Object.keys(offsets)[0]];
    }
    return { ...s, appearance: { ...s.appearance, lyricsTrackOffsets: offsets } };
  });
}

export function clearLyricTrackOffsets() {
  settings.set((s) => ({ ...s, appearance: { ...s.appearance, lyricsTrackOffsets: {} } }));
}
