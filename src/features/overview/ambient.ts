import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { setPromptMode } from "../../platform/native";
import { closeFlyout } from "../../notch/flyout";
import {
  systemControls,
  type BluetoothPeer,
  type BluetoothState,
  type NetworkState,
  type WifiNetwork,
} from "../../platform/services";
import { t } from "../../i18n";

/*
 * Shared Wi-Fi / Bluetooth state for the Overview tiles and the attached
 * flyouts. One poll per radio keeps the tile and flyout in sync without two
 * sets of timers or duplicate requests.
 */

type WifiData = {
  net: NetworkState | null;
  busy: boolean;
  networks: WifiNetwork[] | null;
  loading: boolean;
  connecting: string | null;
  error: string | null;
};

type BluetoothData = {
  bt: BluetoothState | null;
  busy: boolean;
  devices: BluetoothPeer[] | null;
  loading: boolean;
  connecting: number | null;
  error: string | null;
};

export const wifi = createStore<WifiData>({
  net: null,
  busy: false,
  networks: null,
  loading: false,
  connecting: null,
  error: null,
});

export const bluetooth = createStore<BluetoothData>({
  bt: null,
  busy: false,
  devices: null,
  loading: false,
  connecting: null,
  error: null,
});

let wifiSettle = 0;
let wifiTimer: number | undefined;
let wifiUsers = 0;

let btSettle = 0;
let btTimer: number | undefined;
let btUsers = 0;

function refreshWifi() {
  const s = wifi.get();
  if (s.busy || Date.now() < wifiSettle) return;
  void systemControls.network().then((net) => wifi.set((cur) => ({ ...cur, net }))).catch(() => {});
}

export function useWifiAmbient() {
  const state = wifi.use();
  useEffect(() => {
    wifiUsers += 1;
    if (wifiUsers === 1) {
      refreshWifi();
      wifiTimer = window.setInterval(refreshWifi, 15_000);
    }
    return () => {
      wifiUsers = Math.max(0, wifiUsers - 1);
      if (wifiUsers === 0) window.clearInterval(wifiTimer);
    };
  }, []);
  return state;
}

export function toggleWifi() {
  const s = wifi.get();
  if (s.busy) return;
  if (!s.net) {
    // Unknown state: read it first instead of guessing and switching the radio.
    void systemControls.network().then((net) => wifi.set((cur) => ({ ...cur, net }))).catch(() => {});
    return;
  }
  const next = !(s.net.enabled ?? s.net.connected);
  wifiSettle = Date.now() + 3000;
  wifi.set((cur) => ({
    ...cur,
    busy: true,
    error: null,
    net: cur.net
      ? { ...cur.net, enabled: next, connected: next ? cur.net.connected : false, name: next ? cur.net.name : "" }
      : cur.net,
  }));
  void systemControls
    .setWifi(next)
    .then((net) => wifi.set((cur) => ({ ...cur, net })))
    .catch(() => systemControls.network().then((net) => wifi.set((cur) => ({ ...cur, net }))).catch(() => {}))
    .finally(() => {
      wifiSettle = Date.now() + 3000;
      wifi.set((cur) => ({ ...cur, busy: false }));
    });
}

export function scanWifi() {
  wifi.set((cur) => ({ ...cur, loading: true, error: null }));
  void systemControls
    .wifiNetworks()
    .then((networks) => wifi.set((cur) => ({ ...cur, networks, loading: false })))
    .catch((e) => wifi.set((cur) => ({ ...cur, error: String(e), networks: [], loading: false })));
}

export async function connectWifi(network: WifiNetwork) {
  if (wifi.get().connecting) return;
  wifi.set((cur) => ({ ...cur, connecting: network.ssid, error: null, busy: true }));
  wifiSettle = Date.now() + 4000;
  try {
    const net = await systemControls.wifiConnect(network.ssid);
    wifi.set((cur) => ({ ...cur, net, connecting: null, busy: false }));
  } catch (e) {
    const message = String(e);
    if (message.includes("not saved")) {
      // A new network needs Windows' password UI. Drop the notch below it so
      // the Quick Settings network panel is usable, then restore.
      closeFlyout();
      void setPromptMode(true);
      void systemControls.openUri("ms-availablenetworks:");
      window.setTimeout(() => void setPromptMode(false), 15_000);
      wifi.set((cur) => ({ ...cur, error: null, connecting: null, busy: false }));
    } else {
      wifi.set((cur) => ({ ...cur, error: message, connecting: null, busy: false }));
      scanWifi();
    }
  } finally {
    wifiSettle = Date.now() + 3000;
  }
}

function refreshBluetooth() {
  const s = bluetooth.get();
  if (s.busy || Date.now() < btSettle) return;
  void systemControls.bluetooth().then((bt) => bluetooth.set((cur) => ({ ...cur, bt }))).catch(() => {});
}

export function useBluetoothAmbient() {
  const state = bluetooth.use();
  useEffect(() => {
    btUsers += 1;
    if (btUsers === 1) {
      refreshBluetooth();
      btTimer = window.setInterval(refreshBluetooth, 20_000);
    }
    return () => {
      btUsers = Math.max(0, btUsers - 1);
      if (btUsers === 0) window.clearInterval(btTimer);
    };
  }, []);
  return state;
}

export function toggleBluetooth() {
  const s = bluetooth.get();
  if (s.busy) return;
  if (!s.bt?.available) {
    void systemControls.openUri("ms-settings:bluetooth");
    return;
  }
  const next = !s.bt.on;
  btSettle = Date.now() + 4000;
  bluetooth.set((cur) => ({
    ...cur,
    busy: true,
    error: null,
    bt: cur.bt ? { ...cur.bt, on: next } : cur.bt,
  }));
  void systemControls
    .setBluetooth(next)
    .then((bt) => bluetooth.set((cur) => ({ ...cur, bt })))
    .catch(() => systemControls.bluetooth().then((bt) => bluetooth.set((cur) => ({ ...cur, bt }))).catch(() => {}))
    .finally(() => {
      btSettle = Date.now() + 4000;
      bluetooth.set((cur) => ({ ...cur, busy: false }));
    });
}

export function scanBluetooth() {
  bluetooth.set((cur) => ({ ...cur, loading: true, error: null }));
  void systemControls
    .bluetoothDevices()
    .then((devices) => bluetooth.set((cur) => ({ ...cur, devices, loading: false })))
    .catch((e) => bluetooth.set((cur) => ({ ...cur, error: String(e), devices: [], loading: false })));
}

export async function connectBluetooth(device: BluetoothPeer) {
  const s = bluetooth.get();
  if (s.connecting !== null || device.connected) return;
  if (!s.bt?.on) {
    bluetooth.set((cur) => ({ ...cur, error: t("Turn Bluetooth on first") }));
    return;
  }
  bluetooth.set((cur) => ({ ...cur, connecting: device.address, error: null, busy: true }));
  btSettle = Date.now() + 12_000;
  try {
    if (await systemControls.bluetoothConnect(device.address)) {
      const bt = await systemControls.bluetooth().catch(() => null);
      bluetooth.set((cur) => ({ ...cur, bt: bt ?? cur.bt, connecting: null, busy: false }));
      scanBluetooth();
    } else {
      bluetooth.set((cur) => ({
        ...cur,
        error: t("Not connected · right-click for settings."),
        connecting: null,
        busy: false,
      }));
    }
  } catch (e) {
    bluetooth.set((cur) => ({ ...cur, error: String(e), connecting: null, busy: false }));
  } finally {
    btSettle = Date.now() + 8000;
  }
}
