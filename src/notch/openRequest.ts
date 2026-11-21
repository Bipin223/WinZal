import { createStore } from "../lib/store";

/**
 * A tiny one-way command store for UI elements outside the notch (for example
 * dragging a notification down) that need the notch to open.
 */
export const notchOpenRequest = createStore(0);

export function requestNotchOpen() {
  notchOpenRequest.set((n) => n + 1);
}

/** A tool that launches something can ask the notch to get out of the way. */
export const notchCloseRequest = createStore(0);

export function requestNotchClose() {
  notchCloseRequest.set((n) => n + 1);
}
