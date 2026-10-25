import type { Settings } from "../../settings/store";

/** Pixel width of the closed gaming pill for the visible items. */
export function gamingWidth(g: Settings["gaming"]): number {
  let w = 28;
  const extra = g.style === "bars" ? 28 : g.style === "graph" ? 48 : 0;
  if (g.showFps) w += 58;
  if (g.showCpu) w += (g.showTemps ? 118 : 86) + extra;
  if (g.showGpu) w += (g.showTemps ? 118 : 86) + extra;
  if (g.showRam) w += 66 + extra;
  if (g.showGpu && g.showRam) w += 12;
  return Math.round(Math.max(220, Math.min(580, w)));
}

/** GPU counters are only needed for GPU load/temperature. */
export function gamingFull(g: Settings["gaming"]): boolean {
  return g.showGpu || g.showTemps;
}
