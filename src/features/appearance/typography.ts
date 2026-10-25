import type { Settings, TypeRole } from "../../settings/store";

/** Built-in scale. The settings store deltas on top of this; 0 means "use this". */
export const TYPE_BASE: Record<TypeRole, { size: number; line: number; weight: number }> = {
  caption: { size: 12, line: 15, weight: 500 },
  footnote: { size: 13, line: 17, weight: 450 },
  body: { size: 14, line: 19, weight: 450 },
  title: { size: 16, line: 21, weight: 650 },
  display: { size: 24, line: 28, weight: 700 },
};

export const TYPE_ROLES: { value: TypeRole; label: string; className: string; sample: string }[] = [
  { value: "caption", label: "Caption", className: "text-caption", sample: "Caption · small labels and metadata" },
  { value: "footnote", label: "Footnote", className: "text-footnote", sample: "Footnote · timestamps and secondary text" },
  { value: "body", label: "Body", className: "text-body", sample: "Body · normal text used across the notch." },
  { value: "title", label: "Title", className: "text-title", sample: "Title · headings and card names" },
  { value: "display", label: "Display", className: "text-display", sample: "Display · the biggest headline" },
];

export function typeValues(role: TypeRole, axis: { size: number; weight: number }) {
  const base = TYPE_BASE[role];
  return {
    size: Math.max(8, base.size + axis.size),
    weight: Math.max(100, Math.min(900, base.weight + axis.weight)),
  };
}

/** Writes the role scale into the CSS variables Tailwind's text-* classes use. */
export function applyTypography(typo: Settings["typography"]) {
  const style = document.documentElement.style;
  for (const { value: role } of TYPE_ROLES) {
    const base = TYPE_BASE[role];
    const axis = typo[role] ?? { size: 0, weight: 0 };
    const size = Math.max(8, base.size + axis.size);
    const line = Math.max(10, base.line + axis.size);
    const weight = Math.max(100, Math.min(900, base.weight + axis.weight));
    style.setProperty(`--text-${role}`, `${size}px`);
    style.setProperty(`--text-${role}--line-height`, `${line}px`);
    style.setProperty(`--text-${role}--font-weight`, `${weight}`);
  }
}
