import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowCounterClockwise, Eyedropper, Plus } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { springs } from "../../design/motion";
import { isNative } from "../../platform/native";
import { settings, updateSettings, type Settings } from "../../settings/store";
import { Switch } from "../../ui/controls";
import { SelectedDot } from "../../ui/SelectedDot";
import { ColorPickerPanel } from "../../ui/ColorPicker";
import { t } from "../../i18n";
import { DARK_SURFACE, LIGHT_SURFACE, useThemeLight } from "./theme";

type Appearance = Settings["appearance"];

const ACCENTS = ["auto", "#0a84ff", "#30d158", "#ffd60a", "#ff9f0a", "#ff453a", "#bf5af2", "#ffffff"];
const CLOCK_ACCENTS = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ffffff"];
const THEME_COLORS = ["#0b0b0f", "#1c1c1e", "#0b1220", "#0f1a14", "#1a0f1a", "#f5f5f7", "#fdf6e3", "#f7e7a1", "#e5e5e5", "#ffffff"];
const THEME_PRESETS = [
  { name: "Mocha", color: "#2a1b16", a: "#4a2c20", b: "#e7c4a5" },
  { name: "Matcha", color: "#1f2e1a", a: "#3e5b34", b: "#cddfb3" },
  { name: "Monochrome", color: "#1c1c1e", a: "#0b0b0f", b: "#e5e5e5" },
  { name: "Soft Yellow", color: "#f7e7a1", a: "#e8c84a", b: "#fff7d1" },
];

const DEFAULTS: Appearance = {
  accent: "auto",
  material: "solid",
  corners: "rounded",
  theme: "dark",
  themeColor: "#141416",
  style: "dynamic",
  dragAnimation: true,
  clockWeather: true,
  musicInPill: true,
  clockAccent: "#ff453a",
  clockText: "large",
  clockBold: true,
  lyricsInPill: false,
  lyricsLayout: "inline",
  lyricsTextSize: 12,
  lyricsVisualizer: true,
  lyricsVisualizerStyle: "wave",
  lyricsAnimation: "apple",
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
  const themeLight = useThemeLight();
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
  const previewFill = fillWithAlpha(a.theme === "custom" ? a.themeColor : themeLight ? LIGHT_SURFACE : DARK_SURFACE, alpha);
  const accent = a.accent === "auto" ? "#0a84ff" : a.accent;

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      <Preview fill={previewFill} accent={accent} corners={a.corners} islandStyle={a.style} />
      <Section label={t("Theme")}>
        <Choice
          label={t("Modus")}
          value={a.theme}
          options={[
            ["dark", t("Dark")],
            ["light", t("Light")],
            ["system", t("System")],
            ["custom", t("Custom")],
          ]}
          onChange={(theme) => set({ theme: theme as Appearance["theme"] })}
        />
      </Section>
      {a.theme === "custom" && (
        <Section label={t("Theme color")}>
          <ThemeColorPicker value={a.themeColor} themeLight={themeLight} onChange={(themeColor) => set({ themeColor })} />
        </Section>
      )}
      <Section label={t("Style")}>
        <div className="grid grid-cols-2 gap-1.5">
          <StyleCard active={a.style === "dynamic"} label={t("Dynamic Island")} onClick={() => set({ style: "dynamic" })} />
          <StyleCard active={a.style === "windows"} label={t("Windows Island")} floating onClick={() => set({ style: "windows" })} />
        </div>
      </Section>
      <Section label={t("Equalization Accent")}>
        <Swatches value={a.accent} colors={ACCENTS} onChange={(accent) => set({ accent })} />
      </Section>
      <Section label={t("Uhr-Akzent")}>
        <Swatches value={a.clockAccent} colors={CLOCK_ACCENTS} onChange={(clockAccent) => set({ clockAccent })} />
      </Section>
      <Section label={t("Uhr-Text")}>
        <ToggleRow label={t("Clock & weather")} checked={a.clockWeather} onChange={(clockWeather) => set({ clockWeather })} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Choice
            label={t("Closed pill")}
            value={a.clockText}
            options={[
              ["compact", t("Kompakt")],
              ["large", t("Groß")],
            ]}
            onChange={(clockText) => set({ clockText: clockText as Appearance["clockText"] })}
          />
          <Choice
            label={t("Expanded")}
            value={a.clockBold ? "bold" : "regular"}
            options={[
              ["regular", t("Regular")],
              ["bold", t("Bold")],
            ]}
            onChange={(value) => set({ clockBold: value === "bold" })}
          />
        </div>
      </Section>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-[12px] bg-fill-1 p-2">
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
        </div>
        <div className="rounded-[12px] bg-fill-1 p-2">
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
      </div>
      <Section label={t("Interaction")}>
        <ToggleRow
          label={t("Drag animation")}
          checked={a.dragAnimation}
          onChange={(dragAnimation) => set({ dragAnimation })}
        />
      </Section>
      <Section label={t("Performance")}>
        <ToggleRow
          label={restarting ? t("Restarting WinZal...") : t("GPU acceleration")}
          checked={a.gpuAcceleration}
          onChange={(v) => void setRenderMode(v)}
        />
      </Section>
      <button
        onClick={() =>
          updateSettings({
            appearance: {
              ...DEFAULTS,
              gpuAcceleration: a.gpuAcceleration,
              // Music lives in its own settings page; Appearance reset leaves it alone.
              musicInPill: a.musicInPill,
              lyricsInPill: a.lyricsInPill,
              lyricsLayout: a.lyricsLayout,
              lyricsTextSize: a.lyricsTextSize,
              lyricsVisualizer: a.lyricsVisualizer,
              lyricsVisualizerStyle: a.lyricsVisualizerStyle,
              lyricsAnimation: a.lyricsAnimation,
            },
          })
        }
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
        <span className="text-[10px] font-semibold text-label">9:44</span>
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

function StyleCard(props: { active: boolean; label: string; floating?: boolean; onClick: () => void }) {
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
          <div className="mx-auto mt-3 flex h-7 w-24 items-center justify-center gap-1 rounded-[13px] bg-black">
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
      <div className="truncate text-caption font-semibold text-label">{props.label}</div>
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0 rounded-[12px] bg-fill-1 px-3 py-2">
      <div className="mb-1.5 text-footnote font-semibold text-label-2">{label}</div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <span className="min-w-0 truncate text-caption font-medium text-label-2">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function ThemeColorPicker({ value, themeLight, onChange }: { value: string; themeLight: boolean; onChange: (v: string) => void }) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : "#141416";
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          title={t("Open color picker")}
          aria-label={t("Open color picker")}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-[12px] ring-2 ring-label"
          style={{ background: color }}
        >
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <Eyedropper
              size={15}
              weight="bold"
              className={themeLight ? "text-black/70" : "text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.65))]"}
            />
          </span>
        </button>
        <div className="min-w-0">
          <div className="text-caption font-semibold text-label">{t("Custom theme color")}</div>
          <div className="truncate text-caption text-label-3 tabular">
            {color.toUpperCase()} · {themeLight ? t("Dark text") : t("Light text")}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {THEME_COLORS.map((preset) => {
          const active = color.toLowerCase() === preset.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              onClick={() => onChange(preset)}
              className={`relative size-5 shrink-0 rounded-full ring-2 transition-colors ${active ? "ring-label" : "ring-transparent"}`}
              style={{ background: preset }}
            >
              {active && <SelectedDot size={5} className="absolute inset-0 m-auto ring-1 ring-white/80" />}
            </button>
          );
        })}
      </div>
      <div className="mt-1">
        <div className="mb-1.5 text-footnote font-semibold text-label-2">{t("Ready-made")}</div>
        <div className="grid grid-cols-2 gap-1.5">
          {THEME_PRESETS.map((preset) => {
            const active = color.toLowerCase() === preset.color;
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => onChange(preset.color)}
                aria-pressed={active}
                className={`flex min-w-0 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-fill-2 ring-2 ring-label" : "bg-fill-1 hover:bg-fill-2"
                }`}
              >
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-full ring-1 ring-separator"
                  style={{ background: `linear-gradient(135deg, ${preset.a} 0 50%, ${preset.b} 50% 100%)` }}
                />
                <span className="min-w-0 flex-1 truncate text-caption font-semibold text-label">{preset.name}</span>
                {active && <SelectedDot size={4} />}
              </button>
            );
          })}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
            className="overflow-hidden"
          >
            <ColorPickerPanel value={color} onChange={onChange} onClose={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Swatches({ value, colors, onChange }: { value: string; colors: string[]; onChange: (v: string) => void }) {  const custom = !colors.includes(value) && /^#?[0-9a-f]{6}$/i.test(value);
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
            {active && <SelectedDot size={5} className="absolute inset-0 m-auto ring-1 ring-white/80" />}
          </motion.button>
        );
      })}
      <label
        title={t("Eigene Farbe")}
        className={`relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-full ring-2 transition-colors ${
          custom ? "ring-label" : "ring-transparent"
        }`}
        style={{
          background: custom
            ? value
            : "conic-gradient(#ff453a, #ffd60a, #30d158, #0a84ff, #bf5af2, #ff453a)",
        }}
      >
        <input
          type="color"
          aria-label={t("Eigene Farbe")}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          {custom ? (
            <SelectedDot size={5} className="ring-1 ring-white/80" />
          ) : (
            <Plus size={9} weight="bold" className="text-white [filter:drop-shadow(0_1px_1px_rgb(0_0_0/0.7))]" />
          )}
        </span>
      </label>
    </div>
  );
}

/** Full-width segmented control with a sliding pill; labels stay centred. */
function Choice(props: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="mb-1 truncate text-caption font-medium text-label-3">{props.label}</div>
      <div className="flex rounded-[9px] bg-fill-2 p-[2px]">
        {props.options.map(([value, label]) => {
          const active = props.value === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => props.onChange(value)}
              className="relative min-w-0 flex-1 rounded-[7px] px-1 py-[4px] text-caption font-medium leading-[13px] transition-colors duration-150"
            >
              {active && (
                <motion.span
                  layoutId={`choice-${id}`}
                  className="absolute inset-0 rounded-[7px] bg-label shadow-[0_1px_2px_rgb(0_0_0/0.25)]"
                  transition={springs.snappy}
                />
              )}
              <span className={`relative block truncate ${active ? "text-on-label" : "text-label-3 hover:text-label-2"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
