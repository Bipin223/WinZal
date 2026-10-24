import { useState } from "react";
import { motion } from "motion/react";
import { ArrowCounterClockwise, Check } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { springs } from "../../design/motion";
import { isNative } from "../../platform/native";
import { settings, updateSettings, type Settings } from "../../settings/store";
import { Slider, Switch } from "../../ui/controls";
import { t } from "../../i18n";

type Appearance = Settings["appearance"];

const ACCENTS = ["auto", "#0a84ff", "#30d158", "#ffd60a", "#ff9f0a", "#ff453a", "#bf5af2", "#ffffff"];
const CLOCK_ACCENTS = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ffffff"];
const NOTCH_COLORS = ["#000000", "#0b0b0f", "#111827", "#0f1a14", "#1a0f1a", "#1a0f0f", "#101418", "#1c1c1e"];

const DEFAULTS: Appearance = {
  accent: "auto",
  resting: "#000000",
  expanded: "#000000",
  material: "solid",
  corners: "rounded",
  style: "dynamic",
  dragAnimation: true,
  dockIconBrightness: 100,
  subtextBrightness: 100,
  clockWeather: true,
  clockAccent: "#ff453a",
  clockText: "large",
  lyricsInPill: false,
  gpuAcceleration: false,
};

function fillWithAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function AppearanceView() {
  const a = settings.use().appearance;
  const set = (patch: Partial<Appearance>) => updateSettings({ appearance: { ...a, ...patch } });
  const [restarting, setRestarting] = useState(false);

  const setRenderMode = async (gpu: boolean) => {
    if (restarting) return;
    // Persist in localStorage for the UI, in Rust's mode file for the next launch,
    // then restart WebView2: --disable-gpu cannot be changed while it runs.
    set({ gpuAcceleration: gpu });
    if (!isNative) return;
    setRestarting(true);
    try {
      await invoke("set_webview_render_mode", { mode: gpu ? "gpu" : "cpu" });
      await relaunch();
    } catch {
      set({ gpuAcceleration: !gpu });
      setRestarting(false);
    }
  };

  const alpha = a.material === "glass" ? 0.62 : a.material === "dark" ? 0.82 : 1;
  const previewFill = fillWithAlpha(a.resting, alpha);
  const accent = a.accent === "auto" ? "#0a84ff" : a.accent;

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      <Preview fill={previewFill} accent={accent} corners={a.corners} islandStyle={a.style} />
      <Section label={t("Style")} hint={t("How the island looks on your screen")}>
        <div className="grid grid-cols-2 gap-1.5">
          <StyleCard
            active={a.style === "dynamic"}
            label={t("Dynamic Island")}
            hint={t("Hangs from the top edge like a notch, tabs with names.")}
            onClick={() => set({ style: "dynamic" })}
          />
          <StyleCard
            active={a.style === "windows"}
            label={t("Windows Island")}
            hint={t("A floating pill with a clock at rest and tabs at the bottom.")}
            floating
            onClick={() => set({ style: "windows" })}
          />
        </div>
      </Section>
      <Section label={t("Akzent")} hint={t("Aus dem Cover oder fest")}>
        <Swatches value={a.accent} colors={ACCENTS} onChange={(accent) => set({ accent })} />
      </Section>
      <Section label={t("Uhr-Akzent")} hint={t("Färbt die erste Ziffer der Uhrzeit")}>
        <Swatches value={a.clockAccent} colors={CLOCK_ACCENTS} onChange={(clockAccent) => set({ clockAccent })} />
      </Section>
      <Section label={t("Uhr-Text")} hint={t("Nur in der geschlossenen Pille")}>
        <Choice
          label={t("Größe")}
          value={a.clockText}
          options={[
            ["compact", t("Kompakt")],
            ["large", t("Groß")],
          ]}
          onChange={(clockText) => set({ clockText: clockText as Appearance["clockText"] })}
        />
      </Section>
      <Section label={t("Songtext")} hint={t("Aktuelle Zeile in der geschlossenen Pille")}>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div className="min-w-0">
            <div className="text-caption font-semibold text-label-2">{t("Lyrics in the closed pill")}</div>
            <div className="text-[9px] leading-[11px] text-label-4">
              {t("Shows the current synced line instead of the title when available (LRCLIB).")}
            </div>
          </div>
          <Switch checked={a.lyricsInPill} onChange={(lyricsInPill) => set({ lyricsInPill })} label={t("Lyrics in the closed pill")} />
        </div>
      </Section>
      <Section label={t("Ruhende Notch")} hint={t("Geschlossen")}>
        <Swatches value={a.resting} colors={NOTCH_COLORS} onChange={(resting) => set({ resting })} />
      </Section>
      <Section label={t("Offene Notch")} hint={t("Ausgeklappt")}>
        <Swatches value={a.expanded} colors={NOTCH_COLORS} onChange={(expanded) => set({ expanded })} />
      </Section>
      <div className="grid grid-cols-2 gap-1.5">
        <Choice
          label={t("Material")}
          value={a.material}
          options={[
            ["solid", t("Fest")],
            ["dark", t("Dunkles Glas")],
            ["glass", t("Glas")],
          ]}
          onChange={(material) => set({ material: material as Appearance["material"] })}
        />
        <Choice
          label={t("Ecken")}
          value={a.corners}
          options={[
            ["rounded", t("Rund")],
            ["squared", t("Eckig")],
          ]}
          onChange={(corners) => set({ corners: corners as Appearance["corners"] })}
        />
      </div>
      <Section label={t("Interaction")} hint={t("Motion and edge light")}>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div className="min-w-0">
            <div className="text-caption font-semibold text-label-2">{t("Drag animation")}</div>
            <div className="text-[9px] leading-[11px] text-label-4">
              {t("The notch squeezes and sways with the pointer.")}
            </div>
          </div>
          <Switch
            checked={a.dragAnimation}
            onChange={(v) => set({ dragAnimation: v })}
            label={t("Drag animation")}
          />
        </div>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div className="min-w-0">
            <div className="text-caption font-semibold text-label-2">{t("Clock & weather")}</div>
            <div className="text-[9px] leading-[11px] text-label-4">
              {t("Show the time and temperature in the closed island.")}
            </div>
          </div>
          <Switch
            checked={a.clockWeather}
            onChange={(v) => set({ clockWeather: v })}
            label={t("Clock & weather")}
          />
        </div>
      </Section>
      <Section label={t("Performance")} hint={t("Restart required")}>
        <div className="flex items-center justify-between gap-3 py-0.5">
          <div className="min-w-0">
            <div className="text-caption font-semibold text-label-2">{t("GPU acceleration")}</div>
            <div className="text-[9px] leading-[11px] text-label-4">
              {restarting
                ? t("Restarting WinZal...")
                : t("On: smoother animations, more RAM. Off: less RAM, more CPU.")}
            </div>
          </div>
          <Switch
            checked={a.gpuAcceleration}
            onChange={(v) => void setRenderMode(v)}
            label={t("GPU acceleration")}
          />
        </div>
      </Section>
      <Section label={t("Icons & subtext")} hint={t("Dim the small details")}>
        <div className="flex items-center justify-between text-caption font-semibold text-label-2">
          <span>{t("Dock icons")}</span>
          <span className="tabular text-label-3">{a.dockIconBrightness}%</span>
        </div>
        <Slider
          label={t("Dock icons")}
          value={a.dockIconBrightness}
          min={20}
          max={100}
          step={5}
          onChange={(v) => set({ dockIconBrightness: v })}
        />
        <div className="mt-1 flex items-center justify-between text-caption font-semibold text-label-2">
          <span>{t("Subtext")}</span>
          <span className="tabular text-label-3">{a.subtextBrightness}%</span>
        </div>
        <Slider
          label={t("Subtext")}
          value={a.subtextBrightness}
          min={20}
          max={100}
          step={5}
          onChange={(v) => set({ subtextBrightness: v })}
        />
      </Section>
      <button
        onClick={() => updateSettings({ appearance: { ...DEFAULTS, gpuAcceleration: a.gpuAcceleration } })}
        className="pressable flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-fill-1 text-caption text-label-2 hover:text-label"
      >
        <ArrowCounterClockwise size={12} weight="bold" />
        {t("Zurücksetzen")}
      </button>
    </div>
  );
}

function Preview({
  fill,
  accent,
  corners,
  islandStyle,
}: {
  fill: string;
  accent: string;
  corners: Appearance["corners"];
  islandStyle: Appearance["style"];
}) {
  const floating = islandStyle === "windows";
  return (
    <div className="relative flex h-[82px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-fill-1">
      <div className="absolute inset-x-4 top-2 flex justify-between text-[9px] tracking-wide text-label-4">
        <span>WINZAL</span>
        <span>{t("Vorschau")}</span>
      </div>
      <motion.div
        animate={{ backgroundColor: fill }}
        transition={springs.morph}
        className={`relative flex h-10 w-36 items-center justify-between px-2.5 ${
          floating ? "mt-4 rounded-[15px]" : corners === "squared" ? "mt-3 rounded-[7px]" : "mt-3 rounded-b-[15px]"
        }`}
        style={{
          boxShadow: floating ? "0 8px 22px rgb(0 0 0 / 0.55)" : undefined,
        }}
      >
        <span className="text-[10px] font-semibold text-white">9:44</span>
        <div className="flex items-end gap-[2px]" style={{ color: accent }}>
          {[3, 6, 9, 7, 4].map((h, i) => (
            <motion.span
              key={i}
              className="w-[2px] rounded-full bg-current"
              animate={{ height: [h, h + 3, h] }}
              transition={{ repeat: Infinity, duration: 1.25, delay: i * 0.11, ease: "easeInOut" }}
              style={{ height: h }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function StyleCard(props: {
  active: boolean;
  label: string;
  hint: string;
  floating?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-w-0 rounded-[10px] p-1.5 text-left transition-colors ${
        props.active ? "bg-fill-2 ring-1 ring-label" : "bg-fill-1 hover:bg-fill-2"
      }`}
    >
      <div className="relative mb-1.5 h-12 overflow-hidden rounded-[7px] bg-fill-2">
        {props.floating ? (
          <div
            className="mx-auto mt-3 flex h-7 w-24 items-center justify-center gap-1 rounded-[13px] bg-black"
          >
            <span className="text-[8px] font-semibold text-white">9:44</span>
            <span className="text-[7px] text-white/60">12°</span>
          </div>
        ) : (
          <div className="mx-auto flex h-7 w-24 items-center justify-center gap-1 rounded-b-[12px] bg-black">
            <span className="text-[8px] font-semibold text-white">9:44</span>
            <span className="text-[7px] text-white/60">12°</span>
          </div>
        )}
      </div>
      <div className="truncate text-[10px] font-semibold text-label">{props.label}</div>
      <div className="mt-0.5 text-[8px] leading-[10px] text-label-3">{props.hint}</div>
    </button>
  );
}

function Section({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0 rounded-[12px] bg-fill-1 px-3 py-1.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-caption font-semibold text-label-2">{label}</span>
        <span className="text-[10px] text-label-4">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Swatches({ value, colors, onChange }: { value: string; colors: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {colors.map((color) => {
        const active = value === color;
        return (
          <motion.button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => onChange(color)}
            whileTap={{ scale: 0.9 }}
            className={`relative size-5 shrink-0 rounded-full ring-2 transition-colors ${
              active ? "ring-label" : "ring-transparent"
            }`}
            style={{
              background:
                color === "auto"
                  ? "conic-gradient(#ff453a, #ffd60a, #30d158, #0a84ff, #bf5af2, #ff453a)"
                  : color,
            }}
          >
            {active && <Check size={9} weight="bold" className="absolute inset-0 m-auto text-white mix-blend-difference" />}
          </motion.button>
        );
      })}
    </div>
  );
}

function Choice(props: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-[12px] bg-fill-1 px-2 py-1.5">
      <div className="mb-1 text-caption font-semibold text-label-2">{props.label}</div>
      <div className="flex gap-0.5">
        {props.options.map(([value, label]) => {
          const active = props.value === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => props.onChange(value)}
              className={`min-w-0 flex-1 truncate rounded-[7px] px-1.5 py-1 text-[10px] font-medium transition-colors ${
                active ? "bg-label text-black" : "text-label-2 hover:text-label"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
