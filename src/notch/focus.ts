import { createStore } from "../lib/store";
import { onFocusFromTray, syncFocusTray } from "../platform/native";
import { systemControls } from "../platform/services";

/*
 * Focus is Windows' system-wide Do Not Disturb switch, not a click-through
 * notch style. The header button, Settings switch, Overview tile and tray all
 * write the same Windows state through the Rust focus_get/focus_set commands.
 */
export const focusMode = createStore(false);
export const FOCUS_CLICKS = 3;
let request = 0;

/** Read the real Windows DND state and mirror it into the UI + tray. */
export async function refreshFocusMode(): Promise<boolean> {
  try {
    const state = await systemControls.focus();
    focusMode.set(state.active);
    syncFocusTray(state.active);
    return state.active;
  } catch {
    return focusMode.get();
  }
}

export function setFocusMode(on: boolean) {
  // Optimistic so the switch responds immediately, then trust Windows' answer.
  focusMode.set(on);
  syncFocusTray(on);
  const ticket = ++request;
  void systemControls
    .setFocus(on)
    .then((state) => {
      if (ticket !== request) return;
      focusMode.set(state.active);
      syncFocusTray(state.active);
    })
    .catch(() => void refreshFocusMode());
}

let started = false;

export function startFocusMode() {
  if (started) return;
  started = true;
  void refreshFocusMode();
  onFocusFromTray((on) => setFocusMode(on));
}
