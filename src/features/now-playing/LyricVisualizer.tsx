import { useId } from "react";

export type LyricVisualizerStyle = "wave" | "pulse" | "dots" | "ripple" | "aurora";

/**
 * Small, CSS-only visualizers for the lyrics pill. They sit behind the text at
 * the bottom edge, use the same `--accent` variable as the equalizer, and pause
 * with playback. The settings picker reuses the same components as live
 * previews. No extra animation loop.
 */
export function LyricVisualizer({
  style,
  playing,
  preview = false,
}: {
  style: LyricVisualizerStyle;
  playing: boolean;
  preview?: boolean;
}) {
  const gradientId = `lyric-river-${useId().replace(/:/g, "")}`;
  const shell = preview
    ? "absolute inset-x-0 bottom-0 z-0 h-2.5 overflow-hidden"
    : "pointer-events-none absolute inset-x-0 bottom-0 z-0 h-2.5 overflow-hidden";
  return (
    <div className={preview ? "relative h-full w-full overflow-hidden" : "contents"}>
      {preview && <span className="absolute top-[42%] left-1/2 z-10 h-[2px] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fill-20" />}
      <div
        aria-hidden
        className={`${shell} ${playing ? "" : "lyric-paused"}`}
        style={{
          color: "var(--accent, #ff453a)",
          maskImage: "linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)",
        }}
      >
        {style === "pulse" ? (
          <div className="lyric-pulse absolute inset-x-0 bottom-0 h-full" style={{ background: "linear-gradient(90deg, transparent, currentColor, transparent)" }} />
        ) : style === "dots" ? (
          <div className="absolute inset-x-0 bottom-0 flex h-full items-end justify-between px-[8%]">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} className="lyric-dot size-[3px] rounded-full bg-current" style={{ animationDelay: `${i * 0.23}s` }} />
            ))}
          </div>
        ) : style === "ripple" ? (
          <div className="absolute inset-0">
            {[0, 1, 2].map((i) => (
              <span key={i} className="lyric-ripple" style={{ animationDelay: `${i}s` }} />
            ))}
          </div>
        ) : style === "aurora" ? (
          <>
            <div className="lyric-aurora absolute inset-x-[-15%] bottom-[-5px] h-5 blur-[3px]" style={{ background: "radial-gradient(ellipse at 35% 100%, currentColor, transparent 65%)" }} />
            <div className="lyric-aurora lyric-aurora-delay absolute inset-x-[-15%] bottom-[-5px] h-5 blur-[3px]" style={{ background: "radial-gradient(ellipse at 70% 100%, currentColor, transparent 60%)" }} />
          </>
        ) : (
          <svg className="lyric-wave h-full w-[200%]" viewBox="0 0 240 8" preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path d="M0 4 Q 30 0 60 4 T 120 4 T 180 4 T 240 4 L240 8 L0 8 Z" fill={`url(#${gradientId})`} />
            <path d="M0 4 Q 30 0 60 4 T 120 4 T 180 4 T 240 4" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        )}
      </div>
    </div>
  );
}
