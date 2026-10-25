import { useEffect, useRef } from "react";
import { systemControls, type PowerMode } from "../../platform/services";
import { settings } from "../../settings/store";
import { useGamingLive } from "./gaming";

const KEY = "winzal:power-before-game";

/**
 * While a chosen game is in front: switch Lenovo to Custom. On exit restore
 * the exact mode that was active before. A saved mode also heals a crash.
 */
export function useGameAutoPower() {
  const live = useGamingLive();
  const auto = settings.use().gaming.autoPower;
  const switched = useRef(false);

  useEffect(() => {
    if (!auto) {
      if (switched.current) {
        switched.current = false;
        restore();
      }
      return;
    }
    if (live && !switched.current) {
      switched.current = true;
      void systemControls
        .energy()
        .then((e) => {
          localStorage.setItem(KEY, e.scheme);
          return systemControls.setEnergy("custom");
        })
        .catch(() => {
          localStorage.removeItem(KEY);
          switched.current = false;
        });
    } else if (!live && switched.current) {
      switched.current = false;
      restore();
    }
  }, [live, auto]);

  // Never leave Custom forced after a crash or a restart during a game.
  useEffect(() => {
    if (!live && localStorage.getItem(KEY)) restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function restore() {
  const saved = localStorage.getItem(KEY) as PowerMode | null;
  localStorage.removeItem(KEY);
  if (saved) void systemControls.setEnergy(saved).catch(() => {});
}
