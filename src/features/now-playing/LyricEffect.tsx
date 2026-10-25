import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useAnimationFrame } from "motion/react";
import type { LyricAnimation } from "../../settings/store";
import { livePosition, type NowPlaying } from "../../platform/media";

type LabAnimation = Exclude<LyricAnimation, "word">;

/**
 * The eight effects from final.html. Fill/focus/liquid/stripe follow the word
 * that is being sung instead of just playing an entrance, so they stay on the
 * timestamp. Word by Word is untouched in LiveActivity.
 */
export function LyricEffect({
  animation,
  text,
  start = 0,
  end = 4,
  np = null,
  preview = false,
}: {
  animation: LabAnimation;
  text: string;
  index: number;
  start?: number;
  end?: number;
  np?: NowPlaying | null;
  preview?: boolean;
}) {
  if (animation === "glitch") return <GlitchText text={text} />;
  if (animation === "spot") return <SpotlightText text={text} start={start} end={end} np={np} preview={preview} />;
  if (animation === "letters") return <LetterBloom text={text} />;
  if (animation === "spark") return <SparkText text={text} start={start} end={end} np={np} preview={preview} />;
  if (animation === "orbit") return <OrbitText text={text} np={np} />;
  if (animation === "ambient") return <AmbientText text={text} np={np} />;
  return (
    <WordProgress
      animation={animation}
      text={text}
      start={start}
      end={end}
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
  np,
  preview,
}: {
  animation: "fill" | "liquid";
  text: string;
  start: number;
  end: number;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const timing = useRef({ start, end });
  timing.current = { start, end };
  const total = words.reduce((n, word) => n + word.length + 1.7, 0);

  useAnimationFrame(() => {
    const duration = preview ? 2.2 : Math.max(0.35, timing.current.end - timing.current.start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.6
      : np
        ? livePosition(np) - timing.current.start
        : 0;
    const progress = Math.min(1, Math.max(0, elapsed / (duration * 0.88)));
    let acc = 0;
    let active = -1;
    words.forEach((word, i) => {
      const from = acc / total;
      acc += word.length + 1.7;
      const to = acc / total;
      const p = Math.min(1, Math.max(0, (progress - from) / Math.max(0.0001, to - from)));
      const el = refs.current[i];
      if (!el) return;
      if (progress >= from) active = i;
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
  np,
  preview,
}: {
  text: string;
  start: number;
  end: number;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const spot = useRef<HTMLElement>(null);
  const timing = useRef({ start, end });
  timing.current = { start, end };
  const total = words.reduce((n, word) => n + word.length + 1.7, 0);

  useAnimationFrame(() => {
    const duration = preview ? 2.2 : Math.max(0.35, timing.current.end - timing.current.start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.6
      : np
        ? livePosition(np) - timing.current.start
        : 0;
    const progress = Math.min(1, Math.max(0, elapsed / (duration * 0.88)));
    let acc = 0;
    let active = -1;
    let activeP = 0;
    words.forEach((word, i) => {
      const from = acc / total;
      acc += word.length + 1.7;
      const to = acc / total;
      const p = Math.min(1, Math.max(0, (progress - from) / Math.max(0.0001, to - from)));
      if (progress >= from) {
        active = i;
        activeP = p;
      }
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
    spot.current.style.left = `${(centre + (nextCentre - centre) * activeP).toFixed(2)}px`;
  });

  return (
    <span className="lab-line lab-spot-line">
      {words.map((word, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el; }} className="lab-w">
          <span className="lab-base">{word}</span>
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
      <i ref={spot} className="lab-spot" aria-hidden />
    </span>
  );
}

/** Per-character bloom, 18 ms apart, softened so it lands with the line. */
function LetterBloom({ text }: { text: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    void el.offsetWidth;
    el.classList.add("in");
  }, [text]);
  return (
    <span ref={host} className="lab-line lab-letters">
      {[...text].map((ch, i) => (
        <span key={i} className="lab-lch" style={{ "--d": `${i * 18}ms` } as CSSProperties}>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}

/** Particles burst from each word as it becomes the active one. */
function SparkText({
  text,
  start,
  end,
  np,
  preview,
}: {
  text: string;
  start: number;
  end: number;
  np: NowPlaying | null;
  preview: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const layer = useRef<HTMLSpanElement>(null);
  const lastActive = useRef(-1);
  const timing = useRef({ start, end });
  timing.current = { start, end };
  const total = words.reduce((n, word) => n + word.length + 1.7, 0);

  useAnimationFrame(() => {
    const duration = preview ? 2.2 : Math.max(0.35, timing.current.end - timing.current.start);
    const elapsed = preview
      ? (performance.now() / 1000) % 2.6
      : np
        ? livePosition(np) - timing.current.start
        : 0;
    const progress = Math.min(1, Math.max(0, elapsed / (duration * 0.88)));
    let acc = 0;
    let active = -1;
    words.forEach((word, i) => {
      const from = acc / total;
      acc += word.length + 1.7;
      if (progress >= from) active = i;
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
    for (let i = 0; i < 7; i++) {
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
      window.setTimeout(() => spark.remove(), 760);
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

/** Per-word float inside a slowly breathing line. */
function AmbientText({ text, np }: { text: string; np: NowPlaying | null }) {
  return (
    <span className={`lab-line lab-ambient-line${np && !np.isPlaying ? " lyr-paused" : ""}`}>
      {text.split(/\s+/).filter(Boolean).map((word, i, all) => (
        <span key={i} className="lab-ambient-word" style={{ "--i": i } as CSSProperties}>
          {word}
          {i < all.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}

/** Words orbit in from above, one after another, with only a soft blur. */
function OrbitText({ text, np }: { text: string; np: NowPlaying | null }) {
  return (
    <span className={`lab-line lab-orbit-line${np && !np.isPlaying ? " lyr-paused" : ""}`}>
      {text.split(/\s+/).filter(Boolean).map((word, i, all) => (
        <span key={i} className="lab-orb" style={{ "--d": `${i * 80}ms` } as CSSProperties}>
          {word}
          {i < all.length - 1 ? "\u00A0" : ""}
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
