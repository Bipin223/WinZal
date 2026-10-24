import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { display, fetchFps, type ForegroundInfo } from "../../platform/services";

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
  return gaming.use();
}

export const fps = createStore<{ value: number | null; error: string | null }>({ value: null, error: null });

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
