import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { ArrowClockwise, DotsSixVertical, MagnifyingGlass, PushPin, X } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { AppsIcon } from "./AppsIcon";
import { requestNotchClose } from "../../notch/openRequest";
import { settings, updateSettings } from "../../settings/store";
import { t } from "../../i18n";
import { Button } from "../../ui/controls";
import { AppGlyph } from "./AppGlyph";
import { loadAppIcons, loadApps, openApp, useApps, type AppEntry } from "./store";

/**
 * Start-menu style launchpad. The first row is the user's pinned apps; All apps
 * is a searchable list where each tile can be pinned.
 */
export function AppsView() {
  const { apps, loading, error } = useApps();
  const pinned = settings.use().apps?.pinned ?? [];
  const [mode, setMode] = useState<"pinned" | "all">("pinned");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<string[]>(pinned);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef(order);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const suppressUntil = useRef(0);

  useEffect(() => {
    orderRef.current = pinned;
    setOrder(pinned);
  }, [pinned]);

  useEffect(() => () => dragCleanup.current?.(), []);

  const pinnedApps = useMemo(
    () => order.map((id) => apps.find((app) => app.id === id)).filter((app): app is AppEntry => !!app),
    [order, apps],
  );
  const all = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? apps.filter((app) => app.name.toLowerCase().includes(needle)) : apps;
  }, [apps, query]);
  const allMode = mode === "all";

  const togglePin = (id: string) => {
    const current = settings.get().apps?.pinned ?? [];
    const adding = !current.includes(id);
    updateSettings((cur) => {
      const list = cur.apps?.pinned ?? [];
      return {
        apps: {
          ...cur.apps,
          pinned: adding ? [...list, id] : list.filter((pinnedId) => pinnedId !== id),
        },
      };
    });
    if (adding) void loadAppIcons([id]);
  };

  const open = (app: AppEntry) => {
    // Opening the app is the priority; close the notch when the command is done.
    void openApp(app.id).finally(requestNotchClose);
  };

  const suppressClicks = () => {
    suppressUntil.current = performance.now() + 400;
  };

  const commitOrder = () => {
    const next = orderRef.current;
    const current = settings.get().apps?.pinned ?? [];
    if (next.length === current.length && next.every((id, index) => id === current[index])) return;
    updateSettings((cur) => ({ apps: { ...cur.apps, pinned: next } }));
  };

  const targetIndex = (x: number, y: number): number | null => {
    const grid = gridRef.current;
    const first = grid?.querySelector<HTMLElement>("[data-pinned-tile]");
    if (!grid || !first) return null;
    const gr = grid.getBoundingClientRect();
    const fr = first.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const colGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || colGap;
    const cellW = fr.width + colGap;
    const cellH = fr.height + rowGap;
    if (cellW <= 0 || cellH <= 0) return null;
    const col = Math.max(0, Math.min(4, Math.floor((x - gr.left) / cellW)));
    const row = Math.max(0, Math.floor((y - gr.top) / cellH));
    return Math.min(orderRef.current.length - 1, row * 5 + col);
  };

  const beginDrag = (app: AppEntry, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || orderRef.current.length < 2) return;
    dragCleanup.current?.();
    setDraggingId(null);
    const tile = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let timer = 0;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try {
        if (tile.hasPointerCapture(pointerId)) tile.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already be gone.
      }
      dragCleanup.current = null;
    };
    const finish = () => {
      window.clearTimeout(timer);
      if (active) {
        commitOrder();
        suppressClicks();
        setDraggingId(null);
      }
      cleanup();
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
          window.clearTimeout(timer);
          suppressClicks();
          cleanup();
        }
        return;
      }
      ev.preventDefault();
      const target = targetIndex(ev.clientX, ev.clientY);
      if (target === null) return;
      setOrder((current) => {
        const from = current.indexOf(app.id);
        if (from < 0 || from === target) return current;
        const next = [...current];
        const [moved] = next.splice(from, 1);
        next.splice(target, 0, moved);
        orderRef.current = next;
        return next;
      });
    };

    timer = window.setTimeout(() => {
      active = true;
      setDraggingId(app.id);
      try {
        tile.setPointerCapture(pointerId);
      } catch {
        // Mouse input still works through the window listeners.
      }
    }, 280);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    dragCleanup.current = cleanup;
  };

  return (
    <div className="flex h-full flex-col gap-2 px-4 pt-1 pb-2">
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-fill-2 px-2">
          <MagnifyingGlass size={12} weight="bold" className="shrink-0 text-label-3" />
          <input
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (value) setMode("all");
            }}
            placeholder={t("Search apps")}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[10px] text-label outline-none placeholder:text-label-4"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("Clear")}
              className="grid size-4 shrink-0 place-items-center rounded-full text-label-3 hover:text-label"
            >
              <X size={9} weight="bold" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => {
            setMode(allMode ? "pinned" : "all");
            setQuery("");
          }}
          className="pressable h-7 shrink-0 rounded-full bg-fill-2 px-2.5 text-[9px] font-semibold text-label"
        >
          {allMode ? t("Pinned") : t("All apps")}
        </button>
        {allMode && (
          <button
            type="button"
            onClick={() => void loadApps(true)}
            disabled={loading}
            aria-label={t("Refresh apps")}
            className="pressable grid size-7 shrink-0 place-items-center rounded-full text-label-3 hover:text-label disabled:opacity-40"
          >
            <ArrowClockwise size={12} weight="bold" className={loading ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {!allMode && pinnedApps.length > 1 && (
        <div className="flex h-3.5 shrink-0 items-center justify-end gap-1 px-1 text-[8px] text-label-4">
          <DotsSixVertical size={9} weight="bold" />
          {t("Hold and drag to reorder")}
        </div>
      )}

      {loading && apps.length === 0 ? (
        <Skeleton />
      ) : error && apps.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span className="grid size-10 place-items-center rounded-[10px] bg-fill-2 text-label-3">
            <AppsIcon size={21} />
          </span>
          <span className="text-footnote font-medium text-label">{t("Apps didn't load")}</span>
          <span className="text-caption text-label-3">{t("Windows did not return the Start menu.")}</span>
          <Button primary onClick={() => void loadApps(true)}>
            {t("Try again")}
          </Button>
        </div>
      ) : allMode ? (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
          {all.length > 0 ? (
            <div className="grid grid-cols-5 gap-0.5">
              {all.map((app) => (
                <AppTile
                  key={app.id}
                  app={app}
                  pinned={pinned.includes(app.id)}
                  onPin={() => togglePin(app.id)}
                  onOpen={() => open(app)}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <span className="text-footnote font-medium text-label">{t("No apps found")}</span>
              <span className="text-caption text-label-3">{t("Try another name.")}</span>
            </div>
          )}
        </div>
      ) : pinnedApps.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span className="grid size-10 place-items-center rounded-[10px] bg-fill-2 text-label-2">
            <AppsIcon size={21} />
          </span>
          <span className="text-footnote font-medium text-label">{t("Pin your apps")}</span>
          <span className="max-w-56 text-caption leading-relaxed text-label-3">
            {t("Open All apps, then tap the pin on any app you want here.")}
          </span>
          <Button primary onClick={() => setMode("all")}>
            {t("Browse all apps")}
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
          <div
            ref={gridRef}
            onClickCapture={(event) => {
              if (performance.now() < suppressUntil.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            className="grid grid-cols-5 gap-0.5 select-none"
          >
            {pinnedApps.map((app) => (
              <motion.div key={app.id} layout transition={springs.snappy}>
                <AppTile
                  app={app}
                  draggable
                  dragging={draggingId === app.id}
                  onPointerDown={(event) => beginDrag(app, event)}
                  onOpen={() => open(app)}
                />
              </motion.div>
            ))}
            <motion.div layout transition={springs.snappy}>
              <button
                type="button"
                onClick={() => setMode("all")}
                className="pressable flex w-full min-w-0 flex-col items-center gap-1.5 rounded-[10px] px-1 py-1.5 text-center hover:bg-fill-1"
              >
                <span className="grid size-10 place-items-center rounded-[10px] bg-fill-2 text-label-3">
                  <AppsIcon size={20} />
                </span>
                <span className="line-clamp-2 h-[22px] w-full text-[9px] leading-[11px] font-medium text-label-3">
                  {t("All apps")}
                </span>
              </button>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}

function AppTile({
  app,
  pinned,
  onPin,
  onOpen,
  draggable,
  dragging,
  onPointerDown,
}: {
  app: AppEntry;
  pinned?: boolean;
  onPin?: () => void;
  onOpen: () => void;
  draggable?: boolean;
  dragging?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-pinned-tile={draggable ? "true" : undefined}
      onPointerDown={onPointerDown}
      className={`group relative flex min-w-0 flex-col items-center rounded-[10px] px-1 py-1.5 hover:bg-fill-1 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        dragging ? "z-10 scale-[1.04] bg-fill-2 shadow-[0_14px_28px_-14px_rgb(0_0_0/0.7)]" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`pressable flex w-full min-w-0 flex-col items-center gap-1.5 text-center outline-none ${
          draggable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <AppGlyph icon={app.icon} name={app.name} />
        <span className="line-clamp-2 h-[22px] w-full overflow-hidden text-[9px] leading-[11px] font-medium text-label-2">
          {app.name}
        </span>
      </button>
      {onPin && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPin();
          }}
          aria-label={pinned ? t("Unpin {app}", { app: app.name }) : t("Pin {app}", { app: app.name })}
          className={`absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full transition-colors duration-150 ${
            pinned ? "bg-label text-on-label" : "bg-fill-2 text-label-3 hover:text-label"
          }`}
        >
          <PushPin size={9} weight={pinned ? "fill" : "bold"} />
        </button>
      )}
      {draggable && (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-0.5 right-0.5 text-label-4 transition-opacity duration-150 ${
            dragging ? "opacity-80" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <DotsSixVertical size={9} weight="bold" />
        </span>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid flex-1 grid-cols-5 content-start gap-0.5">
      {Array.from({ length: 15 }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-1.5 px-1 py-1.5">
          <span className="size-10 animate-pulse rounded-[10px] bg-fill-2" />
          <span className="h-3 w-10 animate-pulse rounded-full bg-fill-1" />
        </div>
      ))}
    </div>
  );
}
