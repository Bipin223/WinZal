import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { springs } from "../design/motion";
import { privacy } from "../features/privacy/store";
import { t } from "../i18n";

/** Width reserved at the right end of the closed pill for the recording badge. */
export const RECORDING_EXTRA = 72;
/** How far the live content moves left to leave room for the badge. */
export const RECORDING_INSET = 70;

/** Screen-recording state plus the local start time (for the elapsed clock). */
export function useRecording() {
  const recording = privacy.use().screen;
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    setSince(recording ? Date.now() : null);
  }, [recording]);
  return { recording, since };
}

/**
 * Right-end recording chip: blinking red dot + elapsed time. It is part of the
 * closed pill, so it appears and disappears with the notch shape's spring.
 */
export function RecordingBadge({ since, className = "" }: { since: number | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  const elapsed = since ? Math.max(0, now - since) : 0;

  return (
    <motion.div
      aria-label={t("Bildschirm wird aufgenommen")}
      className={`pointer-events-none z-10 flex h-[18px] items-center gap-1 rounded-full px-1.5 ${className}`}
      style={{ backgroundColor: "rgb(255 69 58 / 0.14)" }}
      initial={{ opacity: 0, scale: 0.9, x: 5 }}
      animate={{ opacity: 1, scale: 1, x: 0, transition: springs.snappy }}
      exit={{ opacity: 0, scale: 0.9, x: 5, transition: { duration: 0.12 } }}
    >
      <span className="rec-blink size-[5px] shrink-0 rounded-full" style={{ backgroundColor: "var(--color-red)" }} />
      <span className="tabular text-[9px] leading-none font-semibold text-label-2">{formatElapsed(elapsed)}</span>
    </motion.div>
  );
}

/** 00:00 under an hour, 1:02:03 above it. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
