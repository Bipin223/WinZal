import { isNative } from "../platform/native";
import { listSystemToasts, type SystemToast } from "../platform/services";
import { notify, type NotificationBrand, type NotificationKind } from "./store";

const COLORS = ["#2f8fff", "#ff5ea8", "#5fe9e3", "#ff9f0a", "#30d158", "#bf5af2", "#8e8e93"];
const seen = new Set<number>();
let seeded = false;

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
    title: toast.title || app,
    body: toast.body || "",
    color: brand.color ?? colorFor(app),
    duration: 5600,
  });
}

/**
 * Poll the native listener instead of relying on a cross-window event. This is
 * one cheap command every 1.8 s and survives webview reloads/permission races.
 */
export function startSystemToastWatch() {
  if (!isNative) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const items = await listSystemToasts();
      if (!seeded) {
        items.forEach((item) => seen.add(item.id));
        seeded = true;
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
    } catch {
      // Listener not allowed yet.
    } finally {
      running = false;
    }
  };
  void tick();
  window.setInterval(() => void tick(), 1800);
}
