import { createStore } from "./store";
import { settings } from "../settings/store";
import { fetchChangelog, updater, type ChangelogEntry, type UpdateHandle } from "../platform/services";

/*
 * Updates: check (anonymously, only the latest.json of the newest GitHub release), show the
 * version, download + install only on click. Signed: the app only installs updates with a
 * valid signature (key in tauri.conf.json → plugins.updater.pubkey).
 */

type Phase = "idle" | "checking" | "current" | "available" | "downloading" | "error";

export const update = createStore<{
  current: string | null;
  phase: Phase;
  /** New version, if available. */
  version: string | null;
  progress: number;
  checkedAt: number | null;
  /** Changelog of the new version (all versions, filtered in the UI); null = not loaded. */
  notes: ChangelogEntry[] | null;
}>({ current: null, phase: "idle", version: null, progress: 0, checkedAt: null, notes: null });

let found: UpdateHandle | null = null;

export async function checkForUpdate(autoInstall = false) {
  const phase = update.get().phase;
  if (phase === "checking" || phase === "downloading") return;
  update.set((s) => ({ ...s, phase: "checking" }));
  try {
    found = await updater.check();
    const version = found?.version ?? null;
    const known = update.get();
    update.set((s) => ({ ...s, phase: found ? "available" : "current", version, checkedAt: Date.now(), notes: version === known.version ? s.notes : null }));
    if (version && (version !== known.version || !known.notes)) {
      void fetchChangelog(version).then((notes) => update.get().version === version && update.set((s) => ({ ...s, notes })));
    }
    // Background checks can install after a short pause; manual checks wait for
    // the Install button so the changelog can be read first.
    if (found && autoInstall && settings.get().updates.install) {
      window.setTimeout(() => {
        if (update.get().phase === "available" && settings.get().updates.install) void installUpdate();
      }, 8_000);
    }
  } catch {
    found = null;
    update.set((s) => ({ ...s, phase: "error", checkedAt: Date.now() }));
  }
}

export async function installUpdate() {
  if (!found || update.get().phase !== "available") return;
  update.set((s) => ({ ...s, phase: "downloading", progress: 0 }));
  try {
    await found.install((progress) => update.set((s) => ({ ...s, progress })));
  } catch {
    update.set((s) => ({ ...s, phase: "error" }));
  }
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Signed updates from GitHub: check once after startup and once a day when the
 * user allows it. Background checks install automatically when that setting is
 * on; nothing is ever installed without either setting or a click.
 */
const AUTO_CHECK = !import.meta.env.DEV;

/** On start (slightly delayed to keep startup fast) and daily after that, if allowed. */
export function startUpdateWatch() {
  void updater.current().then((current) => update.set((s) => ({ ...s, current })));
  const auto = () => AUTO_CHECK && settings.get().updates.auto && void checkForUpdate(settings.get().updates.install);
  setTimeout(auto, 15_000);
  setInterval(auto, DAY);
}
