import { useSyncExternalStore } from "react";

export function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  const subscribe = (cb: () => void) => {
    subs.add(cb);
    return () => void subs.delete(cb);
  };
  return {
    get: () => value,
    set(v: T) {
      value = v;
      for (const cb of subs) cb();
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function removeLocal(match: (key: string) => boolean) {
  try {
    for (const k of Object.keys(localStorage)) if (match(k)) localStorage.removeItem(k);
  } catch {}
}

export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
