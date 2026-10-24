import { AnimatePresence, motion } from "motion/react";
import { ArrowsOutSimple, Copy, X } from "@phosphor-icons/react";
import { content } from "../design/motion";
import { HeaderButton } from "../notch/header";
import { t } from "../i18n";

export interface LoadedImagePreview {
  src: string;
  width: number;
  height: number;
  /** Display size calculated by the caller for the current notch. */
  w: number;
  h: number;
}

/** Large image below a card row; the notch grows for it. */
export function ImagePreviewPane({ preview, onCopy, onClose }: { preview: LoadedImagePreview; onCopy: () => void; onClose: () => void }) {
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col items-center gap-1.5 px-4 pt-2.5"
      initial={{ opacity: 0, filter: "blur(6px)", transform: "translateY(-6px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transform: "translateY(0px)", transition: { ...content.enter, delay: 0.08 } }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      <div className="relative" style={{ width: preview.w, height: preview.h }}>
        <AnimatePresence initial={false}>
          <motion.img
            key={preview.src}
            src={preview.src}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full rounded-[12px] object-contain"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
          />
        </AnimatePresence>
      </div>
      <div className="flex w-full items-center justify-between" style={{ maxWidth: Math.max(preview.w, 240) }}>
        <span className="tabular flex items-center gap-1 text-caption text-label-3">
          <ArrowsOutSimple size={11} weight="bold" /> {preview.width} × {preview.height}
        </span>
        <div className="flex gap-0.5">
          <HeaderButton label={t("Kopieren")} onClick={onCopy}>
            <Copy size={13} weight="bold" />
          </HeaderButton>
          <HeaderButton label={t("Vorschau schließen")} onClick={onClose}>
            <X size={13} weight="bold" />
          </HeaderButton>
        </div>
      </div>
    </motion.div>
  );
}
