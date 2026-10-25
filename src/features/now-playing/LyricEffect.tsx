import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { LyricAnimation } from "../../settings/store";

/**
 * Lyric entrance effects translated from the animation lab. Word-by-word stays
 * in LiveActivity; the rest live here so the settings previews and the closed
 * pill use exactly the same markup.
 */
export function LyricEffect({
  animation,
  text,
  index,
  preview = false,
}: {
  animation: Exclude<LyricAnimation, "word">;
  text: string;
  index: number;
  preview?: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const charOffsets = words.map((_, i) => words.slice(0, i).reduce((n, word) => n + word.length + 1, 0));

  if (animation === "fill" || animation === "liquid") {
    const fromBottom = animation === "liquid";
    return (
      <span className="inline-flex items-center justify-center gap-x-[0.28em] whitespace-nowrap">
        {words.map((word, i) => (
          <span key={i} className="relative inline-block whitespace-nowrap">
            <span className="text-label-4">{word}</span>
            <motion.span
              className="absolute inset-0 whitespace-nowrap text-label"
              initial={{ clipPath: fromBottom ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)" }}
              animate={{ clipPath: "inset(0 0 0 0)" }}
              transition={{ duration: 0.5, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            >
              {word}
            </motion.span>
          </span>
        ))}
      </span>
    );
  }

  if (animation === "focus") {
    return (
      <span className="inline-flex items-center justify-center gap-x-[0.28em] whitespace-nowrap">
        {words.map((word, i) => (
          <motion.span
            key={i}
            className="inline-block whitespace-nowrap"
            initial={{ opacity: 0.32 }}
            animate={{ opacity: [0.32, 1, 0.32], scale: [1, 1.06, 1] }}
            transition={{
              duration: 0.7,
              delay: i * 0.32,
              repeat: preview ? Infinity : 1,
              repeatDelay: preview ? words.length * 0.32 : 0,
            }}
          >
            {word}
          </motion.span>
        ))}
      </span>
    );
  }

  if (animation === "irid") {
    return (
      <span className="inline-flex items-center justify-center gap-x-[0.28em] whitespace-nowrap">
        {words.map((word, i) => (
          <motion.span
            key={i}
            className="inline-block whitespace-nowrap bg-gradient-to-r from-[var(--accent)] via-white to-[#ffc46b] bg-[length:300%_100%] bg-clip-text text-transparent"
            initial={{ backgroundPosition: "0% 0" }}
            animate={{ backgroundPosition: ["0% 0", "200% 0"] }}
            transition={{ duration: 1.4, delay: i * 0.1, repeat: preview ? Infinity : 1, repeatDelay: 0.4 }}
          >
            {word}
          </motion.span>
        ))}
      </span>
    );
  }

  if (animation === "stripe") {
    return (
      <span className="inline-flex items-center justify-center gap-x-[0.28em] whitespace-nowrap">
        {words.map((word, i) => (
          <span key={i} className="relative inline-block whitespace-nowrap">
            {word}
            <motion.span
              className="absolute -bottom-[2px] left-0 h-[2px] w-full origin-left rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.45, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        ))}
      </span>
    );
  }

  if (animation === "cascade") {
    return (
      <span className="inline-flex items-center justify-center whitespace-nowrap">
        {words.map((word, wi) => (
          <span key={wi} className="inline-block whitespace-nowrap">
            {[...word].map((ch, ci) => (
              <motion.span
                key={ci}
                className="inline-block"
                initial={{ opacity: 0, y: 9, filter: "blur(5px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.5, delay: (charOffsets[wi] + ci) * 0.018, ease: [0.16, 1, 0.3, 1] }}
              >
                {ch}
              </motion.span>
            ))}
            {wi < words.length - 1 ? <span>&nbsp;</span> : null}
          </span>
        ))}
      </span>
    );
  }

  if (animation === "dissolve") {
    return (
      <motion.span
        key={index}
        className="inline-block"
        initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
        transition={{ duration: 0.42, ease: [0.23, 1, 0.32, 1] }}
      >
        {text}
      </motion.span>
    );
  }

  if (animation === "dots") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="lyr-dots" aria-hidden>
          <i /><i /><i />
        </span>
        <span>{text}</span>
      </span>
    );
  }

  if (animation === "duet") {
    const amber = index % 2 === 1;
    return (
      <span className="inline-block" style={{ color: amber ? "#ffc46b" : "var(--accent)" }}>
        {text}
      </span>
    );
  }

  // glitch
  return <GlitchText text={text} />;
}

function GlitchText({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const glyphs = "!<>-_\\/[]{}=+*^?#01";
    let tick = 0;
    setShown(text);
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= 9) {
        setShown(text);
        window.clearInterval(id);
        return;
      }
      const resolved = Math.min(1, tick / 9);
      setShown(
        [...text]
          .map((ch, i) => (ch === " " || i / text.length < resolved ? ch : glyphs[Math.floor(Math.random() * glyphs.length)]))
          .join(""),
      );
    }, 38);
    return () => window.clearInterval(id);
  }, [text]);
  return <span className="inline-block tabular-nums">{shown}</span>;
}
