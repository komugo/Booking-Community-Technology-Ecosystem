import { env } from "cloudflare:workers";
import type { Locale } from "@komugo/db";

export type ApiError = { code: string; field?: string; params?: Record<string, string | number> };
type Named = { nameEn: string; nameMs: string };

export type Checkout = {
  id: string;
  state: "draft" | "held" | "expired" | "booked" | "refund_due" | "redeemed";
  locale: Locale;
  quantity: number;
  startsAt: number | null;
  timeslotId: string;
  option: Named & {
    id: string;
    priceSen: number;
    durationMinutes: number;
    minAge: number | null;
    maxAge: number | null;
    maxWeightKg: number | null;
    requiredCert: string | null;
    minParticipants: number | null;
    asksWeight: boolean;
  };
  activity: Named & {
    slugEn: string;
    slugMs: string;
    listingMode: "bookable" | "info" | "hidden";
    streetAddress: string | null;
    postalCode: string | null;
    city: Named & { slugEn: string; slugMs: string };
    category: { slugEn: string; slugMs: string };
  };
  operatorName: string;
  freeCancelHours: number | null;
  waiver: { version: string; text: string };
  addOns: (Named & { id: string; qty: number; priceSen: number })[];
  estimatedSen: number;
  amountSen: number | null;
  holdExpiresAt: number | null;
  signedIn: boolean;
  contact: { name: string | null; email: string | null; phone: string | null };
  draft?: { name: string; birthDate: string; weightKg: number | null; certs: string[]; waiver: { guardian: boolean; signerName: string } | null }[];
  participants: { id: string; name: string; birthDate: string }[];
  savedParticipants: { id: string; name: string; birthDate: string; weightKg: number | null; certs: string[]; waiverSignedAt: number | null }[];
  bookingId: string | null;
  packId: string | null;
  k?: string;
  packs: (Named & { id: string; k: string; left: number; expiresAt: number; why: null | "expired" | "after_expiry" | "used_up" | "add_ons" })[];
  refundReason: string | null;
  refundSen: number | null;
};

export type GroupTicket = {
  id: string;
  participantId: string;
  participantName: string;
  status: "issued" | "cancelled" | "forfeited";
  optionId: string;
  timeslotId: string;
  startsAt: number;
  closedAt: number | null;
  refundId: string | null;
  refundSen: number;
};

type GroupBase = {
  id: string;
  option: Named & { id: string; durationMinutes: number };
  activity: Checkout["activity"] & { lat: number | null; lng: number | null };
  operatorName: string;
  freeCancelHours: number | null;
  tickets: GroupTicket[];
  addOns: (Named & { addOnId: string; quantity: number; priceSen: number })[];
  closure: { timeslotId: string; reason: string; choice: "refund" | "reschedule" | null; chosenAt: number | null }[];
  canChange: boolean;
  k: string;
};

export type Booking = GroupBase & { kind: "booking"; amountSen: number };
export type Pack = GroupBase & {
  kind: "pack";
  offer: (Named & { id: string }) | null;
  sessionsTotal: number;
  sessionsUsed: number;
  expiresAt: number;
  options: (Named & { id: string })[];
};
export type Group = Booking | Pack;

export type Quote = { tickets: { id: string; outcome: "cancelled" | "forfeited"; refundSen: number }[]; refundSen: number; reason: "cancel" | "closure" | null };

type Visit = {
  kind: "booking" | "pack";
  id: string;
  k: string;
  timeslotId: string;
  startsAt: number;
  closed: boolean;
  option: Named;
  activity: Named;
  participants: string[];
  statuses: GroupTicket["status"][];
};
export type Me = {
  email: string | null;
  awaiting: Visit[];
  upcoming: Visit[];
  packs: (Named & { id: string; k: string; sessionsTotal: number; sessionsUsed: number; expiresAt: number; expired: boolean })[];
  past: Visit[];
};

type Reply<T> = { status: number; data: T; error: ApiError & { errors?: ApiError[] }; cookies: string[] };

export async function api<T = unknown>(request: Request, method: string, path: string, body?: unknown): Promise<Reply<T>> {
  const headers = new Headers({ "x-client-ip": request.headers.get("CF-Connecting-IP") ?? "" });
  const cookie = request.headers.get("Cookie");
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const res = await env.API.fetch(`https://api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return {
    status: res.status,
    data: (res.ok ? json : null) as T,
    error: res.ok ? { code: "" } : ((json as ApiError | null) ?? { code: "unknown" }),
    cookies: res.headers.getSetCookie(),
  };
}

export function see(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

export const errorsOf = (e: Reply<unknown>["error"]): ApiError[] => e.errors ?? [e];
