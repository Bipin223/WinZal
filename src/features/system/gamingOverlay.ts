import type { Settings } from "../../settings/store";

/** Pixel width of the closed gaming pill for the visible items. */
export function gamingWidth(g: Settings["gaming"]): number {
  let w = 28;
  const extra = g.style === "bars" ? 18 : g.style === "dots" ? 10 : 0;
  if (g.showFps) w += 58;
  if (g.showCpu) w += (g.showTemps ? 112 : 78) + extra;
  if (g.showGpu) w += (g.showTemps ? 112 : 78) + extra;
  if (g.showRam) w += 64;
  if (g.showGpu && g.showRam) w += 10;
  return Math.round(Math.max(190, Math.min(480, w)));
}

/** GPU counters are only needed for GPU load/temperature. */
export function gamingFull(g: Settings["gaming"]): boolean {
  return g.showGpu || g.showTemps;
}
