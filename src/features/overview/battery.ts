import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { batteryStatus, type BatteryStatus } from "../../platform/services";

/**
 * One battery poll for the whole notch. The header used to refresh every 15 s,
 * which made the charge bolt appear long after the cable was connected; the
 * attached Power strip polled separately. A shared 1 s poll keeps both in sync
 * and makes plug/unplug feel immediate.
 */
const battery = createStore<BatteryStatus | null>(null);

let consumers = 0;
let timer: number | undefined;

async function refresh() {
  try {
    battery.set(await batteryStatus());
  } catch {
    // Keep the last reading; a transient failure should not blank the pill.
  }
}

export function useBatteryStatus() {
  const value = battery.use();
  useEffect(() => {
    consumers += 1;
    if (consumers === 1) {
      void refresh();
      timer = window.setInterval(refresh, 1000);
    }
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
  }, []);
  return value;
}
