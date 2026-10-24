import { useEffect, useRef, useState } from "react";
import { livePosition, type NowPlaying } from "../../platform/media";
import { fetchLyrics } from "../../platform/services";

interface Line {
  at: number;
  text: string;
}

export interface LyricsDisplay {
  current: string | null;
  next: string | null;
  index: number;
}

/** Parse once per track, even when the pill closes and reopens. */
const parsed = new Map<string, Line[]>();
const PARSED_MAX = 30;

/**
 * Current + next synced lyric line for the closed music pill. Fetches once per
 * track (LRCLIB, Rust-cached + parsed cache here) and only re-renders when the
 * line changes. No per-frame React work, no extra animation loop.
 */
export function useLyrics(np: NowPlaying | null, enabled: boolean): LyricsDisplay {
  const [lines, setLines] = useState<Line[]>([]);
  const [index, setIndex] = useState(-1);
  const npRef = useRef(np);
  npRef.current = np;
  const track = np ? `${np.title}\u0001${np.artist}\u0001${Math.round(np.duration)}` : "";
  const playing = np?.isPlaying ?? false;

  useEffect(() => {
    if (!enabled || !np || !np.title.trim()) {
      // Functional setters bail out when already empty, so a music track change
      // with lyrics off does not cause an extra render.
      setLines((prev) => (prev.length ? [] : prev));
      setIndex((prev) => (prev === -1 ? prev : -1));
      return;
    }
    const cached = parsed.get(track);
    if (cached) {
      setLines(cached);
      setIndex(-1);
      return;
    }
    let alive = true;
    setLines([]);
    setIndex(-1);
    // Small grace period: skipping tracks quickly does not fire a request per track.
    const id = window.setTimeout(() => {
      void fetchLyrics(np.title, np.artist, np.duration)
        .then((lyrics) => {
          if (!alive) return;
          const next = parseLrc(lyrics.synced);
          if (parsed.size >= PARSED_MAX) parsed.clear();
          parsed.set(track, next);
          setLines(next);
        })
        .catch(() => {
          if (alive) setLines([]);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
    // One fetch per track; position updates come from the timer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, track]);

  // While playing, four tiny checks per second; no per-frame React work.
  useEffect(() => {
    if (!enabled || lines.length === 0) return;
    const update = () => {
      const now = npRef.current;
      if (!now) return;
      const next = indexAt(lines, livePosition(now));
      setIndex((prev) => (prev === next ? prev : next));
    };
    update();
    if (!playing) return;
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [enabled, lines, playing]);

  // Paused: still follow a seek once, but do not keep a 250 ms timer alive.
  useEffect(() => {
    if (!enabled || playing || !np || lines.length === 0) return;
    const next = indexAt(lines, livePosition(np));
    setIndex((prev) => (prev === next ? prev : next));
  }, [enabled, playing, lines, np?.position]);

  if (index < 0 || !lines[index]) return { current: null, next: null, index: -1 };
  return {
    current: lines[index].text,
    next: lines[index + 1]?.text ?? null,
    index,
  };
}

/** First line whose timestamp is at or before `position`; -1 before the first line. */
function indexAt(lines: Line[], position: number): number {
  let next = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at <= position) next = i;
    else break;
  }
  return next;
}

/** "[00:12.34] text" (and multiple timestamps per line) → sorted lines. */
function parseLrc(synced: string | null): Line[] {
  if (!synced) return [];
  const out: Line[] = [];
  for (const row of synced.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = row.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = stamp[3] ? Number(stamp[3].padEnd(3, "0").slice(0, 3)) / 1000 : 0;
      out.push({ at: minutes * 60 + seconds + fraction, text });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}
