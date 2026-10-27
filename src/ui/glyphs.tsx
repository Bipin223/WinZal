import { motion } from "motion/react";
import type { IconWeight } from "@phosphor-icons/react";

type Props = { size?: number; weight?: IconWeight; className?: string };

// Concentric arcs centred on the dot, so the gaps stay even all the way around.
const WIFI_ARCS = [
  "M3.3 11.7A11.4 11.4 0 0 1 20.7 11.7",
  "M7.1 14.9A6.4 6.4 0 0 1 16.9 14.9",
];

/** Two bold concentric arcs + dot. */
export function WifiOnIcon({ size = 22, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      className={className}
    >
      {WIFI_ARCS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <circle cx="12" cy="18.8" r="1.95" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WifiOffIcon({ size = 22, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      className={className}
    >
      {WIFI_ARCS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <circle cx="12" cy="18.8" r="1.95" fill="currentColor" stroke="none" />
      {/* Cut a clean gap around the slash, iPhone-style. */}
      <path d="M4.5 4.5 19.5 19.5" stroke="var(--color-notch)" strokeWidth={6.8} />
      <path d="M4.5 4.5 19.5 19.5" stroke="currentColor" />
    </svg>
  );
}

const BT_RUNE = [
  "M12 2.5V21.5",
  "M12 2.5 19 7.5 5 16.5",
  "M12 21.5 19 16.5 5 7.5",
];

/** Bold Bluetooth rune, black/white only. */
export function BluetoothOnIcon({ size = 22, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {BT_RUNE.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function BluetoothOffIcon({ size = 22, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {BT_RUNE.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path d="M4.5 4.5 19.5 19.5" stroke="var(--color-notch)" strokeWidth={7} />
      <path d="M4.5 4.5 19.5 19.5" stroke="currentColor" />
    </svg>
  );
}

/** Solid charging battery: no outline, bold fill for the Overview header. */
export function BatterySolidIcon({ size = 20, className, level = 0.82 }: Props & { level?: number }) {
  const width = 16.2 * Math.max(0, Math.min(1, level));
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2.1" y="6.6" width="17.8" height="10.8" rx="3.2" fill="currentColor" opacity="0.2" />
      <motion.rect
        x="3.5"
        y="8"
        height="8"
        rx="2"
        fill="currentColor"
        initial={{ width: 0 }}
        animate={{ width }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
      />
      <rect x="20.4" y="9.8" width="1.8" height="4.4" rx="0.9" fill="currentColor" />
    </svg>
  );
}

/** iPhone-style battery: pure black/white, fill level tells the power mode. */
export function BatteryIcon({ size = 17, className, level = 0.82 }: Props & { level?: number }) {
  const inner = 13.4 * Math.max(0, Math.min(1, level));
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2.4" y="7.2" width="16.8" height="9.6" rx="2.7" stroke="currentColor" strokeWidth={2.4} />
      <rect x="19.6" y="10.1" width="2" height="3.8" rx="0.9" fill="currentColor" />
      <motion.rect
        x="4.1"
        y="8.9"
        height="6.2"
        rx="1.4"
        fill="currentColor"
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: inner, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
      />
    </svg>
  );
}
