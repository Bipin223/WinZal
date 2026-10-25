import { createStore } from "../lib/store";

/**
 * Measured width of the closed clock row (face + PM + date/weather), in CSS px.
 * 0 = not mounted/measured. The closed notch uses this instead of a fixed base
 * width, so each clock face can grow or shrink the pill to fit.
 */
export const clockMeasured = createStore(0);
