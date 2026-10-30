import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { content, springs } from "../design/motion";
import { setNotificationVisible } from "../platform/native";
import { openNotificationApp } from "../platform/services";
import { DiscordLogo } from "../ui/brands";
import winzalIcon from "../assets/winzal-icon.png";
import { dismissNotification, notifications, type AppNotification } from "./store";
import { requestNotchOpen } from "../notch/openRequest";

function hasProgress(item: AppNotification) {
  return item.kind === "timer" || item.kind === "download";
}

/** One circular identity mark: real app icon, Discord mark, or a letter. */
function NotificationIcon({ item, size }: { item: AppNotification; size: number }) {
  if (item.app === "WinZal") {
    return (
      <img
        src={winzalIcon}
        alt=""
        className="shrink-0 rounded-full border border-white/10 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  if (item.brand === "discord") {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-white/90"
        style={{ width: size, height: size }}
      >
        <DiscordLogo size={Math.round(size * 0.54)} />
      </span>
    );
  }
  const initial = Array.from(item.app.trim())[0]?.toLocaleUpperCase() ?? "?";
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.07] font-semibold text-white/80"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initial}
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
  const measure = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const minHeight = item.body ? 62 : 48;
  // Long notifications grow sideways, never taller: measure the unwrapped
  // text and animate the capsule to the width it needs (up to 680px).
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    let alive = true;
    const update = () => {
      if (alive) setWidth(Math.min(680, Math.max(300, Math.ceil(el.scrollWidth) + 76)));
    };
    update();
    void document.fonts.ready.then(update);
    return () => {
      alive = false;
    };
  }, [item.id, item.app, item.title, item.body]);

  return (
    <div className="pointer-events-none fixed top-0 left-1/2 z-[120] -translate-x-1/2 pt-[2px]">
      <div
        ref={measure}
        aria-hidden
        className="pointer-events-none fixed top-0 -left-[2000px] w-max whitespace-nowrap"
      >
        <div className="text-[8px] font-semibold tracking-[0.14em] uppercase">
          {item.app} <span className="ml-3 text-[8.5px] font-normal tracking-normal">now</span>
        </div>
        <div className="text-[15.5px] leading-[19px] font-semibold">{item.title}</div>
        {item.body && <div className="text-[12.5px] leading-[15px]">{item.body}</div>}
      </div>
      <motion.div
        data-notification-hit
        className="pointer-events-auto relative flex items-center overflow-hidden rounded-full border border-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_12px_30px_-14px_rgb(0_0_0/0.55)]"
        style={{ background: "linear-gradient(180deg, rgba(40, 40, 44, 0.58), rgba(12, 12, 14, 0.72))", minHeight }}
        initial={{ width: 124, height: 24, borderRadius: 15, opacity: 0 }}
        animate={{ width, height: minHeight, borderRadius: 999, opacity: 1 }}
        exit={{ width: 124, height: 24, borderRadius: 15, opacity: 0, transition: springs.close }}
        transition={{ type: "spring", visualDuration: 0.38, bounce: 0 }}
        drag
        dragConstraints={{ left: -170, right: 170, top: -130, bottom: 170 }}
        dragElastic={0.14}
        dragSnapToOrigin
        dragMomentum={false}
        dragTransition={{ bounceStiffness: 420, bounceDamping: 36 }}
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
        <span aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-white/30" />
        <motion.div
          className="relative flex w-full items-center gap-[13px] px-[10px] py-[2px]"
          style={{ minWidth: 298 }}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0, transition: { ...content.enter, delay: 0.06 } }}
        >
          <motion.div
            initial={{ scale: 0.55, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={springs.peek}
          >
            <NotificationIcon item={item} size={32} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-[8px] font-semibold tracking-[0.14em] text-white/45 uppercase">{item.app}</span>
              <span className="ml-auto shrink-0 text-[8.5px] text-white/35">now</span>
            </div>
            <div className="mt-px truncate text-[15.5px] leading-[19px] font-semibold text-white">{item.title}</div>
            {item.body && (
              <div className="line-clamp-2 text-[12.5px] leading-[15px] text-white/60">{item.body}</div>
            )}
          </div>
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
