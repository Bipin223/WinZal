import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowClockwise,
  Bluetooth,
  CaretRight,
  Lock,
  MusicNoteSimple,
  Pause,
  Play,
  WifiHigh,
  WifiSlash,
} from "@phosphor-icons/react";
import { springs } from "../design/motion";
import { media, useNowPlaying, type MediaSession } from "../platform/media";
import { systemControls } from "../platform/services";
import { settings } from "../settings/store";
import { t } from "../i18n";
import { Switch } from "../ui/controls";
import { SelectedDot } from "../ui/SelectedDot";
import { closeFlyout, flyout, type FlyoutKind } from "./flyout";
import {
  connectBluetooth,
  connectWifi,
  scanBluetooth,
  scanWifi,
  toggleBluetooth,
  toggleWifi,
  useBluetoothAmbient,
  useWifiAmbient,
} from "../features/overview/ambient";

/**
 * Panels that spring out of the side of the notch. Rendering them in the same
 * window keeps the glass, focus and click-through behaviour identical to the
 * notch, without a second WebView.
 */
export function FlyoutLayer() {
  const { kind, side } = flyout.use();
  const material = settings.use().appearance.material;
  return (
    <AnimatePresence>
      {kind && (
        <motion.div
          key={kind}
          data-flyout-hit
          className={`pointer-events-auto absolute z-40 overflow-hidden rounded-[20px] border border-separator shadow-[0_26px_60px_-18px_rgb(0_0_0/0.8),0_6px_18px_rgb(0_0_0/0.35)] ${
            material === "glass" ? "bg-notch backdrop-blur-2xl" : "bg-elevated"
          }`}
          style={{
            width: kind === "sessions" ? 334 : 300,
            maxHeight: 336,
            top: 0,
            ...(side === "left" ? { right: "calc(100% + 12px)" } : { left: "calc(100% + 12px)" }),
            transformOrigin: side === "left" ? "100% 18%" : "0% 18%",
            willChange: "transform, opacity",
          }}
          initial={{ opacity: 0, scale: 0.82, x: side === "left" ? 16 : -16 }}
          animate={{ opacity: 1, scale: 1, x: 0, transition: springs.open }}
          exit={{ opacity: 0, scale: 0.88, x: side === "left" ? 10 : -10, transition: springs.close }}
        >
          {kind === "wifi" && <WifiFlyout />}
          {kind === "bluetooth" && <BluetoothFlyout />}
          {kind === "sessions" && <SessionsFlyout />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({
  icon,
  title,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-1 text-label">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-footnote font-semibold text-label">{title}</span>
        <span className="block truncate text-caption text-label-3">{detail}</span>
      </span>
      {children}
    </div>
  );
}

function ScanButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={t("Scan again")}
      className="pressable flex size-6 shrink-0 items-center justify-center rounded-[7px] text-label-3 hover:text-label disabled:opacity-40"
    >
      <ArrowClockwise size={12} weight="bold" className={loading ? "animate-spin" : undefined} />
    </button>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-4 text-center text-caption text-label-3">{children}</div>;
}

function ErrorRow({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="px-3 pt-1 pb-2 text-[9px] leading-[12px] text-orange">{error}</div>;
}

function SettingsLink({ label, uri }: { label: string; uri: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        closeFlyout();
        void systemControls.openUri(uri);
      }}
      className="pressable mx-2 mt-1 mb-2 flex h-7 shrink-0 items-center justify-between rounded-[8px] px-2 text-caption text-label-3 transition-colors duration-150 hover:bg-fill-1 hover:text-label-2"
    >
      {label}
      <CaretRight size={10} weight="bold" />
    </button>
  );
}

function WifiFlyout() {
  const { net, busy, networks, loading, connecting, error } = useWifiAmbient();
  useEffect(() => scanWifi(), []);
  const enabled = !!(net?.enabled ?? net?.connected);
  return (
    <div className="flex max-h-[336px] flex-col">
      <Header
        icon={enabled ? <WifiHigh size={19} weight="bold" /> : <WifiSlash size={19} weight="bold" />}
        title={t("WLAN")}
        detail={busy ? t("Wird umgeschaltet…") : enabled ? net?.name || t("An") : t("Aus")}
      >
        <Switch checked={enabled} onChange={() => toggleWifi()} label={t("WLAN")} />
      </Header>
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[9px] font-medium tracking-[0.08em] text-label-4 uppercase">{t("Wi-Fi networks")}</span>
        <ScanButton loading={loading} onClick={() => scanWifi()} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && !networks ? (
          <EmptyRow>{t("Scanning...")}</EmptyRow>
        ) : networks?.length ? (
          networks.map((network) => {
            const current = network.connected;
            return (
              <button
                key={network.ssid}
                type="button"
                onClick={() => void connectWifi(network)}
                disabled={!!connecting || current}
                className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-150 ${
                  current ? "bg-fill-2" : "hover:bg-fill-1"
                }`}
              >
                <span className="flex w-3.5 shrink-0 justify-center text-label-3">
                  <WifiHigh size={13} weight={current ? "fill" : "bold"} />
                </span>
                <span className="min-w-0 flex-1 truncate text-caption text-label">{network.ssid}</span>
                {current && <SelectedDot />}
                {network.secured && <Lock size={9} weight="bold" className="shrink-0 text-label-4" />}
                <span className="w-7 shrink-0 text-right text-[9px] tabular text-label-4">{network.signal}%</span>
                {connecting === network.ssid && <span className="size-2 shrink-0 animate-pulse rounded-full bg-green" />}
              </button>
            );
          })
        ) : (
          <EmptyRow>{t("No Wi-Fi networks found")}</EmptyRow>
        )}
      </div>
      <ErrorRow error={error} />
      <SettingsLink label={t("Wi-Fi settings")} uri="ms-settings:network-wifi" />
    </div>
  );
}

function BluetoothFlyout() {
  const { bt, busy, devices, loading, connecting, error } = useBluetoothAmbient();
  useEffect(() => scanBluetooth(), []);
  const enabled = !!bt?.on;
  return (
    <div className="flex max-h-[336px] flex-col">
      <Header
        icon={<Bluetooth size={19} weight="bold" />}
        title="Bluetooth"
        detail={busy ? t("Wird umgeschaltet…") : !bt?.available ? t("Einstellungen") : enabled ? t("An") : t("Aus")}
      >
        <Switch checked={enabled} onChange={() => toggleBluetooth()} label="Bluetooth" />
      </Header>
      {!bt?.available ? (
        <button
          type="button"
          onClick={() => void systemControls.openUri("ms-settings:bluetooth")}
          className="pressable mx-3 mb-3 flex h-8 items-center justify-center gap-1 rounded-[9px] bg-fill-1 text-caption text-label-2 hover:text-label"
        >
          {t("Open Windows Bluetooth settings")}
          <CaretRight size={10} weight="bold" />
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-[9px] font-medium tracking-[0.08em] text-label-4 uppercase">{t("Bluetooth devices")}</span>
            <ScanButton loading={loading} onClick={() => scanBluetooth()} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {loading && !devices ? (
              <EmptyRow>{t("Scanning...")}</EmptyRow>
            ) : devices?.length ? (
              devices.map((device) => (
                <button
                  key={device.address}
                  type="button"
                  onClick={() => void connectBluetooth(device)}
                  disabled={connecting !== null || device.connected}
                  className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-150 ${
                    device.connected ? "bg-fill-2" : "hover:bg-fill-1"
                  }`}
                >
                  <span className="flex w-3.5 shrink-0 justify-center text-label-3">
                    <Bluetooth size={12} weight={device.connected ? "fill" : "bold"} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption text-label">{device.name}</span>
                  {device.connected ? <SelectedDot /> : <span className="shrink-0 text-[9px] text-label-4">{t("Paired")}</span>}
                  {connecting === device.address && <span className="size-2 shrink-0 animate-pulse rounded-full bg-green" />}
                </button>
              ))
            ) : (
              <EmptyRow>{t("No paired devices")}</EmptyRow>
            )}
          </div>
        </>
      )}
      <ErrorRow error={error} />
      {bt?.available && <SettingsLink label={t("Bluetooth settings")} uri="ms-settings:bluetooth" />}
    </div>
  );
}

function SessionsFlyout() {
  const np = useNowPlaying();
  const [sessions, setSessions] = useState<MediaSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = async (spinner = false) => {
    if (spinner) setLoading(true);
    try {
      const next = await media.sessions();
      if (alive.current) {
        setSessions(next);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current && spinner) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    void load(true);
    const id = window.setInterval(() => void load(false), 3000);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, []);

  const toggle = (session: MediaSession) => {
    setSessions((list) => list?.map((item) => (item.appId === session.appId ? { ...item, isPlaying: !item.isPlaying } : item)) ?? null);
    media.toggleSession(session.appId);
  };

  return (
    <div className="flex max-h-[336px] flex-col">
      <Header icon={<MusicNoteSimple size={18} weight="fill" />} title={t("Audio sessions")} detail={t("Playing on this PC")}>
        <ScanButton loading={loading} onClick={() => void load(true)} />
      </Header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessions?.length ? (
          sessions.map((session) => (
            <div
              key={session.appId}
              className="group flex items-center gap-0.5 rounded-[10px] transition-colors duration-150 hover:bg-fill-1"
            >
              <button
                type="button"
                onClick={() => {
                  media.select(session.appId);
                  closeFlyout();
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 py-1.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] leading-[14px] font-semibold text-label">
                    {session.title || session.artist || "—"}
                  </span>
                  {session.title && session.artist && (
                    <span className="block truncate text-[9px] leading-[11px] text-label-3">{session.artist}</span>
                  )}
                </span>
                {session.isPlaying && (
                  <motion.span
                    className="size-1.5 shrink-0 rounded-full bg-green"
                    animate={{ opacity: [0.65, 1, 0.65] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {np?.appId === session.appId && <SelectedDot />}
              </button>
              <button
                type="button"
                onClick={() => toggle(session)}
                aria-label={session.isPlaying ? t("Pause") : t("Abspielen")}
                className="pressable mr-1 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-label-2 hover:bg-fill-2 hover:text-label"
              >
                {session.isPlaying ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
              </button>
            </div>
          ))
        ) : (
          <EmptyRow>{loading ? t("Loading...") : t("No audio sessions")}</EmptyRow>
        )}
      </div>
      <ErrorRow error={error} />
    </div>
  );
}

export type { FlyoutKind };
