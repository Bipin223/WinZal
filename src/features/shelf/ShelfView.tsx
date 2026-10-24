import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowsOutSimple, ClipboardText, Copy, File, FileAudio, FileText, FileVideo, FolderOpen, ImageSquare, Table, Trash, Tray, X, type Icon } from "@phosphor-icons/react";
import { fade, springs } from "../../design/motion";
import { createStore } from "../../lib/store";
import { formatBytes } from "../../lib/format";
import { drop, pasteFiles, takeDropped, usePasteFiles } from "../../platform/drop";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { MAX_SIZE, requestSize } from "../../notch/size";
import { findTab } from "../../notch/tabs";
import { copyFiles, filePreview, filePreviewLarge, fileText, openFile, probeFiles, revealFile, type DroppedFile, type FileKind } from "../../platform/services";
import { askAI } from "../ask/handoff";
import { AskAIPill, CardButton, CopyCheck } from "../../ui/CardActions";
import { ImagePreviewPane, type LoadedImagePreview } from "../../ui/ImagePreview";
import { t } from "../../i18n";

/*
 * Shelf: put files on the notch and later open them with one click,
 * show them in Explorer or paste them elsewhere with Ctrl+V.
 * Only references are stored; the files stay where they are.
 *
 * Files come in via drag and drop or Ctrl+V (screenshots too). Anything dropped on
 * the closed notch lands in the last used file tool.
 */
interface ShelfItem extends DroppedFile {
  addedAt: number;
}

const shelf = createStore<ShelfItem[]>([], { persist: "shelf" });
const MAX_ITEMS = 30;
const ROW_H = 146;
const PREVIEW_MAX_H = 250;
/** Gap + controls below the image. */
const PREVIEW_CHROME = 46;

const kindIcon: Record<FileKind, Icon> = { image: ImageSquare, audio: FileAudio, video: FileVideo, document: FileText, table: Table, other: File };

export function ShelfView() {
  const items = shelf.use();
  const { dragging, dropped } = drop.use();
  const [copied, setCopied] = useState<string | null>(null);
  const [nothing, setNothing] = useState(false);
  const [preview, setPreview] = useState<(LoadedImagePreview & { path: string }) | null>(null);
  usePasteFiles(() => flash(setNothing));

  useEffect(() => {
    const paths = takeDropped();
    if (!paths?.length) return;
    void probeFiles(paths).then(({ files }) => {
      const now = Date.now();
      shelf.set((list) => {
        const fresh = files.filter((f) => !list.some((x) => x.path === f.path)).map((f) => ({ ...f, addedAt: now }));
        return [...fresh, ...list].slice(0, MAX_ITEMS);
      });
    });
  }, [dropped]);

  const copyAll = async (paths: string[], key: string) => {
    await copyFiles(paths);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  // The preview grows the closed tab downward; leaving Shelf always resets it.
  useEffect(() => () => requestSize("shelf", null), []);

  const closePreview = () => {
    setPreview(null);
    requestSize("shelf", null);
  };

  const openPreview = async (item: ShelfItem) => {
    const data = await filePreviewLarge(item.path).catch(() => null);
    if (!data || !data.width || !data.height) return;
    const base = findTab("shelf")!.size;
    const h = Math.min(PREVIEW_MAX_H, MAX_SIZE.h - base.h - PREVIEW_CHROME, ((base.w - 32) * data.height) / data.width);
    setPreview({ ...data, path: item.path, w: (h * data.width) / data.height, h });
    requestSize("shelf", { w: base.w, h: base.h + h + PREVIEW_CHROME });
  };

  if (items.length === 0) {
    return (
      <div className="h-full px-4 pt-1 pb-2">
        <motion.div
          className={`flex h-full flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed transition-colors duration-200 ${
            dragging ? "border-label-2 bg-fill-2" : "border-fill-3 bg-fill-1"
          }`}
          animate={{ transform: dragging ? "scale(1.015)" : "scale(1)" }}
          transition={springs.snappy}
        >
          <Tray size={22} weight="bold" className={dragging ? "text-label" : "text-label-3"} />
          <span className="text-body text-label-2">{dragging ? t("Loslassen zum Ablegen") : t("Dateien hierher ziehen")}</span>
          <PasteHint nothing={nothing} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col px-4 pt-1 pb-2">
      <HeaderActions>
        <span className="tabular mr-1 text-caption text-label-3">
          {items.length} {items.length === 1 ? t("Datei") : t("Dateien")}
        </span>
        <HeaderButton label={copied === "all" ? t("Kopiert") : t("Alle kopieren")} onClick={() => void copyAll(items.map((i) => i.path), "all")}>
          {copied === "all" ? <CopyCheck size={14} /> : <Copy size={14} weight="bold" />}
        </HeaderButton>
        <HeaderButton
          label={t("Ablage leeren")}
          onClick={() => {
            closePreview();
            shelf.set([]);
          }}
        >
          <Trash size={14} weight="bold" />
        </HeaderButton>
      </HeaderActions>
      <div className="flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:none]" style={{ height: ROW_H }}>
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.path}
              layout
              transition={springs.snappy}
              initial={{ opacity: 0, transform: "scale(0.94)" }}
              animate={{ opacity: 1, transform: "scale(1)" }}
              exit={{ opacity: 0, transform: "scale(0.94)", transition: fade }}
              className="group relative h-full w-[160px] shrink-0"
            >
              <Card
                item={item}
                copied={copied === item.path}
                onCopy={() => void copyAll([item.path], item.path)}
                onPreview={() => void openPreview(item)}
                onRemove={() => {
                  if (preview?.path === item.path) closePreview();
                  shelf.set((l) => l.filter((x) => x.path !== item.path));
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {preview && (
          <ImagePreviewPane
            key="preview"
            preview={preview}
            onCopy={() => void copyAll([preview.path], "preview")}
            onClose={closePreview}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dragging && (
          <motion.div
            className="pointer-events-none absolute inset-x-4 top-1 bottom-3 flex items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-label-2 bg-label/85 text-body text-notch"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            {t("Loslassen zum Ablegen")}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Card({ item, copied, onCopy, onPreview, onRemove }: { item: ShelfItem; copied: boolean; onCopy: () => void; onPreview: () => void; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const I = kindIcon[item.kind];
  useEffect(() => {
    if (item.kind === "image") void filePreview(item.path).then(setPreview);
  }, [item.path, item.kind]);

  const ask = async () => {
    if (item.kind === "image") {
      const src = preview ?? (await filePreview(item.path));
      askAI({ id: `shelf-${item.path}`, kind: "image", title: item.name, detail: t("Shelf image"), image: src ?? undefined, path: item.path });
      return;
    }
    let text: string | undefined;
    if (item.kind === "document" || item.kind === "table") {
      try {
        text = await fileText(item.path);
      } catch {
        text = undefined;
      }
    }
    askAI({
      id: `shelf-${item.path}`,
      kind: text ? "text" : "file",
      title: item.name,
      detail: `${item.kind} · ${formatBytes(item.size, 0)}`,
      text,
      path: item.path,
    });
  };

  return (
    <div className="group relative flex size-full flex-col overflow-hidden rounded-[14px] bg-fill-1">
      <button
        onClick={() => void openFile(item.path)}
        aria-label={t("{name} öffnen", { name: item.name })}
        title={t("{name} öffnen", { name: item.name })}
        className="pressable relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {preview ? (
          <img src={preview} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
        ) : (
          <I size={30} weight="duotone" className="text-label-2" />
        )}
      </button>
      <div className="px-2 pt-1.5 pb-2 transition-opacity duration-150 group-hover:opacity-0">
        <p className="truncate text-caption font-medium text-label" title={item.name}>{item.name}</p>
        <span className="tabular text-caption text-label-3">{formatBytes(item.size, 0)}</span>
      </div>
      <CardButton
        label={copied ? t("Kopiert") : t("Kopieren")}
        icon={Copy}
        copied={copied}
        className="absolute top-2 left-2 opacity-0 group-hover:opacity-100"
        onClick={onCopy}
      />
      {item.kind === "image" && (
        <CardButton
          label={t("Vorschau")}
          icon={ArrowsOutSimple}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100"
          onClick={onPreview}
        />
      )}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <CardButton label={t("Im Explorer zeigen")} icon={FolderOpen} onClick={() => revealFile(item.path)} />
        <CardButton label={t("Entfernen")} icon={X} onClick={onRemove} />
      </div>
      <AskAIPill className="absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100" onClick={() => void ask()} />
    </div>
  );
}

/** Second path besides drag and drop, visible because Ctrl+V isn't discoverable. */
export function PasteHint({ nothing }: { nothing: boolean }) {
  return (
    <button onClick={() => void pasteFiles()} className="pressable flex items-center gap-1 text-caption text-label-3 hover:text-label-2">
      <ClipboardText size={12} weight="bold" />
      {nothing ? t("Keine Dateien in der Zwischenablage") : t("oder Strg+V zum Einfügen")}
    </button>
  );
}

function flash(set: (v: boolean) => void) {
  set(true);
  setTimeout(() => set(false), 1600);
}
