import { invoke } from "@tauri-apps/api/core";
import { media } from "../../platform/media";
import { isNative } from "../../platform/native";
import { discordState } from "./store";

/**
 * Publishes the Windows now-playing track to Discord Rich Presence while music
 * plays. Runs from app start, so it also works while the notch is closed.
 *
 * The Discord card is owned by Discord: the app only supplies the type
 * (Listening), title, artist, timestamps and cover URL.
 */
let started = false;

export function startDiscordPresence() {
  if (!isNative || started) return;
  started = true;

  let lastKey = "";

  const push = () => {
    if (discordState.get().status !== "ready") {
      // Once the RPC session is ready again, force a fresh activity update.
      lastKey = "";
      return;
    }

    const np = media.get();
    const info =
      np && np.isPlaying && np.title.trim()
        ? {
            title: np.title,
            artist: np.artist,
            position: Math.max(0, np.position),
            duration: Math.max(0, np.duration),
          }
        : null;
    const key = info ? `${info.title}\u0001${info.artist}\u0001${Math.round(info.duration)}` : "off";
    if (key === lastKey) return;
    lastKey = key;

    void invoke("discord_activity", { info }).catch(() => {
      // A reconnect can race the update; retry on the next state/track change.
      lastKey = "";
    });
  };

  media.subscribe(push);
  discordState.subscribe(() => {
    lastKey = "";
    push();
  });
  push();
}
