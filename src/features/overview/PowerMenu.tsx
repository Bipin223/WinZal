import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { batteryStatus, type BatteryStatus, type PowerMode } from "../../platform/services";
import { BatteryIcon } from "../../ui/glyphs";
import { BatteryMeter } from "../../ui/BatteryMeter";
import { springs } from "../../design/motion";

export type PowerOption = {
  mode: PowerMode;
  label: string;
  level: number;
  tone: string;
  color: string;
  dot: string;
};

/**
 * A compact horizontal strip above the Power tile: the live battery on the
 * left, then the four power modes as bare battery icons. Hold the tile to open,
 * move onto an icon and release (or click) to apply. No labels, no tile
 * backgrounds — the active mode is full-strength with a dot underneath.
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
  const [batt, setBatt] = useState<BatteryStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void batteryStatus()
        .then((next) => alive && setBatt(next))
        .catch(() => {});
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    // Do not let the opening pointerdown immediately close the strip.
    const id = window.setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const actual = batt?.present ? Math.min(100, Math.max(0, Math.round(batt.percent))) : null;

  return (
    <motion.div
      ref={box}
      className="absolute right-0 bottom-[calc(100%+8px)] z-50 flex items-center overflow-hidden rounded-full border border-white/15 bg-white/[0.07] p-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_18px_40px_-16px_rgb(0_0_0/0.85),0_4px_12px_rgb(0_0_0/0.3)] backdrop-blur-2xl backdrop-saturate-150"
      initial={{ opacity: 0, y: 5, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: springs.open }}
      exit={{ opacity: 0, y: 4, scale: 0.98, transition: springs.close }}
      style={{ transformOrigin: "100% 100%" }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-white/30" />
      {actual !== null && (
        <>
          <span className="ml-0.5 flex shrink-0 items-center">
            <BatteryMeter
              percent={actual}
              charging={!!batt?.charging}
              plugged={!!batt?.plugged}
              saver={!!batt?.saver}
              size="xs"
            />
          </span>
          <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-separator" />
        </>
      )}

      {options.map((option) => {
        const active = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            disabled={busy}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              onPick(option.mode);
              onClose();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onPick(option.mode);
              onClose();
            }}
            aria-label={option.label}
            className="group relative flex size-8 shrink-0 items-center justify-center rounded-full outline-none transition-opacity duration-150 focus-visible:ring-1 focus-visible:ring-white/25 disabled:opacity-40"
            style={{ color: option.color }}
          >
            <span className="flex transition-transform duration-150 group-hover:scale-110">
              <BatteryIcon size={19} level={option.level} />
            </span>
            {active && (
              <span
                aria-hidden
                className="absolute bottom-0.5 size-1 rounded-full"
                style={{ backgroundColor: option.color }}
              />
            )}
          </button>
        );
      })}
    </motion.div>
  );
}
