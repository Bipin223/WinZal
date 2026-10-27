import { AnimatePresence, motion } from "motion/react";
import { springs } from "../design/motion";
import { formatClock, timer, useRemaining } from "../features/timer/store";

/**
 * A second detached island for a running timer when another activity owns the
 * main pill (gaming, Discord call, music). A circular progress ring surrounds
 * the remaining time; purely decorative, like the gaming equalizer satellite.
 */
export function TimerSatellite({ show, floating }: { show: boolean; floating: boolean }) {
  const s = timer.use();
  const remaining = useRemaining();
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const elapsed = s.duration > 0 ? Math.min(1, Math.max(0, 1 - remaining / s.duration)) : 1;
  const label = s.finished ? "0:00" : remaining >= 3600 ? `${Math.ceil(remaining / 60)}m` : formatClock(remaining);
  const tint = s.finished ? "var(--color-green)" : s.mode === "focus" ? "var(--color-orange)" : "var(--color-green)";
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="timer-satellite"
          aria-hidden
          className="pointer-events-none absolute flex size-8 items-center justify-center bg-notch"
          style={{
            left: "calc(100% + 10px)",
            top: 0,
            bottom: 0,
            marginTop: "auto",
            marginBottom: "auto",
            borderRadius: "50%",
            transformOrigin: "0% 50%",
            color: tint,
            boxShadow: floating ? "0 10px 24px -8px rgb(0 0 0 / 0.65), 0 2px 8px rgb(0 0 0 / 0.3)" : undefined,
          }}
          initial={{ opacity: 0, scale: 0.55, x: -7 }}
          animate={{ opacity: 1, scale: 1, x: 0, transition: springs.snappy }}
          exit={{ opacity: 0, scale: 0.55, x: -5, transition: { duration: 0.14, ease: "easeIn" } }}
        >
          <svg viewBox="0 0 32 32" className="absolute inset-0 size-full -rotate-90">
            <circle cx="16" cy="16" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.18" />
            <circle
              cx="16"
              cy="16"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - elapsed)}
            />
          </svg>
          <span className="tabular relative text-[7.5px] leading-none font-semibold">{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
