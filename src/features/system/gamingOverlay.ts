import type { Settings } from "../../settings/store";
import { createStore } from "../../lib/store";

/**
 * Measured content width of the live gaming row. 0 = not measured yet, so the
 * notch falls back to the estimate below.
 */
export const gamingMeasured = createStore(0);

/**
 * Fallback width before the live row has been measured. Bars/Graph show no
 * percentage text, so they are narrower than the Text style.
 */
export function gamingWidth(g: Settings["gaming"]): number {
  const text = g.style === "text";
  const used = g.showTemps
    ? (text ? 104 : g.style === "bars" ? 98 : 104)
    : (text ? 74 : g.style === "bars" ? 68 : 74);
  const ram = text ? 68 : g.style === "bars" ? 72 : 78;
  let w = 20;
  if (g.showFps) w += 54;
  if (g.showCpu) w += used;
  if (g.showGpu) w += used;
  if (g.showRam) w += ram;
  if (g.showGpu && g.showRam) w += 12;
  if (g.divider && (g.showFps || g.showCpu) && (g.showGpu || g.showRam)) w += 10;
  return Math.round(Math.max(180, Math.min(580, w)));
}

/** GPU counters are only needed for GPU load/temperature. */
export function gamingFull(g: Settings["gaming"]): boolean {
  return g.showGpu || g.showTemps;
}
