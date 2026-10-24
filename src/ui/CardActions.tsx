import type { Icon, IconWeight } from "@phosphor-icons/react";
import { Check } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { springs } from "../design/motion";
import { t } from "../i18n";
import { ChatBubbleIcon } from "./ChatBubbleIcon";

/** Glass circle used on clipboard and shelf cards. */
export function CardButton({
  label,
  icon: I,
  copied = false,
  active = false,
  weight = "bold",
  className = "",
  onClick,
}: {
  label: string;
  icon: Icon;
  copied?: boolean;
  active?: boolean;
  weight?: IconWeight;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`pressable flex size-7 items-center justify-center rounded-full border border-white/10 backdrop-blur-md transition-[background-color,color,opacity,transform,border-color] duration-200 ease-out hover:scale-105 hover:border-white/25 ${
        active ? "bg-white text-black" : "bg-black/35 text-white hover:bg-black/55"
      } ${className}`}
    >
      <span className="relative flex size-full items-center justify-center rounded-full">
        {copied && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border border-white/70"
            initial={{ opacity: 0.7, scale: 0.55 }}
            animate={{ opacity: 0, scale: 1.55 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          />
        )}
        <AnimatePresence initial={false}>
          {copied ? (
            <motion.span
              key="check"
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.3, rotate: -25 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={springs.snappy}
            >
              <Check size={14} weight="bold" />
            </motion.span>
          ) : (
            <motion.span
              key="icon"
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={springs.snappy}
            >
              <I size={14} weight={weight} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}

/** A checkmark that pops in when something was copied. */
export function CopyCheck({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <motion.span
      aria-hidden
      className={`inline-flex ${className}`}
      initial={{ opacity: 0, scale: 0.3, rotate: -25 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={springs.snappy}
    >
      <Check size={size} weight="bold" />
    </motion.span>
  );
}

/** Large, consistent Ask AI action with the chat-bubble icon. */
export function AskAIPill({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={t("Ask AI")}
      onClick={onClick}
      className={`pressable flex h-8 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-black/60 text-[11px] font-semibold text-white backdrop-blur-md transition-[background-color,opacity,transform,border-color] duration-200 ease-out hover:scale-[1.02] hover:border-white/30 hover:bg-black/75 ${className}`}
    >
      <ChatBubbleIcon size={16} weight="bold" />
      {t("Ask AI")}
    </button>
  );
}
