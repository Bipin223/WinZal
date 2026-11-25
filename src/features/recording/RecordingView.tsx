import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Camera, Check, Microphone, Pause, Play, Selection, VideoCamera } from "@phosphor-icons/react";
import { obs, screenCapture, type ObsStatus } from "../../platform/services";
import { navigate } from "../../notch/nav";
import { t } from "../../i18n";

/** Parse OBS' HH:MM:SS.mmm timecode into milliseconds. */
function timecodeMs(code: string | undefined): number {
  if (!code) return 0;
  const match = code.match(/(\d+):(\d+):(\d+)(?:[.,](\d+))?/);
  if (!match) return 0;
  const [, h, m, s, frac = "0"] = match;
  return (
    Number(h) * 3_600_000 +
    Number(m) * 60_000 +
    Number(s) * 1000 +
    Math.round(Number(`0.${frac}`) * 1000)
  );
}

function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const cs = Math.floor((total % 1000) / 10);
  const sec = Math.floor(total / 1000) % 60;
  const min = Math.floor(total / 60_000) % 60;
  const hour = Math.floor(total / 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hour > 0
    ? `${hour}:${pad(min)}:${pad(sec)},${pad(cs)}`
    : `${pad(min)}:${pad(sec)},${pad(cs)}`;
}

const BAR_COUNT = 52;
/** A little texture per column so a steady tone still looks like a waveform. */
const BAR_TEXTURE = Array.from({ length: BAR_COUNT }, (_, i) => {
  const shape = Math.abs(Math.sin(i * 2.7) * Math.cos(i * 1.13));
  return 0.5 + 0.5 * shape;
});

/**
 * Recording: OBS control on the notch's own surface. No extra card — liquid
 * glass stays transparent, Solid/Dark/Glass use the selected theme.
 */
export function RecordingView() {
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  const smoothed = useRef(0);
  const base = useRef({ ms: 0, at: performance.now() });

  useEffect(() => {
    let alive = true;
    const load = () => {
      void obs
        .status()
        .then((next) => {
          if (!alive) return;
          setStatus(next);
          base.current = { ms: timecodeMs(next.timecode), at: performance.now() };
          if (next.connected) setError(null);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    };
    load();
    const poll = window.setInterval(load, 1200);
    return () => {
      alive = false;
      window.clearInterval(poll);
    };
  }, []);

  const recording = !!status?.recording;
  const paused = !!status?.paused;
  const connected = !!status?.connected;

  useEffect(() => {
    if (!recording || paused) return;
    const tick = window.setInterval(() => {
      setNow(base.current.ms + (performance.now() - base.current.at));
    }, 50);
    return () => window.clearInterval(tick);
  }, [recording, paused]);

  useEffect(() => {
    if (!recording || paused) {
      void obs.meter(false);
      return;
    }
    void obs.meter(true);
    let alive = true;
    let unlisten: (() => void) | null = null;
    void obs
      .onLevel((raw) => {
        if (!alive) return;
        const target = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
        // Fast attack, slow release — the same feel as the OBS meters.
        const k = target > smoothed.current ? 0.55 : 0.22;
        smoothed.current += (target - smoothed.current) * k;
        const level = smoothed.current < 0.004 ? 0 : smoothed.current;
        setLevels((prev) => {
          const next = prev.slice(1);
          next.push(level);
          return next;
        });
      })
      .then((stop) => {
        if (alive) unlisten = stop;
        else stop();
      });
    return () => {
      alive = false;
      void obs.meter(false);
      unlisten?.();
    };
  }, [recording, paused]);

  // Keep the last take on screen while the bars collapse, then reset.
  useEffect(() => {
    if (recording) return;
    const id = window.setTimeout(() => {
      smoothed.current = 0;
      setLevels(Array(BAR_COUNT).fill(0));
    }, 450);
    return () => window.clearTimeout(id);
  }, [recording]);

  const elapsed = recording && !paused ? now : status ? timecodeMs(status.timecode) : 0;
  const timer = formatTimer(elapsed);
  const [timerMain, timerCentis] = timer.split(",");

  const run = async (action: () => Promise<void>, label?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (label) setNote(label);
    try {
      await action();
      const next = await obs.status();
      setStatus(next);
      base.current = { ms: timecodeMs(next.timecode), at: performance.now() };
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      window.setTimeout(() => setNote(null), 4000);
    }
  };

  const start = () => run(() => obs.start());
  const stop = () => run(() => obs.stop());
  const togglePause = () => run(() => (paused ? obs.resume() : obs.pause()));
  const prepare = () =>
    run(async () => {
      const message = await obs.prepare();
      setNote(message);
    });
  const openObs = () => run(() => obs.show());

  const captureScreen = async (area = false) => {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    setNote(area ? t("Select an area on screen...") : t("Capturing screen..."));
    try {
      const shot = area ? await screenCapture.takeArea() : await screenCapture.take();
      setNote(
        shot.copied
          ? t("Screenshot saved to Pictures\\Screenshots and copied")
          : t("Screenshot saved to Pictures\\Screenshots"),
      );
    } catch (e) {
      const message = String(e);
      if (/cancel/i.test(message)) setNote(t("Screen capture cancelled"));
      else setError(message);
    } finally {
      setCapturing(false);
      window.setTimeout(() => setNote(null), 4000);
    }
  };

  const setup = status && !connected ? status : null;
  const setupTitle = setup
    ? !setup.running
      ? t("OBS is not running")
      : !setup.websocket
        ? t("OBS WebSocket is off")
        : t("OBS is not reachable")
    : "";
  const setupBody = setup
    ? !setup.running
      ? t("Open OBS, then record from here.")
      : !setup.websocket
        ? t("OBS → Tools → WebSocket Server Settings → Enable WebSocket server.")
        : setup.error ?? t("Check OBS and try again.")
    : "";

  return (
    <div className="flex h-full min-h-0 flex-col px-1">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-2">
          <span className="size-6 shrink-0" />
          <div className="flex flex-1 items-center justify-center gap-1.5 text-[10.5px] font-semibold tracking-[-0.01em] text-label">
            <span
              className={`size-[5px] rounded-full ${
                recording ? "bg-[#ff453a] shadow-[0_0_7px_rgb(255_69_58/0.6)]" : "bg-label-3"
              }`}
            />
            {recording ? t("Recording") : t("Ready to record")}
          </div>
          <button
            type="button"
            aria-label={t("Open OBS")}
            title={t("Open OBS")}
            onClick={openObs}
            className="pressable flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-1 text-label-2"
          >
            <VideoCamera size={13} weight="bold" />
          </button>
        </div>

        <div className="text-center text-[34px] leading-none font-semibold tracking-[-0.055em] text-label tabular">
          {timerMain}
          <span className="text-[0.58em] font-semibold tracking-[-0.03em] text-label-3">,{timerCentis}</span>
        </div>

        {connected ? (
          <div className="relative mx-2 mt-0.5 flex h-[52px] items-center justify-center gap-[2.25px] overflow-hidden text-label">
            {levels.map((level, i) => {
              const shaped = Math.pow(Math.max(0, Math.min(1, level)), 0.42);
              const height = 3 + 46 * shaped * BAR_TEXTURE[i];
              return (
                <motion.span
                  key={i}
                  className="flex h-[52px] w-[2.25px] shrink-0 items-center justify-center"
                  initial={false}
                  animate={{ scaleY: recording ? 1 : 0.1, opacity: recording ? 1 : 0.22 }}
                  transition={{ type: "spring", stiffness: 170, damping: 24, mass: 0.7 }}
                >
                  <span
                    className="block w-full rounded-[2px] bg-current"
                    style={{
                      height,
                      opacity: recording ? 0.42 + 0.53 * (i / (BAR_COUNT - 1)) : 1,
                      transition: "height 80ms linear",
                    }}
                  />
                </motion.span>
              );
            })}
            <motion.span
              className="pointer-events-none absolute top-1 bottom-1 w-[2px] rounded-[2px] bg-[#ff453a] shadow-[0_0_8px_rgb(255_69_58/0.45)]"
              initial={false}
              animate={{ opacity: recording ? 1 : 0.22 }}
              transition={{ duration: 0.35 }}
              style={{ left: "66.6%" }}
            />
            <motion.span
              className="pointer-events-none absolute top-1/2 right-3 border-t border-dashed border-label-3"
              initial={false}
              animate={{ opacity: recording ? 1 : 0.12 }}
              transition={{ duration: 0.35 }}
              style={{ left: "67%" }}
            />
          </div>
        ) : setup ? (
          <div className="mx-2 mt-0.5 flex flex-1 flex-col items-center justify-center rounded-[14px] bg-fill-1 px-3 py-2 text-center">
            <div className="text-[10.5px] font-semibold text-label-2">{setupTitle}</div>
            <div className="mt-0.5 max-w-[360px] text-[10px] leading-snug text-label-3">{setupBody}</div>
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => void (setup.websocket ? openObs() : prepare())}
                className="pressable rounded-full bg-label px-2.5 py-1 text-[10px] font-semibold text-on-label"
              >
                {setup.websocket ? t("Open OBS") : t("Enable & open OBS")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void obs.status().then((next) => {
                    setStatus(next);
                    setError(null);
                  })
                }
                className="pressable rounded-full bg-fill-2 px-2.5 py-1 text-[10px] font-semibold text-label-2"
              >
                {t("Retry")}
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-2 mt-0.5 h-[52px]" />
        )}

        <div className="mt-0.5 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label={t("Capture full screen")}
            title={t("Capture full screen")}
            disabled={capturing}
            onClick={() => void captureScreen(false)}
            className={`pressable flex size-7 items-center justify-center rounded-full bg-fill-1 text-label-2 disabled:opacity-35 ${
              capturing ? "animate-pulse" : ""
            }`}
          >
            <Camera size={14} weight="bold" />
          </button>

          <button
            type="button"
            aria-label={t("Capture area")}
            title={t("Capture area")}
            disabled={capturing}
            onClick={() => void captureScreen(true)}
            className={`pressable flex size-7 items-center justify-center rounded-full bg-fill-1 text-label-2 disabled:opacity-35 ${
              capturing ? "animate-pulse" : ""
            }`}
          >
            <Selection size={14} weight="bold" />
          </button>

          <button
            type="button"
            aria-label={t("OBS audio")}
            title={t("OBS audio")}
            disabled={!connected}
            onClick={openObs}
            className="pressable flex size-7 items-center justify-center rounded-full bg-fill-1 text-label-2 disabled:opacity-35"
          >
            <Microphone size={13} weight="bold" />
          </button>

          <button
            type="button"
            aria-label={paused ? t("Resume recording") : t("Pause recording")}
            title={paused ? t("Resume recording") : t("Pause recording")}
            disabled={!recording || busy}
            onClick={() => void togglePause()}
            className="pressable flex size-7 items-center justify-center rounded-full bg-fill-1 text-label-2 disabled:opacity-35"
          >
            {paused ? <Play size={13} weight="fill" /> : <Pause size={13} weight="fill" />}
          </button>

          <button
            type="button"
            aria-label={recording ? t("Stop recording") : t("Start recording")}
            title={recording ? t("Stop recording") : t("Start recording")}
            disabled={!connected || busy}
            onClick={() => void (recording ? stop() : start())}
            className={`pressable flex size-[43px] items-center justify-center rounded-full bg-[#ff5d5d] shadow-[0_10px_20px_-8px_rgb(255_69_58/0.6),inset_0_1px_0_rgb(255_255_255/0.35)] transition-transform disabled:opacity-40 ${
              busy ? "animate-pulse" : ""
            }`}
          >
            {recording ? (
              <span className="size-[12px] rounded-[2.5px] bg-white" />
            ) : (
              <span className="size-[14px] rounded-full bg-white" />
            )}
          </button>

          <button
            type="button"
            aria-label={t("Done")}
            title={t("Done")}
            onClick={() => navigate("overview")}
            className="pressable flex size-7 items-center justify-center rounded-full bg-fill-1 text-label-2"
          >
            <Check size={14} weight="bold" />
          </button>
        </div>

        {(note || error) && (
          <div className="pointer-events-none absolute inset-x-3 bottom-12 rounded-xl bg-black/75 px-3 py-1.5 text-center text-[10px] font-medium text-white/90 shadow-lg">
            {error ?? note}
          </div>
        )}
      </div>
    </div>
  );
}
