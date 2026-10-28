import { createStore } from "../lib/store";

export type FlyoutKind = "wifi" | "bluetooth" | "sessions" | "power";

/**
 * The attached panel that is currently open beside the notch. Only one can be
 * open at a time, so its content and side live in one tiny store.
 */
export const flyout = createStore<{ kind: FlyoutKind | null; side: "left" | "right" }>({
  kind: null,
  side: "right",
});

export function openFlyout(kind: FlyoutKind) {
  flyout.set({ kind, side: kind === "wifi" ? "left" : "right" });
}

export function closeFlyout() {
  if (flyout.get().kind !== null) flyout.set({ kind: null, side: "right" });
}

/** Arrow button: one tap opens the panel, the next tap closes it. */
export function toggleFlyout(kind: FlyoutKind) {
  if (flyout.get().kind === kind) closeFlyout();
  else openFlyout(kind);
}
