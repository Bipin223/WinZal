import type { Settings } from "../../settings/store";

/** Pixel width of the closed gaming pill for the visible items. */
export function gamingWidth(g: Settings["gaming"]): number {
  let w = 34;
  if (g.showFps) w += 52;
  if (g.showCpu) w += g.showTemps ? 96 : 64;
  if (g.showGpu) w += g.showTemps ? 96 : 64;
  if (g.showRam) w += 54;
  w += g.style === "text" ? 18 : 10;
  return Math.round(Math.max(180, Math.min(460, w)));
}

/** GPU counters are only needed for GPU load/temperature. */
export function gamingFull(g: Settings["gaming"]): boolean {
  return g.showGpu || g.showTemps;
}
