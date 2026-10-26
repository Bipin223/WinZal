import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { display, fetchFps, fpsHelperReady, releaseFpsHelper, type ForegroundInfo } from "../../platform/services";

/*
 * Gaming mode is decided in Rust: it knows the foreground app (and whether the
 * user selected it), so the closed overlay can show only for chosen games.
 */
const foreground = createStore<ForegroundInfo | null>(null);
const gaming = createStore(false);

export function startGamingWatch() {
  display.onForeground((info) => {
    foreground.set(info);
    gaming.set(info.gaming);
  });
}

/** Is the closed notch showing FPS and load right now? */
export function useGamingLive(): boolean {
  const live = gaming.use();
  // Dev-only preview: localhost/?gaming=1 shows the measured overlay without
  // needing a real game. Vite removes this branch from the production bundle.
  const forced = import.meta.env.DEV && new URLSearchParams(window.location.search).has("gaming");
  return live || forced;
}

export const fps = createStore<{ value: number | null; error: string | null }>({ value: null, error: null });

/* The elevated ETW helper is shared by Gaming and Hardware. Keep it alive
   while either is visible, then let it exit instead of idling at ~21 MB. */
let helperUsers = 0;
let helperRelease: number | undefined;

export function useFpsHelper(active: boolean) {
  useEffect(() => {
    if (!active) return;
    helperUsers += 1;
    window.clearTimeout(helperRelease);
    void fpsHelperReady();
    return () => {
      helperUsers = Math.max(0, helperUsers - 1);
      if (helperUsers > 0) return;
      window.clearTimeout(helperRelease);
      helperRelease = window.setTimeout(() => {
        if (helperUsers === 0) void releaseFpsHelper();
      }, 5000);
    };
  }, [active]);
}

/** Poll FPS once a second while the overlay is visible. */
export function useFpsPolling() {
  useEffect(() => {
    let alive = true;
    const load = () => void fetchFps().then((r) => alive && fps.set({ value: r.fps, error: r.error }));
    load();
    const id = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
}
