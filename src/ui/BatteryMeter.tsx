import { motion } from "motion/react";
import { Lightning } from "@phosphor-icons/react";
import { springs } from "../design/motion";

type Props = {
  percent: number;
  charging?: boolean;
  plugged?: boolean;
  /** Windows Battery Saver is on: yellow body. */
  saver?: boolean;
  /** `md` for the Overview header, `xs` for the Power strip. */
  size?: "xs" | "md";
};

/**
 * The white reference battery: one solid off-white capsule, the charge number
 * and a bolt inside, plus a small terminal. No outline and no percentage sign.
 *
 * A connected charger shows the bolt; unplugged has no bolt. Battery Saver is
 * yellow; under 20 % is red.
 */
export function BatteryMeter({ percent, charging = false, plugged = false, saver = false, size = "md" }: Props) {
  const level = Math.max(0, Math.min(100, Math.round(percent)));
  const low = level < 20;
  // Lenovo conservation mode keeps the battery below 100 % and often leaves
  // Windows' charging flag off while the charger is connected. The cable is the
  // reliable signal for the bolt: connected = bolt, unplugged = no bolt.
  const powered = charging || plugged;
  // Critical and saver states override the normal white body. The bolt alone
  // communicates charging; a plugged-in full battery stays white.
  const body = low ? "var(--color-red)" : saver ? "var(--color-yellow)" : "#f4f4f6";
  const ink = "#26262a";
  const md = size === "md";
  const width = md ? 28 : 22;
  const height = md ? 15 : 12;
  const radius = md ? 5 : 4;
  const tipW = md ? 2 : 1.5;
  const tipH = md ? 5.5 : 4.5;
  // The number is the point of the capsule: let it fill the height like the
  // reference. Three digits need a small step down or they touch the bolt.
  const tighten = level >= 100 ? 0.74 : 1;
  const fontSize = (md ? 12.5 : 9.5) * tighten;
  const bolt = (md ? 8 : 6.5) * tighten;
  const glow = low
    ? "0 0 9px rgb(255 69 58 / 0.28)"
    : saver
      ? "0 0 9px rgb(255 214 10 / 0.26)"
      : powered
        ? "0 0 11px rgb(255 255 255 / 0.2), 0 1px 2px rgb(0 0 0 / 0.22)"
        : "0 0 10px rgb(255 255 255 / 0.16), 0 1px 2px rgb(0 0 0 / 0.22)";

  return (
    <span
      className="inline-flex shrink-0 items-center"
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
          style={{ gap: md ? 0.6 : 0.5, fontSize, color: ink, letterSpacing: md ? "-0.02em" : "-0.03em" }}
        >
          <motion.span
            key={level}
            initial={{ opacity: 0.7, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1, transition: springs.snappy }}
          >
            {level}
          </motion.span>
          {powered && (
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
