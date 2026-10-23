import { useRef, useState } from "react";
import { display } from "../platform/services";
import { settings, updateSettings } from "../settings/store";
import { holdOpen, type NotchStatus } from "./useNotchState";

/** Below this distance it's a click, not a drag. */
const THRESHOLD = 6;
/** The notch snaps to the center when close to it. */
const SNAP = 24;

/** Sends display settings to Rust, optionally with an offset that isn't saved yet. */
export function applyDisplay(offset = settings.get().display.offset) {
  const s = settings.get();
  display.apply({ hideFullscreen: s.display.visibility === "hide-fullscreen", monitor: s.display.monitor, offset, gaming: s.gaming.mode !== "off" });
}

/*
 * Move the notch sideways: grab it anywhere when closed, by the header when open.
 * Natively the window itself moves (display.rs, clamped to the monitor), in the
 * browser only the notch inside the window. Saved on release.
 */
export function useDragToMove(status: NotchStatus) {
  const saved = settings.use().display.offset;
  const [live, setLive] = useState<number | null>(null);
  const [lag, setLag] = useState(0);
  const moved = useRef(false);
  const lagRef = useRef(0);
  const lagTimer = useRef<number | undefined>(undefined);
  const offset = live ?? saved;

  const stopLag = () => {
    clearTimeout(lagTimer.current);
    lagRef.current = 0;
    setLag(0);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("button, input, textarea, a, [role=slider], [data-no-drag]")) return;
    // When open only via the header, otherwise lists and sliders would drag too.
    if (status === "open" && !target.closest("[data-drag-handle]")) return;

    const { pointerId: id, screenX: x } = e;
    const from = offset;
    let current = from;
    let frame = 0;
    let lastX = x;
    moved.current = false;
    stopLag();

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.screenX - x;
      const delta = ev.screenX - lastX;
      lastX = ev.screenX;
      if (!moved.current && Math.abs(dx) < THRESHOLD) return;
      if (!moved.current) {
        moved.current = true;
        holdOpen(true);
      }

      // Soft follow: the window moves 1:1, the shape lags a touch and stretches.
      const nextLag = Math.max(-10, Math.min(10, -delta * 0.55 + lagRef.current * 0.3));
      lagRef.current = nextLag;
      setLag(nextLag);
      clearTimeout(lagTimer.current);
      lagTimer.current = window.setTimeout(() => {
        lagRef.current = 0;
        setLag(0);
      }, 90);

      current = Math.abs(from + dx) < SNAP ? 0 : Math.round(from + dx);
      setLive(current);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyDisplay(current));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopLag();
      if (!moved.current) return;
      holdOpen(false);
      updateSettings((cur) => ({ display: { ...cur.display, offset: current } }));
      setLive(null);
      // The click right after releasing shouldn't open anything.
      setTimeout(() => (moved.current = false), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return { offset, dragging: live !== null, lag, onPointerDown, moved: () => moved.current };
}
