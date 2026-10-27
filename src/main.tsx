import { StrictMode, useEffect, useLayoutEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "./styles/global.css";
import { Notch } from "./notch/Notch";
import { DesktopMock } from "./dev/DesktopMock";
import { isNative } from "./platform/native";
import { startDropListener } from "./platform/drop";
import { systemControls, type PowerMode } from "./platform/services";
import { clipboard } from "./platform/clipboard";
import { settings } from "./settings/store";
import { setMotionScale, setMotionStyle } from "./design/motion";
import { applyTypography } from "./features/appearance/typography";
import { applyDisplay } from "./notch/drag";
import { startFocusMode } from "./notch/focus";
import { startSilentMode } from "./notch/silent";
import { startPresentationMode } from "./features/privacy/store";
import { startSystemPolling } from "./features/system/store";
import { startGamingWatch } from "./features/system/gaming";
import { startDiscord } from "./features/discord/store";
import { startDiscordPresence } from "./features/discord/presence";
import { startUpdateWatch } from "./lib/update";
import { update } from "./lib/update";
import { notifyUpdateAvailable } from "./notifications/store";
import { startSystemToastWatch, stopSystemToastWatch } from "./notifications/system";
import { showcase } from "./dev/showcase-data";
import { startShowcase } from "./dev/showcase";
import { startTheme } from "./features/appearance/theme";

if (showcase) startShowcase();

startTheme();
startDropListener();
startFocusMode();
startSilentMode();
startPresentationMode();
startSystemPolling();
startGamingWatch();
startDiscord();
startDiscordPresence();
startUpdateWatch();

// Notifications off = no native toast listener and no island cards.
let toastWatch: boolean | null = null;
const syncToastWatch = () => {
  const on = settings.get().notifications;
  if (on === toastWatch) return;
  toastWatch = on;
  if (on) startSystemToastWatch();
  else stopSystemToastWatch();
};
syncToastWatch();
settings.subscribe(syncToastWatch);

// Ctrl+Alt+M works over fullscreen games, where the Power tile cannot be clicked.
void listen("notch://power-cycle", async () => {
  try {
    const state = await systemControls.energy();
    const modes: PowerMode[] = [
      "saver",
      "balanced",
      ...(state.plugged ? (["max"] as PowerMode[]) : []),
      ...(state.plugged && state.custom ? (["custom"] as PowerMode[]) : []),
    ];
    const index = modes.indexOf(state.scheme);
    const next = modes[(index + 1) % modes.length] ?? modes[0];
    await systemControls.setEnergy(next);
  } catch {
    // The normal Power tile still shows the error.
  }
});

// Show one island notification per newly discovered update.
let lastUpdateNotice = "";
const watchUpdateNotice = () => {
  const u = update.get();
  if (u.phase !== "available" || !u.version || u.version === lastUpdateNotice) return;
  lastUpdateNotice = u.version;
  try {
    if (localStorage.getItem("winzal:update-notified") === u.version) return;
    localStorage.setItem("winzal:update-notified", u.version);
  } catch {
    // localStorage unavailable: still show the notification.
  }
  notifyUpdateAvailable(u.version);
};
update.subscribe(watchUpdateNotice);
watchUpdateNotice();

// Send display settings (monitor, fullscreen, offset, gaming) to Rust on start and on every change.
let lastDisplay = "";
const syncDisplay = () => {
  const { display, gaming } = settings.get();
  const key = `${display.visibility}|${display.monitor}|${display.offset}|${gaming.mode}|${gaming.apps.join(",")}|${gaming.hideInGames}`;
  if (key === lastDisplay) return;
  lastDisplay = key;
  applyDisplay();
};
syncDisplay();
settings.subscribe(syncDisplay);

// Clipboard history only records what an enabled tool uses (Ask: the latest text).
let lastClipMode = "";
const syncClipboardMode = () => {
  const on = (id: string) => settings.get().tools.some((t) => t.id === id && t.enabled);
  const mode = on("clipboard") ? "all" : on("ask") ? "text" : "off";
  if (mode === lastClipMode) return;
  lastClipMode = mode;
  clipboard.mode(mode);
};
syncClipboardMode();
settings.subscribe(syncClipboardMode);

// Language: update the tray menu in Rust and set the lang attribute.
let lastLang = "";
const applyLanguage = () => {
  const { language } = settings.get();
  if (language === lastLang) return;
  lastLang = language;
  document.documentElement.lang = language;
  if (isNative) void invoke("set_language", { lang: language });
};
applyLanguage();
settings.subscribe(applyLanguage);

// The notch isn't a web page: no browser context menu (except in text fields for
// cut/paste) and in the app no browser shortcuts like reload or print.
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
});
if (isNative) {
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "F5" || e.key === "F7" || e.key === "F12" || (e.ctrlKey && ["r", "p", "f", "g", "j", "u", "s"].includes(k))) e.preventDefault();
  });
}

// No native hover tooltips anywhere in the notch. Components can keep their
// title props for semantics, but Chromium's tooltip must never appear.
const stripTitle = (root: Element) => {
  if (root.hasAttribute("title")) root.removeAttribute("title");
  root.querySelectorAll("[title]").forEach((el) => el.removeAttribute("title"));
};
const stripTitles = (records: MutationRecord[]) => {
  for (const record of records) {
    if (record.type === "attributes") {
      const el = record.target;
      if (el instanceof Element && el.hasAttribute("title")) el.removeAttribute("title");
      continue;
    }
    // Only visit what was added. A whole-document query on every mutation was
    // the single busiest DOM observer while lyrics/visualizations update.
    for (const node of record.addedNodes) {
      if (node instanceof Element) stripTitle(node);
    }
  }
};
document.querySelectorAll("[title]").forEach((el) => el.removeAttribute("title"));
new MutationObserver(stripTitles).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["title"],
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

/** Applies the global motion intensity to Motion and the CSS layer. */
function Root() {
  const s = settings.use();
  const motion = s.appearance.motion;
  setMotionScale(motion / 100);
  setMotionStyle(s.appearance.motionStyle);
  useLayoutEffect(() => applyTypography(s.typography), [s.typography]);
  useEffect(() => {
    document.documentElement.dataset.motion = motion === 0 ? "off" : motion < 50 ? "reduced" : "full";
    document.documentElement.dataset.motionStyle = s.appearance.motionStyle;
  }, [motion, s.appearance.motionStyle]);
  return (
    <MotionConfig reducedMotion={motion === 0 ? "always" : "user"}>
      {!isNative && <DesktopMock />}
      <Notch />
    </MotionConfig>
  );
}
