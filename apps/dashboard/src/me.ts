import { api, ApiError } from "./api";
import { closeQueue } from "./checkins";
import { removeLocal, store } from "./store";
import type { Me } from "./types";

// undefined = loading, null = signed out
const me = store<Me | null | undefined>(undefined);

export const useMe = me.use;

export async function loadMe() {
  try {
    me.set(await api<Me>("GET", "/me"));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) me.set(null);
    else throw e;
  }
}

// Participant data and unsynced scans must not outlive the Member's session on a shared device.
export async function signOut() {
  try {
    await api("POST", "/auth/logout", {});
  } finally {
    closeQueue();
    removeLocal((k) => k.startsWith("ops:day:") || k.startsWith("ops:scans:"));
    me.set(null);
  }
}
