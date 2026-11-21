import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createStore } from "../../lib/store";
import { isNative } from "../../platform/native";

/** What the Windows account gives us: display name and account photo. */
interface AccountProfile {
  name: string;
  photo: string | null;
}

const account = createStore<AccountProfile>({ name: "", photo: null });

let request: Promise<void> | null = null;

/** Reads the Windows name/photo once; the Settings picker overrides them. */
function ensureAccount(): Promise<void> {
  if (request) return request;
  request = (async () => {
    if (!isNative) return;
    try {
      account.set(await invoke<AccountProfile>("account_profile"));
    } catch {
      // No account data: the initial-letter avatar is enough.
    }
  })();
  return request;
}

export function useAccount(): AccountProfile {
  const state = account.use();
  useEffect(() => {
    void ensureAccount();
  }, []);
  return state;
}

/** Effective profile: the local override when set, otherwise Windows. */
export function useProfile(profile: { name: string; photo: string } | undefined) {
  const a = useAccount();
  return {
    name: profile?.name?.trim() || a.name || "You",
    photo: profile?.photo || a.photo || null,
  };
}

export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";
}
