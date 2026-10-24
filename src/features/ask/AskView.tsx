import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Chats, Copy, FileText, ImageSquare, NotePencil, Plus, Stop, Translate, TextAlignLeft, Trash, X, type Icon } from "@phosphor-icons/react";
import { content, fade } from "../../design/motion";
import { createStore } from "../../lib/store";
import { navigate } from "../../notch/nav";
import { clipboard } from "../../platform/clipboard";
import { settings, updateSettings } from "../../settings/store";
import { Switch } from "../../ui/controls";
import { ChatBubbleIcon } from "../../ui/ChatBubbleIcon";
import { CopyCheck } from "../../ui/CardActions";
import { providerInfo, streamChat, type ChatMessage } from "./providers";
import { askAttachment, clearAskAttachment } from "./handoff";
import { askHistory, type AskSummary } from "./history";
import { t, tBackend } from "../../i18n";

/**
 * The active conversation lives in memory. Older conversations stay as small
 * JSON files in app data and are loaded only when the user opens them, so the
 * history costs a few KB of RAM and nothing per token while streaming.
 */
const chat = createStore<ChatMessage[]>([]);
const active = createStore<{ id: string | null; title: string; updatedAt: number }>({ id: null, title: "", updatedAt: 0 });
const history = createStore<AskSummary[]>([]);
let historyHydrated = false;
let saveQueue: Promise<void> = Promise.resolve();

function titleFor(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return t("Neuer Chat");
  const line = first.content
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part && !/^(Context|Datei|What is this\?):/i.test(part));
  const text = (line ?? first.content).replace(/\s+/g, " ").trim();
  return text.slice(0, 60) || t("Neuer Chat");
}

/** Older builds kept the chat in localStorage; move it to the new history. */
async function migrateLegacyChat() {
  if (!settings.get().ask.saveHistory) return;
  const raw = localStorage.getItem("notch:ask-chat");
  if (!raw) return;
  try {
    const old = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(old)) return;
    const clean = old.filter(
      (message) => message && typeof message.content === "string" && (message.content.trim() || (message.images?.length ?? 0) > 0),
    );
    if (clean.length === 0) {
      localStorage.removeItem("notch:ask-chat");
      return;
    }
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = titleFor(clean);
    const updatedAt = Date.now();
    const list = await askHistory.save({ id, title, updatedAt, messages: clean });
    history.set(list);
    localStorage.removeItem("notch:ask-chat");
  } catch {
    // If it cannot be read or saved, keep the old data instead of deleting it.
  }
}

/** Queue a save; only the active chat is serialized, and only after a turn. */
function persist(messages: ChatMessage[]) {
  // Saving off: keep the chat in memory only and never touch existing files.
  if (!settings.get().ask.saveHistory) return;
  const clean = messages.filter((message) => message.content.trim() || (message.images?.length ?? 0) > 0);
  if (clean.length === 0) return;
  const snapshot = clean.map((message) => ({ ...message }));
  // Capture id/title before queueing; startNew/load may change the active chat.
  const current = active.get();
  const id = current.id ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const title = current.title || titleFor(snapshot);
  const updatedAt = Date.now();
  active.set({ id, title, updatedAt });
  saveQueue = saveQueue
    .then(async () => {
      // The switch may have been turned off while an earlier save was queued.
      if (!settings.get().ask.saveHistory) return;
      const list = await askHistory.save({ id, title, updatedAt, messages: snapshot });
      history.set(list);
    })
    .catch(() => {});
}

function when(updatedAt: number): string {
  const date = new Date(updatedAt);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Clipboard images can be 4K screenshots. Keep text crisp but cap the longest
 * side so the pending attachment and the saved chat stay light on memory.
 */
async function imageFromClipboard(file: File): Promise<string> {
  if (typeof createImageBitmap !== "function") return readFile(file);
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 2.5 * 1024 * 1024) return await readFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return readFile(file);
    const png = file.type === "image/png";
    if (!png) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.88);
  } finally {
    bitmap.close();
  }
}


const quick: { icon: Icon; label: string; prompt: (text: string) => string }[] = [
  { icon: TextAlignLeft, label: "Zusammenfassen", prompt: (text) => t("Fasse kurz zusammen: {x}", { x: text }) },
  { icon: NotePencil, label: "Umformulieren", prompt: (text) => t("Formuliere klarer um: {x}", { x: text }) },
  { icon: Translate, label: "Ins Englische", prompt: (text) => t("Übersetze ins Englische: {x}", { x: text }) },
];

/*
 *   Ask                                    grok-4.7  [Ã—] [ðŸ“Œ]
 *   ┌───────────────────────────────────────────────â”
 *   │                         What time is it in NY? │
 *   │ The answer …â–                                 │
 *   └───────────────────────────────────────────────┘
 *   [ Ask anything …                           (â†‘) ]
 *
 * Provider, model and effort are only set in the settings.
 */
export function AskView() {
  const messages = chat.use();
  const current = active.use();
  const saved = history.use();
  const ask = settings.use().ask;
  const saveHistory = ask.saveHistory;
  const provider = ask.provider;
  const config = ask.configs[provider];
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const attachment = askAttachment.use();
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const wasStreaming = useRef(false);
  const firstSaveEffect = useRef(true);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    if (attachment) input.current?.focus({ preventScroll: true });
  }, [attachment]);

  // Load the newest conversation on the first Ask open, and keep the index fresh.
  useEffect(() => {
    if (historyHydrated) {
      void askHistory.list().then(history.set).catch(() => {});
      return;
    }
    historyHydrated = true;
    void (async () => {
      try {
        // Only switch/migrate/auto-open when saving is on. Turning it off must
        // leave old chats untouched and must not reopen one behind the user's back.
        if (settings.get().ask.saveHistory) await migrateLegacyChat();
        const list = await askHistory.list();
        history.set(list);
        if (
          settings.get().ask.saveHistory &&
          list.length > 0 &&
          chat.get().length === 0 &&
          active.get().id === null
        ) {
          const conversation = await askHistory.load(list[0].id);
          if (conversation && chat.get().length === 0) {
            chat.set(conversation.messages);
            active.set({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt });
          }
        }
      } catch {
        // History is optional; the chat itself still works.
      }
    })();
  }, []);

  // Turning saving back on makes an old in-memory chat (if any) migratable,
  // without overwriting the conversation that is open right now.
  useEffect(() => {
    if (firstSaveEffect.current) {
      firstSaveEffect.current = false;
      return;
    }
    if (!saveHistory) return;
    if (chat.get().length > 0 || active.get().id !== null) return;
    void (async () => {
      await migrateLegacyChat();
      const list = await askHistory.list();
      history.set(list);
    })().catch(() => {});
  }, [saveHistory]);

  // A turn is saved when streaming ends (completed, stopped or failed).
  useEffect(() => {
    if (wasStreaming.current && !streaming) void persist(chat.get());
    wasStreaming.current = streaming;
  }, [streaming]);

  // Follow along at the bottom while streaming.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages]);

  const startNew = () => {
    void persist(chat.get());
    abort.current?.abort();
    chat.set([]);
    active.set({ id: null, title: "", updatedAt: 0 });
    clearAskAttachment();
    setError(null);
    setHistoryOpen(false);
    input.current?.focus({ preventScroll: true });
  };

  const openSaved = async (item: AskSummary) => {
    if (streaming) return;
    void persist(chat.get());
    try {
      const conversation = await askHistory.load(item.id);
      if (!conversation) return;
      chat.set(conversation.messages);
      active.set({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt });
      setHistoryOpen(false);
      setError(null);
      input.current?.focus({ preventScroll: true });
    } catch {
      // Keep the current chat if the file is unreadable.
    }
  };

  const removeSaved = async (item: AskSummary) => {
    await saveQueue.catch(() => {});
    try {
      const list = await askHistory.remove(item.id);
      history.set(list);
      if (active.get().id === item.id) {
        abort.current?.abort();
        chat.set([]);
        active.set({ id: null, title: "", updatedAt: 0 });
      }
    } catch {
      // Ignore a failed delete; the item stays in the list.
    }
  };

  const clearSaved = async () => {
    await saveQueue.catch(() => {});
    try {
      const list = await askHistory.clear();
      history.set(list);
      setConfirmClear(false);
      setHistoryOpen(false);
      // The open chat was one of the deleted files: start a clean memory-only
      // conversation. An unsaved draft stays untouched.
      if (active.get().id !== null) {
        abort.current?.abort();
        chat.set([]);
        active.set({ id: null, title: "", updatedAt: 0 });
      }
    } catch {
      // Keep the menu open and the files in place if the delete failed.
    }
  };

  const setSaving = (on: boolean) => {
    updateSettings((s) => ({ ask: { ...s.ask, saveHistory: on } }));
    if (!on) setConfirmClear(false);
  };

  const attachPastedImage = async (file: File) => {
    if (streaming) return;
    try {
      const image = await imageFromClipboard(file);
      if (!image) return;
      askAttachment.set({
        id: crypto.randomUUID?.() ?? `paste-${Date.now()}`,
        kind: "image",
        title: t("Eingefügtes Bild"),
        detail: t("Aus der Zwischenablage"),
        image,
      });
      setError(null);
      input.current?.focus({ preventScroll: true });
    } catch {
      setError(t("Bild konnte nicht gelesen werden"));
    }
  };

  /** Ctrl+V anywhere in the open Ask view turns an image on the clipboard into an attachment. */
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const data = event.clipboardData;
    if (!data) return;
    const fromItems = Array.from(data.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    )?.getAsFile();
    const file = fromItems ?? Array.from(data.files).find((candidate) => candidate.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    void attachPastedImage(file);
  };

  const send = async (text: string) => {
    const prompt = text.trim();
    const attached = askAttachment.get();
    if ((!prompt && !attached) || streaming) return;
    setDraft("");
    setError(null);

    let contentText = prompt;
    let images: string[] | undefined;
    if (attached) {
      if (attached.image) {
        images = [attached.image];
        contentText = prompt || t("What is this?");
      } else if (attached.text) {
        contentText = `${t("Context")}: ${attached.title}\n${attached.text}${prompt ? `\n\n${prompt}` : ""}`;
      } else {
        contentText = `${t("Datei")}: ${attached.title}${attached.path ? `\n${attached.path}` : ""}${prompt ? `\n\n${prompt}` : ""}`;
      }
    }

    clearAskAttachment();
    const user: ChatMessage = { role: "user", content: contentText, ...(images ? { images } : {}) };
    const conversation: ChatMessage[] = [...chat.get(), user];
    chat.set([...conversation, { role: "assistant", content: "" }]);
    void persist(conversation);
    setStreaming(true);
    abort.current = new AbortController();
    try {
      await streamChat(provider, config, conversation, (delta) => {
        chat.set((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        });
      }, abort.current.signal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "no-key" ? t("Kein API-Schlüssel für {p} – in den Einstellungen eintragen.", { p: providerInfo[provider].label }) : tBackend(msg));
      // Remove the empty reply bubble again.
      chat.set((m) => (m.at(-1)?.content === "" ? m.slice(0, -1) : m));
    } finally {
      setStreaming(false);
    }
  };

  const runQuick = (q: (typeof quick)[number]) => {
    const latest = clipboard.get().find((c) => c.kind === "text" || c.kind === "link");
    if (!latest) {
      setError(t("Zuerst einen Text kopieren – die Schnellaktionen arbeiten mit der Zwischenablage."));
      return;
    }
    void send(q.prompt(latest.text));
  };

  return (
    <div className="relative flex h-full flex-col px-4 pt-1 pb-2" onPaste={handlePaste}>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <span className="text-body text-label-2">{t("Frag etwas oder nutze die Zwischenablage")}</span>
            <div className="flex gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.label}
                  onClick={() => runQuick(q)}
                  className="pressable pressable-fill flex h-7 items-center gap-1.5 rounded-full bg-fill-1 px-3 text-footnote text-label-2"
                >
                  <q.icon size={13} weight="bold" /> {t(q.label)}
                </button>
              ))}
            </div>
            <span className="text-[10px] leading-[12px] text-label-3">{t("Bild mit Strg+V einfügen")}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-1">
            {messages.map((m, i) => (
              <Bubble key={i} message={m} streaming={streaming && i === messages.length - 1} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            className="mb-1 text-caption text-orange"
            initial={{ opacity: 0, transform: "translateY(2px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            {error}{" "}
            <button onClick={() => navigate("settings", "ask")} className="underline underline-offset-2 hover:text-label">
              {t("Einstellungen")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {attachment && (
          <motion.div
            layout
            initial={{ opacity: 0, transform: "translateY(6px) scale(0.98)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: content.enter }}
            exit={{ opacity: 0, transform: "translateY(4px) scale(0.98)", transition: fade }}
            className="mb-1 flex items-center gap-2 rounded-[12px] bg-fill-1 p-1.5"
          >
            {attachment.image ? (
              <img src={attachment.image} alt="" className="size-9 shrink-0 rounded-[7px] object-cover" />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label-2">
                {attachment.kind === "text" ? <FileText size={16} weight="bold" /> : <ImageSquare size={16} weight="bold" />}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-caption font-semibold text-label">{attachment.title}</div>
              <div className="truncate text-[9px] leading-[11px] text-label-3">{attachment.detail}</div>
            </div>
            <button
              type="button"
              aria-label={t("Entfernen")}
              onClick={clearAskAttachment}
              className="pressable flex size-5 shrink-0 items-center justify-center rounded-full text-label-4 hover:text-label"
            >
              <X size={10} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {historyOpen && (
        <div
          className="absolute inset-0 z-20"
          onClick={() => {
            setHistoryOpen(false);
            setConfirmClear(false);
          }}
        />
      )}

      <div className="relative z-30 mt-1 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate("settings", "ask")}
          title={t("Modell in den Einstellungen ändern")}
          className="min-w-0 truncate px-1 text-caption text-label-2 hover:text-label"
        >
          {config.model || providerInfo[provider].label}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-fill-1 p-0.5">
          <AskAction label={t("AI-Einstellungen")} onClick={() => navigate("settings", "ask")}>
            <ChatBubbleIcon size={18} weight="bold" />
          </AskAction>
          <AskAction
            label={saveHistory ? t("Chat-Verlauf") : t("Chat-Verlauf - Speichern aus")}
            active={historyOpen}
            onClick={() => {
              setConfirmClear(false);
              setHistoryOpen((open) => !open);
            }}
          >
            <Chats size={18} weight="bold" />
          </AskAction>
          <AskAction label={t("Neuer Chat")} disabled={messages.length === 0} onClick={startNew}>
            <Plus size={18} weight="bold" />
          </AskAction>
        </div>

        {historyOpen && (
          <div className="absolute right-0 bottom-full z-40 mb-1 w-[280px] overflow-hidden rounded-[12px] bg-elevated p-1.5 shadow-2xl ring-1 ring-separator">
            <div className="flex items-center justify-between px-2 py-1">
              <div className="text-[10px] font-semibold tracking-wide text-label-2 uppercase">{t("Gespeicherte Chats")}</div>
              {saved.length > 0 && (
                <button
                  type="button"
                  aria-label={t("Alle löschen")}
                  title={t("Alle löschen")}
                  onClick={() => setConfirmClear(true)}
                  className="pressable flex size-5 items-center justify-center rounded-[6px] text-label-3 hover:text-red"
                >
                  <Trash size={11} weight="bold" />
                </button>
              )}
            </div>
            <div className="max-h-[200px] overflow-y-auto [scrollbar-width:none]">
              {saved.length === 0 ? (
                <div className="px-2 py-2 text-caption text-label-3">{t("Noch keine gespeicherten Chats")}</div>
              ) : (
                saved.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-0.5 rounded-[8px] pr-1 hover:bg-fill-2 ${current.id === item.id ? "bg-fill-2" : ""}`}
                  >
                    <button type="button" onClick={() => void openSaved(item)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                      <div className="truncate text-[11px] font-medium text-label">{item.title}</div>
                      <div className="mt-0.5 text-[9px] leading-[11px] text-label-3">
                        {when(item.updatedAt)} · {item.messages} {item.messages === 1 ? t("Nachricht") : t("Nachrichten")}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={t("Löschen")}
                      onClick={() => void removeSaved(item)}
                      className="pressable flex size-6 shrink-0 items-center justify-center rounded-[6px] text-label-3 hover:text-red"
                    >
                      <Trash size={11} weight="bold" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {confirmClear && saved.length > 0 && (
              <div className="mx-1 mt-1 rounded-[8px] bg-fill-1 p-2">
                <div className="text-[10px] leading-[13px] font-medium text-label">{t("Alle gespeicherten Chats löschen?")}</div>
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="pressable h-6 rounded-full bg-fill-2 px-2.5 text-[10px] font-medium text-label-2 hover:text-label"
                  >
                    {t("Abbrechen")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearSaved()}
                    className="pressable h-6 rounded-full bg-red px-2.5 text-[10px] font-semibold text-white"
                  >
                    {t("Löschen")}
                  </button>
                </div>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-separator px-2 pt-2 pb-1">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-label">{t("Chats speichern")}</div>
                <div className="mt-0.5 text-[9px] leading-[11px] text-label-3">
                  {saveHistory ? t("Bis zu 3 Chats lokal auf diesem PC") : t("Aus - dieser Chat bleibt nur im Speicher")}
                </div>
              </div>
              <Switch label={t("Chats speichern")} checked={saveHistory} onChange={setSaving} />
            </div>
          </div>
        )}
      </div>

      <form
        className="mt-1 flex items-end gap-2 rounded-[16px] bg-fill-1 py-1.5 pr-1.5 pl-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={input}
          value={draft}
          rows={1}
          placeholder={t("Frag etwas …")}
          onChange={(e) => {
            setDraft(e.target.value);
            // Grows up to 3 lines.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 54)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          className="max-h-[54px] min-h-[18px] flex-1 resize-none bg-transparent py-0.5 text-body text-label outline-none [scrollbar-width:none] placeholder:text-label-4"
        />
        {streaming ? (
          <button type="button" aria-label={t("Stopp")} onClick={() => abort.current?.abort()} className="pressable flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-3 text-label">
            <Stop size={11} weight="fill" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label={t("Senden")}
            disabled={!draft.trim() && !attachment}
            className="pressable flex size-6 shrink-0 items-center justify-center rounded-full bg-label text-on-label transition-opacity duration-150 disabled:opacity-25"
          >
            <ArrowUp size={13} weight="bold" />
          </button>
        )}
      </form>

    </div>
  );
}

/** Larger Ask actions at the lower right: AI settings, chat history and new chat. */
function AskAction(props: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`pressable flex size-9 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
        props.active ? "bg-fill-3 text-label" : "text-label-2 hover:bg-fill-2 hover:text-label"
      }`}
    >
      {props.children}
    </button>
  );
}

function Bubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const user = message.role === "user";
  return (
    <motion.div
      className={`group flex ${user ? "justify-end" : "justify-start"}`}
      initial={{ opacity: 0, transform: "translateY(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={content.enter}
    >
      <div
        className={`relative max-w-[85%] text-body whitespace-pre-wrap ${
          user ? "rounded-[14px] rounded-br-[4px] bg-fill-2 px-3 py-1.5 text-label" : "px-1 text-label-2"
        }`}
      >
        {message.images?.map((src, i) => (
          <img key={i} src={src} alt="" className="mb-1 max-h-40 max-w-full rounded-[8px] object-contain" />
        ))}
        {message.content}
        {streaming && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-label-2" />}
        {!user && !streaming && message.content && (
          <button
            aria-label={t("Kopieren")}
            onClick={() => {
              void navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="pressable mt-1 flex items-center gap-1 text-caption text-label-4 opacity-0 group-hover:opacity-100 hover:text-label-2"
          >
            {copied ? <CopyCheck size={11} /> : <Copy size={11} weight="bold" />} {copied ? t("Kopiert") : t("Kopieren")}
          </button>
        )}
      </div>
    </motion.div>
  );
}
