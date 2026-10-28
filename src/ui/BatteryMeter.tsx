import { motion } from "motion/react";
import { Lightning } from "@phosphor-icons/react";
import { springs } from "../design/motion";

type Props = {
  percent: number;
  charging?: boolean;
  plugged?: boolean;
  /** Windows Battery Saver is on: yellow body. */
  saver?: boolean;
  /** `md` for the Overview header, `sm` for tight rows, `xs` for popovers. */
  size?: "xs" | "sm" | "md";
  className?: string;
};

/**
 * The white reference battery: one solid off-white capsule, the charge number
 * and a bolt inside, plus a small terminal. No outline and no percentage sign.
 *
 * Charging is white with a bolt; Battery Saver is yellow; under 20 % is red.
 */
export function BatteryMeter({ percent, charging = false, plugged = false, saver = false, size = "md", className = "" }: Props) {
  const level = Math.max(0, Math.min(100, Math.round(percent)));
  const low = level < 20;
  // Critical and saver states override the normal white body. The bolt alone
  // communicates charging; a plugged-in full battery stays white.
  const body = low ? "var(--color-red)" : saver ? "var(--color-yellow)" : "#f4f4f6";
  const ink = "#26262a";
  const md = size === "md";
  const xs = size === "xs";
  const width = xs ? 22 : md ? 28 : 24;
  const height = xs ? 12 : md ? 15 : 13;
  const radius = xs ? 4 : md ? 5 : 4;
  const tipW = xs ? 1.5 : 2;
  const tipH = xs ? 4.5 : md ? 5.5 : 5;
  const fontSize = xs ? 7.25 : md ? 9 : 7.5;
  const bolt = xs ? 6 : md ? 7.5 : 6;
  const glow = low
    ? "0 0 9px rgb(255 69 58 / 0.28)"
    : saver
      ? "0 0 9px rgb(255 214 10 / 0.26)"
      : charging
        ? "0 0 11px rgb(255 255 255 / 0.2), 0 1px 2px rgb(0 0 0 / 0.22)"
        : "0 0 10px rgb(255 255 255 / 0.16), 0 1px 2px rgb(0 0 0 / 0.22)";

  return (
    <span
      className={`inline-flex shrink-0 items-center ${className}`}
      aria-label={`Battery ${level}%${charging ? " · charging" : ""}${saver ? " · Battery Saver" : ""}${plugged ? " · plugged in" : ""}`}
    >
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
          style={{ gap: xs ? 1 : md ? 1.2 : 1, fontSize, color: ink }}
        >
          <motion.span
            key={level}
            initial={{ opacity: 0.7, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1, transition: springs.snappy }}
          >
            {level}
          </motion.span>
          {charging && (
            <motion.span
              className="flex"
              animate={{ scale: [1, 1.16, 1], opacity: [0.82, 1, 0.82] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <Lightning size={bolt} weight="fill" />
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
