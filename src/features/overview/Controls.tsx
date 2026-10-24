import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
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
  systemControls,
  type BluetoothPeer,
  type BluetoothState,
  type BrightnessState,
  type EnergyState,
  type GlimState,
  type NetworkState,
  type PowerMode,
  type VolumeState,
  type WifiNetwork,
} from "../../platform/services";
import { BatteryIcon, BluetoothOffIcon, BluetoothOnIcon, WifiOffIcon, WifiOnIcon } from "../../ui/glyphs";
import { SelectedDot } from "../../ui/SelectedDot";
import { focusMode, refreshFocusMode, setFocusMode } from "../../notch/focus";
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
  onContextMenu?: (e: React.MouseEvent) => void;
  onWheel?: (e: React.WheelEvent) => void;
  /** Separate dropdown affordance, e.g. choose a Wi-Fi network. */
  onMenu?: () => void;
  menuLabel?: string;
  chevron?: boolean;
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
        onClick={props.onClick}
        className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-[12px] px-1.5 text-left"
      >
        <motion.span
          className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${
            props.bareIcon ? "" : props.active ? props.activeIconBgClass ?? "bg-on-label/10" : "bg-fill-2"
          }`}
          animate={{ rotate: props.straight ? 0 : props.active ? 0 : -18, scale: props.active ? 1.06 : 1 }}
          transition={springs.peek}
        >
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

        {props.chevron && (
          <CaretRight size={9} weight="bold" className={props.active ? "text-on-label/35" : "text-label-4"} />
        )}
      </motion.button>

      {props.onMenu && (
        <button
          type="button"
          aria-label={props.menuLabel}
          onClick={props.onMenu}
          className={`mr-1 flex size-5 shrink-0 items-center justify-center rounded-[5px] ${
            props.active ? "text-on-label/45 hover:text-on-label/70" : "text-label-4 hover:text-label-2"
          }`}
        >
          <CaretDown size={9} weight="bold" />
        </button>
      )}

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
      label={t("Nicht stören")}
      state={active ? t("An") : t("Aus")}
      active={active}
      onIcon={Moon}
      offIcon={Moon}
      straight
      bareIcon
      iconSize={22}
      onClick={() => setFocusMode(!active)}
      title={t("Nicht stören")}
    />
  );
}

/* ── Wi-Fi ──────────────────────────────────────────────────────────────────── */

type AmbientMenuProps = {
  menuOpen: boolean;
  onMenu: () => void;
  onClose: () => void;
};

function WifiTile({ menuOpen, onMenu, onClose }: AmbientMenuProps) {
  const [net, setNet] = useState<NetworkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const settle = useRef(0);

  useEffect(() => {
    // Don't let a slow 15 s poll race an optimistic toggle and flip the tile back.
    const load = () => {
      if (busyRef.current || Date.now() < settle.current) return;
      void systemControls.network().then(setNet).catch(() => setNet(null));
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  const loadNetworks = async () => {
    setLoading(true);
    setError(null);
    try {
      setNetworks(await systemControls.wifiNetworks());
    } catch (e) {
      setError(String(e));
      setNetworks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (menuOpen) void loadNetworks();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [menuOpen, onClose]);

  const enabled = !!(net?.enabled ?? net?.connected);
  const active = enabled;
  const state = enabled ? (net?.connected ? net.name || t("Verbunden") : t("An")) : t("Aus");

  const toggle = () => {
    onClose();
    if (busy) return;
    if (!net) {
      // Unknown state: read it first instead of guessing and switching the radio.
      setBusy(true);
      busyRef.current = true;
      void systemControls.network().then(setNet).catch(() => setNet(null)).finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
      return;
    }
    const next = !enabled;
    setBusy(true);
    busyRef.current = true;
    settle.current = Date.now() + 3000;
    setNet((current) =>
      current
        ? { ...current, enabled: next, connected: next ? current.connected : false, name: next ? current.name : "" }
        : { connected: false, wifi: false, name: "", enabled: next },
    );
    void systemControls
      .setWifi(next)
      .then(setNet)
      .catch(() => systemControls.network().then(setNet).catch(() => setNet(null)))
      .finally(() => {
        busyRef.current = false;
        settle.current = Date.now() + 3000;
        setBusy(false);
      });
  };

  const connect = async (network: WifiNetwork) => {
    if (connecting) return;
    if (!network.known) {
      onClose();
      void systemControls.openUri("ms-availablenetworks:");
      return;
    }
    setConnecting(network.ssid);
    setError(null);
    busyRef.current = true;
    settle.current = Date.now() + 4000;
    try {
      setNet(await systemControls.wifiConnect(network.ssid));
      onClose();
    } catch (e) {
      setError(String(e));
      void loadNetworks();
    } finally {
      busyRef.current = false;
      settle.current = Date.now() + 3000;
      setConnecting(null);
    }
  };

  return (
    <div ref={box} className="relative min-w-0">
      <ToggleTile
        label={t("WLAN")}
        state={busy ? "…" : state}
        active={active}
        onIcon={WifiOnIcon}
        offIcon={WifiOffIcon}
        straight
        bareIcon
        iconSize={22}
        dot="#30d158"
        onClick={toggle}
        onMenu={onMenu}
        menuLabel={t("Choose Wi-Fi network")}
        onContextMenu={(e) => {
          e.preventDefault();
          void systemControls.openUri("ms-settings:network-wifi");
        }}
        title=""
      />
      {menuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[290px] overflow-hidden rounded-[12px] bg-elevated p-1.5 shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold tracking-wide text-label-3 uppercase">
              {t("Wi-Fi networks")}
            </span>
            <button
              type="button"
              onClick={() => void loadNetworks()}
              disabled={loading}
              className="pressable flex size-5 items-center justify-center rounded-[6px] text-label-3 hover:text-label disabled:opacity-40"
              aria-label={t("Scan again")}
            >
              <ArrowClockwise size={11} weight="bold" className={loading ? "animate-spin" : undefined} />
            </button>
          </div>
          <div className="max-h-[96px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {loading && !networks ? (
              <div className="px-2.5 py-3 text-caption text-label-3">{t("Scanning...")}</div>
            ) : networks?.length ? (
              networks.map((network) => (
                <button
                  key={network.ssid}
                  type="button"
                  onClick={() => void connect(network)}
                  disabled={!!connecting}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left hover:bg-fill-2 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate text-caption text-label">{network.ssid}</span>
                  {network.connected && <SelectedDot />}
                  {network.secured && <Lock size={9} weight="bold" className="shrink-0 text-label-4" />}
                  <span className="w-7 shrink-0 text-right text-[9px] tabular text-label-4">{network.signal}%</span>
                  {connecting === network.ssid && (
                    <span className="size-2 shrink-0 animate-pulse rounded-full bg-green" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-2.5 py-3 text-caption text-label-3">{t("No Wi-Fi networks found")}</div>
            )}
          </div>
          {error && <div className="px-2.5 pt-1 pb-1 text-[9px] leading-[12px] text-[#ff9f0a]">{error}</div>}
          {networks?.some((n) => !n.known) && (
            <div className="border-t border-separator px-2.5 py-1.5 text-[9px] leading-[12px] text-label-4">
              {t("New networks open Windows to enter the password.")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Bluetooth ──────────────────────────────────────────────────────────────── */

function BluetoothTile({ menuOpen, onMenu, onClose }: AmbientMenuProps) {
  const [bt, setBt] = useState<BluetoothState | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<BluetoothPeer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const settle = useRef(0);

  useEffect(() => {
    const load = () => {
      if (busyRef.current || Date.now() < settle.current) return;
      void systemControls.bluetooth().then(setBt).catch(() => setBt(null));
    };
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);

  const loadDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await systemControls.bluetoothDevices());
    } catch (e) {
      setError(String(e));
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (menuOpen) void loadDevices();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [menuOpen, onClose]);

  const active = !!bt?.on;
  const state = bt?.available ? (active ? t("An") : t("Aus")) : t("Einstellungen");

  const toggle = () => {
    onClose();
    if (busy) return;
    if (!bt?.available) {
      // No radio found: the Settings page is the only useful destination.
      void systemControls.openUri("ms-settings:bluetooth");
      return;
    }
    const next = !active;
    setBusy(true);
    busyRef.current = true;
    settle.current = Date.now() + 4000;
    setBt((current) => (current ? { ...current, on: next } : current));
    void systemControls
      .setBluetooth(next)
      .then(setBt)
      .catch(() => systemControls.bluetooth().then(setBt).catch(() => setBt(null)))
      .finally(() => {
        busyRef.current = false;
        settle.current = Date.now() + 4000;
        setBusy(false);
      });
  };

  const connect = async (device: BluetoothPeer) => {
    if (connecting !== null || device.connected) return;
    if (!active) {
      setError(t("Turn Bluetooth on first"));
      return;
    }
    setConnecting(device.address);
    setError(null);
    busyRef.current = true;
    settle.current = Date.now() + 12_000;
    try {
      if (await systemControls.bluetoothConnect(device.address)) {
        await systemControls.bluetooth().then(setBt).catch(() => {});
        await loadDevices();
        onClose();
      } else {
        setError(t("Could not connect. Right-click for Windows settings."));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      settle.current = Date.now() + 8000;
      setConnecting(null);
    }
  };

  return (
    <div ref={box} className="relative min-w-0">
      <ToggleTile
        label="Bluetooth"
        state={busy ? "…" : state}
        active={active}
        onIcon={BluetoothOnIcon}
        offIcon={BluetoothOffIcon}
        straight
        bareIcon
        iconSize={22}
        dot="#30d158"
        onClick={toggle}
        onMenu={onMenu}
        menuLabel={t("Choose Bluetooth device")}
        onContextMenu={(e) => {
          e.preventDefault();
          void systemControls.openUri("ms-settings:bluetooth");
        }}
        title=""
      />
      {menuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[290px] overflow-hidden rounded-[12px] bg-elevated p-1.5 shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold tracking-wide text-label-3 uppercase">
              {t("Bluetooth devices")}
            </span>
            <button
              type="button"
              onClick={() => void loadDevices()}
              disabled={loading}
              className="pressable flex size-5 items-center justify-center rounded-[6px] text-label-3 hover:text-label disabled:opacity-40"
              aria-label={t("Scan again")}
            >
              <ArrowClockwise size={11} weight="bold" className={loading ? "animate-spin" : undefined} />
            </button>
          </div>
          <div className="max-h-[96px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {loading && !devices ? (
              <div className="px-2.5 py-3 text-caption text-label-3">{t("Scanning...")}</div>
            ) : devices?.length ? (
              devices.map((device) => (
                <button
                  key={device.address}
                  type="button"
                  onClick={() => void connect(device)}
                  disabled={connecting !== null || device.connected}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left hover:bg-fill-2 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate text-caption text-label">{device.name}</span>
                  {device.connected ? (
                    <SelectedDot />
                  ) : (
                    <span className="shrink-0 text-[9px] text-label-4">{t("Paired")}</span>
                  )}
                  {connecting === device.address && (
                    <span className="size-2 shrink-0 animate-pulse rounded-full bg-green" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-2.5 py-3 text-caption text-label-3">{t("No paired devices")}</div>
            )}
          </div>
          {error && <div className="px-2.5 pt-1 pb-1 text-[9px] leading-[12px] text-[#ff9f0a]">{error}</div>}
          <div className="border-t border-separator px-2.5 py-1.5 text-[9px] leading-[12px] text-label-4">
            {t("Pair new devices from Windows settings (right-click).")}
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Power: cycles the three Windows power modes ────────────────────────────── */

function PowerTile() {
  const [energy, setEnergy] = useState<EnergyState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const settle = useRef(0);

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

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [menuOpen]);

  const mode: PowerMode = energy?.scheme ?? "balanced";
  const plugged = energy?.plugged ?? true;
  const customSupported = energy?.custom ?? false;
  const look = (m: PowerMode) => {
    switch (m) {
      case "saver":
        return { label: t("Sparmodus"), level: 0.28, tone: "text-[#0a84ff]", dot: "#0a84ff" };
      case "max":
        return { label: t("Max"), level: 0.92, tone: "text-[#ff453a]", dot: "#ff453a" };
      case "custom":
        return { label: t("Custom"), level: 0.8, tone: "text-[#bf5af2]", dot: "#bf5af2" };
      default:
        return { label: t("Ausgeglichen"), level: 0.6, tone: "text-label", dot: "var(--color-label)" };
    }
  };
  const current = look(mode);
  const modes: PowerMode[] = ["saver", "balanced", ...(plugged ? (["max"] as PowerMode[]) : []), ...(plugged && customSupported ? (["custom"] as PowerMode[]) : [])];
  const options = modes.map((m) => ({ mode: m, ...look(m) }));
  const activeIndex = options.findIndex((option) => option.mode === mode);
  const next = options[(Math.max(0, activeIndex) + 1) % options.length] ?? options[0];

  const select = (target: PowerMode) => {
    setMenuOpen(false);
    if (busyRef.current) return;
    if (target === mode && energy) return;
    setError(null);
    busyRef.current = true;
    settle.current = Date.now() + 20_000;
    setBusy(true);
    setEnergy((e) => (e ? { ...e, saver: target === "saver", scheme: target } : e));
    void systemControls
      .setEnergy(target)
      .then(setEnergy)
      .catch(async (raw) => {
        const message = String(raw);
        if (message.includes("uac-cancelled")) setError(t("Admin permission is needed for Custom."));
        else if (message.includes("plugged")) setError(t("Plug in for Max and Custom."));
        else if (message.includes("lenovo") || message.includes("unsupported")) setError(t("Custom mode is not available on this device."));
        else if (message.includes("helper")) setError(t("Could not start the elevated helper."));
        else setError(t("Could not change the power mode."));
        await systemControls.energy().then(setEnergy).catch(() => setEnergy(null));
      })
      .finally(() => {
        busyRef.current = false;
        settle.current = Date.now() + 2500;
        setBusy(false);
      });
  };

  return (
    <div ref={box} className="relative min-w-0">
      <ToggleTile
        label="Power"
        state={busy ? "…" : current.label}
        active={false}
        statusDot={current.dot}
        renderGlyph={() => <BatteryIcon level={current.level} size={22} className={current.tone} />}
        glyphKey={mode}
        straight
        bareIcon
        onClick={() => select(next.mode)}
        onMenu={() => {
          setMenuOpen((open) => !open);
          setError(null);
        }}
        menuLabel={t("Power mode")}
        onContextMenu={(e) => {
          e.preventDefault();
          void systemControls.openUri("ms-settings:powersleep");
        }}
        title={t("Power mode")}
      />
      {menuOpen && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-[212px] overflow-hidden rounded-[12px] bg-elevated p-1.5 shadow-2xl">
          <div className="px-2 py-1 text-[10px] font-semibold tracking-wide text-label-3 uppercase">{t("Power mode")}</div>
          <div className="grid grid-cols-2 gap-0.5">
            {options.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => select(option.mode)}
                className="flex min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-fill-2"
              >
                <BatteryIcon level={option.level} size={15} className={option.tone} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-label">{option.label}</span>
                {mode === option.mode && <SelectedDot />}
              </button>
            ))}
          </div>
          {error && <div className="px-2.5 py-1 text-[9px] leading-[12px] text-[#ff9f0a]">{error}</div>}
        </div>
      )}
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
  const state = supported ? (active ? t("An") : t("Aus")) : t("Nicht verfügbar");

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
      onContextMenu={(e) => {
        e.preventDefault();
        void systemControls.openUri("ms-settings:nightlight");
      }}
      title={t("Glim: warmes Bildschirmlicht")}
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
        aria-label={vol?.muted ? t("Stummschaltung aufheben") : t("Stumm")}
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
        aria-label={t("Lautstärke")}
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
        aria-label={t("Helligkeit")}
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
  const [menu, setMenu] = useState<"wifi" | "bluetooth" | null>(null);
  const close = () => setMenu(null);
  return (
    <div className="grid grid-cols-4 gap-2">
      <WifiTile menuOpen={menu === "wifi"} onMenu={() => setMenu(menu === "wifi" ? null : "wifi")} onClose={close} />
      <BluetoothTile
        menuOpen={menu === "bluetooth"}
        onMenu={() => setMenu(menu === "bluetooth" ? null : "bluetooth")}
        onClose={close}
      />
      <PowerTile />
      <GlimTile />
    </div>
  );
}

type PowerAction = "lock" | "sleep" | "restart" | "shutdown";

const POWER_ACTIONS: { id: PowerAction; label: string; icon: Icon; weight: IconWeight }[] = [
  { id: "lock", label: "Sperren", icon: Lock, weight: "fill" },
  { id: "sleep", label: "Schlafen", icon: Moon, weight: "fill" },
  { id: "restart", label: "Neu starten", icon: ArrowClockwise, weight: "bold" },
  { id: "shutdown", label: "Herunterfahren", icon: Power, weight: "bold" },
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
            title={armed ? t("Sicher?") : t(label)}
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
