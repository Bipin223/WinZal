import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Is the frontend running in the Tauri app (rather than a regular browser)? */
export const isNative = "__TAURI_INTERNALS__" in window;

/**
 * Reports the hit zone in CSS px relative to the window, plus the CSS viewport
 * size, to Rust (click-through). Rust uses the viewport to map the cursor into
 * the same CSS space, so display/text scaling cannot shift the right edge.
 */
export function setHitRect(rect: { x: number; y: number; w: number; h: number; vw: number; vh: number }) {
  if (isNative) void invoke("set_hit_rect", { rect });
}

/** Keeps the window clickable even when the cursor is outside (e.g. while typing). */
export function setPinned(pinned: boolean) {
  if (isNative) void invoke("set_pinned", { pinned });
}

/** Ghost mode: click-through until three quick clicks wake the notch. */
export function setSilent(silent: boolean) {
  if (isNative) void invoke("set_silent", { silent });
}

/** Three quick clicks while silent. */
export function onSilentExit(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://silent-exit", handler);
  return () => void off.then((f) => f());
}

/**
 * Drops the notch below the Windows Hello credential prompt while it is open,
 * then restores it as always-on-top. Without this the always-on-top notch
 * covers the Hello dialog and its input field.
 */
export async function setPromptMode(active: boolean): Promise<void> {
  if (!isNative) return;
  try {
    await invoke("notch_prompt_mode", { active });
  } catch {
    // A failed z-order change must never block unlocking.
  }
}

/** Cursor over the hit zone; comes from the Rust poll instead of DOM events. */
export function onNativeHover(handler: (inside: boolean) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<boolean>("notch://hover", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

/** Window lost focus (click into another app). */
export function onNativeBlur(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = getCurrentWindow().onFocusChanged(({ payload: focused }) => !focused && handler());
  return () => void off.then((f) => f());
}

/** Global shortcut (Ctrl+Alt+Space) was pressed. */
export function onShortcut(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://shortcut", handler);
  return () => void off.then((f) => f());
}

/** Global shortcuts / tray: presentation mode. */
export function onPresentationToggle(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://presentation-toggle", handler);
  return () => void off.then((f) => f());
}

export function onPresentationSet(handler: (on: boolean) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<boolean>("notch://presentation-set", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

export function trayPresentation(on: boolean) {
  if (isNative) void invoke("tray_presentation", { on });
}

/** Keep the window out of screen captures (WDA_EXCLUDEFROMCAPTURE). */
export function setCaptureHidden(hidden: boolean) {
  if (isNative) void invoke("set_capture_hidden", { hidden });
}

/** Average brightness beside the notch, 0 (black) to 1 (white). */
export async function screenLuminance(): Promise<number> {
  if (!isNative) return 0.5;
  try {
    return await invoke<number>("screen_luminance");
  } catch {
    return 0.5;
  }
}

/** Global shortcut (Ctrl+Alt+H): toggle capture exclusion. */
export function onCaptureToggle(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://capture-toggle", handler);
  return () => void off.then((f) => f());
}

/** Global shortcut / tray: silent mode. */
export function onSilentToggle(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://silent-toggle", handler);
  return () => void off.then((f) => f());
}

export function onSilentSet(handler: (on: boolean) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<boolean>("notch://silent-set", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

export function traySilent(on: boolean) {
  if (isNative) void invoke("tray_silent", { on });
}

/** Tray: left click / "Open" (tab = null) or "Settings" (tab = "settings"). */
export function onTrayOpen(handler: (tab: string | null) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<string | null>("notch://open", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

/**
 * true: the window takes keyboard focus (after opening via shortcut).
 * false: focus goes back to the previous app if we still have it.
 */
export function keyboardFocus(focus: boolean) {
  if (isNative) void invoke("keyboard_focus", { focus });
}

/** Compact the transparent window while closed; expand it for the open panel. */
export function setNotchHeight(height: number) {
  if (isNative) void invoke("set_notch_height", { height });
}

/** Widen the transparent window for an attached flyout; Rust re-centers it. */
export function setNotchWidth(width: number) {
  if (isNative) void invoke("set_notch_width", { width });
}

/** WebView2 memory target: low while the notch sits closed, normal otherwise. */
export function setMemoryLow(low: boolean) {
  if (isNative) void invoke("memory_low", { low });
}

/** Keep the notch shown for a visible notification even in fullscreen. */
export function setNotificationVisible(active: boolean) {
  if (isNative) void invoke("notification_visible", { active });
}

/** Mirrors focus mode into the tray menu's check item. */
export function syncFocusTray(on: boolean) {
  if (isNative) void invoke("tray_focus", { on });
}

/** Focus mode switched from the tray menu. */
export function onFocusFromTray(handler: (on: boolean) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<boolean>("notch://focus-set", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}
