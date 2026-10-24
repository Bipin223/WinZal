import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Chats, Copy, Check, FileText, ImageSquare, NotePencil, Plus, Stop, Translate, TextAlignLeft, Trash, X, type Icon } from "@phosphor-icons/react";
import { content, fade } from "../../design/motion";
import { createStore } from "../../lib/store";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { clipboard } from "../../platform/clipboard";
import { settings } from "../../settings/store";
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
  const provider = ask.provider;
  const config = ask.configs[provider];
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const attachment = askAttachment.use();
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const wasStreaming = useRef(false);

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
        await migrateLegacyChat();
        const list = await askHistory.list();
        history.set(list);
        if (list.length > 0 && chat.get().length === 0 && active.get().id === null) {
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
    <div className="relative flex h-full flex-col px-4 pt-1 pb-2">
      <HeaderActions>
        <button
          onClick={() => navigate("settings", "ask")}
          title={t("Modell in den Einstellungen ändern")}
          className="mr-1 max-w-40 truncate text-caption text-label-3 hover:text-label-2"
        >
          {config.model || providerInfo[provider].label}
        </button>
        <HeaderButton label={t("Chat-Verlauf")} active={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
          <Chats size={14} weight="bold" />
        </HeaderButton>
        <HeaderButton label={t("Neuer Chat")} disabled={messages.length === 0} onClick={startNew}>
          <Plus size={14} weight="bold" />
        </HeaderButton>
      </HeaderActions>

      {historyOpen && (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setHistoryOpen(false)} />
          <div className="absolute right-3 top-8 z-30 w-[270px] overflow-hidden rounded-[12px] bg-elevated p-1.5 shadow-2xl">
            <div className="px-2 py-1 text-[10px] font-semibold tracking-wide text-label-3 uppercase">{t("Gespeicherte Chats")}</div>
            <div className="max-h-[220px] overflow-y-auto [scrollbar-width:none]">
              {saved.length === 0 ? (
                <div className="px-2 py-2 text-caption text-label-4">{t("Noch keine gespeicherten Chats")}</div>
              ) : (
                saved.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-0.5 rounded-[8px] pr-1 hover:bg-fill-2 ${current.id === item.id ? "bg-fill-2" : ""}`}
                  >
                    <button type="button" onClick={() => void openSaved(item)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                      <div className="truncate text-[11px] font-medium text-label">{item.title}</div>
                      <div className="mt-0.5 text-[9px] leading-[11px] text-label-4">
                        {when(item.updatedAt)} · {item.messages} {item.messages === 1 ? t("Nachricht") : t("Nachrichten")}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={t("Löschen")}
                      onClick={() => void removeSaved(item)}
                      className="pressable flex size-6 shrink-0 items-center justify-center rounded-[6px] text-label-4 hover:text-red"
                    >
                      <Trash size={11} weight="bold" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

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
            {copied ? <Check size={11} weight="bold" /> : <Copy size={11} weight="bold" />} {copied ? t("Kopiert") : t("Kopieren")}
          </button>
        )}
      </div>
    </motion.div>
  );
}
