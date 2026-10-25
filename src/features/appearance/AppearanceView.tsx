import { useId } from "react";
import { motion } from "motion/react";
import { ArrowCounterClockwise, Plus } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { settings, updateSettings, type Settings } from "../../settings/store";
import { Slider, Switch } from "../../ui/controls";
import { SelectedDot } from "../../ui/SelectedDot";
import { ColorPickerPanel } from "../../ui/ColorPicker";
import { t } from "../../i18n";
import { ClockTime } from "../../notch/ClockTime";
import { formatTimeParts } from "../../lib/format";
import { useMinute } from "../../lib/useMinute";
import { DARK_SURFACE, LIGHT_SURFACE, useThemeLight } from "./theme";

type Appearance = Settings["appearance"];

const ACCENTS = ["auto", "#0a84ff", "#30d158", "#ffd60a", "#ff9f0a", "#ff453a", "#bf5af2", "#ffffff"];
const CLOCK_ACCENTS = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ffffff"];
const DEFAULTS: Appearance = {
  accent: "auto",
  material: "solid",
  corners: "rounded",
  theme: "dark",
  themeColor: "#141416",
  style: "dynamic",
  islandWidth: 0,
  islandHeight: 30,
  lineWidth: 150,
  lineThickness: 5,
  dragAnimation: true,
  clockWeather: true,
  clockShowWeather: true,
  clockShowDate: true,
  clockShowDay: true,
  musicInPill: true,
  clockAccent: "#ff453a",
  clockClosedSize: 15,
  clockClosedWeight: 800,
  clockOpenWeight: 700,
  clockEmphasis: true,
  lyricsInPill: false,
  lyricsLayout: "inline",
  motion: 100,
  lyricsTextSize: 12,
  lyricsOffset: 0,
  lyricsPillExtraWidth: 0,
  lyricsPillHeight: 30,
  lyricsTextWeight: 600,
  lyricsVisualizer: true,
  lyricsVisualizerStyle: "wave",
  lyricsAnimation: "apple",
  gpuAcceleration: false,
  gpuPreference: "auto",
};

function fillWithAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function AppearanceView({ mode = "appearance" }: { mode?: "appearance" | "notch" }) {
  const a = settings.use().appearance;
  const display = settings.use().display;
  const line = display.idleStyle === "line";
  const now = useMinute();
  const previewTime = formatTimeParts(now);
  const themeLight = useThemeLight();
  const set = (patch: Partial<Appearance>) => updateSettings({ appearance: { ...a, ...patch } });

  const alpha = a.material === "glass" ? 0.62 : a.material === "dark" ? 0.82 : 1;
  const previewFill = fillWithAlpha(a.theme === "custom" ? a.themeColor : themeLight ? LIGHT_SURFACE : DARK_SURFACE, alpha);
  const accent = a.accent === "auto" ? "#0a84ff" : a.accent;

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {mode === "appearance" && <Preview fill={previewFill} accent={accent} corners={a.corners} islandStyle={a.style} />}
      {mode === "notch" && (
        <>
          <Section label={t("Closed pill")}>
            <Choice
              label={t("Idle Appearance")}
              value={display.idleStyle}
              options={[
                ["notch", t("Notch")],
                ["line", t("Line")],
              ]}
              onChange={(idleStyle) =>
                updateSettings((current) => ({ display: { ...current.display, idleStyle: idleStyle as "notch" | "line" } }))
              }
            />
            <div className="mt-2 mb-2 flex h-20 items-center justify-center rounded-[10px] bg-fill-2">
              {line ? (
                <div
                  className="relative rounded-full bg-black shadow-[0_6px_18px_rgb(0_0_0/0.35)]"
                  style={{ width: a.lineWidth, height: a.lineThickness }}
                >
                  <span
                    aria-hidden
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      width: 8,
                      height: Math.max(2, a.lineThickness),
                      background: "#ffd60a",
                      boxShadow: "0 0 10px 1px rgb(255 214 10 / 0.55)",
                    }}
                  />
                </div>
              ) : (
                <div
                  className="flex items-center justify-center overflow-hidden rounded-full bg-black px-2 shadow-[0_6px_18px_rgb(0_0_0/0.35)] transition-[width,height] duration-200"
                  style={{ width: 206 + a.islandWidth, height: a.islandHeight }}
                >
                  {a.clockWeather && (
                    <div
                      className="flex items-center gap-1 whitespace-nowrap"
                      style={{ fontWeight: a.clockClosedWeight }}
                    >
                      <span style={{ fontSize: `${a.clockClosedSize}px`, color: "#fff" }}>
                        <ClockTime
                          time={previewTime.time}
                          className="tabular"
                          emphasizeHour={a.clockEmphasis}
                          weight={a.clockClosedWeight}
                        />
                      </span>
                      {previewTime.period && (
                        <span className="text-white/55" style={{ fontSize: Math.max(8, Math.round(a.clockClosedSize * 0.66)) }}>
                          {previewTime.period}
                        </span>
                      )}
                      {(a.clockShowDay || a.clockShowDate) && (
                        <span className="text-white/55" style={{ fontSize: Math.max(8, Math.round(a.clockClosedSize * 0.66)) }}>
                          · {[a.clockShowDay ? "Sun" : null, a.clockShowDate ? "25 Oct" : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {a.clockShowWeather && (
                        <span className="text-white/55" style={{ fontSize: Math.max(8, Math.round(a.clockClosedSize * 0.8)) }}>
                          · 25°
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-[3fr_2fr] gap-3">
              <div>
                <div className="flex items-center justify-between text-caption font-medium text-label-2">
                  <span>{t("Length")}</span>
                  <span className="tabular text-label-3">{line ? a.lineWidth : 206 + a.islandWidth} px</span>
                </div>
                <Slider
                  label={t("Length")}
                  value={line ? a.lineWidth : 206 + a.islandWidth}
                  min={line ? 40 : 140}
                  max={740}
                  step={1}
                  onChange={(length) => (line ? set({ lineWidth: length }) : set({ islandWidth: length - 206 }))}
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-caption font-medium text-label-2">
                  <span>{t("Width")}</span>
                  <span className="tabular text-label-3">{line ? a.lineThickness : a.islandHeight} px</span>
                </div>
                <Slider
                  label={t("Width")}
                  value={line ? a.lineThickness : a.islandHeight}
                  min={line ? 1 : 20}
                  max={line ? 24 : 64}
                  step={1}
                  onChange={(width) => (line ? set({ lineThickness: width }) : set({ islandHeight: width }))}
                />
              </div>
            </div>
            {!line && (
              <>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-caption font-medium text-label-2">
                    <span>{t("Text size")}</span>
                    <span className="tabular text-label-3">{a.clockClosedSize.toFixed(1)} px</span>
                  </div>
                  <Slider
                    label={t("Text size")}
                    value={a.clockClosedSize}
                    min={10}
                    max={24}
                    step={0.5}
                    onChange={(clockClosedSize) => set({ clockClosedSize })}
                  />
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-caption font-medium text-label-2">
                    <span>{t("Weight")}</span>
                    <span className="tabular text-label-3">{a.clockClosedWeight}</span>
                  </div>
                  <Slider
                    label={t("Weight")}
                    value={a.clockClosedWeight}
                    min={400}
                    max={1000}
                    step={100}
                    onChange={(clockClosedWeight) => set({ clockClosedWeight })}
                  />
                </div>
                <div className="mt-2 flex flex-col gap-1.5">
                  <ToggleRow label={t("Closed clock")} checked={a.clockWeather} onChange={(clockWeather) => set({ clockWeather })} />
                  {a.clockWeather && (
                    <>
                      <div className="flex min-h-6 items-center justify-between gap-3 text-caption">
                        <span className="font-medium text-label-2">{t("Time")}</span>
                        <span className="text-label-3">{t("Always shown")}</span>
                      </div>
                      <ToggleRow label={t("Weather")} checked={a.clockShowWeather} onChange={(clockShowWeather) => set({ clockShowWeather })} />
                      <ToggleRow label={t("Date")} checked={a.clockShowDate} onChange={(clockShowDate) => set({ clockShowDate })} />
                      <ToggleRow label={t("Day")} checked={a.clockShowDay} onChange={(clockShowDay) => set({ clockShowDay })} />
                    </>
                  )}
                </div>
              </>
            )}
          </Section>

          <Section label={t("Extended pill")}>
            <div className="mb-2 flex h-[72px] items-center justify-center rounded-[10px] bg-fill-2">
              <div className="flex items-center rounded-[14px] bg-black px-5 py-3">
                <ClockTime
                  time={previewTime.time}
                  className="tabular text-[34px] text-white"
                  emphasizeHour={a.clockEmphasis}
                  weight={a.clockOpenWeight}
                />
                {previewTime.period && <span className="ml-1 text-[11px] font-semibold text-white/55">{previewTime.period}</span>}
              </div>
            </div>
            <div className="flex items-center justify-between text-caption font-medium text-label-2">
              <span>{t("Weight")}</span>
              <span className="tabular text-label-3">{a.clockOpenWeight}</span>
            </div>
            <Slider
              label={t("Weight")}
              value={a.clockOpenWeight}
              min={400}
              max={1000}
              step={100}
              onChange={(clockOpenWeight) => set({ clockOpenWeight })}
            />
            <div className="mt-2">
              <ToggleRow label={t("Emphasized hour")} checked={a.clockEmphasis} onChange={(clockEmphasis) => set({ clockEmphasis })} />
            </div>
            <div className="mt-2">
              <div className="mb-1 text-caption font-medium text-label-2">{t("Clock accent")}</div>
              <Swatches value={a.clockAccent} colors={CLOCK_ACCENTS} onChange={(clockAccent) => set({ clockAccent })} />
            </div>
          </Section>
        </>
      )}
      {mode === "appearance" && (
        <>
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
          <ColorPickerPanel value={a.themeColor} onChange={(themeColor) => set({ themeColor })} />
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
      <button
        onClick={() =>
          updateSettings({
            appearance: {
              ...DEFAULTS,
              // Notch size lives on the Notch page; Appearance reset leaves it alone.
              islandWidth: a.islandWidth,
              islandHeight: a.islandHeight,
              lineWidth: a.lineWidth,
              lineThickness: a.lineThickness,
              gpuAcceleration: a.gpuAcceleration,
              gpuPreference: a.gpuPreference,
              // Clock styling lives on the Notch page; Appearance reset leaves it alone.
              clockAccent: a.clockAccent,
              clockClosedSize: a.clockClosedSize,
              clockEmphasis: a.clockEmphasis,
              clockClosedWeight: a.clockClosedWeight,
              clockOpenWeight: a.clockOpenWeight,
              clockWeather: a.clockWeather,
              clockShowWeather: a.clockShowWeather,
              clockShowDate: a.clockShowDate,
              clockShowDay: a.clockShowDay,
              // Music lives in its own settings page; Appearance reset leaves it alone.
              musicInPill: a.musicInPill,
              lyricsInPill: a.lyricsInPill,
              lyricsLayout: a.lyricsLayout,
              lyricsTextSize: a.lyricsTextSize,
              lyricsOffset: a.lyricsOffset,
              motion: a.motion,
              lyricsPillExtraWidth: a.lyricsPillExtraWidth,
              lyricsPillHeight: a.lyricsPillHeight,
              lyricsTextWeight: a.lyricsTextWeight,
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
        </>
      )}
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
      <div className="truncate text-caption font-medium text-label">{props.label}</div>
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0 rounded-[12px] bg-fill-1 px-3 py-2">
      <div className="mb-1.5 text-footnote font-medium text-label-2">{label}</div>
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
