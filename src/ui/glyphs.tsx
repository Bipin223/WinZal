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

/** The idle media disc: outer ring, center dot and two grooves. */
export function IdleRecordIcon({ size = 24, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth={1.9} />
      <circle cx="12" cy="12" r="2.15" fill="currentColor" />
      <path
        d="M8.5 8.2a5.4 5.4 0 0 0 0 7.6M15.5 8.2a5.4 5.4 0 0 1 0 7.6"
        stroke="currentColor"
        strokeWidth={2.1}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** iPhone-style battery: pure black/white, fill level tells the power mode. */
export function BatteryIcon({
  size = 17,
  className,
  level = 0.82,
  variant = "outline",
}: Props & { level?: number; variant?: "outline" | "capsule" }) {
  const filled = Math.max(0, Math.min(1, level));

  if (variant === "capsule") {
    return (
      <svg
        width={size}
        height={(size * 14) / 26}
        viewBox="0 0 26 14"
        fill="none"
        className={className}
      >
        <rect x="1" y="2.2" width="21.9" height="9.6" rx="4.8" fill="currentColor" opacity={0.2} />
        <motion.rect
          x="1"
          y="2.2"
          height="9.6"
          rx="4.8"
          fill="currentColor"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 21.9 * filled, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
        />
        <rect x="23.4" y="5" width="1.6" height="4" rx="0.8" fill="currentColor" opacity={0.55} />
      </svg>
    );
  }

  const inner = 13.4 * filled;
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
