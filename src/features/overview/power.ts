import { createStore } from "../../lib/store";

/** Bumped when the power flyout changes the mode, so the tile refreshes now. */
export const powerRevision = createStore(0);

export function bumpPowerMode() {
  powerRevision.set((n) => n + 1);
}
