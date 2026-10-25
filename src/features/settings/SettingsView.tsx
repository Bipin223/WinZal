import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import {
  ArrowClockwise,
  ArrowsInLineHorizontal,
  DotsSixVertical,
  Keyboard,
  Lightning,
  LockSimple,
  Monitor,
  MusicNotesSimple,
  Palette,
  Play,
  SlidersHorizontal,
  SquaresFour,
  Stop,
  Timer,
  UserCircle,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { content, fade, springs } from "../../design/motion";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { isNative } from "../../platform/native";
import { alarmSounds, playAlarm, stopAlarm, type AlarmDuration } from "../../lib/sound";
import { nav } from "../../notch/nav";
import { requestSize } from "../../notch/size";
import { tabs } from "../../notch/tabs";
import { autostart, display, fetchFps, fetchUsage, fpsHelperReady, secrets, unlockFps, type ChangelogEntry, type MonitorInfo, type SecretName } from "../../platform/services";
import { settings, updateAsk, updateSettings, type AskProvider, type Settings, type TypeRole, DEFAULT_TYPOGRAPHY } from "../../settings/store";
import { TYPE_ROLES, typeValues } from "../appearance/typography";
import { ChatBubbleIcon } from "../../ui/ChatBubbleIcon";
import { DiscordLogo } from "../../ui/brands";
import { Button, Group, Row, Segmented, Select, Slider, Switch, TextField } from "../../ui/controls";
import { SelectedDot } from "../../ui/SelectedDot";
import { effortLevels, listModels, providerInfo } from "../ask/providers";
import { discordState, reconnectDiscord } from "../discord/store";
import { fps } from "../system/gaming";
import { FpsStat, GamingStat } from "../system/LiveGaming";
import { gamingWidth } from "../system/gamingOverlay";
import { PlaceSearch } from "../weather/WeatherView";
import { AppearanceView } from "../appearance/AppearanceView";
import { MusicSettings } from "./MusicSettings";
import { AboutView } from "./AboutView";
import { VaultSettings } from "../vault/VaultSettings";
import { detectPlace } from "../weather/store";
import { focusMode, refreshFocusMode, setFocusMode } from "../../notch/focus";
import { silentMode, setSilentMode } from "../../notch/silent";
import { checkForUpdate, installUpdate, update } from "../../lib/update";
import { between, changelog, itemText, markSeen, useUnseen } from "../../lib/changelog";
import { privacy, togglePresentation, usePresenting } from "../privacy/store";
import { locale, t, tBackend } from "../../i18n";
import { usageError } from "../usage/UsageView";

type PageId = "general" | "notch" | "appearance" | "display" | "performance" | "music" | "tools" | "timer" | "ai" | "discord" | "about";

const pages: { id: PageId; label: string; icon: Icon }[] = [
  { id: "general", label: "Allgemein", icon: SlidersHorizontal },
  { id: "notch", label: "Notch", icon: Monitor },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "display", label: "Display", icon: Monitor },
  { id: "performance", label: "Performance", icon: Lightning },
  { id: "music", label: "Musik", icon: MusicNotesSimple },
  { id: "tools", label: "Tools", icon: SquaresFour },
  { id: "timer", label: "Timer", icon: Timer },
  { id: "ai", label: "AI", icon: ChatBubbleIcon as unknown as Icon },
  { id: "discord", label: "Discord", icon: DiscordLogo },
  { id: "about", label: "About", icon: UserCircle },
];

/** Deep links from other tools (`navigate("settings", "<section>")`) → page holding that section. */
const sectionPage: Record<string, PageId> = {
  weather: "general",
  updates: "general",
  display: "display",
  appearance: "appearance",
  notch: "notch",
  performance: "performance",
  gpu: "performance",
  fps: "performance",
  music: "music",
  lyrics: "music",
  presentation: "display",
  alarm: "timer",
  ask: "ai",
  usage: "ai",
  discord: "discord",
  vault: "tools",
  about: "about",
};

/** Last open page survives closing/opening the notch (the component is rebuilt). */
let savedPage: PageId = "general";

/** Trim the settings window to the page so short pages don't leave a blank area. */
const PAGE_HEIGHT: Record<PageId, number> = {
  general: 460,
  notch: 460,
  appearance: 460,
  display: 460,
  performance: 460,
  music: 460,
  tools: 460,
  timer: 460,
  ai: 460,
  discord: 460,
  about: 410,
};

/**
 * Settings like macOS: categories on the left, only their content on the right.
 * Other tools jump straight to their section via `navigate("settings", "<section>")`.
 */
export function SettingsView() {
  const { section } = nav.use();
  const [page, setPageState] = useState<PageId>(() => (section && sectionPage[section]) || savedPage);
  const scroller = useRef<HTMLDivElement>(null);
  const setPage = (p: PageId) => {
    savedPage = p;
    setPageState(p);
  };

  useEffect(() => {
    requestSize("settings", { w: 660, h: PAGE_HEIGHT[page] });
  }, [page]);
  useEffect(() => () => requestSize("settings", null), []);

  useEffect(() => {
    if (!section || !sectionPage[section]) return;
    setPage(sectionPage[section]);
    // The section only exists after the page switch.
    const id = window.setTimeout(
      () => scroller.current?.querySelector<HTMLElement>(`#settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      120,
    );
    return () => window.clearTimeout(id);
  }, [section]);

  return (
    <div className="flex h-full gap-3 px-4 pt-1 pb-3">
      <nav className="flex w-[136px] shrink-0 flex-col gap-0.5">
        {pages.map((p) => {
          const active = p.id === page;
          return (
            <button
              key={p.id}
              onClick={() => setPage(p.id)}
              aria-current={active ? "page" : undefined}
              className={`pressable relative flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-body transition-colors duration-150 ${
                active ? "text-label" : "text-label-3 hover:text-label-2"
              }`}
            >
              {active && <motion.span layoutId="settings-page" className="absolute inset-0 rounded-[8px] bg-fill-2" transition={springs.snappy} />}
              <p.icon size={15} weight={active ? "fill" : "bold"} className="relative shrink-0" />
              <span className="relative truncate">{t(p.label)}</span>
            </button>
          );
        })}
      </nav>
      {/* Ref on the stable container: popLayout doesn't pass refs to the child. */}
      <div ref={scroller} className="relative min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={page}
            className="absolute inset-0 flex flex-col gap-4 overflow-y-auto pb-6 [scrollbar-width:none]"
            style={{ maskImage: "linear-gradient(180deg, #000 calc(100% - 28px), transparent)" }}
            initial={{ opacity: 0, transform: "translateY(3px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", transition: content.enter }}
            exit={{ opacity: 0, transform: "translateY(-3px)", transition: content.exit }}
          >
            {page === "general" && (
              <>
                <General />
                <Weather />
                <Updates />
              </>
            )}
            {page === "notch" && <AppearanceView mode="notch" />}
            {page === "appearance" && <AppearanceView mode="appearance" />}
            {page === "display" && (
              <>
                <Display />
                <Typography />
                <GamingSettings />
                <Presentation />
              </>
            )}
            {page === "performance" && <Performance />}
            {page === "music" && <MusicSettings />}
            {page === "tools" && (
              <>
                <Tools />
                <VaultSettings />
              </>
            )}
            {page === "timer" && <Alarm />}
            {page === "ai" && (
              <>
                <Ask />
                <UsageSettings />
                <KeysNote />
              </>
            )}
            {page === "discord" && (
              <>
                <Discord />
                <KeysNote />
              </>
            )}
            {page === "about" && <AboutView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Version, update check and (optionally) automatic install. */
function Updates() {
  const updates = settings.use().updates;
  const auto = updates.auto;
  const install = updates.install;
  const u = update.use();
  const unseen = useUnseen();
  // Remember what was new when the section opened, so the labels stay while reading.
  const [fresh] = useState(() => new Set(unseen.map((e) => e.version)));
  const [showLog, setShowLog] = useState(false);
  const busy = u.phase === "checking" || u.phase === "downloading";
  const status = {
    idle: undefined,
    checking: t("Suche …"),
    current: t("Du hast die neueste Version"),
    available: t("Neue Version gefunden"),
    downloading: t("Wird geladen … {n} %", { n: Math.round(u.progress * 100) }),
    error: t("Prüfung fehlgeschlagen – später erneut versuchen"),
  }[u.phase];
  const upcoming = u.notes && u.version && u.current ? between(u.notes, u.current, u.version) : [];

  return (
    <Group title={t("Updates")} id="settings-updates">
      <Row label={t("Version {v}", { v: u.current ?? "–" })} hint={status}>
        <Button disabled={busy} onClick={() => void checkForUpdate()}>
          {t("Jetzt suchen")}
        </Button>
      </Row>
      <AnimatePresence initial={false}>
        {(u.phase === "available" || u.phase === "downloading") && u.version && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <Row label={t("Version {v} verfügbar", { v: u.version })}>
              {u.phase === "downloading" ? (
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-fill-2">
                  <div className="h-full origin-left rounded-full bg-label transition-transform duration-150 ease-linear" style={{ transform: `scaleX(${u.progress})` }} />
                </div>
              ) : (
                <Button primary onClick={() => void installUpdate()}>
                  {t("Jetzt aktualisieren")}
                </Button>
              )}
            </Row>
            {upcoming.length > 0 && <ChangelogList entries={upcoming} />}
          </motion.div>
        )}
      </AnimatePresence>
      <Row
        label={
          <span className="flex items-center gap-1.5">
            {t("Neuerungen")}
            {unseen.length > 0 && !showLog && <span className="size-[7px] rounded-full bg-link" />}
          </span>
        }
        hint={unseen.length > 0 ? t(unseen.length === 1 ? "Neu in Version {v}" : "{n} Versionen seit deinem letzten Update", { v: unseen[0].version, n: unseen.length }) : undefined}
      >
        <Button
          onClick={() => {
            if (!showLog) markSeen();
            setShowLog((v) => !v);
          }}
        >
          {showLog ? t("Ausblenden") : t("Anzeigen")}
        </Button>
      </Row>
      <AnimatePresence initial={false}>
        {showLog && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <ChangelogList entries={between(changelog, null, u.current ?? changelog[0].version)} fresh={fresh} />
          </motion.div>
        )}
      </AnimatePresence>
      <Row label={t("Automatisch suchen")}>
        <Switch label={t("Automatisch suchen")} checked={auto} onChange={(on) => updateSettings({ updates: { ...updates, auto: on } })} />
      </Row>
      <Row label={t("Automatisch installieren")}>
        <Switch label={t("Automatisch installieren")} checked={install} onChange={(on) => updateSettings({ updates: { ...updates, install: on } })} />
      </Row>
    </Group>
  );
}

/** Versions with their short notes; `fresh` marks the ones new since your last update. */
function ChangelogList({ entries, fresh }: { entries: ChangelogEntry[]; fresh?: Set<string> }) {
  const date = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex flex-col gap-3 px-3 pt-1.5 pb-3">
      {entries.map((e, i) => (
        <motion.div
          key={e.version}
          initial={{ opacity: 0, transform: "translateY(4px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ...content.enter, delay: 0.04 * Math.min(i, 6) }}
        >
          <div className="flex items-baseline gap-1.5 text-caption">
            <span className="tabular font-semibold text-label">{e.version}</span>
            {fresh?.has(e.version) && <span className="font-medium text-link">{t("Neu")}</span>}
            <span className="ml-auto text-label-3">{date.format(new Date(`${e.date}T12:00:00`))}</span>
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {e.items.map((item, j) => (
              <li key={j} className={`flex gap-2 text-footnote ${item.highlight ? "font-semibold text-label" : "text-label-2"}`}>
                <span aria-hidden className={`mt-[7px] size-[3px] shrink-0 rounded-full ${item.highlight ? "bg-label" : "bg-label-3"}`} />
                <span>{itemText(item)}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      ))}
    </div>
  );
}

function KeysNote() {
  return (
    <div className="flex items-start gap-1.5 px-3 pb-1 text-caption text-label-4">
      <LockSimple size={11} weight="bold" className="mt-0.5 shrink-0" />
      {t("Schlüssel liegen in der Windows-Anmeldeinformationsverwaltung. Alles bleibt auf diesem PC.")}
    </div>
  );
}

function Ask() {
  const s = settings.use();
  const provider = s.ask.provider;
  const cfg = s.ask.configs[provider];
  const base = provider === "custom" ? cfg.baseUrl : "";
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (provider === "custom" && !base.trim()) {
      setModels([]);
      setError(t("Set the base URL first"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listModels(provider, base);
      setModels(list);
      // A sensible first choice when no model is selected yet.
      if (!cfg.model.trim() && list.length) {
        const preferred =
          provider === "gemini"
            ? ["gemini-3.5-flash", "gemini-4-argon", "gemini-3.8-flash"].find((m) => list.includes(m))
            : provider === "groq"
              ? ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"].find((m) => list.includes(m))
              : undefined;
        updateAsk(provider, { model: preferred ?? list[0] });
      }
    } catch (e) {
      const message = String(e);
      setError(message === "no-key" ? t("Save an API key first") : tBackend(message));
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setModels([]);
    setError(null);
    void load();
    // Refetch only when the provider or its base URL changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, base]);

  const options = (models.includes(cfg.model) || !cfg.model ? models : [cfg.model, ...models]).map((m) => ({
    value: m,
    label: m,
  }));


  return (
    <Group title={t("AI-Chat")} id="settings-ask">
      <Row label={t("Anbieter")}>
        <Segmented<AskProvider>
          id="ask-provider"
          size="sm"
          value={provider}
          onChange={(next) => updateSettings({ ask: { ...s.ask, provider: next } })}
          options={(Object.keys(providerInfo) as AskProvider[]).map((p) => ({ value: p, label: providerInfo[p].label }))}
        />
      </Row>
      {provider === "custom" && (
        <Row label={t("Base-URL")}>
          <TextField
            value={s.ask.configs.custom.baseUrl}
            onChange={(baseUrl) => updateAsk("custom", { baseUrl: baseUrl.trim() })}
            placeholder="https://…/v1"
            width="w-52"
          />
        </Row>
      )}
      <SecretRow
        name={`ai.${provider}` as SecretName}
        label={t("API-Schlüssel")}
        onSaved={() => void load()}
      />
      <Row label={t("Modell")} hint={error ?? undefined}>
        <div className="flex items-center gap-1.5">
          {models.length ? (
            <Select
              value={cfg.model || models[0]}
              options={options}
              onChange={(model) => updateAsk(provider, { model })}
              width="w-52"
            />
          ) : (
            <TextField
              value={cfg.model}
              onChange={(model) => updateAsk(provider, { model: model.trim() })}
              placeholder={t(providerInfo[provider].modelHint)}
              width="w-52"
            />
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title={t("Modelle laden")}
            aria-label={t("Modelle laden")}
            className="pressable flex size-7 shrink-0 items-center justify-center rounded-full text-label-3 hover:text-label disabled:opacity-40"
          >
            <ArrowClockwise size={14} weight="bold" className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </Row>
      <Row label="Effort">
        <Segmented
          id="ask-effort-settings"
          size="sm"
          value={cfg.effort}
          onChange={(effort) => updateAsk(provider, { effort })}
          options={effortLevels}
        />
      </Row>
      <Row label={t("Chats speichern")}>
        <Switch
          label={t("Chats speichern")}
          checked={s.ask.saveHistory}
          onChange={(on) => updateSettings({ ask: { ...s.ask, saveHistory: on } })}
        />
      </Row>
    </Group>
  );
}

function General() {
  const s = settings.use();
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => {
    void autostart.get().then(setAuto);
  }, []);

  return (
    <Group>
      <Row label={t("Uhrzeit")}>
        <Segmented
          id="clock-format"
          size="sm"
          value={s.units.clock}
          onChange={(clock) => updateSettings((p) => ({ units: { ...p.units, clock } }))}
          options={[
            { value: "24", label: t("24 Std.") },
            { value: "12", label: t("12 Std.") },
          ]}
        />
      </Row>
      <Row label={t("Öffnen")}>
        <Segmented
          id="open-mode"
          size="sm"
          value={s.openMode}
          onChange={(openMode) => updateSettings({ openMode })}
          options={[
            { value: "hover", label: t("Hover") },
            { value: "click", label: t("Klick") },
          ]}
        />
      </Row>
      <AnimatePresence initial={false}>
        {s.openMode === "hover" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <Row label={t("Hover-Verzögerung")}>
              <Segmented
                id="hover-delay"
                size="sm"
                value={s.hoverDelay}
                onChange={(hoverDelay) => updateSettings({ hoverDelay })}
                options={[
                  { value: "fast", label: t("Schnell") },
                  { value: "normal", label: t("Normal") },
                  { value: "patient", label: t("Geduldig") },
                ]}
              />
            </Row>
          </motion.div>
        )}
      </AnimatePresence>
      <Row label={t("Mit Windows starten")}>
        {auto !== null && (
          <Switch
            label={t("Mit Windows starten")}
            checked={auto}
            onChange={(v) => {
              setAuto(v);
              void autostart.set(v);
            }}
          />
        )}
      </Row>
      <Row label={t("Tastenkürzel")}>
        <span className="flex items-center gap-1 text-caption text-label-2">
          <Keyboard size={13} weight="bold" className="text-label-3" />
          {["Strg", "Alt", "Leertaste"].map((k) => (
            <kbd key={k} className="rounded-[5px] bg-fill-2 px-1.5 py-0.5 font-sans text-caption">{t(k)}</kbd>
          ))}
        </span>
      </Row>
    </Group>
  );
}

/** Where and when the notch shows up. */
function Display() {
  const s = settings.use();
  const d = s.display;
  const focus = focusMode.use();
  useEffect(() => {
    void refreshFocusMode();
  }, []);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    void display.monitors().then(setMonitors);
  }, []);
  // Show the FPS row in Settings even when gaming mode has not drawn a value yet.
  // A direct ETW attempt fails asynchronously, so poll briefly until the state is known.
  useEffect(() => {
    let alive = true;
    const load = () => void fetchFps().then((r) => alive && fps.set({ value: r.fps, error: r.error }));
    load();
    const id = window.setInterval(load, 1500);
    const stop = window.setTimeout(() => window.clearInterval(id), 6000);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, []);
  const label = (m: MonitorInfo, i: number) => `${m.primary ? t("Hauptbildschirm") : t("Bildschirm {n}", { n: i + 1 })} · ${m.width}×${m.height}`;

  return (
    <Group id="settings-display">
      <Row label={t("Sichtbarkeit")}>
        <Segmented
          id="display-visibility"
          size="sm"
          value={d.visibility}
          onChange={(visibility) => updateSettings((cur) => ({ display: { ...cur.display, visibility } }))}
          options={[
            { value: "always", label: t("Immer oben") },
            { value: "hide-fullscreen", label: t("Vollbild: aus") },
          ]}
        />
      </Row>
      {monitors.length > 1 && (
        <Row label={t("Monitor")}>
          <Select
            width="w-52"
            value={d.monitor ?? monitors.find((m) => m.primary)?.name ?? monitors[0].name}
            onChange={(name) => updateSettings((cur) => ({ display: { ...cur.display, monitor: monitors.find((m) => m.name === name)?.primary ? null : name } }))}
            options={monitors.map((m, i) => ({ value: m.name, label: label(m, i) }))}
          />
        </Row>
      )}
      {d.offset !== 0 && (
        <Row label={t("Position")}>
          <Button onClick={() => updateSettings((cur) => ({ display: { ...cur.display, offset: 0 } }))}>
            <span className="flex items-center gap-1.5">
              <ArrowsInLineHorizontal size={13} weight="bold" /> {t("Zur Mitte")}
            </span>
          </Button>
        </Row>
      )}
      <Row label={t("Silent mode")}>
        <Switch label={t("Silent mode")} checked={silentMode.use()} onChange={setSilentMode} />
      </Row>
      <Row label={t("Nicht stören")}>
        <Switch label={t("Nicht stören")} checked={focus} onChange={setFocusMode} />
      </Row>
      <Row label={t("Aufnahme-Punkte")}>
        <Switch label={t("Aufnahme-Punkte")} checked={s.privacyDots} onChange={(privacyDots) => updateSettings({ privacyDots })} />
      </Row>
    </Group>
  );
}

/** Font roles: size and weight offsets, 0 = default. */
function Typography() {
  const typo = settings.use().typography;
  const [role, setRole] = useState<TypeRole>("body");
  const axis = typo[role];
  const info = TYPE_ROLES.find((r) => r.value === role)!;
  const eff = typeValues(role, axis);
  const setAxis = (patch: Partial<{ size: number; weight: number }>) =>
    updateSettings((cur) => ({
      typography: { ...cur.typography, [role]: { ...cur.typography[role], ...patch } },
    }));
  const formatSize = (value: number) => (value === 0 ? t("Default") : `${value > 0 ? "+" : ""}${value.toFixed(1)} px`);
  const formatWeight = (value: number) => (value === 0 ? t("Default") : `${value > 0 ? "+" : ""}${value}`);
  return (
    <Group title={t("Font")} id="settings-font">
      <div className="grid grid-cols-5 gap-1.5 px-3 pt-3">
        {TYPE_ROLES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setRole(entry.value)}
            className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
              role === entry.value ? "border-label bg-fill-2" : "border-separator bg-fill-1 hover:bg-fill-2"
            }`}
          >
            <div className="flex h-9 items-center justify-center rounded-[7px] bg-fill-2">
              <span className={`${entry.className} text-label`}>Aa</span>
            </div>
            <div className="mt-1 text-center text-[9px] font-medium text-label">{t(entry.label)}</div>
            {role === entry.value && <SelectedDot className="absolute top-1.5 right-1.5" />}
          </button>
        ))}
      </div>
      <div className="mx-3 mt-2 rounded-[10px] bg-fill-2 px-3 py-3">
        <div className={info.className}>{t(info.sample)}</div>
        <div className="mt-1 text-[10px] text-label-4">
          {eff.size % 1 === 0 ? eff.size : eff.size.toFixed(1)} px · {eff.weight}
        </div>
      </div>
      <Row label={t("Size")}>
        <div className="flex w-48 items-center gap-2">
          <Slider
            label={t("Size")}
            value={axis.size}
            min={-4}
            max={8}
            step={0.5}
            onChange={(size) => setAxis({ size })}
          />
          <span className="tabular w-16 text-right text-caption text-label-3">{formatSize(axis.size)}</span>
        </div>
      </Row>
      <Row label={t("Weight")}>
        <div className="flex w-48 items-center gap-2">
          <Slider
            label={t("Weight")}
            value={axis.weight}
            min={-300}
            max={300}
            step={50}
            onChange={(weight) => setAxis({ weight })}
          />
          <span className="tabular w-16 text-right text-caption text-label-3">{formatWeight(axis.weight)}</span>
        </div>
      </Row>
      <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2">
        <span className="text-caption text-label-4">{t("0 = default")}</span>
        <Button onClick={() => updateSettings({ typography: DEFAULT_TYPOGRAPHY })}>{t("Reset font")}</Button>
      </div>
    </Group>
  );
}

/** Game overlay: live look, what to show, and how the values are drawn. */
function GamingSettings() {
  const g = settings.use().gaming;
  const setG = (patch: Partial<Settings["gaming"]>) => updateSettings((cur) => ({ gaming: { ...cur.gaming, ...patch } }));
  const width = gamingWidth(g);
  const left = g.showFps || g.showCpu;
  const right = g.showGpu || g.showRam;
  const scale = width > 430 ? 430 / width : 1;
  const sample = {
    cpu: [18, 24, 21, 30, 28, 36, 33, 37],
    gpu: [30, 38, 34, 44, 40, 52, 47, 48],
    ram: [52, 55, 54, 58, 60, 63, 67, 69],
  };
  const flags: { key: "showFps" | "showCpu" | "showTemps" | "showGpu" | "showRam"; label: string }[] = [
    { key: "showFps", label: "FPS" },
    { key: "showCpu", label: "CPU" },
    { key: "showTemps", label: t("Temperatures") },
    { key: "showGpu", label: "GPU" },
    { key: "showRam", label: "RAM" },
  ];
  const styles: { value: Settings["gaming"]["style"]; label: string }[] = [
    { value: "text", label: t("Text") },
    { value: "bars", label: t("Bars") },
    { value: "graph", label: t("Graph") },
  ];
  return (
    <Group title={t("Gaming")} id="settings-gaming">
      <div className="px-3 pt-3 pb-2">
        <div className="relative flex h-16 items-center justify-center overflow-hidden rounded-[10px] bg-fill-2 px-2">
          <span className="absolute top-1.5 right-2 z-10 text-[9px] font-semibold tracking-wide text-label-4 uppercase">
            {g.mode === "games" ? t("On") : t("Off")}
          </span>
          <div
            className={`flex origin-center items-center gap-2 rounded-full bg-black px-3 text-white ${
              left && right ? "justify-between" : "justify-center"
            } ${g.mode === "games" ? "" : "opacity-50"}`}
            style={{ width, height: 30, transform: `scale(${scale})` }}
          >
            {left && (
              <div className="flex shrink-0 items-center gap-2">
                {g.showFps && <FpsStat f={{ value: 64, error: null }} preview />}
                {g.showCpu && (
                  <GamingStat label="CPU" value={37} temp={g.showTemps ? 28 : null} kind={g.style} preview data={sample.cpu} />
                )}
              </div>
            )}
            {right && (
              <div className="flex shrink-0 items-center gap-2">
                {g.showGpu && (
                  <GamingStat label="GPU" value={48} temp={g.showTemps ? 81 : null} kind={g.style} preview data={sample.gpu} />
                )}
                {g.showGpu && g.showRam && <span aria-hidden className="h-3 w-px shrink-0 self-center bg-white/15" />}
                {g.showRam && <GamingStat label="RAM" value={69} kind={g.style} preview data={sample.ram} />}
              </div>
            )}
            {!left && !right && <span aria-hidden className="size-1 rounded-full bg-white/40" />}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 pb-2">
        {flags.map((flag) => (
          <div key={flag.key} className="flex min-h-6 items-center justify-between gap-2">
            <span className="text-caption font-medium text-label-2">{flag.label}</span>
            <Switch
              label={flag.label}
              checked={g[flag.key]}
              onChange={(on) => setG({ [flag.key]: on } as Partial<Settings["gaming"]>)}
            />
          </div>
        ))}
      </div>
      <div className="px-3 pb-2">
        <div className="mb-1.5 text-footnote font-medium text-label-2">{t("Stat style")}</div>
        <div className="grid grid-cols-3 gap-1.5">
          {styles.map((style) => (
            <button
              key={style.value}
              type="button"
              onClick={() => setG({ style: style.value })}
              className={`relative overflow-hidden rounded-[10px] border p-1 transition-colors ${
                g.style === style.value ? "border-label bg-fill-2" : "border-separator bg-fill-1 hover:bg-fill-2"
              }`}
            >
              <div className="flex h-8 items-center justify-center rounded-[7px] bg-black">
                <GamingStat label="CPU" value={37} kind={style.value} preview data={sample.cpu} />
              </div>
              <div className="mt-1 text-center text-[9px] font-medium text-label">{style.label}</div>
              {g.style === style.value && <SelectedDot className="absolute top-1.5 right-1.5" />}
            </button>
          ))}
        </div>
      </div>
      <Row label={t("Gaming overlay")}>
        <Switch
          label={t("Gaming overlay")}
          checked={g.mode === "games"}
          onChange={(on) => setG({ mode: on ? "games" : "off" })}
        />
      </Row>
      <Row label={t("Transparent in games")}>
        <Switch label={t("Transparent in games")} checked={g.transparent} onChange={(transparent) => setG({ transparent })} />
      </Row>
      <Row label={t("Custom power in games")}>
        <Switch label={t("Custom power in games")} checked={g.autoPower} onChange={(autoPower) => setG({ autoPower })} />
      </Row>
      {g.mode === "games" && <GamingApps />}
    </Group>
  );
}

/** Rendering mode and FPS access: all performance switches in one place. */
function Performance() {
  const a = settings.use().appearance;
  const [restarting, setRestarting] = useState(false);
  const [hoverMotion, setHoverMotion] = useState(false);
  const restartWith = async (run: () => Promise<void>, revert: () => void) => {
    if (restarting) return;
    if (!isNative) return;
    setRestarting(true);
    try {
      await run();
      await relaunch();
    } catch {
      revert();
      setRestarting(false);
    }
  };
  const setRenderMode = (gpu: boolean) => {
    updateSettings({ appearance: { ...a, gpuAcceleration: gpu } });
    void restartWith(
      () => invoke("set_webview_render_mode", { mode: gpu ? "gpu" : "cpu" }),
      () => updateSettings({ appearance: { ...a, gpuAcceleration: !gpu } }),
    );
  };
  const setGpuPreference = (gpuPreference: Settings["appearance"]["gpuPreference"]) => {
    updateSettings({ appearance: { ...a, gpuPreference } });
    void restartWith(
      () => invoke("set_gpu_preference", { mode: gpuPreference }),
      () => updateSettings({ appearance: { ...a, gpuPreference: a.gpuPreference } }),
    );
  };
  return (
    <>
      <Group title={t("Motion")} id="settings-motion">
        <div className="px-3 pt-2 pb-3">
          <div
            className="flex h-16 items-center justify-center rounded-[10px] bg-fill-2"
            onPointerEnter={() => setHoverMotion(true)}
            onPointerLeave={() => setHoverMotion(false)}
          >
            <motion.div
              className="rounded-full bg-notch"
              initial={false}
              animate={
                !hoverMotion || a.motion === 0
                  ? { width: 92, height: 14 }
                  : { width: [92, 150, 92], height: [14, 30, 14] }
              }
              transition={
                !hoverMotion || a.motion === 0
                  ? { duration: 0 }
                  : { duration: 2.4 - (a.motion / 100) * 1.2, repeat: Infinity, repeatType: "reverse", ease: [0.23, 1, 0.32, 1] }
              }
              style={{ borderRadius: 999 }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-caption font-medium text-label-2">
            <span>{t("Motion intensity")}</span>
            <span className="tabular text-label-3">{a.motion}%</span>
          </div>
          <Slider
            label={t("Motion intensity")}
            value={a.motion}
            min={0}
            max={100}
            step={5}
            onChange={(motion) => updateSettings({ appearance: { ...a, motion } })}
          />
          <div className="mt-1 flex justify-between text-[10px] font-medium text-label-4">
            <span>{t("Off")}</span>
            <span>{t("Reduced")}</span>
            <span>{t("Full")}</span>
          </div>
        </div>
      </Group>
      <Group title={t("Performance")} id="settings-performance">
        <Row label={restarting ? t("Restarting WinZal...") : t("GPU acceleration")}>
          <Switch label={t("GPU acceleration")} checked={a.gpuAcceleration} onChange={setRenderMode} />
        </Row>
        {a.gpuAcceleration && (
          <Row label={t("Graphics card")}>
            <Segmented
              id="performance-gpu-preference"
              size="sm"
              value={a.gpuPreference}
              onChange={(gpuPreference) => setGpuPreference(gpuPreference as Settings["appearance"]["gpuPreference"])}
              options={[
                { value: "auto", label: t("Auto") },
                { value: "igpu", label: "iGPU" },
                { value: "dgpu", label: "dGPU" },
              ]}
            />
          </Row>
        )}
        <FpsUnlockRow />
      </Group>
    </>
  );
}

/** Genshin is always included; the input adds a custom .exe. */
function GamingApps() {
  const gaming = settings.use().gaming;
  const [manual, setManual] = useState("");
  const genshin = ["genshinimpact.exe", "yuanshen.exe"];
  const custom = gaming.apps.filter((id) => !genshin.includes(id.toLowerCase()));
  const addManual = () => {
    const name = manual.trim().replace(/^.*[\\/]/, "").toLowerCase();
    if (!name) return;
    const id = name.endsWith(".exe") ? name : `${name}.exe`;
    if (!genshin.includes(id) && !gaming.apps.some((item) => item.toLowerCase() === id)) {
      updateSettings((cur) => ({ gaming: { ...cur.gaming, apps: [...cur.gaming.apps, id] } }));
    }
    setManual("");
  };
  const remove = (id: string) => updateSettings((cur) => ({ gaming: { ...cur.gaming, apps: cur.gaming.apps.filter((item) => item !== id) } }));

  return (
    <Group title={t("FPS-Spiel")} id="settings-gaming-apps">
      <Row label="Genshin Impact">
        <SelectedDot />
      </Row>
      {custom.map((id) => (
        <Row key={id} label={friendlyAppName(id)}>
          <button
            type="button"
            aria-label={t("Entfernen")}
            onClick={() => remove(id)}
            className="pressable flex size-6 items-center justify-center rounded-full bg-fill-2 text-label-3 hover:text-label"
          >
            <X size={12} weight="bold" />
          </button>
        </Row>
      ))}
      <Row label={t("Eigene .exe")}>
        <div className="flex items-center gap-1.5">
          <TextField value={manual} onChange={setManual} onSubmit={addManual} placeholder="game.exe" width="w-32" />
          <Button onClick={addManual}>{t("Hinzufügen")}</Button>
        </div>
      </Row>
    </Group>
  );
}

function friendlyAppName(id: string): string {
  return id
    .replace(/\.exe$/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Presentation mode: one switch, plus automatic while the screen is recorded or shared. */
function Presentation() {
  const { auto } = settings.use().presentation;
  const presenting = usePresenting();
  const recording = privacy.use().screen;
  return (
    <Group title={t("Präsentationsmodus")} id="settings-presentation">
      <Row
        label={t("Präsentationsmodus")}
      >
        <Switch label={t("Präsentationsmodus")} checked={presenting} onChange={togglePresentation} />
      </Row>
      <Row label={t("Bei Bildschirmaufnahme")}>
        <Switch
          label={t("Bei Bildschirmaufnahme")}
          checked={auto}
          onChange={(on) => updateSettings((cur) => ({ presentation: { ...cur.presentation, auto: on } }))}
        />
      </Row>
      {auto && recording && !presenting && (
        <Row label={t("Für diese Aufnahme aus")} />
      )}
    </Group>
  );
}

const discordStatus: Record<string, string> = {
  off: "Aus – Tool „Discord“ einschalten",
  "no-config": "Client-ID und Secret fehlen",
  "no-client": "Discord läuft nicht",
  connecting: "Verbinde …",
  authorizing: "In Discord bestätigen",
  ready: "Verbunden",
  error: "Fehler",
};

/** Discord call: your own app in the developer portal (the only way Discord grants voice scopes). */
function Discord() {
  const s = settings.use();
  const state = discordState.use();
  const [id, setId] = useState(s.discord.clientId);
  const [name, setName] = useState(s.discord.appName);
  const save = () => updateSettings((cur) => ({ discord: { ...cur.discord, clientId: id.trim() } }));
  const saveName = () => updateSettings((cur) => ({ discord: { ...cur.discord, appName: name.trim() } }));
  return (
    <>
      <Group title={t("Rich Presence")} id="settings-discord">
        <Row label={t("Rich Presence")}>
          <Switch
            label={t("Rich Presence")}
            checked={s.discord.presence}
            onChange={(presence) => updateSettings((cur) => ({ discord: { ...cur.discord, presence } }))}
          />
        </Row>
        {s.discord.presence && (
          <>
            <Row label={t("Wird angezeigt nach „Listening to“")}>
              <Segmented<"title" | "artist" | "app">
                id="discord-status"
                size="sm"
                value={s.discord.statusLine}
                onChange={(statusLine) => updateSettings((cur) => ({ discord: { ...cur.discord, statusLine } }))}
                options={[
                  { value: "title", label: t("Titel") },
                  { value: "artist", label: t("Künstler") },
                  { value: "app", label: t("App-Name") },
                ]}
              />
            </Row>
            <Row label={t("App-Name")}>
              <div className="flex items-center gap-1.5">
                <TextField value={name} onChange={setName} onSubmit={saveName} placeholder="WinZal" width="w-40" />
                {name.trim() !== s.discord.appName && <Button onClick={saveName}>{t("Sichern")}</Button>}
              </div>
            </Row>
          </>
        )}
      </Group>
      <Group title={t("Verbindung")} id="settings-discord-connection">
        <Row label={t("Status")} hint={state.error ? tBackend(state.error) : undefined}>
          <span className={`text-caption ${state.status === "ready" ? "text-green" : "text-label-2"}`}>
            {t(discordStatus[state.status] ?? state.status)}
          </span>
        </Row>
        <Row label={t("Client-ID")}>
          <div className="flex items-center gap-1.5">
            <TextField value={id} onChange={setId} onSubmit={save} placeholder="123456789012345678" width="w-40" />
            {id.trim() !== s.discord.clientId && <Button onClick={save}>{t("Sichern")}</Button>}
          </div>
        </Row>
        <SecretRow name="discord.secret" label={t("Client-Secret")} onSaved={reconnectDiscord} />
      </Group>
    </>
  );
}

const durations: { value: string; label: string }[] = [
  { value: "0", label: "1×" },
  { value: "5", label: "5 s" },
  { value: "15", label: "15 s" },
  { value: "30", label: "30 s" },
  { value: "-1", label: "Bis Stopp" },
];

/** Timer alarm: sound, volume, duration, with preview. */
function Alarm() {
  const a = settings.use().alarm;
  const [previewing, setPreviewing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const set = (patch: Partial<typeof a>) => updateSettings((cur) => ({ alarm: { ...cur.alarm, ...patch } }));

  const preview = (next = a) => {
    window.clearTimeout(timer.current);
    playAlarm(next.sound, next.volume, 0);
    setPreviewing(true);
    timer.current = window.setTimeout(() => setPreviewing(false), 2500);
  };
  useEffect(() => () => stopAlarm(), []);

  return (
    <Group id="settings-alarm">
      <Row label={t("Alarm-Ton")}>
        <div className="flex items-center gap-1.5">
          <button
            aria-label={previewing ? t("Stopp") : t("Probehören")}
            title={previewing ? t("Stopp") : t("Probehören")}
            onClick={() => {
              if (!previewing) return preview();
              stopAlarm();
              setPreviewing(false);
            }}
            className="pressable pressable-fill flex size-7 items-center justify-center rounded-full bg-fill-2 text-label"
          >
            {previewing ? <Stop size={11} weight="fill" /> : <Play size={11} weight="fill" />}
          </button>
          <Select
            width="w-36"
            value={a.sound}
            onChange={(sound) => {
              set({ sound });
              preview({ ...a, sound });
            }}
            options={alarmSounds.map((o) => ({ ...o, label: t(o.label) }))}
          />
        </div>
      </Row>
      <Row label={t("Lautstärke")}>
        <div className="flex w-52 items-center gap-2">
          <Slider label={t("Lautstärke")} value={Math.round(a.volume * 100)} min={5} max={100} step={5} onChange={(v) => set({ volume: v / 100 })} />
          <span className="tabular w-8 text-right text-caption text-label-2">{Math.round(a.volume * 100)}</span>
        </div>
      </Row>
      <Row label={t("Dauer")}>
        <Segmented id="alarm-duration" size="sm" value={String(a.duration)} onChange={(v) => set({ duration: Number(v) as AlarmDuration })} options={durations.map((o) => ({ ...o, label: t(o.label) }))} />
      </Row>
    </Group>
  );
}

/** AI usage: one custom endpoint, configured here. */
function UsageSettings() {
  const usage = settings.use().usage;
  const cfg = usage.config;
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const setCfg = (patch: Partial<Settings["usage"]["config"]>) =>
    updateSettings((cur) => ({ usage: { ...cur.usage, config: { ...cur.usage.config, ...patch } } }));

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const [provider] = await fetchUsage(["custom"], cfg);
      const window = provider?.windows[0];
      const error = provider?.error;
      setTest(
        window
          ? { ok: true, text: `${Math.round(window.usedPercent)} %` }
          : { ok: false, text: error ? t(usageError[error] ?? error) : t("No data") },
      );
    } catch (e) {
      setTest({ ok: false, text: tBackend(String(e)) });
    } finally {
      setTesting(false);
    }
  };

  const windowOptions = [
    { value: "session", label: t("Session") },
    { value: "daily", label: t("Today") },
    { value: "weekly", label: t("Week") },
    { value: "monthly", label: t("Month") },
  ];

  return (
    <Group title={t("AI-Nutzung")} id="settings-usage">
      <Row label={t("Show AI usage")}>
        <Switch
          label={t("Show AI usage")}
          checked={usage.custom}
          onChange={(custom) => updateSettings((cur) => ({ usage: { ...cur.usage, custom } }))}
        />
      </Row>
      {usage.custom && (
        <>
          <Row label={t("Name")}>
            <TextField value={cfg.name} onChange={(name) => setCfg({ name })} placeholder="My AI" width="w-52" />
          </Row>
          <Row label={t("Endpoint")}>
            <TextField value={cfg.url} onChange={(url) => setCfg({ url })} placeholder="https://…" width="w-52" />
          </Row>
          <Row label={t("Auth header")}>
            <TextField value={cfg.header} onChange={(header) => setCfg({ header })} placeholder="Authorization" width="w-40" />
          </Row>
          <SecretRow name="usage.custom" label={t("Header value")} />
          <Row label={t("Value path")}>
            <TextField value={cfg.valuePath} onChange={(valuePath) => setCfg({ valuePath })} placeholder="data.used" width="w-52" />
          </Row>
          <Row label={t("Limit path")}>
            <TextField value={cfg.limitPath} onChange={(limitPath) => setCfg({ limitPath })} placeholder="data.limit" width="w-52" />
          </Row>
          <Row label={t("Reset path")}>
            <TextField value={cfg.resetPath} onChange={(resetPath) => setCfg({ resetPath })} placeholder="data.reset" width="w-52" />
          </Row>
          <Row label={t("Window")}>
            <Select
              width="w-40"
              value={cfg.window}
              options={windowOptions}
              onChange={(window) => setCfg({ window: window as Settings["usage"]["config"]["window"] })}
            />
          </Row>
          <Row label={t("Plan")}>
            <TextField value={cfg.plan} onChange={(plan) => setCfg({ plan })} placeholder="Pro" width="w-32" />
          </Row>
          <Row label={t("Test")}>
            <div className="flex items-center gap-2">
              {test && <span className={`text-caption ${test.ok ? "text-green" : "text-red"}`}>{test.text}</span>}
              <Button onClick={() => void runTest()} disabled={testing}>
                {testing ? t("Testing…") : t("Test")}
              </Button>
            </div>
          </Row>
        </>
      )}
    </Group>
  );
}

/** FPS without admin: a tiny elevated helper owns the ETW session. */
function FpsUnlockRow() {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "relogin" | "cancelled" | "failed">("idle");
  // Keep the row unlocked after closing Settings while the helper is still alive.
  useEffect(() => {
    let alive = true;
    void fpsHelperReady().then((ready) => {
      if (alive && ready) setState("ok");
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Row label={t("FPS & CPU-Temperatur")}>
      {state === "ok" || state === "relogin" ? (
        <SelectedDot size={8} />
      ) : (
        <Button
          disabled={state === "busy"}
          onClick={() => {
            setState("busy");
            void unlockFps().then((result) => {
              setState(result);
              if (result === "ok") void fetchFps().then((r) => fps.set({ value: r.fps, error: r.error }));
            });
          }}
        >
          {t("Freischalten")}
        </Button>
      )}
    </Row>
  );
}

/** Weather location: automatic via IP or fixed, right here without opening the weather tool. */
function Weather() {
  const { weather: w } = settings.use();
  const [searching, setSearching] = useState(false);
  return (
    <Group title={t("Wetter")} id="settings-weather">
      <Row label={t("Standort")}>
        <Segmented<"auto" | "manual">
          id="weather-mode"
          size="sm"
          value={!w || w.auto ? "auto" : "manual"}
          onChange={(m) => {
            if (m === "auto") {
              setSearching(false);
              void detectPlace(true);
            } else setSearching(true);
          }}
          options={[
            { value: "auto", label: t("Automatisch") },
            { value: "manual", label: t("Manuell") },
          ]}
        />
      </Row>
      <Row label={t("Ort")}>
        <Button onClick={() => setSearching((v) => !v)}>{w?.name ?? t("Wird erkannt …")}</Button>
      </Row>
      <AnimatePresence initial={false}>
        {searching && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <div className="p-2">
              <PlaceSearch compact canCancel onDone={() => setSearching(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Group>
  );
}

/** Show/hide tools and drag to reorder. At least one stays on. */
function Tools() {
  const s = settings.use();
  const enabledCount = s.tools.filter((x) => x.enabled).length;
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <Group>
      <Reorder.Group
        as="div"
        axis="y"
        values={s.tools.map((x) => x.id)}
        onReorder={(ids: string[]) => updateSettings((cur) => ({ tools: ids.map((id) => cur.tools.find((x) => x.id === id)!) }))}
        className="divide-y divide-separator"
      >
        {s.tools.map((tool) => {
          const tab = tabs.find((x) => x.id === tool.id);
          if (!tab) return null;
          return (
            <Reorder.Item
              key={tool.id}
              value={tool.id}
              as="div"
              transition={springs.snappy}
              onDragStart={() => setDragging(tool.id)}
              onDragEnd={() => setDragging(null)}
              whileDrag={{ scale: 1.02 }}
              className={`group relative flex h-9 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing ${
                dragging === tool.id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)]" : ""
              }`}
            >
              <DotsSixVertical size={13} weight="bold" className="-ml-1 text-label-4 transition-colors group-hover:text-label-3" />
              <tab.icon size={15} weight="bold" className={tool.enabled ? "text-label-2" : "text-label-4"} />
              <span className={`flex-1 text-body select-none ${tool.enabled ? "text-label" : "text-label-3"}`}>{t(tab.label)}</span>
              <div onPointerDown={(e) => e.stopPropagation()}>
                <Switch
                  label={t(tab.label)}
                  checked={tool.enabled}
                  onChange={(enabled) => {
                    if (!enabled && enabledCount <= 1) return;
                    updateSettings((cur) => ({ tools: cur.tools.map((x) => (x.id === tool.id ? { ...x, enabled } : x)) }));
                  }}
                />
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </Group>
  );
}

/**
 * Field for a key. Stored values are never read back, it only shows
 * "saved ✓". Typing a new one overwrites it, saving empty deletes it.
 */
function SecretRow({ name, label, hint, onSaved }: { name: SecretName; label: string; hint?: string; onSaved?: () => void }) {
  const [stored, setStored] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue("");
    setError(null);
    void secrets.has(name).then(setStored);
  }, [name]);

  const save = async () => {
    setError(null);
    try {
      await secrets.set(name, value);
      setStored(!!value.trim());
      setValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
      onSaved?.();
    } catch (e) {
      setError(tBackend(String(e)));
    }
  };

  return (
    <Row label={label} hint={error ?? hint}>
      <div className="flex items-center gap-1.5">
        <AnimatePresence>
          {(saved || (stored && !value)) && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
              <SelectedDot size={7} />
            </motion.span>
          )}
        </AnimatePresence>
        <TextField
          secret
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(null);
          }}
          onSubmit={() => void save()}
          placeholder={stored ? t("Gespeichert") : t("Einfügen")}
          width="w-40"
        />
        {(value || stored) && (
          <Button onClick={() => void save()} disabled={!value && !stored}>
            {value ? t("Sichern") : t("Löschen")}
          </Button>
        )}
      </div>
    </Row>
  );
}
