import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeSlash, MusicNoteSimple, Timer } from "@phosphor-icons/react";
import { DiscordLogo } from "../../ui/brands";
import { content, springs } from "../../design/motion";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { togglePresentation, usePresenting } from "../privacy/store";
import { useNowPlaying } from "../../platform/media";
import { useDiscordCall } from "../discord/store";
import { Equalizer } from "../now-playing/Equalizer";
import { ARTWORK_LAYOUT_ID } from "../now-playing/NowPlayingView";
import { formatClock, timer, useRemaining } from "../timer/store";
import { describe, useForecast } from "../weather/store";
import { settings } from "../../settings/store";
import { formatTemp, formatTimeParts } from "../../lib/format";
import { locale, t } from "../../i18n";
import { CompactClock } from "../../notch/ClockFace";
import { useMinute } from "../../lib/useMinute";
import { useSecond } from "../../lib/useSecond";
import { PowerActions, QuickControls, SystemRow } from "./Controls";
import { BatteryMeter } from "../../ui/BatteryMeter";
import { batteryStatus, systemControls, type BatteryStatus } from "../../platform/services";

/*
 *   9:43 AM        [🔒 🌙 ↻ ⏻]                 ☀ 70°
 *   Tuesday 20 October                 San Diego · Mostly clear
 *   ┌──────────────────────────────────────────────┐
 *   │ ▣ Song – Artist                        ▮▮▮▮  │
 *   └──────────────────────────────────────────────┘
 *   [☾ Focus 104] [🔊 ━━━ 100] [☀ ━━━ 84]
 *   [📶 Wi-Fi] [ᛒ Bluetooth] [🔋 Power] [🌗 Glim]
 */
export function OverviewView() {
  const presenting = usePresenting();
  return (
    <div className="flex h-full flex-col gap-2 px-4 pt-1 pb-3">
      <HeaderActions>
        <BatteryIndicator />
        <HeaderButton
          label={presenting ? t("Präsentationsmodus beenden") : t("Präsentationsmodus")}
          active={presenting}
          onClick={togglePresentation}
        >
          {presenting ? <EyeSlash size={14} weight="fill" /> : <Eye size={14} weight="bold" />}
        </HeaderButton>
      </HeaderActions>
      <Header />
      <Activity />
      <QuickControls />
      <SystemRow />
    </div>
  );
}

function BatteryIndicator() {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void batteryStatus()
        .then((next) => alive && setBattery(next))
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  if (!battery?.present) return null;
  const percent = Math.min(100, Math.max(0, battery.percent));
  return (
    <motion.button
      type="button"
      aria-label={`Battery ${percent}%${battery.plugged ? " · plugged in" : ""}`}
      title={`Battery ${percent}%${battery.plugged ? " · plugged in" : ""}`}
      onClick={() => void systemControls.openUri("ms-settings:powersleep")}
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1, transition: springs.snappy }}
      className="pressable flex h-7 items-center rounded-full px-0.5 outline-none transition-colors duration-150 hover:bg-fill-1 focus:outline-none"
    >
      <BatteryMeter percent={percent} charging={battery.charging} plugged={battery.plugged} size="md" />
    </motion.button>
  );
}

function Header() {
  const now = useMinute();
  const forecast = useForecast();
  const appearance = settings.use().appearance;
  const place = settings.use().weather;
  const weather = forecast && forecast !== "error" ? describe(forecast.current.code, forecast.current.day) : null;
  const { period } = formatTimeParts(now);
  const date = new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(now);
  const stacked = appearance.clockStyle === "stacked";
  const withSeconds = appearance.clockStyle === "split" || appearance.clockStyle === "scatter";
  const liveSeconds = useSecond(withSeconds);

  return (
    <div className="relative flex items-end justify-between">
      <div>
        <div className={`flex ${stacked ? "items-center" : "items-baseline"} gap-1 leading-none tracking-[-0.03em] text-label`}>
          <CompactClock
            style={appearance.clockStyle}
            now={now}
            size={stacked ? 26 : 34}
            height={stacked ? 58 : 40}
            weight={appearance.clockOpenWeight}
            seconds={liveSeconds}
            showSeconds={withSeconds}
          />
          {period && appearance.clockShowPeriod && <span className="text-title tracking-normal text-label-3">{period}</span>}
        </div>
        <div className="mt-1 text-footnote text-label-3">{date}</div>
      </div>
      <div className="pointer-events-none absolute inset-0 flex translate-y-1 items-end justify-center">
        <div className="pointer-events-auto">
          <PowerActions />
        </div>
      </div>
      <button onClick={() => navigate("weather")} className="pressable flex flex-col items-end text-right" title={t("Wetter öffnen")}>
        <AnimatePresence mode="popLayout" initial={false}>
          {weather && forecast && forecast !== "error" ? (
            <motion.div
              key="w"
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            >
              <weather.icon
                size={22}
                weight="fill"
                className="text-label"
              />
              <span className="tabular text-[22px] leading-none font-semibold tracking-[-0.02em] text-label">
                {formatTemp(forecast.current.temp)}
              </span>
            </motion.div>
          ) : (
            <motion.div key="s" className="h-[22px] w-16 rounded-[6px] bg-fill-1" exit={{ opacity: 0, transition: content.exit }} />
          )}
        </AnimatePresence>
        <div className="mt-1 max-w-[220px] truncate text-footnote text-label-3">
          {place ? `${place.name}${weather ? ` · ${weather.text}` : ""}` : t("Ort wird erkannt …")}
        </div>
      </button>
    </div>
  );
}

/** What's running, in the same priority as the closed notch: timer, call, music. */
function Activity() {
  const np = useNowPlaying();
  const call = useDiscordCall();
  const tm = timer.use();
  const remaining = useRemaining();
  const timerLive = tm.endsAt !== null || tm.finished;

  let item: { key: string; tab: string; icon: ReactNode; title: string; detail: string; trailing?: ReactNode } | null = null;
  if (timerLive) {
    item = {
      key: "timer",
      tab: "timer",
      icon: <Timer size={18} weight="bold" className={tm.mode === "focus" ? "text-orange" : "text-green"} />,
      title: tm.finished ? t(tm.mode === "focus" ? "Fokus abgelaufen" : "Pause abgelaufen") : t(tm.mode === "focus" ? "Fokus" : "Pause"),
      detail: tm.finished ? t("Zum Schließen öffnen") : t("noch {time}", { time: formatClock(remaining) }),
    };
  } else if (call) {
    item = {
      key: "discord",
      tab: "discord",
      icon: <DiscordLogo size={18} weight="fill" className="text-label" />,
      title: call.channelName,
      detail: [call.guildName, t(call.members.length === 1 ? "{n} Person" : "{n} Personen", { n: call.members.length })].filter(Boolean).join(" · "),
      trailing: <Equalizer playing={call.members.some((m) => m.speaking)} tint="bg-green" />,
    };
  } else if (np) {
    item = {
      key: "media",
      tab: "media",
      icon: np.artwork ? (
        // Same layoutId as the cover in Now Playing, so a click flies it there.
        <motion.img
          layoutId={ARTWORK_LAYOUT_ID}
          transition={springs.morph}
          src={np.artwork}
          alt=""
          draggable={false}
          className="size-7 rounded-[6px] object-cover"
        />
      ) : (
        <MusicNoteSimple size={18} weight="fill" className="text-label-2" />
      ),
      title: np.title,
      detail: np.artist,
      trailing: <Equalizer playing={np.isPlaying} />,
    };
  }

  return (
    <div className="relative h-11 overflow-hidden rounded-[12px] bg-fill-1">
      <AnimatePresence mode="popLayout" initial={false}>
        {item ? (
          <motion.button
            key={item.key}
            onClick={() => navigate(item.tab)}
            className="pressable pressable-wide pressable-fill absolute inset-0 flex items-center gap-2.5 px-2.5 text-left"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
          >
            <span className="flex size-7 shrink-0 items-center justify-center">{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-footnote font-medium text-label">{item.title}</span>
              <span className="block truncate text-caption text-label-3">{item.detail}</span>
            </span>
            {item.trailing && <span className="shrink-0 pr-1">{item.trailing}</span>}
          </motion.button>
        ) : (
          <motion.div
            key="idle"
            className="absolute inset-0 flex items-center justify-center text-footnote text-label-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: content.enter }}
            exit={{ opacity: 0, transition: content.exit }}
          >
            {t("Gerade läuft nichts")}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
