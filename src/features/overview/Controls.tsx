import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowClockwise,
  Lock,
  Moon,
  MoonStars,
  Power,
  SpeakerHigh,
  SpeakerLow,
  SpeakerNone,
  SpeakerSimpleSlash,
  Sun,
  SunDim,
  SunHorizon,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import {
  fpsHelperReady,
  systemControls,
  type BrightnessState,
  type EnergyState,
  type GlimState,
  type PowerMode,
  type VolumeState,
} from "../../platform/services";
import { BatteryIcon, BluetoothOffIcon, BluetoothOnIcon, WifiOffIcon, WifiOnIcon } from "../../ui/glyphs";
import { focusMode, refreshFocusMode, setFocusMode } from "../../notch/focus";
import { toggleFlyout } from "../../notch/flyout";
import { useBluetoothAmbient, useWifiAmbient, toggleBluetooth, toggleWifi } from "./ambient";
import { PowerMenu } from "./PowerMenu";
import { t } from "../../i18n";

type TileIcon = React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>;

/* ────────────────────────────────────────────────────────────────────────────
 * A compact toggle tile: icon in a soft circle, two lines of text, and a
 * springy state change (fill, icon swap, halo, status dot).
 * ──────────────────────────────────────────────────────────────────────────── */

function ToggleTile(props: {
  label: string;
  state: string;
  active: boolean;
  onIcon?: TileIcon;
  offIcon?: TileIcon;
  /** Fully custom glyph, e.g. a battery whose fill follows the mode. */
  renderGlyph?: (active: boolean) => React.ReactNode;
  /** Changes when the glyph content changes, so it springs again. */
  glyphKey?: string;
  iconClassName?: string;
  onClick: () => void;
  /** Short press-and-hold opens the attached panel. Tap still does the primary action. */
  onHold?: () => void;
  /** Hold duration in ms. Default 420; Power uses a quick hold. */
  holdMs?: number;
  onContextMenu?: (e: React.MouseEvent) => void;
  onWheel?: (e: React.WheelEvent) => void;
  /** Active-state dot (Wi-Fi / Bluetooth). */
  dot?: string;
  /** Always-visible state dot (Power modes). */
  statusDot?: string;
  title?: string;
  iconSize?: number;
  /** Keep the glyph level (iPhone toggles do not tilt). */
  straight?: boolean;
  /** No circle behind the glyph, just black/white. */
  bareIcon?: boolean;
  activeIconBgClass?: string;
}) {
  const On = props.onIcon;
  const Off = props.offIcon;
  const size = props.iconSize ?? 17;
  const swap = props.straight ? 0 : props.active ? -30 : 30;
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimer = useRef<number | undefined>(undefined);
  const holdFrame = useRef<number | undefined>(undefined);
  const holdFired = useRef(false);
  const holdOrigin = useRef({ x: 0, y: 0 });

  useEffect(
    () => () => {
      window.clearTimeout(holdTimer.current);
      cancelAnimationFrame(holdFrame.current ?? 0);
    },
    [],
  );

  const stopHold = () => {
    window.clearTimeout(holdTimer.current);
    cancelAnimationFrame(holdFrame.current ?? 0);
    setHoldProgress(0);
  };

  const startHold = (e: React.PointerEvent) => {
    if (!props.onHold || e.button !== 0) return;
    stopHold();
    holdFired.current = false;
    holdOrigin.current = { x: e.screenX, y: e.screenY };
    const holdMs = Math.max(1, props.holdMs ?? 420);
    const began = performance.now();
    const tick = () => {
      const progress = Math.min(1, (performance.now() - began) / holdMs);
      setHoldProgress(progress);
      if (progress < 1) holdFrame.current = requestAnimationFrame(tick);
    };
    holdFrame.current = requestAnimationFrame(tick);
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true;
      setHoldProgress(1);
      props.onHold?.();
      window.setTimeout(() => setHoldProgress(0), 160);
      // Keep the guard until the pointer is actually released. A fixed timer
      // expired while the button was still held, so a long press released later
      // fired a normal click (turning Wi-Fi/Bluetooth off).
      const clearOnRelease = () => {
        window.removeEventListener("pointerup", clearOnRelease);
        window.removeEventListener("pointercancel", clearOnRelease);
        window.setTimeout(() => {
          holdFired.current = false;
        }, 120);
      };
      window.addEventListener("pointerup", clearOnRelease, { once: true });
      window.addEventListener("pointercancel", clearOnRelease, { once: true });
    }, holdMs);
  };

  const moveHold = (e: React.PointerEvent) => {
    if (!props.onHold || holdProgress === 0) return;
    if (Math.hypot(e.screenX - holdOrigin.current.x, e.screenY - holdOrigin.current.y) > 8) stopHold();
  };

  return (
    <motion.div
      onContextMenu={props.onContextMenu}
      onWheel={props.onWheel}
      title={props.title ?? props.label}
      whileTap={{ scale: 0.955 }}
      style={{ backgroundColor: props.active ? "var(--color-tile-active)" : "var(--color-fill-1)" }}
      transition={springs.snappy}
      className={`relative flex h-10 w-full min-w-0 items-center overflow-hidden rounded-[12px] transition-colors duration-200 ${
        props.active ? "text-on-label" : "text-label"
      }`}
    >
      <motion.button
        type="button"
        onClick={() => {
          if (holdFired.current) {
            holdFired.current = false;
            return;
          }
          props.onClick();
        }}
        onPointerDown={startHold}
        onPointerMove={moveHold}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onPointerLeave={stopHold}
        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-[12px] px-1.5 text-left outline-none focus:outline-none"
      >
        <motion.span
          className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${
            props.bareIcon ? "" : props.active ? props.activeIconBgClass ?? "bg-on-label/10" : "bg-fill-2"
          }`}
          animate={{ rotate: props.straight ? 0 : props.active ? 0 : -18, scale: holdProgress > 0 ? 1.14 : props.active ? 1.06 : 1 }}
          transition={springs.peek}
        >
          {holdProgress > 0 && (
            <svg aria-hidden viewBox="0 0 30 30" className="pointer-events-none absolute -inset-[3px] size-[30px] -rotate-90">
              <circle cx="15" cy="15" r="13" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.22" />
              <circle
                cx="15"
                cy="15"
                r="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 13}
                strokeDashoffset={2 * Math.PI * 13 * (1 - holdProgress)}
              />
            </svg>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={props.glyphKey ?? (props.active ? "on" : "off")}
              initial={{ opacity: 0, scale: 0.45, rotate: swap }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.45, rotate: -swap }}
              transition={springs.snappy}
            >
              {props.renderGlyph ? (
                props.renderGlyph(props.active)
              ) : props.active && On ? (
                <On size={size} weight="fill" className={props.iconClassName} />
              ) : Off ? (
                <Off size={size} weight="fill" />
              ) : null}
            </motion.span>
          </AnimatePresence>

          {props.active && props.dot && (
            <motion.span
              key={`halo-${props.label}`}
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ background: props.dot }}
              initial={{ opacity: 0.45, scale: 0.4 }}
              animate={{ opacity: 0, scale: 2.1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          )}
        </motion.span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] leading-[13px] font-semibold">{props.label}</span>
          <span className={`block truncate text-[10px] leading-[12px] ${props.active ? "text-on-label/55" : "text-label-3"}`}>
            {props.state}
          </span>
        </span>
      </motion.button>

      {props.active && props.dot && (
        <motion.span
          className="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full"
          style={{ background: props.dot }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springs.peek}
        />
      )}

      {props.statusDot && (
        <motion.span
          key={props.statusDot}
          className="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full"
          style={{ background: props.statusDot }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springs.peek}
        />
      )}
    </motion.div>
  );
}

/* ── Focus / Do not disturb ─────────────────────────────────────────────────── */

function FocusTile() {
  const active = focusMode.use();

  useEffect(() => {
    void refreshFocusMode();
    const id = setInterval(() => void refreshFocusMode(), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <ToggleTile
      label={t("Do not disturb")}
      state={active ? t("On") : t("Off")}
      active={active}
      onIcon={Moon}
      offIcon={Moon}
      straight
      bareIcon
      iconSize={22}
      onClick={() => setFocusMode(!active)}
      title={t("Do not disturb")}
    />
  );
}

/* ── Wi-Fi ──────────────────────────────────────────────────────────────────── */

/* â”€â”€ Wi-Fi â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function WifiTile() {
  const { net, busy, error } = useWifiAmbient();
  const enabled = !!(net?.enabled ?? net?.connected);
  const state = busy ? "." : enabled ? (net?.connected ? net.name || t("Connected") : t("On")) : t("Off");

  return (
    <div className="relative min-w-0">
      <ToggleTile
        label={t("Wi-Fi")}
        state={state}
        active={enabled}
        onIcon={WifiOnIcon}
        offIcon={WifiOffIcon}
        straight
        bareIcon
        iconSize={22}
        dot="#30d158"
        onClick={toggleWifi}
        onHold={() => toggleFlyout("wifi")}
        onContextMenu={(e) => {
          e.preventDefault();
          void systemControls.openUri("ms-settings:network-wifi");
        }}
        title={error ?? ""}
      />
    </div>
  );
}

/* â”€â”€ Bluetooth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function BluetoothTile() {
  const { bt, busy, error } = useBluetoothAmbient();
  const active = !!bt?.on;
  const state = busy ? "." : bt?.available ? (active ? t("On") : t("Off")) : t("Settings");

  return (
    <div className="relative min-w-0">
      <ToggleTile
        label="Bluetooth"
        state={state}
        active={active}
        onIcon={BluetoothOnIcon}
        offIcon={BluetoothOffIcon}
        straight
        bareIcon
        iconSize={22}
        dot="#30d158"
        onClick={toggleBluetooth}
        onHold={() => toggleFlyout("bluetooth")}
        onContextMenu={(e) => {
          e.preventDefault();
          void systemControls.openUri("ms-settings:bluetooth");
        }}
        title={error ?? ""}
      />
    </div>
  );
}


/* ── Power: cycles the three Windows power modes ────────────────────────────── */

function PowerTile() {
  const [energy, setEnergy] = useState<EnergyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const busyRef = useRef(false);
  const settle = useRef(0);
  // A click on the tile while the popover is open closes it; do not also cycle.
  const suppressClick = useRef(0);

  useEffect(() => {
    // Don't let the 5 s poll race a just-clicked mode and flip the tile back.
    const load = () => {
      if (busyRef.current || Date.now() < settle.current) return;
      void systemControls.energy().then(setEnergy).catch(() => setEnergy(null));
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const mode: PowerMode = energy?.scheme ?? "balanced";
  const plugged = energy?.plugged ?? true;
  const batterySaver = energy?.batterySaver ?? false;
  const customSupported = energy?.custom ?? false;
  const highAvailable = plugged && !batterySaver;
  const look = (m: PowerMode) => {
    switch (m) {
      case "saver":
        return { label: t("Saver"), level: 0.28, tone: "text-[#0a84ff]", color: "#0a84ff", dot: "#0a84ff" };
      case "max":
        return { label: t("Max"), level: 0.92, tone: "text-[#ff453a]", color: "#ff453a", dot: "#ff453a" };
      case "custom":
        return { label: t("Custom"), level: 0.8, tone: "text-[#bf5af2]", color: "#bf5af2", dot: "#bf5af2" };
      default:
        return { label: t("Balanced"), level: 0.6, tone: "text-label", color: "var(--color-label)", dot: "var(--color-label)" };
    }
  };
  const current = look(mode);
  const modes: PowerMode[] = ["saver", "balanced", ...(highAvailable ? (["max"] as PowerMode[]) : []), ...(highAvailable && customSupported ? (["custom"] as PowerMode[]) : [])];
  const options = modes.map((m) => ({ mode: m, ...look(m) }));
  const activeIndex = options.findIndex((option) => option.mode === mode);
  const next = options[(Math.max(0, activeIndex) + 1) % options.length] ?? options[0];

  const select = (target: PowerMode) => {
    if (busyRef.current) return;
    if (target === mode && energy) return;

    busyRef.current = true;
    settle.current = Date.now() + 20_000;
    setBusy(true);
    setEnergy((e) => (e ? { ...e, saver: target === "saver", scheme: target } : e));
    let finished = false;
    // The Lenovo helper can hang (stale helper / hidden UAC). Never leave the
    // tile on "…" forever: clear it and let the user retry.
    const watchdog = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      busyRef.current = false;
      settle.current = Date.now() + 2500;
      setBusy(false);

    }, 10_000);
    const run = async () => {
      // Custom needs the elevated Lenovo helper. The task-only start never
      // prompts; if it is not available, fail clearly instead of hanging.
      if (target === "custom" && !(await fpsHelperReady())) throw new Error("helper-ready");
      return systemControls.setEnergy(target);
    };
    void run()
      .then(setEnergy)
      .catch(async () => {
        // Re-read the real mode so the tile never lies about the state.
        await systemControls.energy().then(setEnergy).catch(() => setEnergy(null));
      })
      .finally(() => {
        window.clearTimeout(watchdog);
        if (finished) return;
        finished = true;
        busyRef.current = false;
        settle.current = Date.now() + 2500;
        setBusy(false);
      });
  };

  return (
    <div
      className="relative min-w-0"
      onPointerDownCapture={() => {
        if (menuOpen) suppressClick.current = Date.now() + 450;
      }}
    >
      <ToggleTile
        label="Power"
        state={busy ? "." : current.label}
        active={false}
        statusDot={current.dot}
        renderGlyph={() => <BatteryIcon level={current.level} size={22} className={current.tone} />}
        glyphKey={mode}
        straight
        bareIcon
        onClick={() => {
          if (Date.now() < suppressClick.current) {
            suppressClick.current = 0;
            return;
          }
          if (menuOpen) {
            setMenuOpen(false);
            return;
          }
          select(next.mode);
        }}
        onHold={() => setMenuOpen(true)}
        holdMs={220}
        onContextMenu={(e) => {
          e.preventDefault();
          void systemControls.openUri("ms-settings:powersleep");
        }}
        title={t("Power mode")}
      />
      <AnimatePresence>
        {menuOpen && (
          <PowerMenu
            options={options}
            mode={mode}
            busy={busy}
            onPick={(target) => select(target)}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Glim (custom night light) ──────────────────────────────────────────────── */

function GlimTile() {
  const [glim, setGlim] = useState<GlimState | null>(null);

  useEffect(() => {
    const load = () => void systemControls.glim().then(setGlim).catch(() => setGlim(null));
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const active = !!glim?.on;
  const supported = !!glim?.supported;
  const state = supported ? (active ? t("On") : t("Off")) : t("Not available");

  return (
    <ToggleTile
      label="Glim"
      state={state}
      active={active}
      onIcon={SunHorizon}
      offIcon={MoonStars}
      iconClassName="text-[#ffb340]"
      dot="#ffb340"
      straight
      bareIcon
      iconSize={22}
      onClick={() => {
        if (!supported) {
          void systemControls.openUri("ms-settings:nightlight");
          return;
        }
        setGlim((g) => g && { ...g, on: !active });
        void systemControls
          .setGlim(!active)
          .then(setGlim)
          .catch(() => systemControls.glim().then(setGlim));
      }}
      onHold={() => void systemControls.openUri("ms-settings:nightlight")}
      onContextMenu={(e) => {
        e.preventDefault();
        void systemControls.openUri("ms-settings:nightlight");
      }}
      title={t("Glim: warm screen light")}
    />
  );
}

/* ── Volume + brightness ────────────────────────────────────────────────────── */

function VolumeTile() {
  const [vol, setVol] = useState<VolumeState | null>(null);
  const dragging = useRef(false);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => !dragging.current && void systemControls.volume().then(setVol).catch(() => {});
    load();
    const id = setInterval(load, 1000);
    return () => clearInterval(id);
  }, []);

  const level = vol ? (vol.muted ? 0 : vol.level) : 0;
  const set = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const l = Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100) / 100;
    setVol({ level: l, muted: false });
    void systemControls.setVolume({ level: l });
  };
  const Icon = vol?.muted || level === 0 ? SpeakerSimpleSlash : level < 0.34 ? SpeakerNone : level < 0.67 ? SpeakerLow : SpeakerHigh;

  return (
    <div className="flex h-10 min-w-0 items-center gap-1.5 rounded-[12px] bg-fill-1 px-1.5">
      <button
        aria-label={vol?.muted ? t("Unmute") : t("Mute")}
        disabled={!vol}
        onClick={() => vol && void systemControls.setVolume({ muted: !vol.muted }).then(setVol)}
        className={`pressable flex size-6 shrink-0 items-center justify-center rounded-full ${
          vol?.muted ? "text-red" : "text-label-2 hover:text-label"
        }`}
      >
        <Icon size={14} weight="fill" />
      </button>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t("Volume")}
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-5 min-w-0 flex-1 cursor-pointer touch-none overflow-hidden rounded-full bg-fill-2 outline-none"
        onPointerDown={(e) => {
          if (!vol) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e.clientX);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onWheel={(e) => {
          if (!vol) return;
          const l = Math.min(1, Math.max(0, level + (e.deltaY < 0 ? 0.02 : -0.02)));
          setVol({ level: l, muted: false });
          void systemControls.setVolume({ level: l });
        }}
        onKeyDown={(e) => {
          if (!vol || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
          const l = Math.min(1, Math.max(0, level + (e.key === "ArrowRight" ? 0.05 : -0.05)));
          setVol({ level: l, muted: false });
          void systemControls.setVolume({ level: l });
        }}
      >
        <motion.div
          className="absolute inset-0 origin-left rounded-full bg-label"
          initial={false}
          animate={{ transform: `scaleX(${level})` }}
          transition={dragging.current ? { duration: 0 } : springs.snappy}
        />
      </div>
      <span className="tabular w-6 shrink-0 text-right text-[10px] font-semibold text-label-2">
        {vol ? Math.round(level * 100) : "–"}
      </span>
    </div>
  );
}

function BrightnessTile() {
  const [bright, setBright] = useState<BrightnessState | null>(null);
  const dragging = useRef(false);
  const lastSent = useRef(0);
  const levelRef = useRef(0);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => !dragging.current && void systemControls.brightness().then(setBright).catch(() => setBright(null));
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, []);

  const supported = !!bright?.supported;
  const level = supported ? bright.level / 100 : 0;
  const Icon = level < 0.55 ? SunDim : Sun;

  const apply = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const l = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    levelRef.current = l;
    setBright({ level: Math.round(l * 100), supported: true });
    const now = performance.now();
    if (now - lastSent.current < 90) return;
    lastSent.current = now;
    void systemControls.setBrightness(Math.round(l * 100)).then(setBright).catch(() => {});
  };

  const commit = (l: number) => {
    setBright({ level: Math.round(l * 100), supported: true });
    void systemControls.setBrightness(Math.round(l * 100)).then(setBright).catch(() => {});
  };

  return (
    <div className="flex h-10 min-w-0 items-center gap-1.5 rounded-[12px] bg-fill-1 px-1.5">
      <span
        aria-hidden
        className={`flex size-6 shrink-0 items-center justify-center rounded-full ${supported ? "text-label-2" : "text-label-4"}`}
      >
        <Icon size={14} weight="fill" />
      </span>
      <div
        ref={track}
        role="slider"
        tabIndex={supported ? 0 : -1}
        aria-label={t("Brightness")}
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-disabled={!supported}
        className={`relative h-5 min-w-0 flex-1 touch-none overflow-hidden rounded-full bg-fill-2 outline-none ${
          supported ? "cursor-pointer" : "cursor-default opacity-50"
        }`}
        onPointerDown={(e) => {
          if (!supported) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          apply(e.clientX);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && apply(e.clientX)}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          lastSent.current = 0;
          commit(levelRef.current);
        }}
        onPointerCancel={() => (dragging.current = false)}
        onWheel={(e) => {
          if (!supported) return;
          const l = Math.min(1, Math.max(0, level + (e.deltaY < 0 ? 0.02 : -0.02)));
          commit(l);
        }}
        onKeyDown={(e) => {
          if (!supported || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
          const l = Math.min(1, Math.max(0, level + (e.key === "ArrowRight" ? 0.05 : -0.05)));
          commit(l);
        }}
      >
        <motion.div
          className="absolute inset-0 origin-left rounded-full bg-label"
          initial={false}
          animate={{ transform: `scaleX(${level})` }}
          transition={dragging.current ? { duration: 0 } : springs.snappy}
        />
      </div>
      <span className="tabular w-6 shrink-0 text-right text-[10px] font-semibold text-label-2">
        {supported ? Math.round(level * 100) : "–"}
      </span>
    </div>
  );
}

/* ── Rows ───────────────────────────────────────────────────────────────────── */

export function QuickControls() {
  return (
    <div className="grid grid-cols-[104px_1fr_1fr] items-center gap-2">
      <FocusTile />
      <BrightnessTile />
      <VolumeTile />
    </div>
  );
}

export function SystemRow() {
  return (
    <div className="grid grid-cols-4 gap-2">
      <WifiTile />
      <BluetoothTile />
      <PowerTile />
      <GlimTile />
    </div>
  );
}

type PowerAction = "lock" | "sleep" | "restart" | "shutdown";

const POWER_ACTIONS: { id: PowerAction; label: string; icon: Icon; weight: IconWeight }[] = [
  { id: "lock", label: "Lock", icon: Lock, weight: "fill" },
  { id: "sleep", label: "Sleep", icon: Moon, weight: "fill" },
  { id: "restart", label: "Restart", icon: ArrowClockwise, weight: "bold" },
  { id: "shutdown", label: "Shut down", icon: Power, weight: "bold" },
];

/** Minimal, icon-only power actions for the header's centre. */
export function PowerActions() {
  const [confirm, setConfirm] = useState<PowerAction | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (id: PowerAction) => {
    if (id === "lock" || id === "sleep") {
      void systemControls.power(id);
      return;
    }
    if (confirm === id) {
      clearTimeout(timer.current);
      setConfirm(null);
      void systemControls.power(id);
      return;
    }
    setConfirm(id);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setConfirm(null), 3000);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {POWER_ACTIONS.map(({ id, label, icon: Icon, weight }) => {
        const armed = confirm === id;
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => run(id)}
            whileHover={{ scale: 1.08, y: -0.5 }}
            whileTap={{ scale: 0.88 }}
            transition={springs.peek}
            className={`relative flex size-6 items-center justify-center rounded-full ${
              armed ? "text-red" : "text-label-2 hover:text-label"
            }`}
            title={armed ? t("Sure?") : t(label)}
            aria-label={t(label)}
          >
            <Icon size={14} weight={weight} />
            {armed && (
              <motion.span
                className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-red/45"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springs.peek}
              />
            )}
            {armed && (
              <motion.span
                className="absolute inset-x-1.5 bottom-0 h-0.5 origin-left rounded-full bg-red"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: 3, ease: "linear" }}
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
