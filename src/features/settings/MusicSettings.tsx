import { settings, updateSettings } from "../../settings/store";
import { t } from "../../i18n";
import { Group, Row, Segmented, Switch } from "../../ui/controls";

/**
 * Music-specific settings in one place: what the closed pill shows and how
 * synced lyrics are displayed. The rest of the now-playing UI stays in the
 * media tool itself.
 */
export function MusicSettings() {
  const a = settings.use().appearance;
  const set = (patch: Partial<typeof a>) => updateSettings((cur) => ({ appearance: { ...cur.appearance, ...patch } }));

  return (
    <>
      <Group title={t("Wiedergabe")} id="settings-music">
        <Row
          label={t("Musik in der geschlossenen Notch")}
          hint={t("Cover, Titel und Equalizer, während Musik läuft")}
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
          hint={t("Synchronisierte Zeile von LRCLIB, wenn verfügbar")}
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
            <Row label={t("Pill-Größe")}>
              <Segmented
                id="lyrics-size"
                size="sm"
                value={a.lyricsSize}
                onChange={(lyricsSize) => set({ lyricsSize })}
                options={[
                  { value: "default", label: t("Standard") },
                  { value: "large", label: t("Groß") },
                ]}
              />
            </Row>
            <Row label={t("Animation")}>
              <Segmented
                id="lyrics-animation"
                size="sm"
                value={a.lyricsAnimation}
                onChange={(lyricsAnimation) => set({ lyricsAnimation })}
                options={[
                  { value: "current", label: t("Aktuell") },
                  { value: "apple", label: t("Apple Music") },
                  { value: "word", label: t("Wort für Wort") },
                ]}
              />
            </Row>
          </>
        )}
      </Group>
    </>
  );
}
