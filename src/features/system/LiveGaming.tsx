import { useLayoutEffect, useRef } from "react";
import { motion } from "motion/react";
import { LockSimple, SignOut } from "@phosphor-icons/react";
import { content } from "../../design/motion";
import { settings } from "../../settings/store";
import { fps, useFpsPolling } from "./gaming";
import { gamingFull, gamingMeasured } from "./gamingOverlay";
import { levelColor } from "./SystemView";
import { system, useSystemShown } from "./store";
import { LiveEdge } from "../../notch/liveEdges";

/**
 * Gaming overlay. Each stat is optional; Text is inline, Bars adds a central
 * stacked CPU/GPU/RAM meter. FPS stays a number.
 */
export function LiveGaming() {
  useFpsPolling();
  const g = settings.use().gaming;
  useSystemShown(gamingFull(g));
  const f = fps.use();
  const { stats } = system.use();
  const mem = stats ? (stats.memUsed / stats.memTotal) * 100 : null;
  const left = g.showFps || g.showCpu;
  const right = g.showGpu || g.showRam;
  const textKind = g.style === "bars" ? "text" : g.style;
  const bars: number[] = [];
  if (g.style === "bars") {
    if (g.showCpu) bars.push(stats?.cpu ?? 0);
    if (g.showGpu) bars.push(stats?.gpu ?? 0);
    if (g.showRam) bars.push(mem ?? 0);
  }
  const fit = useRef<HTMLDivElement>(null);
  const retry = useRef<number | undefined>(undefined);

  // The shape's width follows the real row, not an estimate. This removes the
  // flexible gap between CPU and GPU and lets every stat size change shrink or
  // grow the pill immediately.
  useLayoutEffect(() => {
    const el = fit.current;
    if (!el) return;
    // Use the row's layout width, not scrollWidth: LiveEdge transforms its two
    // sides outwards to follow the shape, and scrollWidth would count that
    // overflow. Feeding it back made the pill permanently wider on every frame.
    // 24 = 12 px of air on each side, matching the clock pill.
    const report = () => {
      const width = Math.ceil(el.getBoundingClientRect().width + 24);
      gamingMeasured.set(width);
      // The first measurement can land before the parent's store subscription
      // is live. Repeat it once after mount so the pill uses the real width
      // instead of the (slightly smaller) first-paint estimate.
      window.clearTimeout(retry.current);
      retry.current = window.setTimeout(() => gamingMeasured.set(width), 60);
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => {
      ro.disconnect();
      window.clearTimeout(retry.current);
      gamingMeasured.set(0);
    };
  }, []);

  // Settings toggles and stat changes re-render this row. Measure after every
  // render so the pill follows immediately even if the ResizeObserver callback
  // is delayed or the row was mounted at a narrower width.
  useLayoutEffect(() => {
    const el = fit.current;
    if (!el) return;
    const width = Math.ceil(el.getBoundingClientRect().width + 24);
    if (gamingMeasured.get() === width) return;
    gamingMeasured.set(width);
    window.clearTimeout(retry.current);
    retry.current = window.setTimeout(() => gamingMeasured.set(width), 60);
  });

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center px-[10px]"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      <div ref={fit} className="flex w-max shrink-0 items-center gap-1.5">
        {left && (
          <LiveEdge side="left" className="flex items-center gap-2">
            {g.showFps && <FpsStat f={f} />}
            {g.showCpu && (
              <GamingStat
                label="CPU"
                value={stats?.cpu ?? null}
                temp={g.showTemps ? (stats?.cpuTemp ?? null) : null}
                kind={textKind}
              />
            )}
          </LiveEdge>
        )}
        {left && right && g.divider && <span aria-hidden className="h-3 w-px shrink-0 bg-separator" />}
        {g.style === "bars" && bars.length > 0 && <GamingBars values={bars} />}
        {right && (
          <LiveEdge side="right" className="flex items-center gap-2">
            {g.showGpu && (
              <GamingStat
                label="GPU"
                value={stats?.gpu ?? null}
                temp={g.showTemps ? (stats?.gpuTemp ?? null) : null}
                kind={textKind}
              />
            )}
            {g.showGpu && g.showRam && <span aria-hidden className="h-3 w-px shrink-0 self-center bg-separator" />}
            {g.showRam && <GamingStat label="RAM" value={mem} kind={textKind} />}
          </LiveEdge>
        )}
        {!left && !right && <span aria-hidden className="size-1 rounded-full bg-label-3" />}
      </div>
    </motion.div>
  );
}

export function FpsStat({ f, preview = false }: { f: { value: number | null; error: string | null }; preview?: boolean }) {
  const label = preview ? "text-white/45" : "text-label-3";
  const value = preview ? "text-white" : "text-label";
  return (
    <span className="flex shrink-0 items-baseline gap-1 whitespace-nowrap">
      <span className={`tabular flex w-[26px] justify-end text-footnote font-semibold ${value}`}>
        {f.error === "no-admin" ? (
          <LockSimple size={11} weight="bold" className={`self-center ${preview ? "text-white/40" : "text-label-3"}`} />
        ) : f.error === "relogin" ? (
          <SignOut size={11} weight="bold" className="self-center text-orange" />
        ) : f.value === null ? (
          "—"
        ) : (
          Math.round(f.value)
        )}
      </span>
      <span className={`text-caption font-medium ${label}`}>FPS</span>
    </span>
  );
}

/** The central stacked meter used by Bars: CPU, GPU and RAM rows. */
export function GamingBars({ values }: { values: number[] }) {
  return (
    <span className="flex w-14 shrink-0 flex-col justify-center gap-[3px]" aria-hidden>
      {values.map((value, i) => {
        const level = Math.max(0, Math.min(100, value));
        return (
          <span key={i} className="relative h-[3px] overflow-hidden rounded-full bg-fill-3">
            <span
              className="block h-full rounded-full transition-[width,background-color] duration-500 ease-out"
              style={{ width: `${level}%`, backgroundColor: levelColor(level) }}
            />
          </span>
        );
      })}
    </span>
  );
}

export function GamingStat({
  label,
  value,
  temp = null,
  kind = "text",
  preview = false,
}: {
  label: string;
  value: number | null;
  temp?: number | null;
  kind?: "text" | "bars";
  preview?: boolean;
}) {
  const used = Math.max(0, Math.min(100, value ?? 0));
  const color = levelColor(used);
  const labelClass = preview ? "text-white/45" : "text-label-3";
  const valueClass = preview ? "text-white" : "text-label";
  const trackClass = preview ? "bg-white/15" : "bg-fill-3";

  if (kind === "bars") {
    return (
      <span
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
        title={`${label} ${value === null ? "—" : `${Math.round(used)}%`}`}
      >
        <span className={`text-caption font-medium ${labelClass}`}>{label}</span>
        <span className={`relative h-[3px] w-8 overflow-hidden rounded-full ${trackClass}`}>
          <span className="block h-full rounded-full transition-[width,background-color] duration-500 ease-out" style={{ width: `${used}%`, backgroundColor: color }} />
        </span>
        <Temp temp={temp} preview={preview} />
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
      <span className={`text-caption font-medium ${labelClass}`}>{label}</span>
      <span className={`tabular w-[34px] text-right text-footnote font-semibold transition-colors duration-300 ${valueClass}`} style={{ color: value === null ? undefined : color }}>
        {value === null ? "—" : `${Math.round(used)}%`}
      </span>
      <Temp temp={temp} preview={preview} />
    </span>
  );
}

function Temp({ temp, preview }: { temp: number | null; preview: boolean }) {
  if (temp == null) return null;
  return (
    <>
      <span aria-hidden className={`text-caption leading-none ${preview ? "text-white/25" : "text-label-4"}`}>·</span>
      <span className={`tabular text-caption font-medium ${preview ? "text-white/45" : "text-label-3"}`}>{temp}°</span>
    </>
  );
}
