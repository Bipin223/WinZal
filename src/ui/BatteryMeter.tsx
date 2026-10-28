import { motion } from "motion/react";
import { Lightning } from "@phosphor-icons/react";
import { springs } from "../design/motion";

type Props = {
  percent: number;
  charging?: boolean;
  plugged?: boolean;
  /** `md` for the Overview header, `sm` for tight rows. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * The white reference battery: one solid off-white capsule, the charge number
 * and a bolt inside, plus a small terminal. No outline, no fill track and no
 * percentage sign.
 *
 * White is the normal and charging look (a green halo appears while charging);
 * only low/critical states tint the body orange/red so the warning still reads
 * at a glance.
 */
export function BatteryMeter({ percent, charging = false, plugged = false, size = "md", className = "" }: Props) {
  const level = Math.max(0, Math.min(100, Math.round(percent)));
  const critical = level <= 10;
  const low = level <= 20;
  const onPower = charging || plugged;
  // Charging stays white: the bolt is the indicator. Orange/red only warn
  // when the laptop is actually running from the battery.
  const body = !onPower && critical ? "var(--color-red)" : !onPower && low ? "var(--color-orange)" : "#f4f4f6";
  const ink = "#26262a";
  const md = size === "md";
  const width = md ? 32 : 28;
  const height = md ? 17 : 14;
  const radius = md ? 5.5 : 4;
  const tipW = md ? 2.5 : 2;
  const tipH = md ? 6.5 : 5.5;
  const fontSize = md ? 10.5 : 8;
  const glow = onPower
    ? "0 0 11px rgb(255 255 255 / 0.2), 0 1px 2px rgb(0 0 0 / 0.22)"
    : critical || low
      ? `0 0 9px ${critical ? "rgb(255 69 58 / 0.28)" : "rgb(255 159 10 / 0.24)"}`
      : "0 0 10px rgb(255 255 255 / 0.16), 0 1px 2px rgb(0 0 0 / 0.22)";

  return (
    <span className={`inline-flex shrink-0 items-center ${className}`} aria-label={`Battery ${level}%`}>
      <span
        className="relative flex items-center justify-center"
        style={{
          width,
          height,
          borderRadius: radius,
          backgroundColor: body,
          boxShadow: glow,
          transition: "background-color 220ms ease, box-shadow 260ms ease",
        }}
      >
        <span
          className="flex items-center justify-center leading-none font-extrabold tabular"
          style={{ gap: md ? 1.5 : 1, fontSize, color: ink }}
        >
          <motion.span
            key={level}
            initial={{ opacity: 0.7, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1, transition: springs.snappy }}
          >
            {level}
          </motion.span>
          {onPower && (
            <motion.span
              className="flex"
              animate={{ scale: [1, 1.16, 1], opacity: [0.82, 1, 0.82] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <Lightning size={md ? 8.5 : 6} weight="fill" />
            </motion.span>
          )}
        </span>
      </span>
      <span
        aria-hidden
        className="shrink-0 rounded-r-[2px]"
        style={{ width: tipW, height: tipH, marginLeft: 1, backgroundColor: body, transition: "background-color 220ms ease" }}
      />
    </span>
  );
}
