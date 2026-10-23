import { useContext, useRef } from "react";
import { AnimatePresence, useTransform } from "motion/react";
import { useNowPlaying } from "../platform/media";
import { LiveActivity } from "../features/now-playing/LiveActivity";
import { LiveTimer, useTimerLive } from "../features/timer/LiveTimer";
import { LiveDiscord } from "../features/discord/LiveDiscord";
import { useDiscordCall } from "../features/discord/store";
import { LiveGaming } from "../features/system/LiveGaming";
import { useGamingLive } from "../features/system/gaming";
import { geometry } from "./geometry";
import { LiveSpread, ShapeWidth } from "./liveEdges";
import { RECORDING_EXTRA } from "./recording";

/**
 * Which live activity the closed notch shows. Exactly one, by priority:
 * gaming mode (turned on deliberately) before time-critical (timer, call) before
 * background (music). Add new activities here. The ID is also the tool that opens.
 */
export function useLiveActivity(): { id: string | null } {
  const gaming = useGamingLive();
  const timerLive = useTimerLive();
  const call = useDiscordCall();
  const np = useNowPlaying();
  if (gaming) return { id: "system" };
  if (timerLive) return { id: "timer" };
  if (call) return { id: "discord" };
  if (np?.isPlaying) return { id: "media" };
  return { id: null };
}

/**
 * The activity sits in a fixed box the size of the closed live notch, centered. Its two
 * sides (LiveEdge) follow the shape's edges by transform as it opens, closes or peeks.
 * Pinned to the edges by layout instead, they crept in pixel steps (issue #3).
 */
export function LiveSlot({ id, recording = false }: { id: string | null; recording?: boolean }) {
  const np = useNowPlaying();
  const call = useDiscordCall();
  // Keep the last size while an activity fades out (id is null when the notch opens).
  const last = useRef(id);
  if (id) last.current = id;
  const box = last.current === "system" ? geometry.gaming : geometry.live;
  // The recording chip lives at the right end; give the live content the same extra
  // width so the title and the right controls keep their breathing room.
  const width = box.w + (recording ? RECORDING_EXTRA : 0);
  const boxW = useRef(width);
  boxW.current = width;
  const spread = useTransform(useContext(ShapeWidth), (w) =>
    Math.max(0, (w - boxW.current) / 2),
  );
  return (
    <LiveSpread.Provider value={spread}>
      <div
        className="absolute top-0 left-1/2"
        style={{
          width,
          height: box.h,
          marginLeft: -width / 2,
          // The width only changes when the recording chip appears/disappears; let
          // the live content breathe into the extra space instead of jumping.
          transition: "width 240ms cubic-bezier(0.23, 1, 0.32, 1), margin-left 240ms cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <AnimatePresence initial={false}>
          {id === "system" && <LiveGaming key="system" />}
          {id === "timer" && <LiveTimer key="timer" />}
          {id === "discord" && call && (
            <LiveDiscord key="discord" call={call} />
          )}
          {id === "media" && np && <LiveActivity key="media" np={np} />}
        </AnimatePresence>
      </div>
    </LiveSpread.Provider>
  );
}
