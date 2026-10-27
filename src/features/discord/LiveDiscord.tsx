import { motion } from "motion/react";
import { MicrophoneSlash, MusicNotesSimple, SpeakerSimpleSlash } from "@phosphor-icons/react";
import { content } from "../../design/motion";
import type { DiscordCall } from "../../platform/services";
import { Equalizer } from "../now-playing/Equalizer";
import { GuildIcon } from "./DiscordView";
import { LiveEdge } from "../../notch/liveEdges";
import { useNowPlaying } from "../../platform/media";
import { callView } from "./store";
import { t } from "../../i18n";

/**
 * Closed notch during a Discord call (like a phone call on the Dynamic Island):
 * server icon on the left, the same equalizer as for music (green) on the right while
 * someone talks. Real levels come from loopback (the others' voices); for your own
 * voice it moves synthetically. Muted/deafened = red icon.
 */
export function LiveDiscord({ call }: { call: DiscordCall }) {
  const np = useNowPlaying();
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[9px]"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      <LiveEdge side="left">
        <GuildIcon call={call} size={20} />
      </LiveEdge>
      <LiveEdge side="right">
        <div className="flex items-center gap-1">
          {np?.isPlaying && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                callView.set("music");
              }}
              aria-label={t("Show music")}
              title={t("Show music")}
              className="pressable flex size-5 items-center justify-center rounded-full text-label-3 hover:text-label-2"
            >
              <MusicNotesSimple size={13} weight="bold" />
            </button>
          )}
          {call.deaf ? (
            <SpeakerSimpleSlash size={15} weight="fill" className="text-red" />
          ) : call.mute ? (
            <MicrophoneSlash size={15} weight="fill" className="text-red" />
          ) : (
            <Equalizer playing={call.speaking || call.members.some((m) => m.speaking)} tint="bg-green" />
          )}
        </div>
      </LiveEdge>
    </motion.div>
  );
}
