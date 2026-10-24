import { AnimatePresence, motion } from "motion/react";
import { Equalizer } from "../features/now-playing/Equalizer";
import { springs } from "../design/motion";

/**
 * A second, detached island: when gaming stats own the closed pill and music is
 * playing, the equalizer moves into its own little circle at the left edge —
 * visually a separate notch, like the iPhone's satellite islands.
 *
 * Purely decorative: it never takes the pill's width and it does not intercept
 * clicks, so the FPS tools keep their layout.
 */
export function GamingSatellite({ show, playing, floating }: { show: boolean; playing: boolean; floating: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="gaming-equalizer"
          aria-hidden
          className="pointer-events-none absolute flex size-7 items-center justify-center bg-notch"
          style={{
            right: "calc(100% + 10px)",
            top: 0,
            bottom: 0,
            marginTop: "auto",
            marginBottom: "auto",
            borderRadius: "50%",
            transformOrigin: "100% 50%",
            boxShadow: floating ? "0 10px 24px -8px rgb(0 0 0 / 0.65), 0 2px 8px rgb(0 0 0 / 0.3)" : undefined,
          }}
          initial={{ opacity: 0, scale: 0.55, x: 7 }}
          animate={{ opacity: 1, scale: 1, x: 0, transition: springs.snappy }}
          exit={{ opacity: 0, scale: 0.55, x: 5, transition: { duration: 0.14, ease: "easeIn" } }}
        >
          <Equalizer playing={playing} height={10} fps={48} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
