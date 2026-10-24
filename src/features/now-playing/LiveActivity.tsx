import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, MusicNoteSimple } from "@phosphor-icons/react";
import { artwork as artworkSwap, content, springs } from "../../design/motion";
import { useSmoothArtwork } from "./artwork";
import { media, type NowPlaying } from "../../platform/media";
import { Equalizer } from "./Equalizer";
import { useLyrics } from "./lyrics";
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
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/55 text-label opacity-0 transition-opacity duration-150 group-hover/cover:opacity-100">
            <ArrowUpRight size={9} weight="bold" />
          </span>
        </button>
      </LiveEdge>
      <FadeBox>
        {appearance.lyricsInPill && current ? (
          <LyricLine
            current={current}
            next={next}
            layout={appearance.lyricsLayout}
            large={appearance.lyricsSize === "large"}
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
        <Equalizer playing={np.isPlaying} fps={30} />
      </LiveEdge>
    </motion.div>
  );
}

/**
 * The middle text slot. The soft right-edge fade is only applied when a line is
 * actually wider than the slot, so a short lyric in the larger pill stays crisp
 * instead of ending in an unnecessary blur.
 */
function FadeBox({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    const check = () => {
      if (!alive) return;
      const over = Array.from(el.querySelectorAll<HTMLElement>("[data-fade-text]")).some(
        (node) => node.scrollWidth > node.clientWidth + 1,
      );
      setFade((prev) => (prev === over ? prev : over));
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
      className="relative flex min-w-0 flex-1 justify-center overflow-hidden"
      style={
        fade
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
  large,
  animation,
  index,
  start,
  end,
}: {
  current: string;
  next: string | null;
  layout: "inline" | "lines";
  large: boolean;
  animation: "current" | "apple" | "word";
  index: number;
  start: number;
  end: number;
}) {
  const inline = layout === "inline";
  const wordMode = animation === "word";
  const enter =
    animation === "apple"
      ? { opacity: 0, y: 9 }
      : wordMode
        ? { opacity: 0 }
        : { opacity: 0, y: 3, filter: "blur(3px)" };
  const active =
    animation === "apple"
      ? { opacity: 1, y: 0 }
      : wordMode
        ? { opacity: 1 }
        : { opacity: 1, y: 0, filter: "blur(0px)" };
  const leave =
    animation === "apple"
      ? { opacity: 0, y: -9 }
      : wordMode
        ? { opacity: 0 }
        : { opacity: 0, y: -3, filter: "blur(3px)" };
  const transition = animation === "apple" ? springs.snappy : content.enter;
  const words = current.split(/\s+/).filter(Boolean);
  const stagger = words.length > 1 ? Math.min(0.36, Math.max(0.04, ((end - start) * 0.75) / (words.length - 1))) : 0;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={index}
        className="flex min-w-0 max-w-full flex-col items-center justify-center"
        initial={enter}
        animate={active}
        exit={leave}
        transition={transition}
      >
        <span
          data-fade-text
          className={`max-w-full truncate font-semibold text-label ${
            inline
              ? large
                ? "text-[12px] leading-none"
                : "text-[11px] leading-none"
              : large
                ? "text-[12px] leading-[14px]"
                : "text-[11px] leading-[13px]"
          }`}
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
        </span>
        {!inline && next && (
          <span
            data-fade-text
            className={`max-w-full truncate font-medium text-label-4 ${
              large ? "text-[10px] leading-[11px]" : "text-[9px] leading-[10px]"
            }`}
          >
            {next}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
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
