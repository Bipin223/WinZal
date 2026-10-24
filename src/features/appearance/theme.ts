import { createStore } from "../../lib/store";
import { settings, type Settings } from "../../settings/store";

export const DARK_SURFACE = "#000000";
export const LIGHT_SURFACE = "#f5f5f7";

/** The last value of the Windows app theme. */
export const systemLight = createStore(false);

export function isLightTheme(theme: Settings["appearance"]["theme"], system: boolean, customColor: string): boolean {
  if (theme === "light") return true;
  if (theme === "system") return system;
  if (theme === "custom") return isLightColor(customColor);
  return false;
}

export function useThemeLight(): boolean {
  const appearance = settings.use().appearance;
  const system = systemLight.use();
  return isLightTheme(appearance.theme, system, appearance.themeColor);
}

/** Is this island color light enough to need dark text? */
export function isLightColor(color: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return false;
  const n = parseInt(match[1], 16);
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  // The WCAG crossover where black text starts to beat white text.
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255) > 0.179;
}

let started = false;

/** Apply the settings + Windows theme to the document and keep it in sync. */
export function startTheme() {
  if (started) return;
  started = true;
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const apply = () => {
    const appearance = settings.get().appearance;
    const light = isLightTheme(appearance.theme, media.matches, appearance.themeColor);
    systemLight.set(media.matches);
    document.documentElement.dataset.theme = light ? "light" : "dark";
    document.documentElement.style.colorScheme = light ? "light" : "dark";
  };
  apply();
  settings.subscribe(apply);
  media.addEventListener("change", apply);
}
