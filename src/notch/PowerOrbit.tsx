import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check } from "@phosphor-icons/react";
import { springs } from "../design/motion";
import { systemControls, fpsHelperReady, type EnergyState, type PowerMode } from "../platform/services";
import { t } from "../i18n";
import { BatteryIcon } from "../ui/glyphs";
import { bumpPowerMode } from "../features/overview/power";
import { closeFlyout } from "./flyout";

type Mode = {
  id: PowerMode;
  labelKey: string;
  level: number;
  tone: string;
  angle: number;
  left: string;
  top: string;
};

const MODES: Mode[] = [
  { id: "saver", labelKey: "Sparmodus", level: 0.28, tone: "#0a84ff", angle: -90, left: "50%", top: "18%" },
  { id: "balanced", labelKey: "Ausgeglichen", level: 0.6, tone: "#f5f5f7", angle: 0, left: "82%", top: "50%" },
  { id: "max", labelKey: "Max", level: 0.92, tone: "#ff453a", angle: 90, left: "50%", top: "82%" },
  { id: "custom", labelKey: "Custom", level: 0.8, tone: "#bf5af2", angle: 180, left: "18%", top: "50%" },
];

const CENTER = 134;
const RADIUS = 88;

function polar(angle: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: CENTER + Math.cos(rad) * RADIUS, y: CENTER + Math.sin(rad) * RADIUS };
}

function arcPath(from: number, to: number) {
  const a = polar(from);
  const b = polar(to);
  return `M ${a.x} ${a.y} A ${RADIUS} ${RADIUS} 0 0 1 ${b.x} ${b.y}`;
}

/**
 * Circular Power mode window. Hold the Power tile, drag left/right to rotate
 * the selection around the ring, release to apply. Each node is a battery icon
 * filled to that mode's level; the active node lifts and glows.
 */
export function PowerOrbit() {
  const [energy, setEnergy] = useState<EnergyState | null>(null);
  const [selected, setSelected] = useState(1);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const start = useRef<{ x: number; index: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void systemControls
        .energy()
        .then((next) => {
          if (!alive) return;
          setEnergy(next);
          if (!loaded.current) {
            loaded.current = true;
            const index = MODES.findIndex((m) => m.id === next.scheme);
            setSelected(index >= 0 ? index : 1);
          }
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const plugged = energy?.plugged ?? true;
  const saver = energy?.batterySaver ?? false;
  const custom = energy?.custom ?? false;
  const high = plugged && !saver;
  const current = energy?.scheme ?? "balanced";
  const mode = MODES[selected];
  const modeLabel = t(mode.labelKey);
  const available = (m: Mode) =>
    m.id === "max" ? high : m.id === "custom" ? high && custom : true;

  const nextAvailable = (from: number, step: number) => {
    let i = from;
    for (let n = 0; n < MODES.length; n++) {
      i += step;
      if (i < 0) i = MODES.length - 1;
      if (i >= MODES.length) i = 0;
      if (available(MODES[i])) return i;
    }
    return from;
  };

  const apply = (index = selected) => {
    if (busy || !available(MODES[index])) return;
    if (MODES[index].id === current && !error) {
      closeFlyout();
      return;
    }
    setSelected(index);
    setBusy(true);
    setApplied(false);
    setError(null);
    const target = MODES[index].id;
    setEnergy((e) => (e ? { ...e, saver: target === "saver", scheme: target } : e));
    let finished = false;
    const watchdog = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      setBusy(false);
      setError(t("Power change timed out. Try again."));
    }, 10_000);
    const run = async () => {
      if (target === "custom" && !(await fpsHelperReady())) throw new Error("helper-ready");
      return systemControls.setEnergy(target);
    };
    void run()
      .then((next) => {
        setEnergy(next);
        setApplied(true);
        bumpPowerMode();
        window.setTimeout(() => closeFlyout(), 480);
      })
      .catch(async (raw) => {
        const message = String(raw);
        if (message.includes("helper-ready")) setError(t("Custom needs the elevated FPS helper. Start it from Hardware or the gaming overlay first."));
        else if (message.includes("battery-saver")) setError(t("Turn off Battery Saver to use Max or Custom."));
        else if (message.includes("uac-cancelled")) setError(t("Admin permission is needed for Custom."));
        else if (message.includes("plugged")) setError(t("Plug in for Max and Custom."));
        else if (message.includes("lenovo") || message.includes("unsupported")) setError(t("Custom mode is not available on this device."));
        else if (message.includes("helper")) setError(t("Could not start the elevated helper."));
        else setError(t("Could not change the power mode."));
        setBusy(false);
        await systemControls.energy().then(setEnergy).catch(() => {});
      })
      .finally(() => {
        window.clearTimeout(watchdog);
        if (finished) return;
        finished = true;
      });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (busy || event.button !== 0) return;
    start.current = { x: event.clientX, index: selected };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!start.current || busy) return;
    const steps = Math.round((event.clientX - start.current.x) / 38);
    if (steps === 0) return;
    moved.current = true;
    let next = start.current.index;
    const dir = steps > 0 ? 1 : -1;
    for (let n = 0; n < Math.abs(steps); n++) next = nextAvailable(next, dir);
    if (next !== selected) setSelected(next);
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (!start.current) return;
    start.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture already released
    }
    if (moved.current) {
      moved.current = false;
      apply(selected);
    }
  };

  return (
    <div
      className="relative size-[268px] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
      }}
      role="group"
      aria-label={t("Power mode")}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle at 50% 50%, ${mode.tone}24, transparent 68%)` }}
      />
      <div className="absolute top-3.5 left-0 right-0 text-center text-[8px] font-bold uppercase tracking-[0.18em] text-label-3">
        {t("Power mode")}
      </div>

      <svg aria-hidden viewBox="0 0 268 268" className="pointer-events-none absolute inset-0 size-full">
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="2.5" />
        {MODES.map((m) => {
          const a = polar(m.angle);
          return (
            <line
              key={m.id}
              x1={a.x}
              y1={a.y}
              x2={CENTER + Math.cos((m.angle * Math.PI) / 180) * (RADIUS - 6)}
              y2={CENTER + Math.sin((m.angle * Math.PI) / 180) * (RADIUS - 6)}
              stroke={m.tone}
              strokeWidth="2"
              strokeLinecap="round"
              opacity={mode.id === m.id ? 1 : 0.24}
            />
          );
        })}
        <motion.path
          key={mode.id}
          d={arcPath(mode.angle - 30, mode.angle + 30)}
          fill="none"
          stroke={mode.tone}
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          style={{ filter: `drop-shadow(0 0 5px ${mode.tone}66)` }}
        />
      </svg>

      {MODES.map((m, index) => {
        const active = index === selected;
        const usable = available(m);
        return (
          <button
            key={m.id}
            type="button"
            disabled={!usable || busy}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setSelected(index);
              apply(index);
            }}
            aria-label={`${t(m.labelKey)}${usable ? "" : " (unavailable)"}`}
            className="absolute z-10 flex size-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border outline-none transition-[background-color,border-color,box-shadow,transform,opacity] duration-300 focus:outline-none disabled:cursor-not-allowed"
            style={{
              left: m.left,
              top: m.top,
              color: active ? "#0b0c0f" : usable ? m.tone : "var(--color-label-4)",
              backgroundColor: active ? m.tone : "#0b0c0f",
              borderColor: active ? m.tone : "rgba(255,255,255,.1)",
              boxShadow: active ? `0 0 22px ${m.tone}66, 0 6px 14px -6px #000` : undefined,
              opacity: usable ? 1 : 0.42,
              transform: `translate(-50%, -50%) scale(${active ? 1.1 : 1})`,
            }}
          >
            <BatteryIcon size={20} level={m.level} />
            <span className="text-[6px] font-bold tracking-[0.04em] uppercase">{t(m.labelKey)}</span>
          </button>
        );
      })}

      <motion.div
        key={mode.id}
        className="absolute top-1/2 left-1/2 z-20 flex size-[86px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white/10 bg-[#08090b] shadow-[0_14px_30px_-12px_#000]"
        initial={{ scale: 0.94 }}
        animate={{ scale: 1 }}
        transition={springs.snappy}
      >
        {applied ? (
          <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex text-green">
            <Check size={28} weight="bold" />
          </motion.span>
        ) : (
          <motion.span
            key={mode.id}
            initial={{ scale: 0.75, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springs.snappy}
            className="flex"
            style={{ color: mode.tone }}
          >
            <BatteryIcon size={30} level={mode.level} />
          </motion.span>
        )}
        <span className="mt-0.5 text-[10px] font-semibold text-label">{applied ? t("Applied") : modeLabel}</span>
        <span className="mt-px text-[7px] uppercase tracking-[0.1em] text-label-3">
          {busy ? t("Applying…") : applied ? "" : t("drag ↔")}
        </span>
      </motion.div>

      {error && (
        <div className="absolute inset-x-7 bottom-4 z-30 rounded-[9px] bg-red/10 px-2 py-1.5 text-center text-[8px] leading-[11px] text-red">
          {error}
        </div>
      )}
    </div>
  );
}
