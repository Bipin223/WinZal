import { settings } from "../settings/store";

/**
 * Clock text with the first digit tinted (OnePlus-style). The colour is set in
 * Settings → Appearance; red is the default. The tint moves with the leading digit
 * as the hour changes (9:57 → 9 red, 10:57 → 1 red).
 *
 * In the closed notch the whole hour is emphasised so "11" reads as one bold
 * unit instead of a big leading 1 and a smaller trailing 1.
 */
export function ClockTime({ time, className, emphasizeHour = false }: { time: string; className?: string; emphasizeHour?: boolean }) {
  const accent = settings.use().appearance.clockAccent;
  const colon = time.indexOf(":");
  const hourEnd = colon > 0 ? colon : Math.min(2, time.length);
  const first = time.slice(0, 1);
  const restHour = time.slice(1, hourEnd);
  const rest = time.slice(hourEnd);
  return (
    <span className={className}>
      <span
        style={
          emphasizeHour
            ? {
                fontSize: "1.12em",
                fontWeight: 900,
                lineHeight: 1,
                // Keep the enlarged hour clear of the colon.
                marginRight: "0.04em",
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
