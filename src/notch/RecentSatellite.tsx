import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { springs } from "../design/motion";
import { AppGlyph } from "../features/apps/AppGlyph";
import {
  cachedRecentWindows,
  focusRecent,
  loadRecentWindows,
  prefetchRecentWindows,
  recentCacheAge,
  type RecentWindow,
} from "../features/recent/data";
import { isNative, onRecentHover, setRecentHit } from "../platform/native";
import { settings } from "../settings/store";
import { OpenWindowsIcon } from "../ui/OpenWindowsIcon";
import { t } from "../i18n";
import { recentHub } from "./recentHub";

/** Top-left corner of the WinZal window, clear of the notch. */
const HUB_LEFT = 8;
const HUB_TOP = 8;
const ICON_SIZE = 32;
const PANEL_GAP = 10;
const PANEL_TOP = ICON_SIZE + PANEL_GAP;
const TILE = 40;
const GAP = 6;
const PAD = 8;
const MAX_COLS = 4;
const MAX_ROWS = 5;
/** Dwell before a tile takes over, so crossing a row does not switch by accident. */
const SWITCH_DELAY = 280;
/** Close almost immediately after the cursor leaves the switcher. */
const CLOSE_DELAY = 120;
/** Only the button itself gets a tiny tolerance; the open grid uses its own edge. */
const HOVER_PAD_CLOSED = 2;
const HOVER_PAD_OPEN = 4;

/**
 * Standalone task button at the real top-left of the screen. Hovering it drops
 * a tiny icon-only grid of open windows and tray apps; dwelling on an icon
 * switches to it without a click. Clicking the button opens Windows' own Task
 * View. It lives outside the notch hit area and has its own native cursor zone,
 * so it never makes the notch peek, open or move.
 */
export function RecentSatellite({
  floating,
  liquid = false,
  onTaskView,
}: {
  floating: boolean;
  liquid?: boolean;
  onTaskView: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<RecentWindow[]>(() => cachedRecentWindows() ?? []);
  const [loading, setLoading] = useState(() => !cachedRecentWindows());
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const switchTimer = useRef<number | undefined>(undefined);
  const hoveredRef = useRef<string | null>(null);
  const retriedEmpty = useRef(false);
  const alive = useRef(true);
  const switchingRef = useRef(false);
  const openRef = useRef(false);
  openRef.current = open;

  const load = useCallback(async (refresh: boolean) => {
    const cached = cachedRecentWindows();
    if (cached) setWindows(cached);
    else setLoading(true);
    setError(null);
    try {
      const list = await loadRecentWindows(refresh);
      if (alive.current) {
        setWindows(list);
        setError(null);
      }
    } catch {
      if (alive.current) setError(t("Could not read open windows"));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  const clearSwitch = useCallback(() => {
    window.clearTimeout(switchTimer.current);
    switchTimer.current = undefined;
  }, []);

  const hideNow = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    clearSwitch();
    switchingRef.current = false;
    hoveredRef.current = null;
    setOpen(false);
    setHovered(null);
  }, [clearSwitch]);

  const scheduleHide = useCallback(() => {
    if (switchingRef.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(hideNow, CLOSE_DELAY);
  }, [hideNow]);

  const showHub = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    if (openRef.current) return;
    retriedEmpty.current = false;
    setOpen(true);
    const cached = cachedRecentWindows();
    void load(!cached || cached.length === 0 || recentCacheAge() > 2500);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    prefetchRecentWindows();
    const off = onRecentHover((inside) => {
      if (inside) showHub();
      else scheduleHide();
    });
    return () => {
      alive.current = false;
      off();
      window.clearTimeout(closeTimer.current);
      clearSwitch();
      setRecentHit(null);
      recentHub.set({ active: false, height: 0 });
    };
  }, [clearSwitch, scheduleHide, showHub]);

  const hasWindows = windows.length > 0;
  const loadingView = loading && !hasWindows;
  const cols = loadingView ? 2 : hasWindows ? Math.min(MAX_COLS, windows.length) : 1;
  const rows = loadingView ? 2 : hasWindows ? Math.ceil(windows.length / cols) : 1;
  const visibleRows = Math.min(rows, MAX_ROWS);
  const gridWidth = cols * TILE + (cols - 1) * GAP;
  const gridHeight = visibleRows * TILE + (visibleRows - 1) * GAP;
  const panelWidth = gridWidth + PAD * 2;
  const panelHeight = gridHeight + PAD * 2;
  const windowHeight = Math.max(120, HUB_TOP + PANEL_TOP + panelHeight + 12);

  // The first scan can race a display change and come back empty. Retry once
  // automatically instead of leaving a lone refresh button.
  useEffect(() => {
    if (!open || loading || hasWindows || retriedEmpty.current) return;
    retriedEmpty.current = true;
    const id = window.setTimeout(() => {
      if (alive.current) void load(true);
    }, 650);
    return () => window.clearTimeout(id);
  }, [open, loading, hasWindows, load]);

  const reportHit = useCallback(() => {
    if (!isNative) return;
    const icon = iconRef.current?.getBoundingClientRect();
    if (!icon) return;
    const viewport = {
      vw: document.documentElement.clientWidth || window.innerWidth,
      vh: document.documentElement.clientHeight || window.innerHeight,
    };
    const pad = open ? HOVER_PAD_OPEN : HOVER_PAD_CLOSED;
    if (!open) {
      setRecentHit({
        x: icon.left - pad,
        y: icon.top - pad,
        w: icon.width + pad * 2,
        h: icon.height + pad * 2,
        ...viewport,
      });
      return;
    }
    setRecentHit({
      x: icon.left - pad,
      y: icon.top - pad,
      w: panelWidth + pad * 2,
      h: PANEL_TOP + panelHeight + pad * 2,
      ...viewport,
    });
  }, [open, panelHeight, panelWidth]);

  useLayoutEffect(() => {
    reportHit();
    const timer = window.setTimeout(reportHit, 350);
    return () => window.clearTimeout(timer);
  }, [reportHit]);

  useEffect(() => {
    if (!isNative) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        reportHit();
      }, 120);
    };
    window.addEventListener("resize", schedule);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("resize", schedule);
    };
  }, [reportHit]);

  useEffect(() => {
    recentHub.set(open ? { active: true, height: windowHeight } : { active: false, height: 0 });
  }, [open, windowHeight]);

  useEffect(
    () => () => {
      recentHub.set({ active: false, height: 0 });
      setRecentHit(null);
    },
    [],
  );

  const switchTo = useCallback(
    async (entry: RecentWindow) => {
      if (switchingRef.current) return;
      clearSwitch();
      switchingRef.current = true;
      hoveredRef.current = entry.id;
      setHovered(entry.id);
      try {
        await focusRecent(entry.id);
        if (alive.current) hideNow();
      } catch {
        if (!alive.current) return;
        switchingRef.current = false;
        hoveredRef.current = null;
        setHovered(null);
        setError(t("That window is gone"));
        void load(true);
      }
    },
    [clearSwitch, hideNow, load],
  );

  const arm = useCallback(
    (entry: RecentWindow) => {
      if (switchingRef.current) return;
      if (hoveredRef.current === entry.id && switchTimer.current !== undefined) return;
      window.clearTimeout(switchTimer.current);
      hoveredRef.current = entry.id;
      setHovered(entry.id);
      switchTimer.current = window.setTimeout(() => void switchTo(entry), SWITCH_DELAY);
    },
    [switchTo],
  );

  const disarm = useCallback(() => {
    if (switchingRef.current) return;
    clearSwitch();
    hoveredRef.current = null;
    setHovered(null);
  }, [clearSwitch]);

  return (
    <motion.div
      ref={rootRef}
      data-recent-hub
      className="pointer-events-auto absolute z-30"
      style={{
        left: HUB_LEFT,
        top: HUB_TOP,
        width: ICON_SIZE,
        height: ICON_SIZE,
      }}
      initial={{ opacity: 0, scale: 0.72, x: -7 }}
      animate={{ opacity: 1, scale: 1, x: 0, transition: springs.snappy }}
      exit={{ opacity: 0, scale: 0.72, x: -5, transition: { duration: 0.14, ease: "easeIn" } }}
      // Native hover comes from the Rust hit-zone poll. Mixing in DOM leave
      // there could schedule a close from a spot that is still inside the
      // enlarged native cushion, so only the browser preview uses DOM hover.
      onPointerEnter={isNative ? undefined : () => showHub()}
      onPointerLeave={
        isNative
          ? undefined
          : (event) => {
              if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
              scheduleHide();
            }
      }
      onClick={(event) => event.stopPropagation()}
    >
      <motion.button
        ref={iconRef}
        type="button"
        aria-label={t("Task View")}
        onClick={(event) => {
          event.stopPropagation();
          hideNow();
          onTaskView();
        }}
        whileTap={{ scale: 0.9 }}
        className={`pressable relative flex size-8 items-center justify-center rounded-full border border-white/10 bg-notch text-label transition-opacity duration-150 hover:opacity-90 ${
          liquid ? "liquid-surface" : ""
        }`}
        style={{
          boxShadow: floating
            ? "0 10px 24px -8px rgb(0 0 0 / 0.65), 0 2px 8px rgb(0 0 0 / 0.3)"
            : undefined,
        }}
      >
        <OpenWindowsIcon size={18} />
        {liquid && <span aria-hidden className="liquid-rim absolute inset-0 rounded-full" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="recent-hub-panel"
            role="dialog"
            aria-label={t("Open windows")}
            className={`absolute overflow-hidden rounded-[14px] border border-separator shadow-[0_26px_60px_-18px_rgb(0_0_0/0.8),0_6px_18px_rgb(0_0_0/0.35)] ${
              settings.get().appearance.material === "liquid"
                ? "liquid-glass"
                : settings.get().appearance.material === "glass"
                  ? "bg-notch backdrop-blur-2xl"
                  : "bg-elevated"
            }`}
            style={{
              left: 0,
              top: PANEL_TOP,
              width: panelWidth,
              height: panelHeight,
              transformOrigin: "0% 0%",
              willChange: "transform, opacity",
            }}
            initial={{ opacity: 0, scale: 0.94, y: -4, x: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0, transition: springs.open }}
            exit={{ opacity: 0, scale: 0.96, y: -3, x: -2, transition: { duration: 0.12, ease: "easeIn" } }}
            onPointerEnter={() => {
              window.clearTimeout(closeTimer.current);
              closeTimer.current = undefined;
            }}
            onPointerMove={(event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              const row = target.closest("[data-recent-row]");
              if (!row) {
                disarm();
                return;
              }
              const entry = windows.find((item) => item.id === row.getAttribute("data-recent-row"));
              if (entry) arm(entry);
            }}
            onPointerLeave={() => disarm()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-full w-full items-center justify-center p-2">
              {loadingView ? (
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${cols}, ${TILE}px)`, gap: GAP }}
                >
                  {Array.from({ length: cols * rows }, (_, index) => (
                    <span
                      key={index}
                      className="animate-pulse rounded-[10px] bg-fill-1"
                      style={{ width: TILE, height: TILE }}
                    />
                  ))}
                </div>
              ) : !hasWindows ? (
                <button
                  type="button"
                  aria-label={t("Refresh open windows")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void load(true);
                  }}
                  className="pressable grid size-10 place-items-center rounded-[10px] text-label-3 hover:bg-fill-1 hover:text-label"
                >
                  <ArrowClockwise size={16} weight="bold" className={loading ? "animate-spin" : undefined} />
                </button>
              ) : (
                <div
                  className="overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{ width: gridWidth, height: gridHeight }}
                >
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: `repeat(${cols}, ${TILE}px)`, gap: GAP }}
                  >
                    {windows.map((entry) => {
                      const active = hovered === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          data-recent-row={entry.id}
                          aria-label={entry.title || entry.name}
                          onClick={(event) => {
                            event.stopPropagation();
                            disarm();
                            void switchTo(entry);
                          }}
                          className={`grid place-items-center rounded-[10px] border transition-all duration-100 ${
                            active
                              ? "-translate-y-px border-white/20 bg-fill-2 ring-1 ring-white/10"
                              : "border-separator bg-fill-1 hover:bg-fill-2"
                          }`}
                          style={{ width: TILE, height: TILE }}
                        >
                          <AppGlyph icon={entry.icon} name={entry.name} size={26} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {error && hasWindows && (
              <span
                aria-hidden
                className="pointer-events-none absolute right-2 bottom-2 size-1.5 rounded-full bg-orange"
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
