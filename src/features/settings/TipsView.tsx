import {
  BatteryFull,
  CaretRight,
  Drop,
  Ghost,
  Hand,
  Lightning,
  MusicNotesSimple,
  Tray,
  WifiHigh,
} from "@phosphor-icons/react";
import { Group } from "../../ui/controls";
import { t } from "../../i18n";

/**
 * In-app quick guide. Plain text on purpose: it stays readable at a glance and
 * does not add a video player or another WebView to the notch.
 */
export function TipsView() {
  return (
    <>
      <Group title={t("First steps")}>
        <Tip icon={<Hand size={15} weight="fill" />} title={t("Hover or click the notch")}>
          {t("Hover to peek and open. In click mode, click the pill. Ctrl + Alt + Space opens it anywhere, including games. Esc or a click outside closes it.")}
        </Tip>
      </Group>

      <Group title={t("Wi-Fi, Bluetooth and audio")}>
        <Tip icon={<WifiHigh size={15} weight="bold" />} title={t("Hold Wi-Fi or Bluetooth")}>
          {t("Tap the tile to switch the radio on or off. Hold the tile to spring out the list on the matching side of the notch.")}
        </Tip>
        <Tip icon={<MusicNotesSimple size={15} weight="fill" />} title={t("Audio sessions")}>
          {t("In Now Playing, open the arrow next to the track. The session list springs out on the right; pick a session to show it, or pause one without changing the current track.")}
        </Tip>
        <Tip icon={<MusicNotesSimple size={15} weight="fill" />} title={t("Music during a Discord call")}>
          {t("While a call and music are both active, a round button on the right shows the other activity. Tap its album art or Discord logo to swap. There is no setting to manage; if a timer is also running, both circles sit on the right and the timer moves one slot out.")}
        </Tip>
      </Group>

      <Group title={t("Battery and clock")}>
        <Tip icon={<BatteryFull size={15} weight="fill" />} title={t("Battery meter")}>
          {t("The Overview header shows a solid battery with the charge number and a bolt inside. Green means charging, orange is 20 percent or less, red is 10 percent or less. Click it for Windows power settings.")}
        </Tip>
        <Tip icon={<CaretRight size={15} weight="bold" />} title={t("Clock text")}>
          {t("Settings → Notch also hides AM / PM and turns off the accent on the first digit if you prefer a plain clock.")}
        </Tip>
      </Group>

      <Group title={t("Timer, Ghost and games")}>
        <Tip icon={<Lightning size={15} weight="fill" />} title={t("Timer")}>
          {t("Timer alone owns the pill. When music, a call or gaming already owns it, the timer becomes a separate circle on the right. Click or drag that circle to open Timer.")}
        </Tip>
        <Tip icon={<Ghost size={15} weight="bold" />} title={t("Ghost mode")}>
          {t("The ghost button fades the notch and makes it click-through. Triple-click it to wake it again; Ctrl + Alt + S is the shortcut. Keep the ghost style on Faded.")}
        </Tip>
        <Tip icon={<Drop size={15} weight="bold" />} title={t("Gaming")}>
          {t("CPU rendering is the proven smooth mode for Genshin. If a game stutters, turn off Notch in games or switch the renderer under Settings → Performance.")}
        </Tip>
      </Group>

      <Group title={t("Files and shortcuts")}>
        <Tip icon={<Tray size={15} weight="fill" />} title={t("Drop a file on the notch")}>
          {t("Dragging a file over the notch opens the last used file tool. Shelf cards also have Convert for a direct handoff to the Converter.")}
        </Tip>
        <Tip icon={<CaretRight size={15} weight="bold" />} title={t("Handy shortcuts")}>
          {t("Ctrl + Alt + Space: open the notch · Ctrl + Alt + Shift + M: cycle power mode · Ctrl + Alt + S: Ghost mode.")}
        </Tip>
      </Group>
    </>
  );
}

function Tip({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-fill-1 px-3 py-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-2 text-label-2">{icon}</span>
      <span className="min-w-0">
        <span className="block text-caption font-semibold text-label">{title}</span>
        <span className="mt-0.5 block text-caption leading-[16px] text-label-3">{children}</span>
      </span>
    </div>
  );
}
