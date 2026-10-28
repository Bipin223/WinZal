import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { PowerMode } from "../../platform/services";
import { BatteryIcon } from "../../ui/glyphs";
import { SelectedDot } from "../../ui/SelectedDot";
import { springs } from "../../design/motion";
import { settings } from "../../settings/store";
import { t } from "../../i18n";

export type PowerOption = {
  mode: PowerMode;
  label: string;
  level: number;
  tone: string;
  color: string;
  dot: string;
};

/**
 * Curved glass Power picker anchored above the tile. It opens on the first
 * press; keep holding, move onto a battery icon and release to apply. The
 * material follows the notch's Liquid Glass / Solid / Dark setting.
 */
export function PowerMenu({
  options,
  mode,
  busy,
  onPick,
  onClose,
}: {
  options: PowerOption[];
  mode: PowerMode;
  busy: boolean;
  onPick: (mode: PowerMode) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<PowerMode | null>(null);
  const material = settings.use().appearance.material;
  const glass = material === "glass";

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const onUp = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    // Do not let the opening pointerdown immediately close the menu.
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onClose]);

  const n = options.length;
  const width = 54;
  const gap = 6;
  const total = n * width + Math.max(0, n - 1) * gap;
  const start = (252 - total) / 2;
  const topFor = (i: number) => (n <= 2 ? 32 : i === 0 || i === n - 1 ? 42 : 14);
  const hovered = options.find((o) => o.mode === hover) ?? options.find((o) => o.mode === mode);

  return (
    <motion.div
      ref={box}
      className={`absolute right-0 bottom-[calc(100%+10px)] z-50 h-[150px] w-[252px] origin-bottom-right overflow-hidden border shadow-[0_24px_54px_-20px_rgb(0_0_0/0.9),0_4px_16px_rgb(0_0_0/0.35)] ${
        glass ? "border-white/10 bg-notch backdrop-blur-2xl" : "border-separator bg-elevated"
      }`}
      initial={{ opacity: 0, y: 7, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: springs.open }}
      exit={{ opacity: 0, y: 5, scale: 0.94, transition: springs.close }}
      style={{ borderRadius: "76px 76px 26px 26px", transformOrigin: "100% 100%" }}
      onPointerUp={() => onClose()}
    >
      {/* glass rim + a soft dome reflection */}
      <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-white/25" />
      <span
        aria-hidden
        className="pointer-events-none absolute -top-8 left-1/2 h-24 w-40 -translate-x-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgb(255 255 255 / .10), transparent 72%)" }}
      />

      <svg aria-hidden viewBox="0 0 252 150" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d="M 18 96 Q 126 18 234 96" fill="none" stroke="rgb(255 255 255 / .12)" strokeWidth="1.5" strokeDasharray="2 5" />
      </svg>

      {options.map((option, i) => {
        const active = option.mode === mode;
        const lit = hover === option.mode || (!hover && active);
        const left = start + i * (width + gap);
        const top = topFor(i);
        return (
          <button
            key={option.mode}
            type="button"
            disabled={busy}
            onPointerEnter={() => setHover(option.mode)}
            onPointerLeave={() => setHover(null)}
            onPointerUp={(event) => {
              event.stopPropagation();
              onPick(option.mode);
              onClose();
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label={option.label}
            className="absolute flex h-[58px] w-[54px] flex-col items-center justify-center gap-1 rounded-[12px] outline-none transition-[background-color,box-shadow,transform] duration-200 focus:outline-none"
            style={{
              left,
              top,
              color: option.color,
              backgroundColor: lit ? `color-mix(in srgb, ${option.color} 14%, transparent)` : "transparent",
              transform: `translateY(${lit ? -2 : 0}px) scale(${lit ? 1.08 : 1})`,
            }}
          >
            <span
              className="relative flex size-9 items-center justify-center rounded-full"
              style={{
                color: option.color,
                backgroundColor: `color-mix(in srgb, ${option.color} ${lit ? 20 : 10}%, transparent)`,
                border: `1px solid color-mix(in srgb, ${option.color} ${lit ? 48 : 22}%, transparent)`,
                boxShadow: lit ? `0 0 18px color-mix(in srgb, ${option.color} 32%, transparent)` : undefined,
                transition: "background-color .2s ease, border-color .2s ease, box-shadow .2s ease",
              }}
            >
              <BatteryIcon size={22} level={option.level} />
              {active && <SelectedDot />}
            </span>
            <span className="max-w-full truncate text-[7px] font-semibold tracking-[0.02em]">{option.label}</span>
          </button>
        );
      })}

      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[9px] font-medium" style={{ color: hovered?.color }}>
        {hovered ? hovered.label : t("Power mode")}
      </div>
    </motion.div>
  );
}
