import type { Settings } from "../../settings/store";
import { LyricEffect } from "./LyricEffect";

type Animation = Settings["appearance"]["lyricsAnimation"];

/**
 * Tiny CSS-only preview of a lyric transition for the settings picker. The real
 * pill uses Motion; these previews use keyframes so they stay cheap and pause
 * when the settings page closes.
 */
export function LyricAnimationPreview({ animation }: { animation: Animation }) {
  const sample = "When you light the candle";
  if (animation === "word") {
    return (
      <div className="flex h-full items-center justify-center px-1 text-[9px] font-semibold whitespace-nowrap text-white">
        {sample.split(" ").map((word, i, all) => (
          <span key={i} className="anim-word inline-block" style={{ animationDelay: `${i * 0.12}s` }}>
            {word}
            {i < all.length - 1 ? "\u00A0" : ""}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center overflow-hidden px-1 text-[9px] font-semibold whitespace-nowrap text-white">
      <LyricEffect animation={animation} text="light the candle" index={0} preview />
    </div>
  );
}
