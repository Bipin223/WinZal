import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  clearLyricTrackOffsets,
  lyricTrackKey,
  setLyricTrackOffset,
  settings,
  updateSettings,
  type Settings,
} from "../../settings/store";
import { useNowPlaying } from "../../platform/media";
import { t } from "../../i18n";
import { LyricAnimationPreview } from "../now-playing/LyricAnimationPreview";
import { LyricEqualizer, LyricGlow } from "../now-playing/LyricVisualizer";
import { Equalizer } from "../now-playing/Equalizer";
import { SelectedDot } from "../../ui/SelectedDot";
import { Button, Group, Row, Segmented, Slider, Switch } from "../../ui/controls";

/**
 * Music-specific settings in one place: what the closed pill shows and how
 * synced lyrics are displayed. The rest of the now-playing UI stays in the
 * media tool itself.
 */
export function MusicSettings() {
  const a = settings.use().appearance;
  const set = (patch: Partial<typeof a>) => updateSettings((cur) => ({ appearance: { ...cur.appearance, ...patch } }));
  const [hoverAnim, setHoverAnim] = useState<string | null>(null);
  const equalizers: { value: Settings["appearance"]["lyricsVisualizerStyle"]; label: string }[] = [
    { value: "bars", label: "Bars" },
  ];
  const glows: { value: Settings["appearance"]["lyricsGlowStyle"]; label: string }[] = [
    { value: "none", label: t("None") },
    { value: "wave", label: "Wave" },
    { value: "aurora", label: "Aurora" },
    { value: "bokeh", label: "Bokeh" },
    { value: "leaves", label: "Leaves" },
  ];
  const animations: { value: Settings["appearance"]["lyricsAnimation"]; label: string }[] = [
    { value: "word", label: t("Word by Word") },
    { value: "apple", label: t("Apple Music") },
    { value: "fill", label: "Word fill sweep" },
    { value: "glitch", label: "Glitch scramble" },
    { value: "liquid", label: "Liquid fill" },
    { value: "spot", label: "Spotlight" },
    { value: "spark", label: "Spark" },
    { value: "orbit", label: "Orbit" },
    { value: "ambient", label: "Ambient" },
  ];

  return (
    <>
      <Group title={t("Wiedergabe")} id="settings-music">
        <Row
          label={t("Musik in der geschlossenen Notch")}
        >
          <Switch
            label={t("Musik in der geschlossenen Notch")}
            checked={a.musicInPill}
            onChange={(musicInPill) => set({ musicInPill })}
          />
        </Row>
      </Group>
      <Group title={t("Songtext")} id="settings-lyrics">
        <Row
          label={t("Songtext in der geschlossenen Pille")}
        >
          <Switch
            label={t("Songtext in der geschlossenen Pille")}
            checked={a.lyricsInPill}
            onChange={(lyricsInPill) => set({ lyricsInPill })}
          />
        </Row>
        {a.lyricsInPill && (
          <>
            <div className="px-3 pt-3">
              <LyricsPillPreview />
            </div>
            <Row label={t("Zeilen-Layout")}>
              <Segmented
                id="lyrics-layout"
                size="sm"
                value={a.lyricsLayout}
                onChange={(lyricsLayout) => set({ lyricsLayout })}
                options={[
                  { value: "inline", label: t("In einer Zeile") },
                  { value: "lines", label: t("Zeile für Zeile") },
                ]}
              />
            </Row>
            <Row label={t("Textgröße")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Textgröße")}
                  value={a.lyricsTextSize}
                  min={10}
                  max={15}
                  step={0.5}
                  onChange={(lyricsTextSize) => set({ lyricsTextSize })}
                />
                <span className="tabular w-11 shrink-0 text-right text-caption text-label-3">{a.lyricsTextSize.toFixed(1)} px</span>
              </div>
            </Row>
            <Row label={t("Lyric timing")}>
              <Segmented
                id="lyrics-sync-mode"
                size="sm"
                value={a.lyricsSyncMode}
                onChange={(lyricsSyncMode) => set({ lyricsSyncMode })}
                options={[
                  { value: "word", label: t("Word") },
                  { value: "line", label: t("Line") },
                ]}
              />
            </Row>
            <Row label={t("Global lyric offset")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Global lyric offset")}
                  value={a.lyricsOffset}
                  min={-5}
                  max={5}
                  step={0.05}
                  onChange={(lyricsOffset) => set({ lyricsOffset })}
                />
                <span className="tabular w-12 shrink-0 text-right text-caption text-label-3">
                  {a.lyricsOffset > 0 ? "+" : ""}
                  {a.lyricsOffset.toFixed(2)} s
                </span>
              </div>
            </Row>
            <CurrentTrackOffset />
            <SavedTrackOffsets />
            <Row label={t("Weight")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Weight")}
                  value={a.lyricsTextWeight}
                  min={400}
                  max={900}
                  step={50}
                  onChange={(lyricsTextWeight) => set({ lyricsTextWeight })}
                />
                <span className="tabular w-11 shrink-0 text-right text-caption text-label-3">{a.lyricsTextWeight}</span>
              </div>
            </Row>
            <Row label={t("Min width")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Min width")}
                  value={a.lyricsPillMinWidth}
                  min={284}
                  max={640}
                  step={4}
                  onChange={(lyricsPillMinWidth) => set({ lyricsPillMinWidth, lyricsPillLength: Math.max(a.lyricsPillLength, lyricsPillMinWidth) })}
                />
                <span className="tabular w-11 shrink-0 text-right text-caption text-label-3">{a.lyricsPillMinWidth} px</span>
              </div>
            </Row>
            <Row label={t("Pill length")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Pill length")}
                  value={a.lyricsPillLength}
                  min={284}
                  max={640}
                  step={4}
                  onChange={(lyricsPillLength) => set({ lyricsPillLength: Math.max(a.lyricsPillMinWidth, lyricsPillLength) })}
                />
                <span className="tabular w-11 shrink-0 text-right text-caption text-label-3">{a.lyricsPillLength} px</span>
              </div>
            </Row>
            <Row label={t("Auto width")}>
              <Switch label={t("Auto width")} checked={a.lyricsPillAuto} onChange={(lyricsPillAuto) => set({ lyricsPillAuto })} />
            </Row>
            <Row label={t("Pill height")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Pill height")}
                  value={a.lyricsPillHeight}
                  min={24}
                  max={44}
                  step={1}
                  onChange={(lyricsPillHeight) => set({ lyricsPillHeight })}
                />
                <span className="tabular w-11 shrink-0 text-right text-caption text-label-3">{a.lyricsPillHeight} px</span>
              </div>
            </Row>
            <Row label={t("Visualisierung")}>
              <Switch label={t("Visualisierung")} checked={a.lyricsVisualizer} onChange={(lyricsVisualizer) => set({ lyricsVisualizer })} />
            </Row>
            {a.lyricsVisualizer && (
              <div className="px-3 pb-3">
                <div className="mb-1.5 text-footnote text-label-2">Equalizer</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {equalizers.map((equalizer) => (
                    <button
                      key={equalizer.value}
                      type="button"
                      onClick={() => set({ lyricsVisualizerStyle: equalizer.value })}
                      className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
                        a.lyricsVisualizerStyle === equalizer.value
                          ? "border-label bg-fill-2"
                          : "border-separator bg-fill-1 hover:bg-fill-2"
                      }`}
                    >
                      <div className="flex h-8 items-center justify-center overflow-hidden rounded-[7px] bg-black">
                        {equalizer.value === "bars" ? (
                          <Equalizer playing height={16} />
                        ) : (
                          <LyricEqualizer style={equalizer.value} playing preview />
                        )}
                      </div>
                      <div className="mt-1 text-center text-[9px] font-medium text-label">{equalizer.label}</div>
                      {a.lyricsVisualizerStyle === equalizer.value && (
                        <SelectedDot className="absolute top-1.5 right-1.5" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="mt-2 mb-1.5 text-footnote text-label-2">Behind glow</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {glows.map((glow) => (
                    <button
                      key={glow.value}
                      type="button"
                      onClick={() => set({ lyricsGlowStyle: glow.value })}
                      className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
                        a.lyricsGlowStyle === glow.value
                          ? "border-label bg-fill-2"
                          : "border-separator bg-fill-1 hover:bg-fill-2"
                      }`}
                    >
                      <div className="relative h-7 overflow-hidden rounded-[7px] bg-black">
                        {glow.value !== "none" && (
                          <LyricGlow style={glow.value} playing />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold text-white/80">
                          {glow.value === "none" ? t("None") : ""}
                        </span>
                      </div>
                      <div className="mt-1 text-center text-[8px] font-medium text-label">{glow.label}</div>
                      {a.lyricsGlowStyle === glow.value && (
                        <SelectedDot className="absolute top-1.5 right-1.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="px-3 pb-3">
              <div className="mb-1.5 text-footnote font-medium text-label-2">{t("Animation")}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {animations.map((animation) => (
                  <button
                    key={animation.value}
                    type="button"
                    onClick={() => set({ lyricsAnimation: animation.value })}
                    onPointerEnter={() => setHoverAnim(animation.value)}
                    onPointerLeave={() => setHoverAnim((v) => (v === animation.value ? null : v))}
                    className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
                      a.lyricsAnimation === animation.value
                        ? "border-label bg-fill-2"
                        : "border-separator bg-fill-1 hover:bg-fill-2"
                    }`}
                  >
                    <div className="h-8 overflow-hidden rounded-[7px] bg-black">
                      {hoverAnim === animation.value ? (
                        <LyricAnimationPreview animation={animation.value} />
                      ) : (
                        <div className="flex h-full items-center justify-center px-1">
                          <span className="truncate text-[9px] font-semibold whitespace-nowrap text-white/80">When you light the candle</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-center text-[9px] font-medium text-label">{animation.label}</div>
                    {a.lyricsAnimation === animation.value && (
                      <SelectedDot className="absolute top-1.5 right-1.5" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Group>
    </>
  );
}

/** Manual correction for the track that is playing right now. */
function CurrentTrackOffset() {
  const np = useNowPlaying();
  const a = settings.use().appearance;
  if (!np) {
    return (
      <Row label={t("This track's offset")}>
        <span className="text-caption text-label-3">{t("Nothing playing")}</span>
      </Row>
    );
  }
  const key = lyricTrackKey(np.title, np.artist);
  const value = a.lyricsTrackOffsets[key] ?? 0;
  const nudge = (delta: number) => setLyricTrackOffset(key, value + delta);
  return (
    <Row label={t("This track's offset")}>
      <div className="flex items-center gap-1">
        <OffsetButton label={t("Lyrics earlier")} onClick={() => nudge(-0.1)}>
          -0.1
        </OffsetButton>
        <button
          type="button"
          onClick={() => setLyricTrackOffset(key, 0)}
          title={t("Reset this track")}
          className="tabular w-12 shrink-0 text-center text-caption font-medium text-label"
        >
          {value > 0 ? "+" : ""}
          {value.toFixed(2)} s
        </button>
        <OffsetButton label={t("Lyrics later")} onClick={() => nudge(0.1)}>
          +0.1
        </OffsetButton>
      </div>
    </Row>
  );
}

function OffsetButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="pressable pressable-fill flex h-7 shrink-0 items-center rounded-full bg-fill-2 px-2 text-[10px] font-semibold text-label"
    >
      {children}
    </button>
  );
}

function SavedTrackOffsets() {
  const offsets = settings.use().appearance.lyricsTrackOffsets;
  const count = Object.keys(offsets).length;
  return (
    <Row label={t("Saved track offsets")}>
      <Button onClick={clearLyricTrackOffsets} disabled={count === 0}>
        {t("Reset all")}
      </Button>
    </Row>
  );
}

/** Live preview of the closed lyric pill. */
function LyricsPillPreview() {
  const a = settings.use().appearance;
  const [textWidth, setTextWidth] = useState(0);
  useLayoutEffect(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = `${a.lyricsTextWeight} ${a.lyricsTextSize}px ${getComputedStyle(document.body).fontFamily}`;
    setTextWidth(ctx.measureText("When you light the candle").width);
  }, [a.lyricsTextSize, a.lyricsTextWeight]);
  const width = a.lyricsPillAuto
    ? Math.max(a.lyricsPillMinWidth, Math.min(a.lyricsPillLength, textWidth + (a.lyricsVisualizer ? 108 : 78)))
    : a.lyricsPillLength;
  const scale = Math.min(1, 430 / Math.max(1, width));
  return (
    <div className="flex h-16 items-center justify-center overflow-hidden rounded-[10px] bg-fill-2 px-2">
      <div
        className="relative flex origin-center items-center justify-between gap-2 overflow-hidden rounded-full bg-black px-3"
        style={{ width, height: a.lyricsPillHeight, transform: `scale(${scale})` }}
      >
        {a.lyricsVisualizer && <LyricGlow style={a.lyricsGlowStyle} playing />}
        <span className="size-5 shrink-0 rounded-[5px] bg-white/15" />
        <span
          className="relative z-10 truncate whitespace-nowrap text-white"
          style={{ fontSize: a.lyricsTextSize, fontWeight: a.lyricsTextWeight }}
        >
          When you light the candle
        </span>
        {a.lyricsVisualizer &&
          (a.lyricsVisualizerStyle === "bars" ? (
            <Equalizer playing height={14} />
          ) : (
            <LyricEqualizer style={a.lyricsVisualizerStyle} playing preview />
          ))}
      </div>
    </div>
  );
}
