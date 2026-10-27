import { env } from "cloudflare:workers";
import type { Locale } from "@komugo/db";

export type ApiError = { code: string; field?: string; params?: Record<string, string | number> };
type Named = { nameEn: string; nameMs: string };

export type Checkout = {
  id: string;
  state: "draft" | "held" | "expired" | "booked" | "refund_due";
  locale: Locale;
  quantity: number;
  startsAt: number | null;
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
    published: boolean;
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
  k?: string;
  refundReason: string | null;
  refundSen: number | null;
};

export type Booking = {
  bookingId: string;
  checkoutId: string;
  startsAt: number;
  amountSen: number;
  option: Named & { id: string; durationMinutes: number };
  activity: Checkout["activity"] & { lat: number | null; lng: number | null };
  operatorName: string;
  freeCancelHours: number | null;
  tickets: { id: string; participantId: string; participantName: string; status: string }[];
  addOns: (Named & { addOnId: string; quantity: number; priceSen: number })[];
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
