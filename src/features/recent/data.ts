import { invoke } from "@tauri-apps/api/core";
import { isNative } from "../../platform/native";

export interface RecentWindow {
  id: string;
  name: string;
  title: string;
  icon: string | null;
  minimized: boolean;
  tray: boolean;
}

// Browser design preview only; the app reads the real windows.
export const mockRecentWindows: RecentWindow[] = [
  { id: "1", name: "Visual Studio Code", title: "WinZal — OverviewView.tsx", icon: null, minimized: false, tray: false },
  { id: "2", name: "Brave", title: "GitHub — Bipin223/WinZal", icon: null, minimized: false, tray: false },
  { id: "3", name: "Spotify", title: "OneRepublic — Nobody", icon: null, minimized: false, tray: false },
  { id: "4", name: "File Explorer", title: "WinZal", icon: null, minimized: true, tray: false },
  { id: "5", name: "Discord", title: "#design — Pixel Forge", icon: null, minimized: false, tray: true },
];

let cache: RecentWindow[] | null = null;
let cacheAt = 0;
let inflight: Promise<RecentWindow[]> | null = null;
let prefetchStarted = false;

/** Last known windows, if the list has ever been read. */
export function cachedRecentWindows(): RecentWindow[] | null {
  return cache;
}

/** Age of the warm list in ms; Infinity when nothing has been read yet. */
export function recentCacheAge(): number {
  return cache ? Date.now() - cacheAt : Number.POSITIVE_INFINITY;
}

/**
 * Window list for the Recent tool and the hover switcher. A warm cache paints
 * immediately; `force` still re-reads once the caller asks for fresh windows.
 * Concurrent reads share one native call, so opening the hover panel while the
 * tool is loading never starts a second enumeration.
 */
export function loadRecentWindows(force = false): Promise<RecentWindow[]> {
  if (!isNative) {
    cache = mockRecentWindows;
    cacheAt = Date.now();
    return Promise.resolve(cache);
  }
  if (inflight) return inflight;
  if (!force && cache) return Promise.resolve(cache);
  const run = invoke<RecentWindow[]>("recent_apps")
    .then((list) => {
      cache = list;
      cacheAt = Date.now();
      return list;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

/**
 * One quiet warm-up when the app has been idle for a moment. It makes the
 * first hover instant without polling; a user who hovers earlier simply starts
 * the same shared read.
 */
export function prefetchRecentWindows() {
  if (!isNative || prefetchStarted || (cache && Date.now() - cacheAt < 15_000)) return;
  prefetchStarted = true;
  // Long enough to stay out of the startup animation, short enough that the
  // first hover later is usually already warm.
  window.setTimeout(() => {
    void loadRecentWindows(true).catch(() => {
      prefetchStarted = false;
    });
  }, 5000);
}

export function focusRecent(id: string): Promise<void> {
  if (!isNative) return Promise.resolve();
  return invoke("recent_focus", { id });
}
