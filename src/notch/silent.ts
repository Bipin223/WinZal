import { createStore } from "../lib/store";
import { onSilentSet, onSilentToggle, traySilent } from "../platform/native";

/**
 * Silent mode: the notch becomes a translucent ghost and ignores the mouse.
 * Persisted so it survives restarts; three quick clicks (or the shortcut) wake it.
 */
export const silentMode = createStore(false, { persist: "silent" });

export function setSilentMode(on: boolean) {
  silentMode.set(on);
}

/** Global Ctrl+Alt+S and the tray item. */
export function startSilentMode() {
  onSilentToggle(() => setSilentMode(!silentMode.get()));
  onSilentSet((on) => setSilentMode(on));
  silentMode.subscribe(() => traySilent(silentMode.get()));
  traySilent(silentMode.get());
}
