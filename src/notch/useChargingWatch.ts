import { useEffect, useRef } from "react";
import { createStore } from "../lib/store";
import { playChargeChime } from "../lib/sound";
import { settings } from "../settings/store";
import { useBatteryStatus } from "../features/overview/battery";

/** The temporary charging capsule shown on the closed pill after plugging in. */
export const chargingPulse = createStore<{ active: boolean; percent: number }>({ active: false, percent: 0 });

/** The same capsule for the low-battery warning, drawn in red. */
export const lowBatteryPulse = createStore<{ active: boolean; percent: number }>({ active: false, percent: 0 });

/**
 * Watches the shared battery reading for the whole app: the closed-pill
 * charging capsule/chime and the low-battery capsule. One poll now drives the
 * header, the Power strip and these alerts.
 */
export function useChargingWatch() {
  const battery = useBatteryStatus();
  const lastPlugged = useRef<boolean | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const lowTimer = useRef<number | undefined>(undefined);
  const lowNotified = useRef(false);

  useEffect(() => {
    if (!battery?.present) return;
    const plugged = battery.charging || battery.plugged;

    // Low battery: once per discharge, only while actually on battery.
    if (!plugged && battery.percent < 20) {
      if (!lowNotified.current) {
        lowNotified.current = true;
        window.clearTimeout(lowTimer.current);
        lowBatteryPulse.set({ active: true, percent: battery.percent });
        lowTimer.current = window.setTimeout(() => {
          lowBatteryPulse.set({ active: false, percent: battery.percent });
        }, 4000);
      }
    } else if (plugged || battery.percent >= 20) {
      lowNotified.current = false;
      window.clearTimeout(lowTimer.current);
      if (lowBatteryPulse.get().active) lowBatteryPulse.set({ active: false, percent: battery.percent });
    }

    if (lastPlugged.current === null) {
      lastPlugged.current = plugged;
      return;
    }
    if (plugged && !lastPlugged.current) {
      window.clearTimeout(lowTimer.current);
      if (lowBatteryPulse.get().active) lowBatteryPulse.set({ active: false, percent: battery.percent });
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

  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(lowTimer.current);
    },
    []
  );
}
