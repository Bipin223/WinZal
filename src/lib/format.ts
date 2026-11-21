import { locale } from "../i18n";
import { settings } from "../settings/store";

/** File size in B / KB / MB / GB / TB. */
export function formatBytes(bytes: number, digits = 1): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toLocaleString(locale(), { maximumFractionDigits: i === 0 ? 0 : digits })} ${units[i]}`;
}

/** Weather data comes in °C; shown in the unit from the settings. "22°" */
export function formatTemp(celsius: number): string {
  const f = settings.get().units.temp === "f";
  return `${Math.round(f ? (celsius * 9) / 5 + 32 : celsius)}°`;
}

/** Wind follows the temperature unit: km/h or mph. */
export function formatWind(kmh: number): string {
  return settings.get().units.temp === "f" ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`;
}

/** Clock time in 24 h or 12 h; `period` is "AM"/"PM" (empty in 24 h) for a smaller second line. */
export function formatTimeParts(date: Date | number): { time: string; period: string } {
  const h12 = settings.get().units.clock === "12";
  const parts = new Intl.DateTimeFormat(locale(), { hour: h12 ? "numeric" : "2-digit", minute: "2-digit", hour12: h12 }).formatToParts(date);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const time = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  return { time, period: period.toUpperCase() };
}
