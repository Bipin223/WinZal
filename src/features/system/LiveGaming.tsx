import { motion } from "motion/react";
import { LockSimple, SignOut } from "@phosphor-icons/react";
import { content } from "../../design/motion";
import { settings } from "../../settings/store";
import { fps, useFpsPolling } from "./gaming";
import { gamingFull } from "./gamingOverlay";
import { levelColor } from "./SystemView";
import { system, useSystemShown } from "./store";
import { LiveEdge } from "../../notch/liveEdges";

/**
 * Gaming overlay. Each stat is optional; Text / Bars / Dots changes how
 * CPU, GPU and RAM are drawn. FPS stays a number.
 */
export function LiveGaming() {
  useFpsPolling();
  const g = settings.use().gaming;
  useSystemShown(gamingFull(g));
  const f = fps.use();
  const { stats, history } = system.use();
  const mem = stats ? (stats.memUsed / stats.memTotal) * 100 : null;
  const left = g.showFps || g.showCpu;
  const right = g.showGpu || g.showRam;

  return (
    <motion.div
      className={`absolute inset-0 flex items-center px-[10px] ${right ? "justify-between" : "justify-center"}`}
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      {left && (
        <LiveEdge side="left" className="flex items-center gap-2">
          {g.showFps && <FpsStat f={f} />}
          {g.showCpu && (
            <GamingStat
              label="CPU"
              value={stats?.cpu ?? null}
              temp={g.showTemps ? (stats?.cpuTemp ?? null) : null}
              kind={g.style}
              data={history.cpu}
            />
          )}
        </LiveEdge>
      )}
      {right && (
        <LiveEdge side="right" className="flex items-center gap-2">
          {g.showGpu && (
            <GamingStat
              label="GPU"
              value={stats?.gpu ?? null}
              temp={g.showTemps ? (stats?.gpuTemp ?? null) : null}
              kind={g.style}
              data={history.gpu}
            />
          )}
          {g.showGpu && g.showRam && <span aria-hidden className="h-3 w-px shrink-0 self-center bg-separator" />}
          {g.showRam && <GamingStat label="RAM" value={mem} kind={g.style} data={history.mem} />}
        </LiveEdge>
      )}
      {!left && !right && <span aria-hidden className="size-1 rounded-full bg-label-3" />}
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

export function GamingStat({
  label,
  value,
  temp = null,
  kind = "text",
  preview = false,
  data = [],
}: {
  label: string;
  value: number | null;
  temp?: number | null;
  kind?: "text" | "bars" | "graph";
  preview?: boolean;
  data?: number[];
}) {
  const used = Math.max(0, Math.min(100, value ?? 0));
  const color = levelColor(used);
  const labelClass = preview ? "text-white/45" : "text-label-3";
  const valueClass = preview ? "text-white" : "text-label";
  const trackClass = preview ? "bg-white/15" : "bg-fill-3";

  if (kind === "bars") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span className={`text-caption font-medium ${labelClass}`}>{label}</span>
        <span className={`relative h-[3px] w-7 overflow-hidden rounded-full ${trackClass}`}>
          <span className="block h-full rounded-full transition-[width,background-color] duration-500 ease-out" style={{ width: `${used}%`, backgroundColor: color }} />
        </span>
        <span className={`tabular text-caption font-semibold ${valueClass}`}>{value === null ? "—" : `${Math.round(used)}%`}</span>
        <Temp temp={temp} preview={preview} />
      </span>
    );
  }

  if (kind === "graph") {
    const series = data.filter((n) => Number.isFinite(n)).slice(-16);
    const w = 42;
    const h = 10;
    const y = (v: number) => h - (Math.max(0, Math.min(100, v)) / 100) * h;
    const points = series.length < 2
      ? `0,${y(used)} ${w},${y(used)}`
      : series.map((v, i) => `${(i / (series.length - 1)) * w},${y(v)}`).join(" ");
    return (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span className={`text-caption font-medium ${labelClass}`}>{label}</span>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden>
          <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`tabular text-caption font-semibold ${valueClass}`}>{value === null ? "—" : `${Math.round(used)}%`}</span>
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
