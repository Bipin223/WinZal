import type { Icon } from "@phosphor-icons/react";

export type IconTone = "accent" | "label" | "label-2" | "label-3";

const toneClass: Record<IconTone, string> = {
  accent: "text-accent",
  label: "text-label",
  "label-2": "text-label-2",
  "label-3": "text-label-3",
};

/**
 * SF Symbols Bold feel: one optical weight for every icon, filled when active.
 * Size is the rendered box; 20–22 is the notch default.
 */
export function BoldIcon({
  icon: IconComponent,
  size = 20,
  active = false,
  tone = "label-2",
  className = "",
  label,
}: {
  icon: Icon;
  size?: number;
  active?: boolean;
  tone?: IconTone;
  className?: string;
  label?: string;
}) {
  return (
    <IconComponent
      size={size}
      weight={active ? "fill" : "bold"}
      className={`${toneClass[tone]} ${className}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    />
  );
}
