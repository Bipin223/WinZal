import { createStore } from "../lib/store";
import type { AlarmDuration, AlarmSound } from "../lib/sound";

export type AskProvider = "gemini" | "groq" | "custom";
export type AskEffort = "low" | "medium" | "high" | "xhigh";

export interface AskProviderConfig {
  model: string;
  effort: AskEffort;
  /** Only for "custom": OpenAI-compatible base, e.g. https://…/v1 */
  baseUrl: string;
}

export interface Settings {
  /** Open on hover or only on click. */
  openMode: "hover" | "click";
  hoverDelay: "fast" | "normal" | "patient";
  /** Order = order in the tool bar. */
  tools: { id: string; enabled: boolean }[];
  /** AI usage: which providers are shown (order = display order). */
  usage: { claude: boolean; codex: boolean; gemini: boolean; cursor: boolean };
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
  gaming: { mode: "off" | "games"; apps: string[] };
  /** Dots like on iPhone: mic/camera (green) or screen recording (red) in use. */
  privacyDots: boolean;
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
    /** Squeeze/bounce while dragging the notch. */
    dragAnimation: boolean;
    /** Show time + weather in the closed island. */
    clockWeather: boolean;
    /** Show the playing track in the closed pill at all (music only in the Now Playing tab when off). */
    musicInPill: boolean;
    /** Colour of the first clock digit (OnePlus-style accent); red by default. */
    clockAccent: string;
    /** Closed clock pill: compact or bigger/bolder text (large default). */
    clockText: "compact" | "large";
    /** Expanded overview clock: bold instead of semibold. */
    clockBold: boolean;
    /** Show the current synced lyric line in the closed music pill instead of the title. */
    lyricsInPill: boolean;
    /** One line (inline) or the current + next line. */
    lyricsLayout: "inline" | "lines";
    /** Continuous lyric font size in px; the pill and visualizer grow with it. */
    lyricsTextSize: number;
    /** How much room the closed lyric pill uses: compact, exact fit, or long. */
    lyricsPillWidth: "compact" | "normal" | "long";
    /** Subtle waveform behind the lyric, in the cover's accent color. */
    lyricsVisualizer: boolean;
    /** Visualizer style inside the lyrics pill. */
    lyricsVisualizerStyle: "wave" | "pulse" | "dots" | "ripple" | "aurora";
    /** Line change animation: Apple Music-style scale/slide, word reveal, or line reveal. */
    lyricsAnimation: "apple" | "word" | "reveal";
    /** true = hardware acceleration (smoother, more RAM); false = software/CPU (less RAM, more CPU). */
    gpuAcceleration: boolean;
  };
  /** Discord call in the notch (local RPC, on = Discord tool enabled). The client secret is stored with the secrets. */
  discord: { clientId: string; presence: boolean; appName: string; statusLine: "title" | "artist" | "app" };
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
  "usage",
  "weather",
  "system",
  "discord",
  "vault",
] as const;

const DEFAULT_OFF = new Set<string>(["discord", "vault"]);

const defaults: Settings = {
  openMode: "hover",
  hoverDelay: "normal",
  tools: TOOL_IDS.map((id) => ({ id, enabled: !DEFAULT_OFF.has(id) })),
  usage: { claude: true, codex: true, gemini: true, cursor: false },
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
  gaming: { mode: "off", apps: ["GenshinImpact.exe", "YuanShen.exe"] },
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
    dragAnimation: true,
    clockWeather: true,
    musicInPill: true,
    clockAccent: "#ff453a",
    clockText: "large",
    clockBold: true,
    lyricsInPill: false,
    lyricsLayout: "inline",
    lyricsTextSize: 12,
    lyricsPillWidth: "normal",
    lyricsVisualizer: true,
    lyricsVisualizerStyle: "wave",
    lyricsAnimation: "apple",
    gpuAcceleration: false,
  },
  discord: { clientId: "", presence: true, appName: "Bipin Rizal’s WinZal app", statusLine: "title" },
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
    usage: { ...defaults.usage, ...s.usage },
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
      // The old "blur" line option is now the word-by-word reveal. Removed
      // Current / Slide / Scale variants fall back to the Apple transition.
      lyricsAnimation: (() => {
        const stored = (s.appearance as { lyricsAnimation?: string } | undefined)?.lyricsAnimation;
        if (stored === "word" || stored === "blur") return "word" as const;
        if (stored === "reveal") return "reveal" as const;
        return "apple" as const;
      })(),
      // Old Default / Large / Small / Big / Biggest become one continuous size.
      lyricsTextSize: (() => {
        const legacy = s.appearance as { lyricsTextSize?: number; lyricsSize?: string } | undefined;
        if (typeof legacy?.lyricsTextSize === "number") return Math.min(15, Math.max(10, legacy.lyricsTextSize));
        if (legacy?.lyricsSize === "biggest") return 14;
        return 12;
      })(),
      lyricsVisualizer: s.appearance?.lyricsVisualizer ?? defaults.appearance.lyricsVisualizer,
      lyricsPillWidth: (() => {
        const stored = (s.appearance as { lyricsPillWidth?: string } | undefined)?.lyricsPillWidth;
        return stored === "compact" || stored === "long" ? stored : "normal";
      })(),
      lyricsVisualizerStyle: s.appearance?.lyricsVisualizerStyle ?? defaults.appearance.lyricsVisualizerStyle,
      // The experimental RGB accent was removed; fall back to auto.
      accent: s.appearance?.accent === "rgb" ? defaults.appearance.accent : s.appearance?.accent ?? defaults.appearance.accent,
      // The island width/height sliders are additive; clamp values from older/corrupt files.
      islandWidth: (() => {
        const value = (s.appearance as { islandWidth?: number } | undefined)?.islandWidth;
        return typeof value === "number" ? Math.min(214, Math.max(-46, Math.round(value))) : defaults.appearance.islandWidth;
      })(),
      islandHeight: (() => {
        const value = (s.appearance as { islandHeight?: number } | undefined)?.islandHeight;
        return typeof value === "number" ? Math.min(40, Math.max(26, Math.round(value))) : defaults.appearance.islandHeight;
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

// One-time: the large closed clock is the new default. After this marker the
// user's own Compact/Large choice sticks across restarts.
try {
  if (!localStorage.getItem("notch:clock-text-large")) {
    settings.set((s) => ({ ...s, appearance: { ...s.appearance, clockText: "large" } }));
    localStorage.setItem("notch:clock-text-large", "1");
  }
} catch {
  // localStorage unavailable: defaults already use large.
}

// The expanded clock starts bold now; Regular stays one tap away in Appearance.
try {
  if (!localStorage.getItem("notch:clock-bold")) {
    settings.set((s) => ({ ...s, appearance: { ...s.appearance, clockBold: true } }));
    localStorage.setItem("notch:clock-bold", "1");
  }
} catch {
  // localStorage unavailable: defaults already use bold.
}

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
  const legacy = (old ?? {}) as { mode?: string; apps?: unknown };
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
  return { mode, apps: normalized };
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
