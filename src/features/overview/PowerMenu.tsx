import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { PowerMode } from "../../platform/services";
import { BatteryIcon } from "../../ui/glyphs";
import { SelectedDot } from "../../ui/SelectedDot";
import { springs } from "../../design/motion";
import { t } from "../../i18n";

export type PowerOption = {
  mode: PowerMode;
  label: string;
  level: number;
  tone: string;
  dot: string;
};

/**
 * Anchored above the Power tile. It opens on a quick press-and-hold; the user
 * keeps the button down, moves onto a mode and releases to apply. No separate
 * window and no long-press delay.
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
  const topFor = (i: number) => (n <= 2 ? 30 : i === 0 || i === n - 1 ? 42 : 14);
  const hovered = options.find((o) => o.mode === hover) ?? options.find((o) => o.mode === mode);

  return (
    <motion.div
      ref={box}
      className="absolute right-0 bottom-[calc(100%+9px)] z-50 w-[252px] origin-bottom-right overflow-hidden rounded-[18px] border border-separator bg-elevated p-2 shadow-[0_22px_50px_-18px_rgb(0_0_0/0.9),0_4px_14px_rgb(0_0_0/0.35)]"
      initial={{ opacity: 0, y: 7, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: springs.open }}
      exit={{ opacity: 0, y: 5, scale: 0.94, transition: springs.close }}
      style={{ transformOrigin: "100% 100%" }}
      onPointerUp={() => onClose()}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[9px] font-semibold tracking-[0.08em] text-label-3 uppercase">{t("Power mode")}</span>
        <span className="text-[8px] text-label-4">{t("move · release")}</span>
      </div>

      <div className="relative h-[104px]">
        <svg aria-hidden viewBox="0 0 236 104" className="pointer-events-none absolute inset-0 h-full w-full">
          <path d="M 18 72 Q 118 4 218 72" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1.5" strokeDasharray="2 5" />
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
              className="absolute flex h-[58px] w-[54px] flex-col items-center justify-center gap-1 rounded-[12px] outline-none transition-[background-color,color,box-shadow,transform] duration-200 focus:outline-none"
              style={{
                left,
                top,
                color: lit ? option.tone : "var(--color-label-2)",
                backgroundColor: lit ? "rgba(255,255,255,.07)" : "transparent",
                transform: `translateY(${lit ? -2 : 0}px) scale(${lit ? 1.06 : 1})`,
              }}
            >
              <span
                className="relative flex size-9 items-center justify-center rounded-full"
                style={{
                  color: lit ? option.tone : "var(--color-label-2)",
                  backgroundColor: lit ? `${option.tone}1f` : "rgba(255,255,255,.05)",
                  boxShadow: lit ? `0 0 16px ${option.tone}3d` : undefined,
                  border: `1px solid ${lit ? `${option.tone}66` : "rgba(255,255,255,.08)"}`,
                  transition: "background-color .2s ease, border-color .2s ease, box-shadow .2s ease, color .2s ease",
                }}
              >
                <BatteryIcon size={22} level={option.level} />
                {active && <SelectedDot />}
              </span>
              <span className="max-w-full truncate text-[7px] font-semibold tracking-[0.02em]">{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-0.5 h-4 text-center text-[9px] text-label-3">
        {hovered ? hovered.label : t("Hold, move, release")}
      </div>
    </motion.div>
  );
}
