import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue, type Transition } from "motion/react";
import { Drop, GearSix, Ghost, MoonStars, PushPin } from "@phosphor-icons/react";
import { content, springs } from "../design/motion";
import { useNowPlaying } from "../platform/media";
import { isNative, keyboardFocus, onNativeBlur, onNativeHover, onShortcut, onSilentExit, onTrayOpen, setHitRect, setMemoryLow, setNotchHeight, setSilent } from "../platform/native";
import { PrivacyDots } from "../features/privacy/PrivacyDots";
import { FOCUS_CLICKS, focusMode, setFocusMode } from "./focus";
import { silentMode, setSilentMode } from "./silent";
import { useFpsHelper, useGamingLive } from "../features/system/gaming";
import { gamingMeasured, gamingWidth } from "../features/system/gamingOverlay";
import { useDragToMove } from "./drag";
import { LiveSlot, useLiveActivity } from "./live";
import { GamingSatellite } from "./GamingSatellite";
import { TimerSatellite } from "./TimerSatellite";
import { ActivitySwitch } from "./ActivitySwitch";
import { callView, useDiscordCall } from "../features/discord/store";
import { FlyoutLayer } from "./FlyoutLayer";
import { closeFlyout, flyout } from "./flyout";
import { notchOpenRequest } from "./openRequest";
import { chargingPulse, useChargingWatch } from "./useChargingWatch";
import { BatteryMeter } from "../ui/BatteryMeter";
import { NotificationLayer } from "../notifications/NotificationLayer";
import { notifications } from "../notifications/store";
import { DOCK_HEIGHT, HEADER_HEIGHT, geometry, openGeometry, type NotchGeometry } from "./geometry";
import { HeaderButton, headerSlot } from "./header";
import { ClockMeta, CompactClock } from "./ClockFace";
import { LiveRightInset } from "./liveEdges";
import { RECORDING_EXTRA, RECORDING_INSET, RecordingBadge, useRecording } from "./recording";
import { sizeOverride } from "./size";
import { lyricsTextWidth } from "../features/now-playing/lyricsWidth";
import { DARK_SURFACE, LIGHT_SURFACE, isLightColor, useThemeLight } from "../features/appearance/theme";
import { NotchShape } from "./NotchShape";
import { drop } from "../platform/drop";
import { settings, updateSettings } from "../settings/store";
import { useUnseen } from "../lib/changelog";
import { nav, navigate } from "./nav";
import { update } from "../lib/update";
import { findTab, settingsTab, tabs, type NotchTab } from "./tabs";
import { holdOpen, pinned, togglePin, useNotchState, type NotchStatus } from "./useNotchState";
import { t } from "../i18n";
import { formatTimeParts } from "../lib/format";
import { useMinute } from "../lib/useMinute";
import { timer } from "../features/timer/store";

/** `#rrggbb` + alpha → `rgba(...)`; anything else is passed through untouched. */
function fillWithAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** If the notch was closed at most this long, it reopens on the last used tool. */
const RESUME_MS = 60_000;
/** Closed this long → lower WebView2's memory target. */
const MEMORY_LOW_AFTER_MS = 60_000;
/** Compact the transparent window while closed; the open panel needs the full height. */
const CLOSED_WINDOW_HEIGHT = 120;
const OPEN_WINDOW_HEIGHT = 560;

export function Notch() {
  const { status, open, dismiss, toggle, onPointerEnter, onPointerLeave } = useNotchState();
  const focus = focusMode.use();
  const silent = silentMode.use();
  // A notification card replaces the closed pill for its lifetime; the pill
  // fades back as soon as the card is cleared.
  const noteVisible = notifications.use().length > 0;
  const hideForNote = noteVisible && status !== "open";
  const noteVisibleRef = useRef(false);
  noteVisibleRef.current = noteVisible;
  const handleEnter = useCallback(() => {
    if (!noteVisibleRef.current) onPointerEnter();
  }, [onPointerEnter]);
  const gamingLive = useGamingLive();
  useFpsHelper(gamingLive || silent);
  useChargingWatch();
  const measuredGamingWidth = gamingMeasured.use();
  const [measuredClockWidth, setMeasuredClockWidth] = useState(0);
  const clockRow = useRef<HTMLDivElement>(null);
  const { tools: toolSettings, display: displaySettings, appearance, gaming } = settings.use();
  // Silent mode is the only ghost; game transparency reuses the Glass alpha (0.62).
  const ghostOpacity = silent && status !== "open" ? (appearance.ghostSolid ? 1 : 0.28) : 1;
  const materialAlpha = appearance.material === "glass" ? 0.62 : appearance.material === "dark" ? 0.82 : 1;
  const notchAlpha = gaming.transparent && gamingLive ? 0.62 : materialAlpha;
  // Measured is the truth once the live row exists. The estimate is only for
  // the first paint; adding both kept a permanent dead gutter around the stats.
  const systemWidth = measuredGamingWidth > 0 ? measuredGamingWidth : gamingWidth(gaming);
  useEffect(() => {
    setSilent(silent && status !== "open");
  }, [silent, status]);
  useEffect(
    () =>
      onSilentExit(() => {
        setSilentMode(false);
        open();
        keyboardFocus(true);
      }),
    [open],
  );
  const light = useThemeLight();
  const floating = appearance.style === "windows";
  // Line as the normal closed look: hover and click work as usual, but nothing shows
  // while closed. Only a finished timer opens it into the notch, until dismissed.
  const timerState = timer.use();
  const timerDone = timerState.finished;
  const timerLive = timerState.endsAt !== null || timerDone;
  const idleLine = displaySettings.idleStyle === "line";
  const alert = idleLine && timerDone;
  const visible = toolSettings.filter((t) => t.enabled).map((t) => findTab(t.id)).filter((t): t is NotchTab => !!t);
  const { tabId } = nav.use();
  // Hidden tool active (e.g. just disabled) → first visible one.
  const tab = tabId === settingsTab.id ? settingsTab : (visible.find((t) => t.id === tabId) ?? visible[0] ?? tabs[0]);
  const np = useNowPlaying();
  const live = useLiveActivity();
  const call = useDiscordCall();
  const charge = chargingPulse.use();
  const chargingView = charge.active && status !== "open" && !idleLine;

  // Like the Dynamic Island: opening jumps to the running activity's tool,
  // but only after a pause. Closed briefly (copying a key, grabbing a file) → you
  // land where you were, e.g. in the settings.
  // Layout effect runs before paint → no frame with the old tab size.
  const prevStatus = useRef(status);
  const closedAt = useRef(0);
  // A target tool from the tray (settings entry) takes priority over the live activity.
  const trayTab = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (status === "open" && prevStatus.current !== "open") {
      const resumed = Date.now() - closedAt.current < RESUME_MS;
      if (trayTab.current) navigate(trayTab.current);
      else if (!resumed && live.id && visible.some((t) => t.id === live.id)) navigate(live.id);
      trayTab.current = null;
    }
    if (status !== "open" && prevStatus.current === "open") closedAt.current = Date.now();
    prevStatus.current = status;
  });

  useQuickDrop(status, open, dismiss);

  const override = sizeOverride.use();
  const size = override?.tabId === tab.id ? override : tab.size;
  // Live activity shown in the closed notch (the idle line only lets the timer alarm through).
  const shownLive = chargingView ? null : idleLine ? (alert ? "timer" : null) : live.id;
  // The closed clock is optional; Windows island prefers it over the live media slot.
  const clockWeather = appearance.clockWeather;
  // Lyrics only make sense when the media pill is visible, so they win over the clock
  // in the floating island (otherwise the whole lyrics option would do nothing there).
  const lyricsPill = appearance.lyricsInPill && shownLive === "media";
  const pillLive = floating ? (clockWeather && !lyricsPill ? null : shownLive) : shownLive;
  const clockPill = !chargingView && clockWeather && !pillLive;
  // Measure the real clock row in the parent so date/day/weather toggles and
  // face changes resize the pill immediately, without a store subscription race.
  useLayoutEffect(() => {
    if (!clockPill || status === "open") return;
    const el = clockRow.current;
    if (!el) {
      setMeasuredClockWidth(0);
      return;
    }
    const report = () => setMeasuredClockWidth(Math.ceil(el.getBoundingClientRect().width + 24));
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => {
      ro.disconnect();
      setMeasuredClockWidth(0);
    };
  }, [clockPill, status]);
  // Screen recording gets its own chip at the right end of the closed pill.
  const { recording, since } = useRecording();
  const showRecording = recording && !idleLine && status !== "open";
  const rightInset = useMotionValue(0);
  useEffect(() => {
    const control = animate(rightInset, showRecording ? RECORDING_INSET : 0, springs.snappy);
    return () => control.stop();
  }, [showRecording, rightInset]);
  // The idle line never passes through the small notch: line → slightly bigger line on
  // hover → open, and straight back to the line on close.
  const lineIdle = idleLine && !alert;
  const lineView = lineIdle && status !== "open";
  const linePeek = status === "peek";
  const lineHeight = appearance.lineThickness + (linePeek ? 2 : 0);
  const baseShape = lineView
    ? {
        ...(linePeek ? geometry.linePeek : geometry.line),
        w: appearance.lineWidth + (linePeek ? 16 : 0),
        h: lineHeight,
        r: lineHeight / 2,
      }
    : shapeFor(status, pillLive, size, systemWidth);
  const shape =
    !lineView && appearance.corners === "squared" && baseShape.r > 5
      ? { ...baseShape, r: Math.min(baseShape.r, 8), ear: Math.min(baseShape.ear, 3) }
      : baseShape;
  const customIsland = !lineView && status !== "open";
  // Gaming owns its width: it is measured from the live row. The island width
  // setting is optional extra air, never a subtraction, so it cannot clip or
  // leave a permanent gap when set to 0.
  const gamingPill = !lineView && status !== "open" && pillLive === "system";
  const extraWidth = Math.max(0, appearance.islandWidth);
  const sizedShape = customIsland
    ? {
        ...shape,
        w: Math.max(80, shape.w + (lyricsPill || gamingPill ? 0 : extraWidth)),
        h: lyricsPill ? appearance.lyricsPillHeight : appearance.islandHeight,
      }
    : shape;
  const tightHit = lineView;
  const finalShape = floating
    ? {
        ...sizedShape,
        ear: 0,
        // Keep the resting island tight: just the clock and the weather.
        w:
          floating && clockPill && status !== "open" && !tightHit
            ? Math.min(sizedShape.w, status === "peek" ? 222 + appearance.islandWidth : 206 + appearance.islandWidth)
            : sizedShape.w,
      }
    : sizedShape;
  const topPad = floating && !tightHit ? 8 : 0;
  const sticky = useStickyHitZone(status, size.h);
  const lyricWidth = lyricsTextWidth.use();
  const clockExtra = clockPill && !idleLine && status !== "open" ? Math.max(0, (appearance.clockClosedSize - 13) * 5) : 0;
  // Grow or shrink to the line, with three levels of breathing room. `normal`
  // is the text-fit width; compact caps long lines, long adds extra air.
  const lyricPill = appearance.lyricsInPill && pillLive === "media" && !idleLine && status !== "open";
  const lyricTarget = !lyricPill || lyricWidth <= 0
    ? 0
    : appearance.lyricsPillAuto
      ? Math.max(appearance.lyricsPillMinWidth, Math.min(appearance.lyricsPillLength, lyricWidth + (appearance.lyricsVisualizer ? 108 : 78)))
      : appearance.lyricsPillLength;
  const lyricsExtra = lyricTarget > 0 ? Math.min(360, Math.max(0, lyricTarget - geometry.live.w)) : 0;

  // The row is measured from the real clock face. The shape is exactly that
  // text plus 24 px (12 px per side) and optional Extra width; toggling date,
  // day or weather off shrinks it immediately instead of keeping a fixed floor.
  // Use the measured row as soon as it exists. The old estimate is only for
  // the first frame; keeping `max(measured, 206…)` was the hidden floor that
  // stopped the pill from shrinking when date/day/weather were turned off.
  const clockContent = measuredClockWidth > 0 ? measuredClockWidth : 206 + clockExtra;
  const clockShapeWidth =
    Math.min(740, Math.max(76, clockContent + extraWidth + (status === "peek" ? 16 : 0))) +
    (showRecording ? RECORDING_EXTRA : 0);
  const displayShape = {
    ...finalShape,
    w: clockPill && status !== "open" ? clockShapeWidth : finalShape.w + (showRecording ? RECORDING_EXTRA : 0) + lyricsExtra,
  };
  // Gaming stats own the pill; a playing track gets its own little island instead.
  const gamingSatellite =
    pillLive === "system" && !!np?.isPlaying && appearance.musicInPill && !idleLine && status !== "open";
  // A running timer gets its own circle on the right whenever another live
  // activity owns the main pill (gaming, call, music).
  const timerSatellite = timerLive && !idleLine && status !== "open" && pillLive !== "timer";
  // Call + music: a circular switch shows the other activity. It sits first on
  // the right; the timer moves one slot further right when both are present.
  const canSwap = !!call && !!np?.isPlaying && appearance.musicInPill;
  const switchKind: "music" | "call" | null = canSwap
    ? pillLive === "discord"
      ? "music"
      : pillLive === "media"
        ? "call"
        : null
    : null;
  const switchSatellite = !!switchKind && !idleLine && status !== "open";
  const timerShift = switchSatellite ? 40 : 0;
  const surface = appearance.theme === "custom" ? appearance.themeColor : light ? LIGHT_SURFACE : DARK_SURFACE;
  const surfaceLight = isLightColor(surface);
  const transition = useTransitionFor(status, displayShape, lyricTarget > 0);

  // Click outside closes (in the browser the fake desktop, in Tauri the window blur).
  const hitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      const inNotch = !!hitRef.current?.contains(target as Node);
      // Flyouts and notification cards are their own hit surfaces. Clicking them
      // must never close them or the notch behind them.
      if (
        target instanceof Element &&
        target.closest("[data-flyout-hit], [data-notification-hit]")
      ) {
        return;
      }
      // A button that owns a flyout must receive the click itself; closing the
      // panel here first made "click again to close" close and instantly reopen.
      if (target instanceof Element && target.closest("[data-flyout-toggle]")) return;
      if (inNotch) {
        if (target instanceof Element && target.closest("[data-edge-drag]")) return;
        // Clicking inside the expanded notch leaves an attached panel open.
        return;
      }
      if (flyout.get().kind !== null) closeFlyout();
      dismiss();
    };
    window.addEventListener("pointerdown", onDown);
    const offBlur = onNativeBlur(dismiss);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      offBlur();
    };
  }, [dismiss]);

  // Attached panels belong to the tool that opened them.
  useEffect(() => {
    closeFlyout();
  }, [tab.id]);

  // An attached panel only makes sense while the notch is open.
  useEffect(() => {
    if (status !== "open" && flyout.get().kind !== null) closeFlyout();
  }, [status]);

  useNativeBridge(hitRef, handleEnter, onPointerLeave, hideForNote);
  const drag = useDragToMove(status);


  // Three quick clicks toggle Windows Do Not Disturb.
  const onClick = (e: React.MouseEvent) => {
    if (drag.moved()) return;
    if (e.detail >= FOCUS_CLICKS && !isInteractive(e.target)) return setFocusMode(!focus);
    if (status !== "open") open();
  };

  // Shortcut: opening takes focus (Esc, typing), closing gives it back.
  useEffect(() => onShortcut(() => toggle() === "open" && keyboardFocus(true)), [toggle]);
  // A downward drag on a notification asks the notch to open.
  useEffect(() => notchOpenRequest.subscribe(() => open()), [open]);
  useEffect(
    () =>
      onTrayOpen((tab) => {
        // Only remember it while opening, otherwise it would stick for the next open.
        trayTab.current = status === "open" ? null : tab;
        if (tab) navigate(tab);
        open();
        keyboardFocus(true);
      }),
    [open, status],
  );
  useEffect(() => {
    if (status === "closed") keyboardFocus(false);
  }, [status]);

  // A 760×560 transparent always-on-top window is far more compositor work
  // than the closed pill. Keep only the top 120 px while closed, and expand
  // before the open panel animates in.
  useEffect(() => {
    if (!isNative) return;
    if (status !== "closed") {
      setNotchHeight(OPEN_WINDOW_HEIGHT);
      return;
    }
    const id = window.setTimeout(() => setNotchHeight(CLOSED_WINDOW_HEIGHT), 450);
    return () => window.clearTimeout(id);
  }, [status]);

  // After a minute closed, let WebView2 lower its memory target; the first
  // hover/peek restores normal before the notch opens, so paging stays hidden.
  // Do not trim the working set while the panel is open: paging out live
  // compositor pages was the only source of periodic hitches.
  useEffect(() => {
    if (status !== "closed" || gamingLive) {
      setMemoryLow(false);
      return;
    }
    const id = window.setTimeout(() => setMemoryLow(true), MEMORY_LOW_AFTER_MS);
    return () => {
      window.clearTimeout(id);
      setMemoryLow(false);
    };
  }, [status, gamingLive]);

  // 1–9 switches tools while open and not typing.
  useEffect(() => {
    if (status !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      const tab = visible[Number(e.key) - 1];
      if (tab) navigate(tab.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, visible]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center transition-opacity duration-200"
      data-surface={surfaceLight ? "light" : "dark"}
      // In the browser the notch moves inside the window; natively the whole window moves (display.rs).
      style={{
        ["--accent" as string]: appearance.accent === "auto" ? np?.accent : appearance.accent,
        ["--color-notch" as string]: fillWithAlpha(surface, notchAlpha),
        transform: isNative ? undefined : `translateX(${drag.offset}px)`,
      }}
    >
      {/* Hit zone: bigger than the visible shape (Fitts) and flush with the top edge. */}
      <div
        ref={hitRef}
        data-notch-hit
        // The line is meant to stay out of the way: only a hair of extra hit zone, so
        // the cursor has to be on it (the normal notch gets the generous Fitts margin).
        className={`${hideForNote ? "pointer-events-none" : "pointer-events-auto"} ${tightHit ? "px-1 pb-1" : "px-4 pb-3"}`}
        style={{ minHeight: sticky.minHeight, paddingTop: topPad, cursor: drag.dragging ? "grabbing" : undefined }}
        onPointerMove={sticky.onPointerMove}
        onPointerDown={drag.onPointerDown}
        // In Tauri, hover comes from the Rust poll (useNativeBridge), not the DOM.
        onPointerEnter={isNative ? undefined : handleEnter}
        onPointerLeave={isNative ? undefined : onPointerLeave}
        onClick={onClick}
      >
        <motion.div
          className="relative"
          animate={{
            x: appearance.dragAnimation ? drag.lag : 0,
            scaleX: appearance.dragAnimation ? 1 + Math.abs(drag.lag) / 500 : 1,
            scaleY: appearance.dragAnimation ? 1 - Math.abs(drag.lag) / 1600 : 1,
          }}
          transition={springs.peek}
          style={{
            transformOrigin: "50% 0%",
            opacity: hideForNote ? 0 : ghostOpacity,
            pointerEvents: hideForNote ? "none" : undefined,
            transition: "opacity 220ms ease",
          }}
        >
        <NotchShape
          geometry={displayShape}
          transition={transition}
          elevated={status === "open"}
          floating={floating}
        >
          <LiveRightInset.Provider value={rightInset}>
            <LiveSlot id={status === "open" ? null : pillLive} recording={showRecording} extra={lyricsExtra} widthExtra={lyricsPill ? 0 : appearance.islandWidth} height={lyricsPill ? appearance.lyricsPillHeight : appearance.islandHeight} systemWidth={systemWidth} />
          </LiveRightInset.Provider>
          {!chargingView && clockWeather && !idleLine && status !== "open" && !pillLive && <ClosedClock rowRef={clockRow} />}
          <AnimatePresence>
            {chargingView && <ChargingPulse key="charging" percent={charge.percent} />}
          </AnimatePresence>
          {!idleLine && <PrivacyDots hideScreen={showRecording} />}
          <AnimatePresence>
            {showRecording && (
              <RecordingBadge key="recording" since={since} className="absolute top-1/2 right-2 -translate-y-1/2" />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {status === "open" && (
              <motion.div
                key="open"
                className="absolute top-0 left-1/2 flex flex-col"
                style={{ width: size.w, height: size.h, marginLeft: -size.w / 2 }}
                // Opacity + a short slide only: scaling or blurring the whole
                // panel re-rasterizes the visualization and reads as jank.
                initial={{ opacity: 0, transform: "translateY(-4px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)", transition: content.enter }}
                exit={{ opacity: 0, transform: "translateY(-3px)", transition: content.exit }}
              >
                <Header
                  title={t(tab.label)}
                  onDragStart={drag.onPointerDown}
                  onSilent={() => {
                    const next = !silentMode.get();
                    setSilentMode(next);
                    if (next) dismiss();
                  }}
                />
                <div className="relative min-h-0 flex-1 overflow-clip">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={tab.id}
                      className="absolute inset-0"
                      initial={{ opacity: 0, transform: "translateY(2px)" }}
                      animate={{ opacity: 1, transform: "translateY(0px)", transition: content.enter }}
                      exit={{ opacity: 0, transform: "translateY(-2px)", transition: content.exit }}
                    >
                      <tab.View />
                    </motion.div>
                  </AnimatePresence>
                </div>
                <Dock tabs={visible} activeId={tab.id} />
              </motion.div>
            )}
          </AnimatePresence>
        </NotchShape>
        {lineView && (
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <motion.span
              className="block rounded-full"
              style={{
                width: 8,
                height: Math.max(2, lineHeight),
                background: "#ffd60a",
                boxShadow: "0 0 12px 2px rgb(255 214 10 / 0.55)",
              }}
              initial={false}
              animate={{ opacity: linePeek ? 1 : 0.55, scaleX: linePeek ? 1.8 : 1 }}
              transition={springs.snappy}
            />
          </span>
        )}
        {/* Endpoint grips: the notch can be moved even while an attached panel
            or satellite extends it. A click on the panel closes the panel; this
            grip keeps it open and drags the whole assembly. */}
        {!lineView && (
          <>
            <div
              aria-hidden
              data-drag-handle
              data-edge-drag
              className="pointer-events-auto absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize rounded-l-[inherit] transition-colors duration-150 hover:bg-white/10"
            />
            <div
              aria-hidden
              data-drag-handle
              data-edge-drag
              className="pointer-events-auto absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize rounded-r-[inherit] transition-colors duration-150 hover:bg-white/10"
            />
          </>
        )}
        <GamingSatellite show={gamingSatellite} playing={!!np?.isPlaying} floating={floating} />
        <ActivitySwitch
          show={switchSatellite}
          kind={switchKind}
          onSwitch={() => callView.set(switchKind === "music" ? "music" : "call")}
          floating={floating}
        />
        <TimerSatellite
          show={timerSatellite}
          floating={floating}
          shift={timerShift}
          onOpen={() => {
            navigate("timer");
            open();
            keyboardFocus(true);
          }}
        />
        <FlyoutLayer />
        </motion.div>
      </div>
      <NotificationLayer />
    </div>
  );
}

/** Windows-island style: the selected clock face in the floating closed pill. */
function ChargingPulse({ percent }: { percent: number }) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center gap-2"
      initial={{ opacity: 0, scale: 0.86, y: 3 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: springs.open }}
      exit={{ opacity: 0, scale: 0.92, y: -2, transition: springs.close }}
      style={{ transformOrigin: "50% 50%", willChange: "transform, opacity" }}
    >
      <span className="relative flex items-center justify-center">
        <motion.span
          aria-hidden
          className="absolute size-6 rounded-full bg-green/25"
          animate={{ scale: [0.8, 1.7], opacity: [0.55, 0] }}
          transition={{ duration: 1.25, repeat: 2, ease: "easeOut" }}
        />
        <BatteryMeter percent={percent} charging plugged size="md" />
      </span>
      <span className="text-caption font-semibold text-label">{t("Charging")}</span>
    </motion.div>
  );
}

/** Windows-island style: the selected clock face in the floating closed pill. */
function ClosedClock({ rowRef }: { rowRef: RefObject<HTMLDivElement | null> }) {
  const now = useMinute();
  const appearance = settings.use().appearance;
  const size = appearance.clockClosedSize;
  const smallSize = Math.max(8, Math.round(size * 0.66));
  const { period } = formatTimeParts(now);
  // Clock-only mode: no date/day/weather. In that minimal state the period is
  // hidden too, so the pill can shrink to just the time.
  const extras = appearance.clockShowWeather || appearance.clockShowDate || appearance.clockShowDay;

  // One-line faces share the baseline with PM and the weather; the two-line
  // Stacked face keeps the side text centered against the block.
  const baseline = appearance.clockStyle !== "stacked";
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-1">
      <div
        ref={rowRef}
        className={`flex w-max shrink-0 ${baseline ? "items-baseline" : "items-center"} gap-2 whitespace-nowrap`}
        style={{ fontWeight: appearance.clockClosedWeight }}
      >
        <span className={`flex min-w-0 ${baseline ? "items-baseline" : "items-center"} gap-1`}>
          <span className="min-w-0 overflow-hidden tabular leading-none text-label" style={{ fontSize: `${size}px` }}>
            <CompactClock
              style={appearance.clockStyle}
              now={now}
              size={size}
              height={appearance.islandHeight}
            />
          </span>
          {extras && period && appearance.clockShowPeriod && (
            <span className="shrink-0 text-label-3 leading-none" style={{ fontSize: `${smallSize}px` }}>
              {period}
            </span>
          )}
        </span>
        {extras && (
          <span className="flex shrink-0 items-baseline text-label-3 leading-none" style={{ fontSize: `${smallSize}px` }}>
            <ClockMeta now={now} compact />
          </span>
        )}
      </div>
    </div>
  );
}

/** Header: tool title on the left, actions + pin on the right. The middle (camera) stays free. */
function Header({ title, onDragStart, onSilent }: { title: string; onDragStart: (e: React.PointerEvent) => void; onSilent: () => void }) {
  const isPinned = pinned.use();
  const focus = focusMode.use();
  const silent = silentMode.use();
  const liquidGlass = settings.use().appearance.material === "glass";
  const toggleLiquidGlass = () =>
    updateSettings((cur) => ({
      appearance: { ...cur.appearance, material: cur.appearance.material === "glass" ? "solid" : "glass" },
    }));
  return (
    // Empty header space = drag handle.
    <div data-drag-handle onPointerDown={onDragStart} className="flex shrink-0 items-center justify-between gap-3 pr-3 pl-5" style={{ height: HEADER_HEIGHT + 4 }}>
      <div className="relative min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h2
            key={title}
            className="truncate text-title"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
          >
            {title}
          </motion.h2>
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-1">
        {/* Tools render here via <HeaderActions> (src/notch/header.tsx). The grid stacks old and new during a switch. */}
        <div ref={(el) => headerSlot.set(el)} className="grid" />
        <HeaderButton
          label={silent ? t("Silent mode off") : t("Silent mode")}
          active={silent}
          onClick={onSilent}
        >
          <Ghost size={14} weight={silent ? "fill" : "bold"} />
        </HeaderButton>
        <HeaderButton
          label={liquidGlass ? t("Liquid Glass off") : t("Liquid Glass")}
          active={liquidGlass}
          onClick={toggleLiquidGlass}
        >
          <Drop size={14} weight={liquidGlass ? "fill" : "bold"} />
        </HeaderButton>
        <HeaderButton
          label={focus ? t("Nicht stören ausschalten") : t("Nicht stören")}
          active={focus}
          onClick={() => setFocusMode(!focus)}
        >
          <MoonStars size={14} weight={focus ? "fill" : "bold"} />
        </HeaderButton>
        <HeaderButton label={isPinned ? t("Lösen") : t("Offen halten")} active={isPinned} onClick={togglePin}>
          <PushPin size={14} weight={isPinned ? "fill" : "bold"} />
        </HeaderButton>
      </div>
    </div>
  );
}

/** Tool bar at the bottom (like OmniNotch). The gear at the end toggles between settings and the last tool. */
function Dock({ tabs, activeId }: { tabs: NotchTab[]; activeId: string }) {
  const lastTool = useRef(tabs[0]?.id);
  if (activeId !== settingsTab.id) lastTool.current = activeId;
  const inSettings = activeId === settingsTab.id;
  const updateReady = update.use().phase === "available";
  // Dot on the gear = update ready or unseen changes → jump straight to that section.
  const unseen = useUnseen().length > 0;
  const badge = updateReady || unseen;

  return (
    <div className="flex shrink-0 items-start justify-center gap-0.5 px-4 pt-1" style={{ height: DOCK_HEIGHT }}>
      {tabs.map((tab) => (
        <DockButton key={tab.id} label={t(tab.label)} icon={tab.icon} active={tab.id === activeId} onClick={() => navigate(tab.id)} />
      ))}
      <span aria-hidden className="mx-1.5 mt-2 h-4 w-px bg-separator" />
      <DockButton
        label={t(settingsTab.label)}
        icon={GearSix}
        active={inSettings}
        badge={badge}
        onClick={() => (inSettings ? navigate(lastTool.current ?? tabs[0].id) : navigate(settingsTab.id, badge ? "updates" : null))}
      />
    </div>
  );
}

function DockButton(props: { label: string; icon: NotchTab["icon"]; active: boolean; onClick: () => void; badge?: boolean }) {
  const I = props.icon;
  return (
    <button
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`pressable relative flex h-8 w-8 items-center justify-center rounded-[10px] ${
        props.active ? "text-label" : "text-label-3 hover:text-label-2"
      }`}
    >
      {props.active && <motion.span layoutId="dock-pill" className="absolute inset-0 rounded-[10px] bg-fill-2" transition={springs.snappy} />}
      <I
        size={16}
        weight={props.active ? "fill" : "bold"}
        className="relative"
      />
      {/* Badge dot (e.g. update available) at the icon's top right. */}
      <AnimatePresence>
        {props.badge && (
          <motion.span
            className="absolute top-1 right-1 size-[7px] rounded-full bg-link ring-2 ring-notch"
            initial={{ opacity: 0, transform: "scale(0.9)" }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            exit={{ opacity: 0, transform: "scale(0.9)" }}
            transition={springs.snappy}
          />
        )}
      </AnimatePresence>
    </button>
  );
}

/**
 * With the dock at the bottom, a shorter tool moves it up, so the cursor would
 * suddenly be outside and the notch would close. So the hit zone only shrinks
 * once the cursor is back over the shape (or the notch closes).
 * Applies natively too: Rust gets this zone's rectangle.
 */
function useStickyHitZone(status: NotchStatus, height: number) {
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const prev = useRef(height);
  useLayoutEffect(() => {
    if (status !== "open") setMinHeight(undefined);
    else if (height < prev.current) {
      const from = prev.current + HIT_PAD_BOTTOM;
      setMinHeight((m) => Math.max(m ?? 0, from));
    }
    prev.current = height;
  }, [status, height]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (minHeight === undefined) return;
    const shapeBottom = e.currentTarget.getBoundingClientRect().top + height;
    if (e.clientY < shapeBottom) setMinHeight(undefined);
  };
  return { minHeight, onPointerMove };
}

/** pb-3 of the hit zone. */
const HIT_PAD_BOTTOM = 12;

function shapeFor(status: NotchStatus, live: string | null, size: { w: number; h: number }, systemWidth = geometry.gaming.w): NotchGeometry {
  if (status === "open") return openGeometry(size.w, size.h);
  const base = live === "system" ? { ...geometry.gaming, w: systemWidth } : live ? geometry.live : geometry.closed;
  if (status === "peek") {
    // Hover nudge relative to the current width so it also fits the live state.
    const bump = geometry.peek.w - geometry.closed.w;
    return { ...geometry.peek, w: base.w + bump };
  }
  return base;
}

/** Picks the spring for the transition (open ≠ close ≠ morph). */
function useTransitionFor(status: NotchStatus, shape: NotchGeometry, smooth = false): Transition {
  const prev = useRef(status);
  const key = `${shape.w}x${shape.h}`;
  const prevKey = useRef(key);

  let t: Transition;
  if (status === "open") t = prev.current === "open" ? springs.morph : springs.open;
  else if (status === "peek") t = springs.peek;
  else t = prev.current === "open" ? springs.close : smooth ? springs.lyricWidth : springs.morph;

  // Only switch when the shape actually changes, otherwise the running spring continues.
  const stable = useRef(t);
  if (prevKey.current !== key) stable.current = t;

  useEffect(() => {
    prev.current = status;
    prevKey.current = key;
  });

  return stable.current;
}

/**
 * Quick drop: drag files over the notch and it opens on Shelf or Converter
 * (whichever was used last). A cancelled drag closes it again if it only opened for that.
 */
function useQuickDrop(status: NotchStatus, open: () => void, dismiss: () => void) {
  const openedByDrag = useRef(false);
  const fileTool = useRef<"shelf" | "convert">("convert");
  const holding = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(
    () =>
      nav.subscribe(() => {
        const id = nav.get().tabId;
        if (id === "shelf" || id === "convert") fileTool.current = id;
      }),
    [],
  );

  useEffect(
    () =>
      drop.subscribe(() => {
        const { dragging, dropped } = drop.get();
        if (dragging && !holding.current) {
          holding.current = true;
          holdOpen(true);
          if (statusRef.current !== "open") {
            openedByDrag.current = true;
            open();
          }
          const current = nav.get().tabId;
          if (current !== "shelf" && current !== "convert") navigate(fileTool.current);
        } else if (!dragging && holding.current) {
          // Drag over: dropped → stay open, cancelled → close again.
          holding.current = false;
          holdOpen(false);
          if (!dropped && openedByDrag.current) dismiss();
          openedByDrag.current = false;
        }
      }),
    [open, dismiss],
  );
}

/**
 * Link to the native shell: reports the hit zone to Rust (click-through), receives
 * hover from the Rust poll and keeps the window clickable while typing.
 */
function useNativeBridge(
  hitRef: RefObject<HTMLDivElement | null>,
  onEnter: () => void,
  onLeave: () => void,
  collapse = false,
) {
  useEffect(() => {
    const el = hitRef.current;
    if (!isNative || !el) return;

    // The shape's size is animated by a spring → ResizeObserver fires every frame.
    // Notifications are separate fixed cards; their union keeps them clickable.
    let frame = 0;
    let cardFrame = 0;
    let cardTimer = 0;
    let cardTimerLate = 0;
    const cards = new Set<HTMLElement>();
    const report = () => {
      const r = el.getBoundingClientRect();
      let left = r.left;
      let top = r.top;
      let right = r.right;
      let bottom = r.bottom;
      if (collapse) {
        // Notification replaces the pill: only the card stays clickable, so the
        // hidden notch does not swallow desktop clicks around it.
        left = Infinity;
        top = Infinity;
        right = -Infinity;
        bottom = -Infinity;
      }
      cards.forEach((card) => {
        const c = card.getBoundingClientRect();
        if (c.width <= 0 || c.height <= 0) return;
        left = Math.min(left, c.left);
        top = Math.min(top, c.top);
        right = Math.max(right, c.right);
        bottom = Math.max(bottom, c.bottom);
      });
      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        left = r.left;
        top = r.top;
        right = r.right;
        bottom = r.bottom;
      }
      setHitRect({
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
        vw: document.documentElement.clientWidth || window.innerWidth,
        vh: document.documentElement.clientHeight || window.innerHeight,
      });
    };
    // Several observers can fire in one frame; send one hit rect per frame.
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        report();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const refreshCards = () => {
      const next = new Set(
        document.querySelectorAll<HTMLElement>(
          collapse ? "[data-notification-hit]" : "[data-notification-hit], [data-flyout-hit]",
        ),
      );
      for (const card of cards) if (!next.has(card)) ro.unobserve(card);
      for (const card of next) if (!cards.has(card)) ro.observe(card);
      cards.clear();
      next.forEach((card) => cards.add(card));
      schedule();
    };
    // The store changes before React commits. Check immediately, after the
    // commit frame, and once the exit spring has removed a dismissed card.
    // This replaces the old body-wide MutationObserver, which ran on every
    // unrelated DOM update (lyrics, clock, visualizations).
    const refreshSoon = () => {
      refreshCards();
      window.cancelAnimationFrame(cardFrame);
      cardFrame = window.requestAnimationFrame(refreshCards);
      window.clearTimeout(cardTimer);
      window.clearTimeout(cardTimerLate);
      cardTimer = window.setTimeout(refreshCards, 40);
      cardTimerLate = window.setTimeout(refreshCards, 450);
    };
    const unsubscribe = notifications.subscribe(refreshSoon);
    const unsubscribeFlyout = flyout.subscribe(refreshSoon);
    const unsubscribeTimer = timer.subscribe(refreshSoon);
    // Overlays such as the timer satellite can appear because music/call
    // priority changed, without any of the stores above changing. Watch only
    // child-list additions/removals and refresh when a hit overlay is involved;
    // this is much narrower than the old body-wide layout observer.
    const overlayObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
          if (!(node instanceof Element)) continue;
          if (node.matches("[data-flyout-hit], [data-notification-hit]") || node.querySelector("[data-flyout-hit], [data-notification-hit]")) {
            refreshSoon();
            return;
          }
        }
      }
    });
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    refreshCards();
    report();
    // A display/DPI change can alter the CSS viewport without resizing the hit
    // zone, so report that too.
    window.addEventListener("resize", schedule);

    const offHover = onNativeHover((inside) => (inside ? onEnter() : onLeave()));
    // Text field focused → hold (clickable, no collapse) until focus leaves.
    let typing = false;
    const onFocusIn = (e: FocusEvent) => {
      if (isTextField(e.target) && !typing) holdOpen((typing = true));
    };
    const onFocusOut = (e: FocusEvent) => {
      if (typing && !isTextField(e.relatedTarget)) holdOpen((typing = false));
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(cardFrame);
      window.clearTimeout(cardTimer);
      window.clearTimeout(cardTimerLate);
      unsubscribe();
      unsubscribeFlyout();
      unsubscribeTimer();
      overlayObserver.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      offHover();
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      if (typing) holdOpen(false);
    };
  }, [hitRef, onEnter, onLeave, collapse]);
}

function isInteractive(el: EventTarget | null): boolean {
  return el instanceof Element && !!el.closest("button, input, textarea, a, [role=slider]");
}

function isTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}
