import { useEffect, useRef, useState } from "react";
import { useAnimationFrame } from "motion/react";
import type { LyricAnimation } from "../../settings/store";
import { livePosition, type NowPlaying } from "../../platform/media";
import type { LyricWordTime } from "../../platform/services";

type LabAnimation = Exclude<LyricAnimation, "word" | "apple">;

/** Character-weighted word starts, so long words get more of the line. */
function wordOffsets(words: string[]): number[] {
  const total = words.reduce((n, word) => n + word.length + 1.7, 0) || 1;
  let acc = 0;
  return words.map((word) => {
    const from = acc / total;
    acc += word.length + 1.7;
    return from;
  });
}

/**
 * Exact LRCLIB word starts when the record has them. The old character split
 * stays as the fallback; `exact` also tells effects to use the full line end.
 */
function wordFractions(words: string[], start: number, end: number, times?: LyricWordTime[] | null) {
  if (times && times.length === words.length) {
    const duration = Math.max(0.35, end - start);
    const froms = times.map((word) => Math.min(0.999, Math.max(0, (word.at - start) / duration)));
    for (let i = 1; i < froms.length; i++) froms[i] = Math.max(froms[i - 1], froms[i]);
    return { froms, exact: true };
  }
  return { froms: wordOffsets(words), exact: false };
}

/** Reveal words one by one on the real line clock, not on a fixed stagger. */
function useWordReveal(
  words: string[],
  start: number,
  end: number,
  np: NowPlaying | null,
  preview: boolean,
  wordTimes?: LyricWordTime[] | null,
) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const last = useRef(-1);
  const { froms, exact } = wordFractions(words, start, end, wordTimes);
  useAnimationFrame(() => {
    const duration = preview ? 2.6 : Math.max(0.35, end - start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.8
      : np
        ? livePosition(np) - start
        : 0;
    const progress = Math.min(1, Math.max(0, elapsed / (duration * (exact ? 1 : 0.92))));
    let active = -1;
    froms.forEach((from, i) => {
      if (progress >= from) active = i;
    });
    if (active === last.current) return;
    last.current = active;
    refs.current.forEach((el, i) => {
      if (el) el.classList.toggle("in", i <= active);
    });
  });
  return refs;
}

/**
 * The remaining lyric effects. Fill/liquid/spotlight/spark/ambient follow the
 * word that is being sung instead of just playing an entrance, so they stay on
 * the timestamp. Word by Word and Apple Music live in LiveActivity.
 */
export function LyricEffect({
  animation,
  text,
  start = 0,
  end = 4,
  wordTimes = null,
  np = null,
  preview = false,
}: {
  animation: LabAnimation;
  text: string;
  index: number;
  start?: number;
  end?: number;
  wordTimes?: LyricWordTime[] | null;
  np?: NowPlaying | null;
  preview?: boolean;
}) {
  if (animation === "glitch") return <GlitchText text={text} />;
  if (animation === "spot") return <SpotlightText text={text} start={start} end={end} wordTimes={wordTimes} np={np} preview={preview} />;
  if (animation === "spark") return <SparkText text={text} start={start} end={end} wordTimes={wordTimes} np={np} preview={preview} />;
  if (animation === "orbit") return <OrbitText text={text} start={start} end={end} wordTimes={wordTimes} np={np} preview={preview} />;
  if (animation === "ambient") return <AmbientText text={text} start={start} end={end} wordTimes={wordTimes} np={np} preview={preview} />;
  return (
    <WordProgress
      animation={animation}
      text={text}
      start={start}
      end={end}
      wordTimes={wordTimes}
      np={np}
      preview={preview}
    />
  );
}

/** Shared word-progress clock for fill, liquid, focus and stripe. */
function WordProgress({
  animation,
  text,
  start,
  end,
  wordTimes,
  np,
  preview,
}: {
  animation: "fill" | "liquid";
  text: string;
  start: number;
  end: number;
  wordTimes?: LyricWordTime[] | null;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const timing = useRef({ start, end });
  timing.current = { start, end };

  useAnimationFrame(() => {
    const duration = preview ? 2.2 : Math.max(0.35, timing.current.end - timing.current.start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.6
      : np
        ? livePosition(np) - timing.current.start
        : 0;
    const { froms, exact } = wordFractions(words, timing.current.start, timing.current.end, wordTimes);
    const progress = Math.min(1, Math.max(0, elapsed / (duration * (exact ? 1 : 0.92))));
    let active = -1;
    froms.forEach((from, i) => {
      if (progress >= from) active = i;
    });
    words.forEach((_, i) => {
      const from = froms[i];
      const to = froms[i + 1] ?? 1;
      const p = Math.min(1, Math.max(0, (progress - from) / Math.max(0.0001, to - from)));
      const el = refs.current[i];
      if (!el) return;
      el.classList.toggle("dim", i !== active);
      el.classList.toggle("hot", i === active);
      const fill = el.querySelector<HTMLElement>(".lab-fill");
      if (fill) {
        if (p <= 0) fill.style.clipPath = animation === "liquid" ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)";
        else if (p >= 1) fill.style.clipPath = "inset(0 0 0 0)";
        else fill.style.clipPath = animation === "liquid"
          ? `inset(${((1 - p) * 100).toFixed(2)}% 0 0 0)`
          : `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
      }
    });
  });

  return (
    <span className={`lab-line lab-mode-${animation}${np && !np.isPlaying ? " lyr-paused" : ""}`}>
      {words.map((word, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el; }} className="lab-w">
          <span className="lab-base">{word}</span>
          {(animation === "fill" || animation === "liquid") && (
            <span className={`lab-fill ${animation === "fill" ? "lab-fill-right" : "lab-fill-up"}`}>{word}</span>
          )}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}

/** Soft light that glides between the centres of the words being sung. */
function SpotlightText({
  text,
  start,
  end,
  wordTimes,
  np,
  preview,
}: {
  text: string;
  start: number;
  end: number;
  wordTimes?: LyricWordTime[] | null;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const spot = useRef<HTMLElement>(null);
  const timing = useRef({ start, end });
  timing.current = { start, end };

  useAnimationFrame(() => {
    const duration = preview ? 2.2 : Math.max(0.35, timing.current.end - timing.current.start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.6
      : np
        ? livePosition(np) - timing.current.start
        : 0;
    const { froms, exact } = wordFractions(words, timing.current.start, timing.current.end, wordTimes);
    const progress = Math.min(1, Math.max(0, elapsed / (duration * (exact ? 1 : 0.92))));
    let active = -1;
    froms.forEach((from, i) => {
      if (progress >= from) active = i;
    });
    const from = active >= 0 ? froms[active] : 0;
    const to = active >= 0 ? (froms[active + 1] ?? 1) : 1;
    const activeP = active >= 0 ? Math.min(1, Math.max(0, (progress - from) / Math.max(0.0001, to - from))) : 0;
    words.forEach((_, i) => {
      const el = refs.current[i];
      if (!el) return;
      el.classList.toggle("dim", i !== active);
      el.classList.toggle("focus", i === active);
    });
    const el = active >= 0 ? refs.current[active] : null;
    if (!el || !spot.current) return;
    const centre = el.offsetLeft + el.offsetWidth / 2;
    const next = refs.current[active + 1];
    const nextCentre = next ? next.offsetLeft + next.offsetWidth / 2 : centre;
    const eased = activeP * activeP * (3 - 2 * activeP);
    const x = centre + (nextCentre - centre) * eased;
    spot.current.style.transform = `translate3d(${x.toFixed(2)}px, -50%, 0) translate(-50%, 0)`;
  });

  return (
    <span className="lab-line lab-spot-line">
      {words.map((word, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el; }} className="lab-w">
          <span className="lab-base">{word}</span>
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
      <i
        ref={spot}
        className="lab-spot"
        style={{ transform: "translate3d(0px, -50%, 0) translate(-50%, 0)" }}
        aria-hidden
      />
    </span>
  );
}

/** Particles burst from each word as it becomes the active one. */
function SparkText({
  text,
  start,
  end,
  wordTimes,
  np,
  preview,
}: {
  text: string;
  start: number;
  end: number;
  wordTimes?: LyricWordTime[] | null;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const layer = useRef<HTMLSpanElement>(null);
  const lastActive = useRef(-1);
  const timing = useRef({ start, end });
  timing.current = { start, end };

  useAnimationFrame(() => {
    const duration = preview ? 2.2 : Math.max(0.35, timing.current.end - timing.current.start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.6
      : np
        ? livePosition(np) - timing.current.start
        : 0;
    const { froms, exact } = wordFractions(words, timing.current.start, timing.current.end, wordTimes);
    const progress = Math.min(1, Math.max(0, elapsed / (duration * (exact ? 1 : 0.92))));
    let active = -1;
    froms.forEach((from, i) => {
      if (progress >= from) active = i;
    });
    words.forEach((_, i) => {
      const el = refs.current[i];
      if (!el) return;
      el.classList.toggle("dim", i !== active);
      el.classList.toggle("focus", i === active);
    });
    if (np && !np.isPlaying) {
      lastActive.current = -1;
      return;
    }
    if (active < 0 || active === lastActive.current) return;
    lastActive.current = active;
    const el = refs.current[active];
    const host = layer.current;
    if (!el || !host) return;
    const centre = el.offsetLeft + el.offsetWidth / 2;
    for (let i = 0; i < 5; i++) {
      const spark = document.createElement("i");
      const angle = Math.random() * Math.PI * 2;
      const radius = 9 + Math.random() * 15;
      spark.className = "lab-sp";
      spark.style.left = `${centre}px`;
      spark.style.top = "50%";
      spark.style.setProperty("--dx", `${(Math.cos(angle) * radius).toFixed(1)}px`);
      spark.style.setProperty("--dy", `${(Math.sin(angle) * radius - 7).toFixed(1)}px`);
      spark.style.animationDelay = `${(Math.random() * 0.05).toFixed(2)}s`;
      host.appendChild(spark);
      window.setTimeout(() => spark.remove(), 700);
    }
  });

  return (
    <span className="lab-line lab-spark-line">
      {words.map((word, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el; }} className="lab-w">
          <span className="lab-base">{word}</span>
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
      <span ref={layer} className="lab-sparks" aria-hidden />
    </span>
  );
}

/** Gentle float/breathe; no per-word blur, and the active word follows the clock. */
function AmbientText({
  text,
  start,
  end,
  wordTimes,
  np,
  preview,
}: {
  text: string;
  start: number;
  end: number;
  wordTimes?: LyricWordTime[] | null;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const last = useRef(-1);
  const { froms, exact } = wordFractions(words, start, end, wordTimes);
  useAnimationFrame(() => {
    const duration = preview ? 2.6 : Math.max(0.35, end - start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.8
      : np
        ? livePosition(np) - start
        : 0;
    const progress = Math.min(1, Math.max(0, elapsed / (duration * (exact ? 1 : 0.92))));
    let active = -1;
    froms.forEach((from, i) => {
      if (progress >= from) active = i;
    });
    if (active === last.current) return;
    last.current = active;
    refs.current.forEach((el, i) => {
      if (el) el.classList.toggle("ambient-active", i === active);
    });
  });
  return (
    <span className={`lab-line lab-ambient-line${np && !np.isPlaying ? " lyr-paused" : ""}`}>
      {words.map((word, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el; }} className="lab-ambient-word">
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}

/** Each word orbits in only when its part of the line is reached. */
function OrbitText({
  text,
  start,
  end,
  wordTimes,
  np,
  preview,
}: {
  text: string;
  start: number;
  end: number;
  wordTimes?: LyricWordTime[] | null;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useWordReveal(words, start, end, np, preview, wordTimes);
  return (
    <span className={`lab-line lab-orbit-line${np && !np.isPlaying ? " lyr-paused" : ""}`}>
      {words.map((word, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el; }} className="lab-orb">
          {word}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}

/** Resolves from noise in 420 ms, then stays on the real line. */
function GlitchText({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const glyphs = "!<>-_\\/[]{}=+*^?#01";
    let tick = 0;
    setShown(text);
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= 11) {
        setShown(text);
        window.clearInterval(id);
        return;
      }
      const resolved = Math.min(1, tick / 11);
      setShown(
        [...text]
          .map((ch, i) => (ch === " " || i / text.length < resolved ? ch : glyphs[Math.floor(Math.random() * glyphs.length)]))
          .join(""),
      );
    }, 38);
    return () => window.clearInterval(id);
  }, [text]);
  return <span className="lab-line lab-glitch tabular-nums">{shown}</span>;
}
