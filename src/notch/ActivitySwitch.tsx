import { useRef } from "react";
import { AnimatePresence, motion, useAnimationFrame } from "motion/react";
import { MusicNotesSimple } from "@phosphor-icons/react";
import { springs } from "../design/motion";
import { livePosition, useNowPlaying } from "../platform/media";
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
  liquid = false,
}: {
  show: boolean;
  kind: "music" | "call" | null;
  onSwitch: () => void;
  floating: boolean;
  liquid?: boolean;
}) {
  const np = useNowPlaying();
  const ring = useRef<SVGCircleElement>(null);
  const ringRadius = 13.75;
  const circumference = 2 * Math.PI * ringRadius;
  useAnimationFrame(() => {
    if (!show || kind !== "music" || !np?.duration || !ring.current) return;
    const progress = Math.min(1, Math.max(0, livePosition(np) / np.duration));
    ring.current.style.strokeDashoffset = String(circumference * (1 - progress));
  });
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
          whileTap={{ scale: 0.9 }}
          className="pressable pointer-events-auto absolute flex size-8 items-center justify-center rounded-full text-label"
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
          <span className="relative block size-8">
            {kind === "music" && !!np?.duration && (
              <svg aria-hidden className="absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r={ringRadius} fill="none" stroke="rgb(109 119 139 / 0.65)" strokeWidth="4.5" />
                <circle
                  ref={ring}
                  cx="16"
                  cy="16"
                  r={ringRadius}
                  fill="none"
                  stroke="#fff"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference}
                />
              </svg>
            )}
            <span className={`absolute grid place-items-center overflow-hidden rounded-full border border-white/10 bg-notch ${liquid ? "liquid-surface" : ""} ${kind === "music" && np?.duration ? "inset-[4px]" : "inset-[2px]"}`}>
              {kind === "music" ? (
                np?.artwork ? (
                  <img src={np.artwork} alt="" draggable={false} className="size-full object-cover" />
                ) : (
                  <MusicNotesSimple size={15} weight="fill" />
                )
              ) : (
                <DiscordLogo size={15} />
              )}
              {liquid && <span aria-hidden className="liquid-rim absolute inset-0 rounded-full" />}
            </span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
