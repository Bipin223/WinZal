import { settings } from "../settings/store";

/**
 * Clock text with the first digit tinted (OnePlus-style). The colour is set in
 * Settings → Appearance; red is the default. The tint moves with the leading digit
 * as the hour changes (9:57 → 9 red, 10:57 → 1 red).
 */
export function ClockTime({ time, className }: { time: string; className?: string }) {
  const accent = settings.use().appearance.clockAccent;
  const first = time.slice(0, 1);
  const rest = time.slice(1);
  return (
    <span className={className}>
      <span style={{ color: accent, fontWeight: 800 }}>{first}</span>
      {rest}
    </span>
  );
}
