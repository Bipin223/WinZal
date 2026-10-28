import { listen } from "@tauri-apps/api/event";
import { isNative } from "../platform/native";
import { listSystemToasts, setToastWatch, type SystemToast } from "../platform/services";
import { dismissAllNotifications, notify, type NotificationBrand, type NotificationKind } from "./store";

const COLORS = ["#2f8fff", "#ff5ea8", "#5fe9e3", "#ff9f0a", "#30d158", "#bf5af2", "#8e8e93"];
const seen = new Set<number>();
let seeded = false;
let watching = false;
let listenerReady = false;
let seedTimer: number | undefined;
const pending: SystemToast[][] = [];

function brandFor(app: string, appId: string): { brand?: NotificationBrand; color?: string } {
  const id = `${app} ${appId}`.toLowerCase();
  if (id.includes("discord")) return { brand: "discord", color: "#5865F2" };
  return {};
}

function colorFor(app: string) {
  let hash = 0;
  for (const char of app) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function kindFor(app: string): NotificationKind {
  const name = app.toLowerCase();
  if (/discord|message|whatsapp|telegram|slack|teams|signal/.test(name)) return "message";
  if (/spotify|music|itunes|soundcloud|youtube/.test(name)) return "music";
  if (/phone|call/.test(name)) return "call";
  if (/timer|clock|alarm/.test(name)) return "timer";
  if (/update|store|winzal/.test(name)) return "download";
  return "info";
}

function show(toast: SystemToast) {
  if (!toast.title && !toast.body) return;
  const app = toast.app || "Windows";
  const brand = brandFor(app, toast.appId);
  notify({
    kind: brand.brand ? "message" : kindFor(app),
    brand: brand.brand,
    app,
    appId: toast.appId,
    title: toast.title || app,
    body: toast.body || "",
    color: brand.color ?? colorFor(app),
    duration: 5600,
  });
}

function consume(items: SystemToast[]) {
  if (!watching) return;
  if (!seeded) {
    pending.push(items);
    return;
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      show(item);
    }
  }
  const live = new Set(items.map((item) => item.id));
  for (const id of seen) if (!live.has(id)) seen.delete(id);
}

function seed(attempt: number) {
  if (!watching) return;
  seedTimer = window.setTimeout(() => {
    if (!watching) return;
    void listSystemToasts()
      .then((items) => {
        if (!watching) return;
        items.forEach((item) => seen.add(item.id));
        seeded = true;
        pending.splice(0).forEach(consume);
      })
      .catch(() => {
        if (attempt < 15) seed(attempt + 1);
        else if (watching) {
          seeded = true;
          pending.splice(0).forEach(consume);
        }
      });
  }, attempt === 0 ? 0 : 2000);
}

/**
 * The native listener emits only when Windows' toast list changes. There is no
 * periodic poll; the one-time list read just seeds existing toasts so opening
 * WinZal does not replay yesterday's notifications.
 */
export function startSystemToastWatch() {
  if (!isNative || watching) return;
  watching = true;
  if (!listenerReady) {
    listenerReady = true;
    void listen<SystemToast[]>("notification://toasts", (event) => consume(event.payload));
  }
  void setToastWatch(true);
  seeded = false;
  seen.clear();
  pending.length = 0;
  seed(0);
}

/** Off: drop the native listener, stop seeding and clear any visible card. */
export function stopSystemToastWatch() {
  if (!isNative) return;
  watching = false;
  window.clearTimeout(seedTimer);
  seeded = false;
  seen.clear();
  pending.length = 0;
  void setToastWatch(false);
  dismissAllNotifications();
}
