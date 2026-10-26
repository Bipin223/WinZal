/**
 * Personal build: Classic and Split only. The other faces stay in the code as
 * planned resources, but are not exposed in this build.
 */
export type ClockStyle = "stacked" | "split" | "scatter" | "classic" | "word";

export const CLOCK_STYLES: { id: ClockStyle; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "split", label: "Split" },
];

export function isClockStyle(value: unknown): value is ClockStyle {
  return CLOCK_STYLES.some((style) => style.id === value);
}
