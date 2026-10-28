import { AnimatePresence, motion } from "motion/react";
import { MusicNotesSimple } from "@phosphor-icons/react";
import { springs } from "../design/motion";
import { useNowPlaying } from "../platform/media";
import { DiscordLogo } from "../ui/brands";

/**
 * Circular action satellite on the right of the closed pill. It shows the
 * activity you are *not* looking at:
 *   - call in the pill + music playing -> album art / music note
 *   - music in the pill + active call  -> Discord logo
 * One tap swaps the pill. This replaces the old in-pill switch buttons and the
 * "Music during calls" setting.
 */
export function ActivitySwitch({
  show,
  kind,
  onSwitch,
  floating,
}: {
  show: boolean;
  kind: "music" | "call" | null;
  onSwitch: () => void;
  floating: boolean;
}) {
  const np = useNowPlaying();
  return (
    <AnimatePresence>
      {show && kind && (
        <motion.button
          key="activity-switch"
          type="button"
          data-flyout-hit
          aria-label={kind === "music" ? "Show music" : "Show Discord call"}
          title={kind === "music" ? "Show music" : "Show Discord call"}
          onClick={(event) => {
            event.stopPropagation();
            onSwitch();
          }}
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.04 }}
          transition={springs.press}
          className="pressable pointer-events-auto absolute flex size-9 items-center justify-center overflow-hidden rounded-full border border-[var(--control-border)] bg-notch text-label after:absolute after:-inset-1 after:content-['']"
          style={{
            left: "calc(100% + 10px)",
            top: 0,
            bottom: 0,
            marginTop: "auto",
            marginBottom: "auto",
            transformOrigin: "0% 50%",
            boxShadow: floating ? "0 10px 24px -8px rgb(0 0 0 / 0.65), 0 2px 8px rgb(0 0 0 / 0.3)" : undefined,
          }}
          initial={{ opacity: 0, scale: 0.55, x: -7 }}
          animate={{ opacity: 1, scale: 1, x: 0, transition: springs.snappy }}
          exit={{ opacity: 0, scale: 0.55, x: -5, transition: { duration: 0.14, ease: "easeIn" } }}
        >
          {kind === "music" ? (
            np?.artwork ? (
              <img src={np.artwork} alt="" draggable={false} className="size-7 rounded-full object-cover" />
            ) : (
              <MusicNotesSimple size={19} weight="fill" />
            )
          ) : (
            <DiscordLogo size={19} />
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
