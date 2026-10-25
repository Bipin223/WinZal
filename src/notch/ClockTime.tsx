import { settings } from "../settings/store";

/**
 * Clock text with the first digit tinted (OnePlus-style). The colour is set in
 * Settings → Notch; red is the default. The tint moves with the leading digit
 * as the hour changes (9:57 → 9 red, 10:57 → 1 red).
 *
 * The hour can be a little heavier (never larger) so "11" reads as one unit.
 * Weights above 900 are rendered with a subtle stroke, since Inter stops at 900.
 */
export function ClockTime({
  time,
  className,
  emphasizeHour = false,
  weight,
}: {
  time: string;
  className?: string;
  emphasizeHour?: boolean;
  weight?: number;
}) {
  const accent = settings.use().appearance.clockAccent;
  const colon = time.indexOf(":");
  const hourEnd = colon > 0 ? colon : Math.min(2, time.length);
  const first = time.slice(0, 1);
  const restHour = time.slice(1, hourEnd);
  const rest = time.slice(hourEnd);
  const stroke = weight !== undefined && weight > 900 ? ((weight - 900) / 100) * 0.3 : 0;
  return (
    <span
      className={className}
      style={{
        fontWeight: weight !== undefined ? Math.min(900, weight) : undefined,
        WebkitTextStroke: stroke > 0 ? `${stroke}px currentColor` : undefined,
      }}
    >
      <span
        style={
          emphasizeHour
            ? {
                fontWeight: Math.min(900, (weight ?? 700) + 200),
                lineHeight: 1,
              }
            : undefined
        }
      >
        <span style={{ color: accent }}>{first}</span>
        {restHour}
      </span>
      {rest}
    </span>
  );
}
