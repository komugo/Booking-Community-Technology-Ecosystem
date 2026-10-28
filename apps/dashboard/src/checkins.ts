import { api, ApiError } from "./api";
import { lookup } from "./day";
import { readLocal, store, writeLocal } from "./store";
import type { CheckIn, Outcome } from "./types";

// "ok" is the optimistic green from the manifest; "unknown" means the manifest has no such Ticket.
type Verdict = "ok" | "unknown" | Outcome;
export type Scan = {
  requestId: string;
  code: string;
  at: number;
  state: "pending" | "done" | "rejected";
  local: Verdict;
  name: string;
  checkedInAt: number | null;
  ticketId: string | null;
  outcome?: Outcome;
  ticket?: CheckIn["ticket"];
};

const MAX = 100;
const key = (op: string) => `ops:scans:${op}`;
const queue = store<{ op: string; scans: Scan[] }>({ op: "", scans: [] });
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let delay = 0;

export const useQueue = queue.use;

function save(scans: Scan[]) {
  const { op } = queue.get();
  writeLocal(key(op), scans);
  queue.set({ ...queue.get(), scans });
}

const patch = (requestId: string, p: Partial<Scan>) => save(queue.get().scans.map((s) => (s.requestId === requestId ? { ...s, ...p } : s)));

export const closeQueue = () => queue.set({ op: "", scans: [] });

export function openQueue(op: string) {
  if (queue.get().op !== op) queue.set({ op, scans: readLocal<Scan[]>(key(op)) ?? [] });
  flush();
}

function verdict(code: string, scans: Scan[]) {
  const hit = lookup(queue.get().op, code);
  if (!hit) return { local: "unknown" as const, name: "", checkedInAt: null, ticketId: null };
  const { slot, ticket } = hit;
  const earlier = scans.find((s) => s.ticketId === ticket.id && s.state !== "rejected");
  const checkedInAt = ticket.checkedInAt ?? earlier?.checkedInAt ?? earlier?.at ?? null;
  const local: Verdict = slot.closedAt ? "closed" : checkedInAt ? "already" : "ok";
  return { local, name: ticket.participant.name, checkedInAt, ticketId: ticket.id };
}

export function scan(code: string) {
  const { scans } = queue.get();
  const s: Scan = { requestId: crypto.randomUUID(), code: code.trim(), at: Date.now(), state: "pending", ...verdict(code, scans) };
  save([s, ...scans].slice(0, MAX));
  flush();
  return s.requestId;
}

async function flush() {
  const { op } = queue.get();
  if (busy || !op) return;
  busy = true;
  clearTimeout(timer);
  try {
    for (;;) {
      if (queue.get().op !== op) break;
      const next = queue
        .get()
        .scans.filter((s) => s.state === "pending")
        .at(-1);
      if (!next) break;
      let r: CheckIn;
      try {
        r = await api<CheckIn>("POST", `/operators/${op}/check-ins`, { requestId: next.requestId, code: next.code });
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 401 || queue.get().op !== op) break;
        if (status >= 400 && status < 500 && status !== 429) {
          patch(next.requestId, { state: "rejected", outcome: "not_found", ticket: null });
          continue;
        }
        delay = Math.min(30_000, delay ? delay * 2 : 2_000);
        timer = setTimeout(flush, delay);
        break;
      }
      delay = 0;
      if (queue.get().op !== op) break;
      patch(next.requestId, {
        state: r.outcome === "checked_in" || r.outcome === "already" ? "done" : "rejected",
        outcome: r.outcome,
        ticket: r.ticket,
        name: r.ticket?.participant.name ?? next.name,
        ticketId: r.ticket?.id ?? next.ticketId,
        checkedInAt: r.ticket?.checkedInAt ?? next.checkedInAt,
      });
    }
  } finally {
    busy = false;
  }
}

addEventListener("online", flush);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && flush());
