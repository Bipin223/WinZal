import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createStore } from "../../lib/store";
import { isNative } from "../../platform/native";

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

const appList = createStore<AppsState>({ apps: [], loading: true, error: null });

let request: Promise<void> | null = null;

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

/** Loads the Start menu once; the list is cached for the app session. */
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
      const apps = await invoke<AppEntry[]>("apps_list");
      appList.set({ apps, loading: false, error: null });
    } catch {
      appList.set((state) => ({ ...state, loading: false, error: "Could not load apps" }));
      request = null;
    }
  })();
  request = run;
  return run;
}

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
