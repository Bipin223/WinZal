import { invoke } from "@tauri-apps/api/core";
import { isNative } from "../../platform/native";
import type { ChatMessage } from "./providers";

/** Index entry: no message bodies, so the history list stays tiny in memory. */
export interface AskSummary {
  id: string;
  title: string;
  updatedAt: number;
  messages: number;
}

export interface AskConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

/**
 * Saved Ask chats. Native builds read one JSON file per conversation from the
 * app-data folder; the browser preview simply has no history.
 */
export const askHistory = {
  list: (): Promise<AskSummary[]> => (isNative ? invoke<AskSummary[]>("ask_history_list") : Promise.resolve([])),
  load: (id: string): Promise<AskConversation | null> =>
    isNative ? invoke<AskConversation | null>("ask_history_load", { id }) : Promise.resolve(null),
  save: (conversation: AskConversation): Promise<AskSummary[]> =>
    isNative ? invoke<AskSummary[]>("ask_history_save", { conversation }) : Promise.resolve([]),
  remove: (id: string): Promise<AskSummary[]> => (isNative ? invoke<AskSummary[]>("ask_history_delete", { id }) : Promise.resolve([])),
};
