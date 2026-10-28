import { klDate } from "@komugo/types/rules";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { readLocal, writeLocal } from "./store";
import type { Timeslot } from "./types";

const DAY = 86_400_000;
type Cached = { at: number; timeslots: Timeslot[] };

export const today = () => klDate(Date.now());
export const addDays = (date: string, n: number) => klDate(Date.parse(`${date}T00:00:00+08:00`) + n * DAY);
const key = (op: string, date: string) => `ops:day:${op}:${date}`;

// Timeslots a Schedule removed are not Closures; nobody needs to see them.
export const visible = (ts: Timeslot[]) => ts.filter((s) => s.closedReason !== "schedule");

export function useDay(op: string, date: string) {
  const [state, setState] = useState<{ data: Cached | null; offline: boolean }>(() => ({ data: readLocal(key(op, date)), offline: false }));
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const { timeslots } = await api<{ timeslots: Timeslot[] }>("GET", `/operators/${op}/timeslots?from=${date}&days=1`);
      const data = { at: Date.now(), timeslots: visible(timeslots) };
      writeLocal(key(op, date), data);
      setState({ data, offline: false });
    } catch (e) {
      setState({ data: readLocal(key(op, date)), offline: (e as { status?: number }).status === 0 });
    } finally {
      setBusy(false);
    }
  }, [op, date]);

  useEffect(() => {
    setState({ data: readLocal(key(op, date)), offline: false });
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 60_000);
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("online", refresh);
    };
  }, [op, date, refresh]);

  return { ...state, busy, refresh };
}

// The cached Today response doubles as the scanner manifest when the network is slow or gone.
export function lookup(op: string, code: string) {
  const c = code.trim().toLowerCase();
  const slots = readLocal<Cached>(key(op, today()))?.timeslots ?? [];
  for (const slot of slots) {
    for (const g of slot.groups) {
      const ticket = g.tickets.find((t) => t.id === c || (c.length === 8 && t.code.toLowerCase() === c));
      if (ticket) return { slot, ticket };
    }
  }
  return null;
}
