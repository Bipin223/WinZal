import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, MusicNoteSimple } from "@phosphor-icons/react";
import { artwork as artworkSwap, content, springs } from "../../design/motion";
import { useSmoothArtwork } from "./artwork";
import { media, type NowPlaying } from "../../platform/media";
import { Equalizer } from "./Equalizer";
import { LyricVisualizer } from "./LyricVisualizer";
import { useLyrics } from "./lyrics";
import { lyricsTextWidth } from "./lyricsWidth";
import { LiveEdge } from "../../notch/liveEdges";
import { settings } from "../../settings/store";
import { t } from "../../i18n";

/**
 * Closed notch while music plays: cover on the left, equalizer on the right,
 * the middle stays empty like a real notch.
 */
export function LiveActivity({ np }: { np: NowPlaying }) {
  const appearance = settings.use().appearance;
  const { current, next, index, start, end } = useLyrics(np, appearance.lyricsInPill);

  // Measure the line at its real font size. The notch uses this to expand only
  // as far as the lyric needs, so readable text is not hidden behind the fade.
  useLayoutEffect(() => {
    if (!appearance.lyricsInPill || !current) {
      lyricsTextWidth.set(0);
      return;
    }
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    const family = getComputedStyle(document.body).fontFamily;
    const size = appearance.lyricsTextSize;
    ctx.font = `600 ${size}px ${family}`;
    let width = ctx.measureText(current).width;
    if (appearance.lyricsLayout === "lines" && next) {
      ctx.font = `500 ${Math.max(8, size - 3)}px ${family}`;
      width = Math.max(width, ctx.measureText(next).width);
    }
    lyricsTextWidth.set(Math.ceil(width));
  }, [appearance.lyricsInPill, appearance.lyricsLayout, appearance.lyricsTextSize, current, next]);
  return (
    <motion.div
      className="absolute inset-0 flex items-center gap-2 px-[9px]"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      <LiveEdge side="left">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void media.openSource();
          }}
          aria-label={t("App öffnen")}
          title={t("App öffnen")}
          className="group/cover pressable relative flex size-5 shrink-0 items-center justify-center rounded-[5px]"
        >
          <LiveArtwork artwork={np.artwork} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/55 text-white opacity-0 transition-opacity duration-150 group-hover/cover:opacity-100">
            <ArrowUpRight size={9} weight="bold" />
          </span>
        </button>
      </LiveEdge>
      <FadeBox fade={!appearance.lyricsInPill || !current}>
        {appearance.lyricsInPill && current && appearance.lyricsVisualizer && (
          <LyricVisualizer style={appearance.lyricsVisualizerStyle} playing={np.isPlaying} />
        )}
        {appearance.lyricsInPill && current ? (
          <LyricLine
            current={current}
            next={next}
            layout={appearance.lyricsLayout}
            size={appearance.lyricsTextSize}
            animation={appearance.lyricsAnimation}
            index={index}
            start={start}
            end={end}
          />
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={np.title}
              data-fade-text
              className="max-w-full overflow-hidden whitespace-nowrap text-[11px] leading-none font-semibold text-label"
              initial={{ opacity: 0, transform: "translateY(3px)", filter: "blur(3px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)", transition: content.enter }}
              exit={{ opacity: 0, transform: "translateY(-3px)", filter: "blur(3px)", transition: content.exit }}
              title={np.title}
            >
              {np.title}
            </motion.div>
          </AnimatePresence>
        )}
      </FadeBox>
      <LiveEdge side="right">
        <Equalizer playing={np.isPlaying} fps={48} />
      </LiveEdge>
    </motion.div>
  );
}

/**
 * The middle text slot. The soft right-edge fade is only applied to a title,
 * and only when it is actually wider than the slot. Lyrics are never faded:
 * they widen the pill instead, and a line beyond the maximum scrolls slowly.
 */
function FadeBox({ children, fade = true }: { children: ReactNode; fade?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    const check = () => {
      if (!alive) return;
      const next = Array.from(el.querySelectorAll<HTMLElement>("[data-fade-text]")).some(
        (node) => node.scrollWidth > node.clientWidth + 1,
      );
      setOver((prev) => (prev === next ? prev : next));
    };
    check();
    const resize = new ResizeObserver(check);
    resize.observe(el);
    const mutation = new MutationObserver(check);
    mutation.observe(el, { subtree: true, childList: true, characterData: true });
    void document.fonts?.ready.then(check);
    return () => {
      alive = false;
      resize.disconnect();
      mutation.disconnect();
    };
  });
  return (
    <div
      ref={box}
      className="relative flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden"
      style={
        fade && over
          ? {
              maskImage: "linear-gradient(90deg, #000 calc(100% - 22px), transparent)",
              WebkitMaskImage: "linear-gradient(90deg, #000 calc(100% - 22px), transparent)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/**
 * One or two lyric lines in the middle of the closed pill. Layout and animation
 * are separate options: "inline" keeps one shortened line, "lines" shows the
 * current line plus the next one. Transitions use only opacity/transform/filter,
 * so the notch keeps its rounded silhouette and nothing re-lays out the bar.
 */
function LyricLine({
  current,
  next,
  layout,
  size,
  animation,
  index,
  start,
  end,
}: {
  current: string;
  next: string | null;
  layout: "inline" | "lines";
  size: number;
  animation: "apple" | "word" | "reveal";
  index: number;
  start: number;
  end: number;
}) {
  const inline = layout === "inline";
  const wordMode = animation === "word";
  const motions = {
    apple: {
      enter: { opacity: 0, y: 10, scale: 0.94 },
      active: { opacity: 1, y: 0, scale: 1 },
      leave: { opacity: 0, y: -8, scale: 0.97 },
    },
    word: {
      enter: { opacity: 0 },
      active: { opacity: 1 },
      leave: { opacity: 0 },
    },
    reveal: {
      enter: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
      active: { opacity: 1, clipPath: "inset(0 0% 0 0)" },
      leave: { opacity: 0, clipPath: "inset(0 0 0 100%)" },
    },
  }[animation];
  const { enter, active, leave } = motions;
  const transition = animation === "apple" ? springs.lyrics : content.enter;
  const words = current.split(/\s+/).filter(Boolean);
  const stagger = words.length > 1 ? Math.min(0.36, Math.max(0.04, ((end - start) * 0.75) / (words.length - 1))) : 0;
  const nextSize = Math.max(8, size - 3);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={index}
        className="relative z-10 flex min-w-0 max-w-full flex-col items-center justify-center"
        initial={enter}
        animate={active}
        exit={leave}
        transition={transition}
      >
        <LyricText
          className="font-semibold text-label"
          resetKey={`${index}-${inline}-${size}`}
          style={{ fontSize: `${size}px`, lineHeight: inline ? `${Math.round(size + 2)}px` : `${Math.round(size + 1)}px` }}
        >
          {wordMode && words.length > 1
            ? words.map((word, i) => (
                <motion.span
                  key={`${index}-${i}`}
                  className="inline-block"
                  initial={{ opacity: 0, filter: "blur(6px)", y: 2 }}
                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                  transition={{ duration: 0.34, delay: i * stagger, ease: [0.23, 1, 0.32, 1] }}
                >
                  {word}
                  {i < words.length - 1 ? "\u00A0" : ""}
                </motion.span>
              ))
            : current}
        </LyricText>
        {!inline && next && (
          <span
            data-fade-text
            className="max-w-full truncate font-medium text-label-4"
            style={{ fontSize: `${nextSize}px`, lineHeight: `${Math.max(9, size - 2)}px` }}
          >
            {next}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * One lyric line that never hides text behind a fade. The notch widens to fit
 * the line; if the line is still wider than the maximum pill, it scrolls
 * slowly to the end and back instead of replacing the end with a blur.
 */
function LyricText({
  children,
  className,
  resetKey,
  style,
}: {
  children: ReactNode;
  className: string;
  resetKey: string;
  style?: CSSProperties;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const over = Math.max(0, el.scrollWidth - el.clientWidth);
      setShift((prev) => (Math.abs(prev - over) > 1 ? over : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [resetKey]);
  return (
    <span
      ref={box}
      data-fade-text
      className={`block max-w-full ${className}`}
      // Clip horizontally for the marquee, but leave room for descenders (g, y)
      // above and below the line box so the glyphs are never sliced.
      style={{ ...style, clipPath: "inset(-12px 0px)" }}
    >
      <motion.span
        className="inline-block whitespace-nowrap"
        animate={shift > 1 ? { x: [0, -shift, -shift, 0] } : { x: 0 }}
        transition={
          shift > 1
            ? {
                duration: Math.min(36, Math.max(9, shift / 22 + 5)),
                times: [0, 0.14, 0.86, 1],
                repeat: Infinity,
                repeatDelay: 1.6,
                delay: 0.7,
                ease: "easeInOut",
              }
            : { duration: 0.2 }
        }
      >
        {children}
      </motion.span>
    </span>
  );
}

/**
 * Track or app change: the new cover (already decoded) fades in on top of the old one
 * with a blur bridge, the old one leaves a beat later. No cut, no gap, same calm
 * pace as the accent color of the equalizer.
 */
function LiveArtwork({ artwork: src }: { artwork: string | null }) {
  const artwork = useSmoothArtwork(src);
  return (
    <div className="relative size-5 shrink-0">
      <AnimatePresence initial={false}>
        <motion.div
          key={artwork ?? "placeholder"}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0, transform: "scale(0.94)", filter: "blur(3px)" }}
          animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)", transition: artworkSwap.enter }}
          exit={{ opacity: 0, filter: "blur(2px)", transition: artworkSwap.exit }}
        >
          {artwork ? (
            <img src={artwork} alt="" draggable={false} className="size-5 rounded-[5px] object-cover" />
          ) : (
            <MusicNoteSimple size={15} weight="fill" className="text-accent" />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
