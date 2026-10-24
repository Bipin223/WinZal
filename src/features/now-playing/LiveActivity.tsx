import { AnimatePresence, motion } from "motion/react";
import { MusicNoteSimple } from "@phosphor-icons/react";
import { artwork as artworkSwap, content } from "../../design/motion";
import { useSmoothArtwork } from "./artwork";
import type { NowPlaying } from "../../platform/media";
import { Equalizer } from "./Equalizer";
import { useLyricsLine } from "./lyrics";
import { LiveEdge } from "../../notch/liveEdges";
import { settings } from "../../settings/store";

/**
 * Closed notch while music plays: cover on the left, equalizer on the right,
 * the middle stays empty like a real notch.
 */
export function LiveActivity({ np }: { np: NowPlaying }) {
  const lyricsOn = settings.use().appearance.lyricsInPill;
  const lyric = useLyricsLine(np, lyricsOn);
  const shown = lyric ?? np.title;
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
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={shown}
            className="max-w-full overflow-hidden whitespace-nowrap text-[11px] leading-none font-semibold text-label"
            initial={{ opacity: 0, transform: "translateY(3px)", filter: "blur(3px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, transform: "translateY(-3px)", filter: "blur(3px)", transition: content.exit }}
            title={np.title}
          >
            {shown}
          </motion.div>
        </AnimatePresence>
      </div>
      <LiveEdge side="right">
        <Equalizer playing={np.isPlaying} />
      </LiveEdge>
    </motion.div>
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
