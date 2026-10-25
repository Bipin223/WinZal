/** The five clock faces. `classic` is the existing clock and the default. */
export type ClockStyle = "stacked" | "split" | "scatter" | "classic" | "word";

export const CLOCK_STYLES: { id: ClockStyle; label: string }[] = [
  { id: "stacked", label: "Stacked" },
  { id: "split", label: "Split" },
  { id: "scatter", label: "Scatter" },
  { id: "classic", label: "Classic" },
  { id: "word", label: "Word" },
];

export function isClockStyle(value: unknown): value is ClockStyle {
  return CLOCK_STYLES.some((style) => style.id === value);
}
