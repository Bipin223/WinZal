import { useState } from "react";
import { settings, updateSettings, type Settings } from "../../settings/store";
import { t } from "../../i18n";
import { LyricAnimationPreview } from "../now-playing/LyricAnimationPreview";
import { LyricVisualizer, type LyricVisualizerStyle } from "../now-playing/LyricVisualizer";
import { SelectedDot } from "../../ui/SelectedDot";
import { Group, Row, Segmented, Slider, Switch } from "../../ui/controls";

/**
 * Music-specific settings in one place: what the closed pill shows and how
 * synced lyrics are displayed. The rest of the now-playing UI stays in the
 * media tool itself.
 */
export function MusicSettings() {
  const a = settings.use().appearance;
  const set = (patch: Partial<typeof a>) => updateSettings((cur) => ({ appearance: { ...cur.appearance, ...patch } }));
  const [hoverAnim, setHoverAnim] = useState<string | null>(null);
  const [hoverViz, setHoverViz] = useState<string | null>(null);
  const visualizers: { value: LyricVisualizerStyle; label: string }[] = [
    { value: "wave", label: t("Welle") },
    { value: "pulse", label: t("Puls") },
    { value: "dots", label: t("Punkte") },
    { value: "ripple", label: t("Wasserring") },
    { value: "aurora", label: t("Aurora") },
  ];
  const animations: { value: Settings["appearance"]["lyricsAnimation"]; label: string }[] = [
    { value: "apple", label: t("Apple Music") },
    { value: "word", label: t("Word by Word") },
    { value: "kinetic", label: t("Kinetic") },
    { value: "reveal", label: t("Reveal") },
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
            <Row label={t("Lyrics offset")}>
              <div className="flex w-44 items-center gap-2">
                <Slider
                  label={t("Lyrics offset")}
                  value={a.lyricsOffset}
                  min={-1}
                  max={1}
                  step={0.1}
                  onChange={(lyricsOffset) => set({ lyricsOffset })}
                />
                <span className="tabular w-11 shrink-0 text-right text-caption text-label-3">
                  {a.lyricsOffset > 0 ? "+" : ""}
                  {a.lyricsOffset.toFixed(1)} s
                </span>
              </div>
            </Row>
            <Row label={t("Pillenbreite")}>
              <Segmented
                id="lyrics-pill-width"
                size="sm"
                value={a.lyricsPillWidth}
                onChange={(lyricsPillWidth) => set({ lyricsPillWidth })}
                options={[
                  { value: "compact", label: t("Kompakt") },
                  { value: "normal", label: t("Normal") },
                  { value: "long", label: t("Lang") },
                ]}
              />
            </Row>
            <Row label={t("Visualisierung")}>
              <Switch label={t("Visualisierung")} checked={a.lyricsVisualizer} onChange={(lyricsVisualizer) => set({ lyricsVisualizer })} />
            </Row>
            {a.lyricsVisualizer && (
              <div className="px-3 pb-3">
                <div className="mb-1.5 text-footnote text-label-2">{t("Stil")}</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {visualizers.map((visualizer) => (
                    <button
                      key={visualizer.value}
                      type="button"
                      onClick={() => set({ lyricsVisualizerStyle: visualizer.value })}
                      onPointerEnter={() => setHoverViz(visualizer.value)}
                      onPointerLeave={() => setHoverViz((v) => (v === visualizer.value ? null : v))}
                      className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
                        a.lyricsVisualizerStyle === visualizer.value
                          ? "border-label bg-fill-2"
                          : "border-separator bg-fill-1 hover:bg-fill-2"
                      }`}
                    >
                      <div className="h-8 overflow-hidden rounded-[7px] bg-black">
                        <LyricVisualizer style={visualizer.value} playing={hoverViz === visualizer.value} preview />
                      </div>
                      <div className="mt-1 text-center text-[9px] font-medium text-label">{visualizer.label}</div>
                      {a.lyricsVisualizerStyle === visualizer.value && (
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
