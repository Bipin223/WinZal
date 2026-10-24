import { AnimatePresence, motion } from "motion/react";
import { MusicNoteSimple } from "@phosphor-icons/react";
import { artwork as artworkSwap, content, springs } from "../../design/motion";
import { useSmoothArtwork } from "./artwork";
import type { NowPlaying } from "../../platform/media";
import { Equalizer } from "./Equalizer";
import { useLyrics } from "./lyrics";
import { LiveEdge } from "../../notch/liveEdges";
import { settings } from "../../settings/store";

/**
 * Closed notch while music plays: cover on the left, equalizer on the right,
 * the middle stays empty like a real notch.
 */
export function LiveActivity({ np }: { np: NowPlaying }) {
  const appearance = settings.use().appearance;
  const { current, next, index } = useLyrics(np, appearance.lyricsInPill);
  return (
    <motion.div
      className="absolute inset-0 flex items-center gap-2 px-[9px]"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      <LiveEdge side="left">
        <LiveArtwork artwork={np.artwork} />
      </LiveEdge>
      <div
        className="relative flex min-w-0 flex-1 justify-center overflow-hidden"
        style={{
          maskImage: "linear-gradient(90deg, #000 calc(100% - 22px), transparent)",
          WebkitMaskImage: "linear-gradient(90deg, #000 calc(100% - 22px), transparent)",
        }}
      >
        {appearance.lyricsInPill && current ? (
          <LyricLine
            current={current}
            next={next}
            layout={appearance.lyricsLayout}
            large={appearance.lyricsSize === "large"}
            animation={appearance.lyricsAnimation}
            index={index}
          />
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={np.title}
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
      </div>
      <LiveEdge side="right">
        <Equalizer playing={np.isPlaying} fps={30} />
      </LiveEdge>
    </motion.div>
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
}: {
  current: string;
  next: string | null;
  layout: "inline" | "lines";
  large: boolean;
  animation: "current" | "apple" | "blur";
  index: number;
}) {
  const inline = layout === "inline";
  const enter =
    animation === "apple"
      ? { opacity: 0, y: 9 }
      : animation === "blur"
        ? { opacity: 0, filter: "blur(6px)" }
        : { opacity: 0, y: 3, filter: "blur(3px)" };
  const active =
    animation === "apple"
      ? { opacity: 1, y: 0 }
      : animation === "blur"
        ? { opacity: 1, filter: "blur(0px)" }
        : { opacity: 1, y: 0, filter: "blur(0px)" };
  const leave =
    animation === "apple"
      ? { opacity: 0, y: -9 }
      : animation === "blur"
        ? { opacity: 0, filter: "blur(6px)" }
        : { opacity: 0, y: -3, filter: "blur(3px)" };
  const transition = animation === "apple" ? springs.snappy : content.enter;
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
          {current}
        </span>
        {!inline && next && (
          <span
            className={`max-w-full truncate font-medium text-label-4 ${
              large ? "text-[10px] leading-[11px]" : "text-[9px] leading-[10px]"
            } ${animation === "blur" ? "blur-[0.7px]" : ""}`}
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
