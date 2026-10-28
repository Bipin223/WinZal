import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check } from "@phosphor-icons/react";
import { batteryStatus, type BatteryStatus, type PowerMode } from "../../platform/services";
import { BatteryIcon } from "../../ui/glyphs";
import { BatteryMeter } from "../../ui/BatteryMeter";
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
 * Compact list popover above the Power tile. Hold the tile to open it, move
 * onto a mode and release (or click) to apply. Rows are bare — an icon, a
 * label and nothing else; the check marks the current mode.
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
  const material = settings.use().appearance.material;
  const glass = material === "glass";

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
    // Do not let the opening pointerdown immediately close the popover.
    const id = window.setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const actual = batt?.present ? Math.min(100, Math.max(0, Math.round(batt.percent))) : null;
  const low = actual !== null && actual < 20;
  const saver = !!batt?.saver;
  const state = !batt
    ? null
    : batt.charging
      ? t("Wird geladen")
      : saver
        ? t("Akkuschonung")
        : batt.plugged
          ? t("Angeschlossen")
          : t("Im Akkubetrieb");
  const stateTone = batt?.charging
    ? "var(--color-green)"
    : low
      ? "var(--color-red)"
      : saver
        ? "var(--color-yellow)"
        : "var(--color-label-2)";

  return (
    <motion.div
      ref={box}
      className={`absolute right-0 bottom-[calc(100%+8px)] z-50 w-[196px] origin-bottom-right rounded-[12px] border p-1 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.85),0_4px_12px_rgb(0_0_0/0.3)] ${
        glass ? "border-white/10 bg-notch backdrop-blur-2xl" : "border-separator bg-elevated"
      }`}
      initial={{ opacity: 0, y: 5, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: springs.open }}
      exit={{ opacity: 0, y: 4, scale: 0.98, transition: springs.close }}
      style={{ transformOrigin: "100% 100%" }}
    >
      <div className="flex items-start justify-between gap-2 px-1.5 pt-1 pb-1.5">
        <span className="pt-1 text-[9px] font-semibold tracking-[0.08em] text-label-3 uppercase">{t("Power mode")}</span>
        {actual !== null && (
          <span className="flex flex-col items-end gap-0.5">
            <BatteryMeter
              percent={actual}
              charging={!!batt?.charging}
              plugged={!!batt?.plugged}
              saver={saver}
              size="xs"
            />
            {state && (
              <span className="text-[8px] leading-none font-medium" style={{ color: stateTone }}>
                {state}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="mx-1 mb-1 h-px bg-separator" />

      <div className="flex flex-col">
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
              className={`group flex h-7 w-full items-center gap-2 rounded-[6px] px-1.5 text-left outline-none transition-colors duration-150 focus-visible:text-label ${
                active ? "text-label" : "text-label-2 hover:text-label"
              }`}
            >
              <span
                className="flex shrink-0 transition-transform duration-150 group-hover:scale-110"
                style={{ color: option.color }}
              >
                <BatteryIcon size={16} level={option.level} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[9.5px] font-medium">{option.label}</span>
              {active && <Check size={11} weight="bold" style={{ color: option.color }} />}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
