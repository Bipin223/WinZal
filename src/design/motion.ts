import type { Transition } from "motion/react";

/*
 * Motion presets. Every animation in the app uses one of these,
 * no inline values in components.
 *
 * Apple-style springs (visualDuration + bounce) instead of stiffness/damping:
 * easier to read and matches SwiftUI's .spring(duration:bounce:).
 */

// ?slow=4 in the URL slows all springs down for tuning.
const slow = Number(new URLSearchParams(location.search).get("slow")) || 1;

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export type MotionStyle = "default" | "ios";

// 0 = off, 1 = full. Set from Settings → Performance → Motion.
let motionScale = 1;
export function setMotionScale(value: number) {
  motionScale = Math.max(0, Math.min(1, value));
}

/*
 * "default" preserves WinZal's existing feel. "ios" is one baked-in Apple
 * profile for chrome only: the same per-surface durations, tuned damping.
 * Lyric springs never take an iOS override, so the reading experience stays
 * identical in both modes.
 */
let motionStyle: MotionStyle = "default";
export function setMotionStyle(value: MotionStyle) {
  motionStyle = value;
}

/**
 * Chrome springs can take an iOS profile. Lyric springs omit it, so they are
 * fixed in both modes.
 */
function spring(visualDuration: number, bounce: number, ios?: { duration: number; bounce: number }): Transition {
  const factor = 0.25 + 0.75 * motionScale;
  if (reduceMotion || motionScale === 0) return { type: "spring", visualDuration: 0.001, bounce: 0 };
  const config = motionStyle === "ios" && ios ? ios : { duration: visualDuration, bounce };
  return { type: "spring", visualDuration: config.duration * factor * slow, bounce: config.bounce };
}

export const springs = {
  /** Notch opens: lively, a noticeable but short overshoot. */
  get open() {
    return spring(0.42, 0.24, { duration: 0.40, bounce: 0.12 });
  },
  /** Notch closes: faster than opening, no bounce. */
  get close() {
    return spring(0.32, 0.04, { duration: 0.30, bounce: 0 });
  },
  /** Hover nudge: small and playful, says "I see you". */
  get peek() {
    return spring(0.26, 0.32, { duration: 0.26, bounce: 0.30 });
  },
  /** Shape change while open (tab switch, live activity). */
  get morph() {
    return spring(0.36, 0.14, { duration: 0.36, bounce: 0.12 });
  },
  /** Small elements inside (tab pill, toggles). */
  get snappy() {
    return spring(0.24, 0.12, { duration: 0.24, bounce: 0.10 });
  },
  /** Apple Music lyric line: soft scale/slide, never overshoots. Fixed. */
  get lyrics() {
    return spring(0.46, 0);
  },
  /** Word-by-word lyric: a fluid rise with a gentle, lively overshoot. Fixed. */
  get lyricWord() {
    return spring(0.52, 0.22);
  },
  /**
   * Closed notch growing/shrinking for a lyric line. A real spring, so a line
   * arriving mid-resize retargets instead of restarting a fixed tween. Fixed,
   * so the reading experience does not change with the chrome personality.
   */
  get lyricWidth(): Transition {
    return spring(0.40, 0.12);
  },
};

const easeOut = [0.23, 1, 0.32, 1] as const;

/** Quick fade for overlays ("Copied", status changes). */
export const fade = { duration: 0.16 * slow, ease: easeOut } satisfies Transition;

/** Crossfade for large areas (covers, charts), a bit calmer. */
export const crossfade = { duration: 0.4 * slow, ease: "easeInOut" } satisfies Transition;

/**
 * Cover swap: the new image fades in on top, the old one leaves a beat later, so
 * there is never a gap or a hard cut (same calm pace as the accent color).
 */
export const artwork = {
  enter: { duration: 0.45 * slow, ease: "easeInOut" } satisfies Transition,
  exit: { duration: 0.35 * slow, delay: 0.2 * slow, ease: "easeInOut" } satisfies Transition,
} as const;

/** Menus/popovers: fast in, even faster out. */
export const popover = {
  enter: { duration: 0.16 * slow, ease: easeOut },
  exit: { duration: 0.1 * slow, ease: easeOut },
} satisfies Record<string, Transition>;

/** Continuous spin for "loading" (refresh icon). */
export const spin = { repeat: Infinity, duration: 0.9, ease: "linear" } satisfies Transition;

/** Calm pulse for "ringing" (opacity back and forth). */
export const pulse = { repeat: Infinity, repeatType: "reverse", duration: 0.7, ease: "easeInOut" } satisfies Transition;

/** Content appears after the shape starts moving; disappears immediately. */
export const content = {
  enter: {
    duration: 0.24 * slow,
    delay: 0.05 * slow,
    ease: [0.23, 1, 0.32, 1],
  } satisfies Transition,
  exit: {
    duration: 0.12 * slow,
    ease: [0.23, 1, 0.32, 1],
  } satisfies Transition,
} as const;

/** "Wrong" (PIN): a short, damped side-to-side shake like the macOS login field. */
export const shake = {
  keyframes: ["translateX(0px)", "translateX(-9px)", "translateX(7px)", "translateX(-5px)", "translateX(3px)", "translateX(0px)"],
  transition: { duration: 0.38 * slow, ease: "easeOut" } satisfies Transition,
} as const;

/** Countdowns that step once per second (2FA ring): linear, exactly one tick long. */
export const tick = { duration: 1, ease: "linear" } satisfies Transition;
