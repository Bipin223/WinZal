import { useEffect, useMemo, useRef, useState } from "react";
import { livePosition, type NowPlaying } from "../../platform/media";
import { fetchLyrics, type Lyrics, type LyricWordTime } from "../../platform/services";
import { lyricTrackKey, settings } from "../../settings/store";

interface Line {
  at: number;
  text: string;
  /** Last sung second for this line, when LRCLIB published word timings. */
  end?: number;
  /** Word-level timings when the record has them; otherwise estimate. */
  words?: LyricWordTime[];
}

export interface LyricsDisplay {
  current: string | null;
  next: string | null;
  index: number;
  /** Start time of the current line in seconds. */
  start: number;
  /** Start time of the next line, or the end of the track. */
  end: number;
  /** Real word timings for the current line, when LRCLIB has them. */
  words: LyricWordTime[] | null;
  /** loading (title shown) | lyrics | instrumental | music (no lyrics). */
  status: "loading" | "lyrics" | "instrumental" | "music";
}

/**
 * Switch just before the timestamp so timer/render latency lands on the beat.
 * The line is replaced in one commit (no exit wait), so there is no overlap and
 * no built-in 80 ms delay.
 */
const LYRIC_LEAD = 0.05;

/** Parse once per track, even when the pill closes and reopens. */
const parsed = new Map<string, Line[]>();
const meta = new Map<string, { instrumental: boolean; hasLyrics: boolean }>();
const PARSED_MAX = 30;

/**
 * Current + next synced lyric line for the closed music pill. Fetches once per
 * track (LRCLIB, Rust-cached + parsed cache here) and only re-renders when the
 * line changes. No per-frame React work, no extra animation loop.
 */
export function useLyrics(np: NowPlaying | null, enabled: boolean): LyricsDisplay {
  const [lines, setLines] = useState<Line[]>([]);
  const [index, setIndex] = useState(-1);
  const [status, setStatus] = useState<LyricsDisplay["status"]>("loading");
  const appearance = settings.use().appearance;
  const npRef = useRef(np);
  npRef.current = np;
  const track = np ? `${np.title}\u0001${np.artist}\u0001${Math.round(np.duration)}` : "";
  const offsetKey = np ? lyricTrackKey(np.title, np.artist) : "";
  // Global correction plus the saved correction for this exact track. A track
  // that runs late can be fixed without shifting everything else.
  const offset = appearance.lyricsOffset + (offsetKey ? (appearance.lyricsTrackOffsets[offsetKey] ?? 0) : 0);
  const playing = np?.isPlaying ?? false;
  // Line mode drops word timings and keeps the line clock used by older
  // versions. Word mode keeps exact timings when the source provides them.
  const shownLines = useMemo<Line[]>(
    () =>
      appearance.lyricsSyncMode === "line"
        ? lines.map(({ at, text, end }) => ({ at, text, end }))
        : lines,
    [lines, appearance.lyricsSyncMode],
  );

  useEffect(() => {
    if (!enabled || !np || !np.title.trim()) {
      // Functional setters bail out when already empty, so a music track change
      // with lyrics off does not cause an extra render.
      setLines((prev) => (prev.length ? [] : prev));
      setIndex((prev) => (prev === -1 ? prev : -1));
      setStatus("loading");
      return;
    }
    const cached = parsed.get(track);
    if (cached) {
      setLines(cached);
      setIndex(-1);
      const info = meta.get(track);
      setStatus(cached.length ? "lyrics" : info?.instrumental ? "instrumental" : info ? "music" : "loading");
      return;
    }
    let alive = true;
    setLines([]);
    setIndex(-1);
    setStatus("loading");
    let retry: number | undefined;
    const load = (attempt: number) => {
      void fetchLyrics(np.title, np.artist, np.duration)
        .then((lyrics) => {
          if (!alive) return;
          const next = parseLyrics(lyrics);
          // One delayed retry: a timeout or 429 must not become "no lyrics"
          // for the rest of the session. LRCLIB answers that really have no
          // synced text are cached by Rust, so the retry is cheap.
          if (!next.length && !lyrics.instrumental && attempt === 0) {
            retry = window.setTimeout(() => load(1), 4000);
            return;
          }
          if (parsed.size >= PARSED_MAX) {
            parsed.clear();
            meta.clear();
          }
          parsed.set(track, next);
          meta.set(track, { instrumental: !!lyrics.instrumental, hasLyrics: next.length > 0 });
          setLines(next);
          setStatus(next.length ? "lyrics" : lyrics.instrumental ? "instrumental" : "music");
        })
        .catch(() => {
          if (!alive) return;
          if (attempt === 0) {
            retry = window.setTimeout(() => load(1), 4000);
            return;
          }
          setLines([]);
          setStatus("music");
        });
    };
    // Small grace period: skipping tracks quickly does not fire a request per track.
    const id = window.setTimeout(() => load(0), 300);
    return () => {
      alive = false;
      window.clearTimeout(id);
      window.clearTimeout(retry);
    };
    // One fetch per track; position updates come from the timer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, track]);

  // While playing, wake exactly at the next line boundary (and at least twice a
  // second so seeking still works). This removes the old 250 ms quantization
  // without adding a per-frame timer.
  useEffect(() => {
    if (!enabled || shownLines.length === 0) return;
    let alive = true;
    let timer: number | undefined;
    const schedule = () => {
      if (!alive) return;
      const now = npRef.current;
      if (!now) return;
      const position = livePosition(now) - offset + LYRIC_LEAD;
      const next = indexAt(shownLines, position);
      setIndex((prev) => (prev === next ? prev : next));
      if (!now.isPlaying) return;
      const upcoming = shownLines.find((line) => line.at > position);
      // 12 ms early covers the timer + render; cap the idle recheck at 250 ms.
      const wait = upcoming ? Math.max(0, (upcoming.at - position) * 1000 - 12) : 250;
      timer = window.setTimeout(schedule, Math.min(250, wait));
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabled, shownLines, playing, offset]);

  // Paused: still follow a seek once, but do not keep a 250 ms timer alive.
  useEffect(() => {
    if (!enabled || playing || !np || shownLines.length === 0) return;
    const next = indexAt(shownLines, livePosition(np) - offset + LYRIC_LEAD);
    setIndex((prev) => (prev === next ? prev : next));
  }, [enabled, playing, shownLines, np?.position, offset]);

  if (index < 0 || !shownLines[index]) return { current: null, next: null, index: -1, start: 0, end: 0, words: null, status };
  const line = shownLines[index];
  // Effects run on the line clock; include the user's offset so word progress
  // stays on the audible line, not the raw LRC timestamp.
  const start = line.at + offset;
  const end =
    line.end && line.end > line.at
      ? line.end + offset
      : shownLines[index + 1]
        ? shownLines[index + 1].at + offset
        : np && np.duration > start
          ? np.duration
          : start + 4;
  return {
    current: line.text,
    next: shownLines[index + 1]?.text ?? null,
    index,
    start,
    end,
    words: line.words?.length ? line.words.map((word) => ({ ...word, at: word.at + offset })) : null,
    status,
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

/** Prefer LRCLIB's word-level lyricsfile timings, then fall back to plain LRC. */
function parseLyrics(lyrics: Lyrics): Line[] {
  if (lyrics.wordLines?.length) {
    return lyrics.wordLines
      .map((line) => ({
        at: line.at,
        text: line.text.trim(),
        end: line.end,
        words: line.words?.length ? line.words : undefined,
      }))
      .filter((line) => line.text)
      .sort((a, b) => a.at - b.at);
  }
  return parseLrc(lyrics.synced);
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
