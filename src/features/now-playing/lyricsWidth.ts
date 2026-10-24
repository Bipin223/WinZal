import { createStore } from "../../lib/store";

/**
 * Natural width (CSS px) of the current lyric line, measured by LiveActivity.
 * The closed notch reads it to grow just enough for the line instead of fading
 * readable text at the right edge. 0 = no lyric is shown (title fallback).
 */
export const lyricsTextWidth = createStore(0);
