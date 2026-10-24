import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../i18n";

/** Small, dependency-free HSV color field used by the Appearance page. */
export function ColorPickerPanel({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value.toUpperCase());
  const hsvRef = useRef(hsv);
  const onChangeRef = useRef(onChange);
  const sv = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const drag = useRef<"sv" | "hue" | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const apply = (next: { h: number; s: number; v: number }) => {
      hsvRef.current = next;
      setHsv(next);
      onChangeRef.current(hsvToHex(next));
    };
    const move = (event: PointerEvent) => {
      if (drag.current === "sv") {
        const rect = sv.current?.getBoundingClientRect();
        if (!rect) return;
        const s = clamp((event.clientX - rect.left) / rect.width);
        const v = 1 - clamp((event.clientY - rect.top) / rect.height);
        apply({ ...hsvRef.current, s, v });
      } else if (drag.current === "hue") {
        const rect = hue.current?.getBoundingClientRect();
        if (!rect) return;
        const h = clamp((event.clientX - rect.left) / rect.width) * 360;
        apply({ ...hsvRef.current, h });
      }
    };
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  useEffect(() => {
    const next = hexToHsv(value);
    if (hsvToHex(hsvRef.current).toLowerCase() !== normalize(value)) {
      hsvRef.current = next;
      setHsv(next);
    }
    setHexText(value.toUpperCase());
  }, [value]);

  const start = (target: "sv" | "hue") => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = target;
    const rect = (target === "sv" ? sv : hue).current?.getBoundingClientRect();
    if (!rect) return;
    if (target === "sv") {
      const s = clamp((event.clientX - rect.left) / rect.width);
      const v = 1 - clamp((event.clientY - rect.top) / rect.height);
      const next = { ...hsvRef.current, s, v };
      hsvRef.current = next;
      setHsv(next);
      onChangeRef.current(hsvToHex(next));
    } else {
      const h = clamp((event.clientX - rect.left) / rect.width) * 360;
      const next = { ...hsvRef.current, h };
      hsvRef.current = next;
      setHsv(next);
      onChangeRef.current(hsvToHex(next));
    }
  };
  const rgb = hexToRgb(value);
  const setRgb = (channel: "r" | "g" | "b", raw: string) => {
    const number = Math.max(0, Math.min(255, Number(raw) || 0));
    const next = { ...rgb, [channel]: number };
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  return (
    <div className="mt-2 rounded-[12px] bg-fill-2 p-2.5 ring-1 ring-separator">
      <div
        ref={sv}
        role="slider"
        aria-label={t("Saturation and brightness")}
        aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
        tabIndex={0}
        onPointerDown={start("sv")}
        className="relative h-[128px] w-full cursor-crosshair touch-none overflow-hidden rounded-[10px] ring-1 ring-white/10"
        style={{
          backgroundColor: `hsl(${hsv.h} 100% 50%)`,
          backgroundImage:
            "linear-gradient(to top, #000, rgb(0 0 0 / 0)), linear-gradient(to right, #fff, rgb(255 255 255 / 0))",
        }}
      >
        <span
          aria-hidden
          className="absolute size-[17px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_6px_rgb(0_0_0/0.6)]"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: value,
          }}
        />
      </div>

      <div
        ref={hue}
        role="slider"
        aria-label={t("Hue")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        onPointerDown={start("hue")}
        className="relative mt-2.5 h-3 w-full cursor-pointer touch-none rounded-full ring-1 ring-black/10"
        style={{
          background:
            "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
        }}
      >
        <span
          aria-hidden
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_5px_rgb(0_0_0/0.65)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span aria-hidden className="size-7 shrink-0 rounded-[8px] ring-1 ring-separator" style={{ backgroundColor: value }} />
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[7px] bg-fill-1 px-2 text-[10px] font-medium text-label-3">
          HEX
          <input
            value={hexText}
            onChange={(event) => {
              const text = event.target.value.toUpperCase().replace(/[^0-9A-F#]/g, "").slice(0, 7);
              setHexText(text);
              if (/^#[0-9A-F]{6}$/.test(text)) onChange(text.toLowerCase());
            }}
            onBlur={() => setHexText(value.toUpperCase())}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-caption font-semibold text-label tabular outline-none"
            aria-label={t("Hex color")}
          />
        </label>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {(["r", "g", "b"] as const).map((channel) => (
          <label key={channel} className="flex items-center gap-1 rounded-[7px] bg-fill-1 px-1.5 py-1 text-[9px] font-semibold text-label-3 uppercase">
            <input
              value={rgb[channel]}
              onChange={(event) => setRgb(channel, event.target.value)}
              inputMode="numeric"
              aria-label={channel.toUpperCase()}
              className="min-w-0 flex-1 bg-transparent text-right text-[10px] font-semibold text-label tabular outline-none"
            />
            {channel}
          </label>
        ))}
      </div>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalize(hex: string): string {
  const value = hex.replace("#", "");
  return value.length === 6 ? `#${value.toLowerCase()}` : "#000000";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = normalize(hex).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex);
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rr) h = ((gg - bb) / delta) % 6;
    else if (max === gg) h = (bb - rr) / delta + 2;
    else h = (rr - gg) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }: { h: number; s: number; v: number }): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}
