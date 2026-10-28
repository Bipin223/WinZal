import type { LyricsFont } from "../../settings/store";

/** Font stack for the lyric pill (and its settings previews). */
export function lyricsFontFamily(font: LyricsFont): string {
  if (font === "system") return '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  if (font === "mono") return '"Cascadia Code", "Cascadia Mono", Consolas, monospace';
  // Inter is bundled with the app; don't let the system UI win by accident.
  return '"Inter Variable", Inter, sans-serif';
}
