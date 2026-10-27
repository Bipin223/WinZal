import { useEffect } from "react";
import { createStore } from "../lib/store";
import { playChargeChime } from "../lib/sound";
import { batteryStatus } from "../platform/services";
import { settings } from "../settings/store";

/** The temporary charging capsule shown on the closed pill after plugging in. */
export const chargingPulse = createStore<{ active: boolean; percent: number }>({ active: false, percent: 0 });

let lastPlugged: boolean | null = null;
let hideTimer: number | undefined;

/**
 * Watches the power state once for the whole app. The closed pill is always
 * mounted, so this needs no extra window or poller per tool. Polling
 * GetSystemPowerStatus is effectively free; 2 s keeps the animation prompt.
 */
export function useChargingWatch() {
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const b = await batteryStatus().catch(() => null);
      if (!alive || !b?.present) return;
      const plugged = b.charging || b.plugged;
      if (lastPlugged === null) {
        lastPlugged = plugged;
        return;
      }
      if (plugged && !lastPlugged) {
        chargingPulse.set({ active: true, percent: b.percent });
        playChargeChime(settings.get().alarm.volume);
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (chargingPulse.get().active) chargingPulse.set({ active: false, percent: b.percent });
        }, 3000);
      } else if (!plugged && lastPlugged) {
        window.clearTimeout(hideTimer);
        if (chargingPulse.get().active) chargingPulse.set({ active: false, percent: b.percent });
      }
      lastPlugged = plugged;
    };
    void poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(hideTimer);
    };
  }, []);
}
