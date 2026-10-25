import { createStore } from "../lib/store";

const LAST_TAB_KEY = "notch:last-tab";

/** First launch opens Overview; afterwards the last tool wins. */
function initialTab(): string {
  try {
    const saved = localStorage.getItem(LAST_TAB_KEY);
    if (saved && saved !== "settings") return saved;
  } catch {
    // Broken storage → first launch behaviour.
  }
  return "overview";
}

/**
 * Which tool is open? Global so tools can link to each other
 * (e.g. Portfolio without a key → "Connect in settings").
 * `section` scrolls the settings to a section.
 */
export const nav = createStore<{ tabId: string; section: string | null }>({ tabId: initialTab(), section: null });

export function navigate(tabId: string, section: string | null = null) {
  // Settings is transient: reopening the notch returns to the last real tool.
  if (tabId !== "settings") {
    try {
      localStorage.setItem(LAST_TAB_KEY, tabId);
    } catch {
      // Storage full/blocked: the in-memory state still works.
    }
  }
  nav.set({ tabId, section });
}
