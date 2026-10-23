import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createStore } from "../lib/store";
import { isNative } from "./native";

/*
 * Quick drop: drag files from Explorer onto the notch.
 * A normal HTML5 drop everywhere. In the app WebView2 hands the `File` objects to Rust
 * (`src-tauri/src/drop.rs`), which sends back real paths; the browser only gets
 * file names (for design work).
 *
 * `dragging` drives the notch (opens the Shelf), `dropped` holds the paths
 * the Shelf takes and then clears.
 */
export const drop = createStore<{ dragging: boolean; dropped: string[] | null }>({ dragging: false, dropped: null });

export function takeDropped(): string[] | null {
  const paths = drop.get().dropped;
  if (paths) drop.set((s) => ({ ...s, dropped: null }));
  return paths;
}

/**
 * Ctrl+V: files (or a copied image/screenshot) from the clipboard land in the active
 * tool just like a drop. Returns false if there was nothing suitable.
 */
export async function pasteFiles(): Promise<boolean> {
  const paths = isNative
    ? await invoke<string[]>("clipboard_paste_files").catch(() => [])
    : [`C:\\Users\\Demo\\Pictures\\Notch\\Eingefügt ${new Date().toLocaleTimeString("de-DE").replaceAll(":", "-")}.png`];
  if (paths.length === 0) return false;
  drop.set({ dragging: false, dropped: paths });
  return true;
}

/** Ctrl+V outside text fields → `pasteFiles`. For Shelf. */
export function usePasteFiles(onEmpty?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.key.toLowerCase() === "v")) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      void pasteFiles().then((ok) => !ok && onEmpty?.());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEmpty]);
}

/** WebView2 bridge (app only). Looked up per call: the host object may appear after startup. */
type WebViewBridge = { postMessageWithAdditionalObjects?(msg: string, objects: unknown[]): void };
const bridge = (): WebViewBridge | undefined =>
  (window as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;

let started = false;

export function startDropListener() {
  if (started) return;
  started = true;

  if (isNative) {
    // Tauri's native WebView drop (fallback; the window now lets WebView2 handle
    // external drops itself, which is the reliable path on current runtimes).
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        drop.set((s) => ({ ...s, dragging: true }));
      } else if (payload.type === "drop") {
        drop.set({ dragging: false, dropped: payload.paths });
      } else if (payload.type === "leave") {
        drop.set((s) => ({ ...s, dragging: false }));
      }
    });
    void listen<string[]>("notch://drop", ({ payload }) => drop.set({ dragging: false, dropped: payload }));
    // Native OLE target: the notch opens as soon as files enter, before the drop.
    void listen("notch://drop-enter", () => drop.set((s) => ({ ...s, dragging: true })));
    void listen("notch://drop-leave", () => drop.set((s) => ({ ...s, dragging: false })));
    // WebView2 may create its child HWNDs just after setup; register once the page
    // is up so the native target also covers them.
    const install = () => void invoke("drop_reinstall").catch(() => {});
    install();
    window.setTimeout(install, 1500);
  }

  // HTML5 drag. Only files count, not selected text.
  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  const stop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    stop(e);
    depth++;
    drop.set((s) => ({ ...s, dragging: true }));
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    stop(e);
    depth = Math.max(0, depth - 1);
    if (depth === 0) drop.set((s) => ({ ...s, dragging: false }));
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) {
      // Required, otherwise the browser refuses the drop and shows a "no" cursor.
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    stop(e);
    depth = 0;
    const files = [...(e.dataTransfer?.files ?? [])];
    const webview = bridge();
    if (webview?.postMessageWithAdditionalObjects) {
      // Paths come back asynchronously as "notch://drop".
      drop.set((s) => ({ ...s, dragging: false }));
      try {
        webview.postMessageWithAdditionalObjects("notch-drop", files);
        return;
      } catch {
        // Fall through to the File.path fallback below.
      }
    }
    // Some WebView2 builds expose the native path on File objects. Only use it
    // when it looks like a real Windows path; never invent a fake one.
    const paths = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => !!p && /^[a-zA-Z]:[\\/]/.test(p));
    drop.set({ dragging: false, dropped: paths.length ? paths : null });
  });
}
