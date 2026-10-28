import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle,
  ChatTeardropDots,
  DownloadSimple,
  Info,
  MusicNotesSimple,
  PhoneCall,
  Timer,
  type Icon,
} from "@phosphor-icons/react";
import { content, springs } from "../design/motion";
import { setNotificationVisible } from "../platform/native";
import { openNotificationApp } from "../platform/services";
import { DiscordLogo } from "../ui/brands";
import winzalIcon from "../assets/winzal-icon.png";
import { dismissNotification, notifications, type AppNotification } from "./store";
import { requestNotchOpen } from "../notch/openRequest";

const ICONS: Record<AppNotification["kind"], Icon> = {
  message: ChatTeardropDots,
  music: MusicNotesSimple,
  download: DownloadSimple,
  timer: Timer,
  call: PhoneCall,
  success: CheckCircle,
  info: Info,
};

function hasProgress(item: AppNotification) {
  return item.kind === "timer" || item.kind === "download";
}

function NotificationIcon({ item, size }: { item: AppNotification; size: number }) {
  if (item.app === "WinZal") {
    return (
      <img
        src={winzalIcon}
        alt=""
        className="shrink-0 rounded-[11px] border border-white/10 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon = item.brand === "discord" ? DiscordLogo : ICONS[item.kind];
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[13px] text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(160deg, ${item.color} 0%, ${item.color} 55%, ${item.color}cc 100%)`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.18), 0 7px 18px -8px ${item.color}`,
      }}
    >
      <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
      <span className="absolute -top-2 -left-2 size-2/3 rounded-full bg-white/20 blur-[7px]" />
      <Icon size={Math.round(size * 0.5)} weight="fill" className="relative drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]" />
    </span>
  );
}

export function NotificationLayer() {
  const items = notifications.use();
  const island = items[0] ?? null;
  const active = !!island;
  useEffect(() => {
    setNotificationVisible(active);
    return () => setNotificationVisible(false);
  }, [active]);

  return (
    <AnimatePresence>{island && <IslandNotification key={island.id} item={island} />}</AnimatePresence>
  );
}

function IslandNotification({ item }: { item: AppNotification }) {
  const dragged = useRef(false);
  const height = item.body ? 98 : 86;

  return (
    <div className="pointer-events-none fixed top-0 left-1/2 z-[120] -translate-x-1/2 pt-[2px]">
      <motion.div
        data-notification-hit
        className="pointer-events-auto relative overflow-hidden rounded-full border border-white/15 bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_24px_60px_-20px_rgb(0_0_0/0.9),0_2px_10px_rgb(0_0_0/0.45)] backdrop-blur-2xl backdrop-saturate-150"
        initial={{ width: 124, height: 24, borderRadius: 15, opacity: 0 }}
        animate={{ width: 352, height, borderRadius: height / 2, opacity: 1 }}
        exit={{ width: 124, height: 24, borderRadius: 15, opacity: 0, transition: springs.close }}
        transition={springs.open}
        drag
        dragConstraints={{ left: -170, right: 170, top: -130, bottom: 170 }}
        dragElastic={0.14}
        dragSnapToOrigin
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          const x = info.offset.x;
          const y = info.offset.y;
          const vx = info.velocity.x;
          const vy = info.velocity.y;
          const up = y < -64 || vy < -520;
          const down = y > 64 || vy > 520;
          const horizontal = Math.abs(x) > 64 || Math.abs(vx) > 520;
          if (up) {
            dismissNotification(item.id);
          } else if (down && y >= Math.abs(x)) {
            // Pulling down opens the notch; the card has done its job.
            requestNotchOpen();
            dismissNotification(item.id);
          } else if (horizontal) {
            dismissNotification(item.id);
          } else if (down) {
            requestNotchOpen();
            dismissNotification(item.id);
          }
          window.setTimeout(() => (dragged.current = false), 80);
        }}
        onClick={() => {
          if (!dragged.current) {
            dismissNotification(item.id);
            void openNotificationApp(item.appId ?? "", item.app).catch(() => {});
          }
        }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-black/55" />
        <span aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-white/30" />
        <motion.div
          className="relative flex h-full items-center gap-3 px-4"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0, transition: { ...content.enter, delay: 0.06 } }}
        >
          <motion.div
            initial={{ scale: 0.55, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={springs.peek}
          >
            <NotificationIcon item={item} size={38} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[9px] font-semibold tracking-[0.16em] text-white/45 uppercase">{item.app}</div>
            <div className="mt-0.5 truncate text-[13.5px] leading-[17px] font-semibold text-white">{item.title}</div>
            {item.body && (
              <div className="line-clamp-2 text-[10.5px] leading-[13px] text-white/55">{item.body}</div>
            )}
          </div>
          <span className="self-start pt-4 text-[10px] text-white/35">now</span>
        </motion.div>
        {hasProgress(item) && (
          <motion.span
            className="absolute inset-x-0 bottom-0 h-[2px] origin-left"
            style={{ background: item.color }}
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: item.duration / 1000, ease: "linear" }}
          />
        )}
      </motion.div>
    </div>
  );
}
