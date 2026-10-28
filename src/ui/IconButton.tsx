import type { ReactNode } from "react";
import { motion } from "motion/react";
import { springs } from "../design/motion";

type Size = "xs" | "sm" | "md";

const box: Record<Size, string> = {
  xs: "size-7",
  sm: "size-8",
  md: "size-9",
};

/**
 * SF Symbols-style control: 12px continuous corners, 7–10% neutral fill,
 * 1px border, accent-tinted active state, 0.95 press / 1.04 hover.
 * The negative-inset pseudo element extends the hit target past the visual box.
 */
export function IconButton({
  label,
  onClick,
  active = false,
  disabled = false,
  size = "sm",
  badge = false,
  children,
  className = "",
  title,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: Size;
  badge?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.95 }}
      whileHover={{ scale: 1.04 }}
      transition={springs.press}
      className={`pressable relative flex shrink-0 select-none items-center justify-center rounded-[12px] border outline-none after:absolute after:-inset-1 after:content-[''] focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-30 ${
        box[size]
      } ${
        active
          ? "border-accent/30 bg-accent/15 text-accent"
          : "border-[var(--control-border)] bg-[var(--control-fill)] text-label-2 hover:border-[var(--control-border-strong)] hover:bg-[var(--control-fill-hover)] hover:text-label"
      } ${className}`}
    >
      {children}
      {badge && (
        <span
          aria-hidden
          className="absolute top-1 right-1 size-[7px] rounded-full bg-link ring-2 ring-notch"
        />
      )}
    </motion.button>
  );
}
