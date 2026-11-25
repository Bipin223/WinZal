import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createStore } from "../../lib/store";
import { isNative } from "../../platform/native";
import { settings } from "../../settings/store";

export interface AppEntry {
  id: string;
  name: string;
  icon: string | null;
}

interface AppsState {
  apps: AppEntry[];
  loading: boolean;
  error: string | null;
}

interface AppIcon {
  id: string;
  icon: string | null;
}

const CACHE_KEY = "notch:apps-cache";

/** Names and icons from the last run: pinned apps paint before the shell scan. */
function readCache(): AppEntry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { apps?: unknown };
    if (!Array.isArray(parsed.apps)) return [];
    return parsed.apps.filter((app): app is AppEntry => {
      if (!app || typeof app !== "object") return false;
      const entry = app as Partial<AppEntry>;
      return typeof entry.id === "string" && typeof entry.name === "string" && (entry.icon === null || typeof entry.icon === "string");
    });
  } catch {
    return [];
  }
}

const appList = createStore<AppsState>({ apps: readCache(), loading: true, error: null });

let request: Promise<void> | null = null;
let iconQueue: string[] = [];
let iconRunning = false;
let saveTimer: number | undefined;

function persistSoon(apps: AppEntry[]) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, apps }));
    } catch {
      // A full localStorage must not break the app list.
    }
  }, 400);
}

// Browser design preview only; the app reads the real Start menu.
const mockApps: AppEntry[] = [
  "Settings",
  "Calculator",
  "File Explorer",
  "Browser",
  "Spotify",
  "Discord",
  "Terminal",
  "Photos",
  "Snipping Tool",
  "Store",
  "Notepad",
  "Clock",
].map((name) => ({ id: `mock:${name}`, name, icon: null }));

/** Start-menu names are fast; icons are fetched afterwards in priority order. */
function loadAppIcons(ids: string[]) {
  if (!isNative) return;
  const apps = appList.get().apps;
  const byId = new Map(apps.map((app) => [app.id, app]));
  for (const id of ids) {
    if (!id || iconQueue.includes(id)) continue;
    const app = byId.get(id);
    if (!app || app.icon) continue;
    iconQueue.push(id);
  }
  void pumpIcons();
}

async function pumpIcons() {
  if (iconRunning) return;
  iconRunning = true;
  try {
    while (iconQueue.length) {
      const chunk = iconQueue.splice(0, 24);
      const fresh = chunk.filter((id) => {
        const app = appList.get().apps.find((entry) => entry.id === id);
        return app && !app.icon;
      });
      if (!fresh.length) continue;
      let icons: AppIcon[] = [];
      try {
        icons = await invoke<AppIcon[]>("app_icons", { ids: fresh });
      } catch {
        continue;
      }
      if (!icons.length) continue;
      appList.set((prev) => {
        const loaded = new Map(icons.map((entry) => [entry.id, entry.icon]));
        let changed = false;
        const apps = prev.apps.map((app) => {
          const icon = loaded.get(app.id);
          if (!icon || app.icon) return app;
          changed = true;
          return { ...app, icon };
        });
        if (!changed) return prev;
        persistSoon(apps);
        return { ...prev, apps };
      });
    }
  } finally {
    iconRunning = false;
    if (iconQueue.length) void pumpIcons();
  }
}

/** Loads the Start menu; cached names/icons paint immediately. */
export function loadApps(force = false): Promise<void> {
  if (!isNative) {
    appList.set({ apps: mockApps, loading: false, error: null });
    return Promise.resolve();
  }
  if (request && !force) return request;
  if (force) request = null;
  appList.set((state) => ({ ...state, loading: true, error: null }));
  const run = (async () => {
    try {
      const meta = await invoke<AppEntry[]>("apps_list");
      appList.set((prev) => {
        const cachedIcons = new Map(prev.apps.map((app) => [app.id, app.icon]));
        const apps = meta.map((app) => ({
          ...app,
          icon: app.icon ?? cachedIcons.get(app.id) ?? null,
        }));
        persistSoon(apps);
        return { apps, loading: false, error: null };
      });
      // Pinned row first; the rest fills in quietly behind it.
      const pinned = settings.get().apps?.pinned ?? [];
      loadAppIcons(pinned);
      loadAppIcons(appList.get().apps.map((app) => app.id));
    } catch {
      appList.set((state) => ({ ...state, loading: false, error: "Could not load apps" }));
      request = null;
    }
  })();
  request = run;
  return run;
}

export { loadAppIcons };

export function useApps() {
  const state = appList.use();
  useEffect(() => {
    void loadApps();
  }, []);
  return state;
}

export async function openApp(id: string): Promise<void> {
  if (!isNative) return;
  await invoke("app_open", { appId: id });
}
