import { createStore } from "../lib/store";

/**
 * A tiny one-way command store for UI elements outside the notch (for example
 * dragging a notification down) that need the notch to open.
 */
export const notchOpenRequest = createStore(0);

export function requestNotchOpen() {
  notchOpenRequest.set((n) => n + 1);
}
