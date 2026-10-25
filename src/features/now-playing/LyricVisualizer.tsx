import type { LyricEqualizerStyle, LyricGlowStyle } from "../../settings/store";

/**
 * The six equalizer behaviours from the animation lab. CSS-only and 40 px wide
 * in the closed pill, so they add no animation loop or React work per frame.
 */
export function LyricEqualizer({
  style,
  playing,
  preview = false,
}: {
  style: LyricEqualizerStyle;
  playing: boolean;
  preview?: boolean;
}) {
  const bars =
    style === "mirror" ? 5 : style === "ticks" ? 10 : style === "capsule" ? 3 : style === "dots" ? 4 : 4;
  return (
    <div
      className={`lyr-eq lyr-eq-${style} ${playing ? "" : "lyr-paused"} ${preview ? "lyr-eq-preview" : ""}`}
      aria-hidden
    >
      {style === "dots" ? (
        Array.from({ length: 4 }, (_, col) => (
          <span key={col} className="lyr-eq-col">
            {[0, 1, 2].map((row) => (
              <i key={row} style={{ animationDelay: `${col * 0.16 + row * 0.1}s` }} />
            ))}
          </span>
        ))
      ) : (
        Array.from({ length: bars }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(style === "mirror" ? Math.abs(i - 2) : i) * 0.11}s` }} />
        ))
      )}
    </div>
  );
}

/** The six soft behind-glow layers from the lab. */
export function LyricGlow({ style, playing }: { style: LyricGlowStyle; playing: boolean }) {
  if (style === "none") return null;
  return (
    <div className={`lyr-glow lyr-glow-${style} ${playing ? "" : "lyr-paused"}`} aria-hidden>
      {style === "spectrum"
        ? Array.from({ length: 14 }, (_, i) => <i key={i} style={{ animationDelay: `${-i * 0.13}s`, animationDuration: `${1.5 + (i % 4) * 0.25}s` }} />)
        : style === "aurora" || style === "rings" || style === "halo"
          ? <><i /><i /></>
          : <i />}
    </div>
  );
}
