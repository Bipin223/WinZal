import { useEffect, useRef } from "react";
import { createStore } from "../lib/store";
import { playChargeChime } from "../lib/sound";
import { settings } from "../settings/store";
import { notify } from "../notifications/store";
import { t } from "../i18n";
import { useBatteryStatus } from "../features/overview/battery";

/** The temporary charging capsule shown on the closed pill after plugging in. */
export const chargingPulse = createStore<{ active: boolean; percent: number }>({ active: false, percent: 0 });

/**
 * Watches the shared battery reading for the whole app: the closed-pill charging
 * pulse/chime and the low-battery notification. One poll now drives the header,
 * the Power strip and these alerts.
 */
export function useChargingWatch() {
  const battery = useBatteryStatus();
  const lastPlugged = useRef<boolean | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const lowNotified = useRef(false);

  useEffect(() => {
    if (!battery?.present) return;
    const plugged = battery.charging || battery.plugged;

    // Low battery: once per discharge, only while actually on battery.
    if (!plugged && battery.percent < 20) {
      if (!lowNotified.current) {
        lowNotified.current = true;
        notify({
          kind: "info",
          app: "WinZal",
          title: t("Akku fast leer"),
          body: t("Nur noch {n}%. Ladegerät anschließen.").replace("{n}", String(battery.percent)),
          color: "#ff453a",
          duration: 7000,
        });
      }
    } else if (plugged || battery.percent >= 20) {
      lowNotified.current = false;
    }

    if (lastPlugged.current === null) {
      lastPlugged.current = plugged;
      return;
    }
    if (plugged && !lastPlugged.current) {
      chargingPulse.set({ active: true, percent: battery.percent });
      playChargeChime(settings.get().alarm.volume);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (chargingPulse.get().active) chargingPulse.set({ active: false, percent: battery.percent });
      }, 3000);
    } else if (!plugged && lastPlugged.current) {
      window.clearTimeout(hideTimer.current);
      if (chargingPulse.get().active) chargingPulse.set({ active: false, percent: battery.percent });
    }
    lastPlugged.current = plugged;
  }, [battery]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
}
