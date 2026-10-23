import { createStore } from "../../lib/store";
import { navigate } from "../../notch/nav";

/** An item handed to Ask from Clipboard or Shelf. It waits in the input until sent. */
export interface AskAttachment {
  id: string;
  kind: "text" | "image" | "file";
  title: string;
  detail?: string;
  /** Text context (clipboard text/link or extracted document text). */
  text?: string;
  /** Image as data URL for the preview and for vision models. */
  image?: string;
  /** Original path for Shelf files. */
  path?: string;
}

export const askAttachment = createStore<AskAttachment | null>(null);

export function askAI(attachment: AskAttachment) {
  askAttachment.set(attachment);
  navigate("ask");
}

export function clearAskAttachment() {
  askAttachment.set(null);
}
