import { createStore } from "../lib/store";

export type NotificationKind = "message" | "music" | "download" | "timer" | "call" | "success" | "info";
export type NotificationBrand = "discord";

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  brand?: NotificationBrand;
  app: string;
  title: string;
  body: string;
  color: string;
  duration: number;
  createdAt: number;
}

export const notifications = createStore<AppNotification[]>([]);

const timers = new Map<number, number>();
let nextId = 1;

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
}

export function dismissNotification(id: number) {
  clearTimer(id);
  notifications.set((list) => list.filter((item) => item.id !== id));
}

/** One island at a time: a newer notification replaces the current one. */
export function notify(input: Omit<AppNotification, "id" | "createdAt" | "duration"> & { duration?: number }) {
  const item: AppNotification = {
    ...input,
    id: nextId++,
    duration: input.duration ?? 4600,
    createdAt: Date.now(),
  };
  notifications.get().forEach((old) => clearTimer(old.id));
  notifications.set([item]);
  timers.set(
    item.id,
    window.setTimeout(() => dismissNotification(item.id), item.duration),
  );
  return item.id;
}

export function previewIsland() {
  return notify({
    kind: "message",
    app: "Messages",
    title: "Bipin",
    body: "Bro, lunch at 1?",
    color: "#34c759",
  });
}

export function previewTimer() {
  return notify({
    kind: "timer",
    app: "Timer",
    title: "Focus session",
    body: "25:00 · deep work",
    color: "#ff9f0a",
    duration: 6500,
  });
}

export function previewDiscord() {
  return notify({
    kind: "message",
    brand: "discord",
    app: "Discord",
    title: "Bipin",
    body: "Hey, are you there?",
    color: "#5865F2",
    duration: 5600,
  });
}

export function notifyTimerFinished() {
  return notify({
    kind: "timer",
    app: "Timer",
    title: "Focus finished",
    body: "Time for a short break",
    color: "#ff9f0a",
    duration: 6500,
  });
}

export function notifyUpdateAvailable(version: string) {
  return notify({
    kind: "download",
    app: "WinZal",
    title: "Update available",
    body: `Version ${version} is ready`,
    color: "#5fe9e3",
    duration: 6500,
  });
}
