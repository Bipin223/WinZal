import type { CSSProperties } from "react";
import type { LyricEqualizerStyle, LyricGlowStyle } from "../../settings/store";

/**
 * The three equalizer behaviours. CSS-only and 40 px wide in the closed pill,
 * so they add no animation loop or React work per frame.
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
  const bars = style === "mirror" ? 5 : style === "ticks" ? 10 : 4;
  return (
    <div
      className={`lyr-eq lyr-eq-${style} ${playing ? "" : "lyr-paused"} ${preview ? "lyr-eq-preview" : ""}`}
      aria-hidden
    >
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(style === "mirror" ? Math.abs(i - 2) : i) * 0.11}s` }} />
      ))}
    </div>
  );
}

const LEAF_PATHS = [
  // Maple — five pointed lobes.
  "M12 1.2 C12.5 4 13.3 6.2 14.2 7.3 L19.6 4.8 L17.8 10.2 L22.4 11.2 L18.4 14 L21 19.2 L15.4 17.4 L13 22.6 L11 17.4 L5.4 19.2 L8 14 L3.6 11.2 L8.2 10.2 L6.4 4.8 L11.8 7.3 C11.9 5.2 12 3.2 12 1.2 Z",
  // Birch — soft oval with a point.
  "M12 2 C15.8 3.4 19 6.8 19 11 C19 16.4 15.8 20.4 12 22 C8.2 20.4 5 16.4 5 11 C5 6.8 8.2 3.4 12 2 Z",
  // Oak — wavy lobes.
  "M12 1.8 C14 4 15.6 4.8 17 4 C16.8 6.2 17.8 7.4 19.2 8 C18 9.6 18.4 11 19.4 12 C18 13 17.6 14.6 18.4 16.4 C16.2 16 14.8 17 14.2 18.6 C13.2 17.6 12.6 17.4 12 17.4 C11.4 17.4 10.8 17.6 9.8 18.6 C9.2 17 7.8 16 5.6 16.4 C6.4 14.6 6 13 4.6 12 C5.6 11 6 9.6 4.8 8 C6.2 7.4 7.2 6.2 7 4 C8.4 4.8 10 4 12 1.8 Z",
];

const LEAF_SHADES = [
  "color-mix(in srgb, var(--accent) 16%, #c0392b)",
  "color-mix(in srgb, var(--accent) 16%, #e2601f)",
  "color-mix(in srgb, var(--accent) 16%, #e6b43a)",
  "color-mix(in srgb, var(--accent) 16%, #d98f2b)",
  "color-mix(in srgb, var(--accent) 16%, #8a9a3b)",
];

/** Wave, Aurora, Bokeh and Leaves. Only the selected one is mounted. */
export function LyricGlow({ style, playing }: { style: LyricGlowStyle; playing: boolean }) {
  if (style === "none") return null;
  const paused = playing ? "" : "lyr-paused";
  if (style === "wave") {
    return (
      <div className={`lyr-glow lyr-glow-wave ${paused}`} aria-hidden>
        <svg className="lyr-wave lyr-wave-back" viewBox="0 0 900 30" preserveAspectRatio="none">
          <path
            className="lyr-wave-back-fill"
            d="M0 15 Q25 9 50 15 T100 15 T150 15 T200 15 T250 15 T300 15 T350 15 T400 15 T450 15 T500 15 T550 15 T600 15 T650 15 T700 15 T750 15 T800 15 T850 15 T900 15 V30 H0 Z"
          />
        </svg>
        <svg className="lyr-wave lyr-wave-front" viewBox="0 0 900 30" preserveAspectRatio="none">
          <path
            className="lyr-wave-front-fill"
            d="M0 18 Q37.5 10 75 18 T150 18 T225 18 T300 18 T375 18 T450 18 T525 18 T600 18 T675 18 T750 18 T825 18 T900 18 V30 H0 Z"
          />
          <path
            className="lyr-wave-crest"
            d="M0 18 Q37.5 10 75 18 T150 18 T225 18 T300 18 T375 18 T450 18 T525 18 T600 18 T675 18 T750 18 T825 18 T900 18"
          />
        </svg>
      </div>
    );
  }
  if (style === "aurora") {
    return (
      <div className={`lyr-glow lyr-glow-aurora ${paused}`} aria-hidden>
        <i />
        <i />
      </div>
    );
  }
  if (style === "bokeh") {
    const count = 6;
    const colors = ["var(--accent)", "#fff", "color-mix(in srgb, var(--accent) 45%, #ffc46b)"];
    return (
      <div className={`lyr-glow lyr-glow-bokeh ${paused}`} aria-hidden>
        {Array.from({ length: count }, (_, i) => {
          const left = 7 + (i * 84) / Math.max(1, count - 1) + ((i * 7) % 5);
          const top = 12 + ((i * 61) % 68);
          const size = i % 4 === 0 ? 42 : i % 3 === 0 ? 24 : 14;
          return (
            <i
              key={i}
              className={`bokeh-mote bokeh-${i % 3}`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${size}px`,
                height: `${size}px`,
                background: colors[i % colors.length],
                animationDuration: `${7 + (i % 5) * 1.6}s`,
                animationDelay: `${-i * 0.9}s`,
                "--dx": `${(i % 2 ? 1 : -1) * (18 + (i % 4) * 10)}px`,
                "--dy": `${(i % 3 === 0 ? -1 : 1) * (10 + (i % 5) * 6)}px`,
              } as CSSProperties}
            />
          );
        })}
        <span className="bokeh-leak leak-a" />
        <span className="bokeh-leak leak-b" />
        <span className="bokeh-leak leak-c" />
      </div>
    );
  }
  const count = 10;
  return (
    <div className={`lyr-glow lyr-glow-leaves ${paused}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const left = -10 + (i * 80) / Math.max(1, count - 1) + ((i * 17) % 7);
        const dur = 8 + (i % 7) * 0.9;
        const delay = -(((i * 13) % 28) / 2);
        const size = 8.5 + (i % 3) * 2.1;
        const dx = 90 + ((i * 31) % 90);
        return (
          <i
            key={i}
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size}px`,
              color: LEAF_SHADES[i % LEAF_SHADES.length],
              "--dur": `${dur}s`,
              "--delay": `${delay}s`,
              "--sway": `${6 + ((i * 5) % 12)}px`,
              "--dx": `${dx}px`,
              "--dir": i % 2 ? 1 : -1,
            } as CSSProperties}
          >
            <svg viewBox="0 0 24 24">
              <path d={LEAF_PATHS[i % LEAF_PATHS.length]} />
              <path className="vein" d="M12 22 L12 6 M12 12 L7 7 M12 12 L17 7 M12 16 L8 12 M12 16 L16 12" />
            </svg>
          </i>
        );
      })}
    </div>
  );
}
