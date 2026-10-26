import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle,
  DownloadSimple,
  EnvelopeSimple,
  Info,
  MusicNotesSimple,
  PhoneCall,
  Timer,
  type Icon,
} from "@phosphor-icons/react";
import { content, springs } from "../design/motion";
import { dismissNotification, notifications, type AppNotification } from "./store";

const ICONS: Record<AppNotification["kind"], Icon> = {
  message: EnvelopeSimple,
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
  const Icon = ICONS[item.kind];
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[12px] text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(180deg, ${item.color}dd, ${item.color}88)`,
        boxShadow: `inset 0 0 0 1px rgb(255 255 255 / 0.16), 0 6px 16px -7px ${item.color}`,
      }}
    >
      <span className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
      <Icon size={Math.round(size * 0.48)} weight="fill" className="relative" />
    </span>
  );
}

export function NotificationLayer() {
  const items = notifications.use();
  const island = items[0] ?? null;

  return (
    <AnimatePresence>{island && <IslandNotification key={island.id} item={island} />}</AnimatePresence>
  );
}

function IslandNotification({ item }: { item: AppNotification }) {
  const dragged = useRef(false);

  return (
    <div className="pointer-events-none fixed top-0 left-1/2 z-[120] -translate-x-1/2 pt-[2px]">
      <motion.div
        data-notification-hit
        className="pointer-events-auto relative overflow-hidden border border-white/10 bg-[#0b0c10] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9),0_2px_10px_rgb(0_0_0/0.45)]"
        initial={{ width: 124, height: 24, borderRadius: 15, opacity: 0 }}
        animate={{ width: 352, height: 76, borderRadius: 26, opacity: 1 }}
        exit={{ width: 124, height: 24, borderRadius: 15, opacity: 0, transition: springs.close }}
        transition={springs.open}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.16}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 64 || info.velocity.y > 520) dismissNotification(item.id);
          window.setTimeout(() => (dragged.current = false), 80);
        }}
        onClick={() => {
          if (!dragged.current) dismissNotification(item.id);
        }}
      >
        <motion.div
          className="flex h-full items-center gap-3 px-4"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0, transition: { ...content.enter, delay: 0.06 } }}
        >
          <motion.div
            initial={{ scale: 0.55, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={springs.peek}
          >
            <NotificationIcon item={item} size={40} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[9px] font-semibold tracking-[0.16em] text-white/45 uppercase">{item.app}</div>
            <div className="mt-0.5 truncate text-[13.5px] leading-[17px] font-semibold text-white">{item.title}</div>
            <div className="truncate text-[11.5px] leading-[15px] text-white/60">{item.body}</div>
          </div>
          <span className="self-start pt-0.5 text-[10px] text-white/35">now</span>
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
