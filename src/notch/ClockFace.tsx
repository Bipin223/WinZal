import type { ReactNode } from "react";
import { settings } from "../settings/store";
import { formatTemp, formatTimeParts } from "../lib/format";
import { locale } from "../i18n";
import { describe, useForecast } from "../features/weather/store";
import { ClockTime } from "./ClockTime";
import type { ClockStyle } from "./clockStyles";

/**
 * The clock faces shown in the expanded Clock tool and, in a compact form, in
 * the closed pill.
 *
 * `scale` is the only size knob: all inner sizes are in `em`, so the same face
 * can be a 480 px hero, a 320 px settings preview or a 40 px picker thumbnail.
 */
export function ClockFace({
  style,
  now,
  seconds,
  scale = 1,
  footer,
  className = "",
}: {
  style: ClockStyle;
  now: Date;
  /** Only used by Scatter, which has a seconds digit. */
  seconds?: number;
  scale?: number;
  footer?: ReactNode;
  className?: string;
}) {
  const a = settings.use().appearance;
  const { time, period } = formatTimeParts(now);
  const [hour, minute] = time.split(":");
  const hh = (hour ?? "0").padStart(2, "0");
  const mm = (minute ?? "00").padStart(2, "0");
  const ss = String(seconds ?? now.getSeconds()).padStart(2, "0");
  const compact = scale < 0.4;
  const accent = a.clockAccent;

  return (
    <div
      className={`relative h-full w-full ${className}`}
      style={{
        fontSize: `${16 * scale}px`,
        fontWeight: a.clockOpenWeight,
        letterSpacing: "-0.01em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {style === "stacked" && (
        <div className="flex h-full items-end justify-between gap-[0.8em] px-[1.1em] py-[0.7em]">
          <div style={{ lineHeight: 0.8, letterSpacing: "-0.06em" }}>
            <div style={{ fontSize: compact ? "4em" : "5.2em" }}>
              <ClockTime time={hh} weight={a.clockOpenWeight} emphasizeHour={a.clockEmphasis} />
            </div>
            <div style={{ fontSize: compact ? "4em" : "5.2em" }}>
              <ClockTime time={mm} weight={a.clockOpenWeight} tint={false} />
            </div>
          </div>
          <div className="flex flex-col items-end gap-[0.35em] pb-[0.2em] text-label-3" style={{ fontSize: "0.75em" }}>
            {a.clockShowPeriod && period && <span className="font-semibold">{period}</span>}
            {footer}
          </div>
        </div>
      )}

      {style === "split" && (
        <div className="flex h-full items-center gap-[0.7em] px-[1.1em]">
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <span className="flex items-center" style={{ fontSize: compact ? "3.2em" : "5.4em", lineHeight: 0.85 }}>
              <ClockTime time={hour ?? "0"} weight={a.clockOpenWeight} emphasizeHour={a.clockEmphasis} />
              <span
                aria-hidden
                className="mx-[0.3em] w-[0.07em] shrink-0 rounded-full bg-label-3"
                style={{ height: `${a.clockSplitHeight / 100}em` }}
              />
              <ClockTime time={minute ?? "00"} weight={a.clockOpenWeight} tint={false} />
            </span>
          </div>
          {!compact && (
            <div className="flex h-full shrink-0 flex-col items-end justify-center gap-[0.9em]">
              {a.clockShowPeriod && period && (
                <span style={{ color: a.clockAccentFirstDigit ? accent : "var(--color-label-3)", fontSize: "1.05em", fontWeight: 800, lineHeight: 1 }}>{period}</span>
              )}
              <span className="tabular text-label-3" style={{ fontSize: "0.95em", lineHeight: 1 }}>{ss}</span>
            </div>
          )}
        </div>
      )}

      {style === "scatter" && (
        <div className="relative h-full w-full">
          <svg
            aria-hidden
            className="absolute inset-0 h-full w-full text-label-4"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <path
              d={compact ? "M16 48 L80 62" : "M16 33 L78 77"}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={compact ? 80 : 78} cy={compact ? 62 : 77} r="1.5" fill={a.clockAccentFirstDigit ? accent : "currentColor"} />
          </svg>
          <span
            className="absolute"
            style={{ left: compact ? "8%" : "9%", top: compact ? "27%" : "16%", fontSize: compact ? "2.3em" : "3.4em" }}
          >
            <ClockTime time={hh} weight={a.clockOpenWeight} emphasizeHour={a.clockEmphasis} />
          </span>
          <span
            className="absolute"
            style={{ left: compact ? "42%" : "43%", top: compact ? "40%" : "45%", fontSize: compact ? "2.1em" : "3em" }}
          >
            <ClockTime time={mm} weight={a.clockOpenWeight} tint={false} />
          </span>
          <span
            className="absolute text-label-3"
            style={{ right: "8%", top: compact ? "27%" : "16%", fontSize: compact ? "1.2em" : "1.8em" }}
          >
            {ss}
          </span>
          <div
            className="absolute bottom-[8%] left-[9%] flex items-center gap-[0.5em] text-label-3"
            style={{ fontSize: "0.75em" }}
          >
            {a.clockShowPeriod && period && <span className="font-semibold">{period}</span>}
            {footer}
          </div>
        </div>
      )}

      {style === "classic" && (
        <div className="flex h-full flex-col items-center justify-center gap-[0.45em] px-[1em]">
          <div style={{ fontSize: compact ? "3.6em" : "4.8em", letterSpacing: "-0.035em", lineHeight: 1 }}>
            <ClockTime time={time} weight={a.clockOpenWeight} emphasizeHour={a.clockEmphasis} />
            {a.clockShowPeriod && period && (
              <span className="ml-[0.18em] align-top text-label-3" style={{ fontSize: "0.24em", letterSpacing: "0.02em" }}>
                {period}
              </span>
            )}
          </div>
          {footer && (
            <div className="text-label-3" style={{ fontSize: "0.8em" }}>
              {footer}
            </div>
          )}
        </div>
      )}

      {style === "word" && (
        <div className="flex h-full flex-col items-center justify-center gap-[0.5em] px-[1.2em] text-center">
          <div style={{ fontSize: compact ? "2.15em" : "2.55em", letterSpacing: "-0.04em", lineHeight: 1.05 }}>
            <WordTime now={now} accent={a.clockAccentFirstDigit ? accent : undefined} />
            {a.clockShowPeriod && period && (
              <span className="ml-[0.35em] align-top text-label-3" style={{ fontSize: "0.34em", letterSpacing: "0.02em" }}>
                {period}
              </span>
            )}
          </div>
          {footer && (
            <div className="text-label-3" style={{ fontSize: "0.75em" }}>
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Date + weather line shared by the big faces and the closed pill. */
export function ClockMeta({
  now,
  compact = false,
  forceDate = false,
}: {
  now: Date;
  compact?: boolean;
  /** Expanded faces always carry the date, even when the closed-pill extras are off. */
  forceDate?: boolean;
}) {
  const a = settings.use().appearance;
  const forecast = useForecast();
  const weekday = now.toLocaleDateString(locale(), { weekday: "short" });
  const date = now.toLocaleDateString(locale(), { day: "numeric", month: "short" });
  const pieces = forceDate
    ? `${weekday} · ${date}`
    : [a.clockShowDay ? weekday : null, a.clockShowDate ? date : null].filter(Boolean).join(" · ");
  const weather = a.clockShowWeather && forecast && forecast !== "error" ? describe(forecast.current.code, forecast.current.day) : null;
  if (!pieces && !weather) return null;
  return (
    <span className="inline-flex items-baseline gap-[0.4em] whitespace-nowrap">
      {pieces && <span>{pieces}</span>}
      {weather && forecast && forecast !== "error" && (
        <span className="inline-flex items-baseline gap-[0.2em]">
          <weather.icon size={compact ? 10 : 13} weight="fill" className="self-center" />
          {formatTemp(forecast.current.temp)}
        </span>
      )}
    </span>
  );
}

/** Compact face for the 30 px closed pill. */
export function CompactClock({
  style,
  now,
  size,
  height,
  weight: customWeight,
  seconds,
  showSeconds = false,
}: {
  style: ClockStyle;
  now: Date;
  size: number;
  height: number;
  /** Defaults to the closed-pill weight; the Overview passes the open weight. */
  weight?: number;
  seconds?: number;
  /** Split/Scatter live seconds, used by the expanded Overview. */
  showSeconds?: boolean;
}) {
  const a = settings.use().appearance;
  const { time } = formatTimeParts(now);
  const [hour, minute] = time.split(":");
  const hh = (hour ?? "0").padStart(2, "0");
  const mm = (minute ?? "00").padStart(2, "0");
  const ss = String(seconds ?? now.getSeconds()).padStart(2, "0");
  const weight = customWeight ?? a.clockClosedWeight;

  if (style === "stacked") {
    // Two lines must fit the pill; 0.82 line-height leaves a hair of breathing room.
    const fs = Math.max(6, Math.min(size, (height - 4) / 2));
    return (
      <span className="flex flex-col leading-[0.82] tracking-[-0.05em]" style={{ fontWeight: weight, fontSize: fs }}>
        <ClockTime time={hh} weight={weight} emphasizeHour={a.clockEmphasis} />
        <ClockTime time={mm} weight={weight} tint={false} />
      </span>
    );
  }

  if (style === "split") {
    const fs = size * 0.9;
    return (
      <span className="flex min-w-0 items-center" style={{ fontSize: fs, lineHeight: 1, fontWeight: weight }}>
        <ClockTime time={hour ?? "0"} weight={weight} emphasizeHour={a.clockEmphasis} />
        <span
          aria-hidden
          className="mx-[0.22em] w-[0.06em] shrink-0 rounded-full bg-label-3"
          style={{ height: `${a.clockSplitHeight / 100}em` }}
        />
        <ClockTime time={minute ?? "00"} weight={weight} tint={false} />
        {showSeconds && (
          <span className="ml-[0.28em] self-end text-label-3" style={{ fontSize: "0.42em", lineHeight: 1 }}>
            {ss}
          </span>
        )}
      </span>
    );
  }

  if (style === "scatter") {
    const fs = size * 0.9;
    return (
      <span className="relative flex items-center gap-[0.22em]" style={{ height, fontWeight: weight }}>
        <svg aria-hidden className="absolute inset-0 h-full w-full text-label-4" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M8 70 L92 32" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <circle cx="92" cy="32" r="1.6" fill={a.clockAccentFirstDigit ? a.clockAccent : "currentColor"} />
        </svg>
        <span style={{ fontSize: fs }}>
          <ClockTime time={hh} weight={weight} emphasizeHour={a.clockEmphasis} />
        </span>
        <span style={{ fontSize: fs * 0.86 }}>
          <ClockTime time={mm} weight={weight} tint={false} />
        </span>
        {showSeconds && (
          <span className="ml-[0.12em] self-end text-label-3" style={{ fontSize: "0.42em", lineHeight: 1 }}>
            {ss}
          </span>
        )}
      </span>
    );
  }

  if (style === "word") {
    const word = wordsFor(now);
    // Each face gets its own closed-pill budget. Word is longest, so it shrinks
    // further and ellipsizes inside the face slot instead of covering PM.
    const fs = Math.max(7, Math.min(size * 0.62, (size * 11) / Math.max(10, word.length)));
    return (
      <span
        className="block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap tracking-[-0.03em]"
        style={{ fontSize: fs, fontWeight: weight, lineHeight: 1 }}
      >
        <WordTime now={now} accent={a.clockAccentFirstDigit ? a.clockAccent : undefined} />
      </span>
    );
  }

  return (
    <span className="tabular" style={{ fontSize: size }}>
      <ClockTime time={time} weight={weight} emphasizeHour={a.clockEmphasis} />
    </span>
  );
}

/* ------------------------------------------------------------------------- */

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"];

function underHundred(n: number, camel = false): string {
  if (n < 10) return ONES[n] || "zero";
  if (n < 20) return TEENS[n - 10];
  const one = ONES[n % 10];
  return TENS[Math.floor(n / 10)] + (one ? (camel ? one[0].toUpperCase() + one.slice(1) : one) : "");
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** 19:09 → "sevenOhnine" (12 h) or "nineteenOhnine" (24 h). */
function wordsFor(now: Date): string {
  const h24 = now.getHours();
  const twelve = settings.get().units.clock === "12";
  const hour = twelve ? h24 % 12 || 12 : h24;
  const minute = now.getMinutes();
  const hourWord = underHundred(hour, true);
  if (minute === 0) return hourWord + "Oclock";
  if (minute < 10) return hourWord + "Oh" + ONES[minute];
  return hourWord + capitalize(underHundred(minute));
}

function WordTime({ now, accent }: { now: Date; accent?: string }) {
  const word = wordsFor(now);
  return (
    <>
      <span style={accent ? { color: accent } : undefined}>{word.charAt(0)}</span>
      {word.slice(1)}
    </>
  );
}
