import { activities, projOptions, projPackOffers, type Locale } from "@komugo/db";
import { eq, inArray } from "drizzle-orm";
import { api, errorsOf, see, type ApiError, type Group, type GroupTicket, type Me, type Quote } from "./api";
import { form } from "./checkout";
import { db, showDrafts } from "./db";
import { codeFrom, problems } from "./form";
import { path } from "./i18n";
import { daysAndTimes } from "./slots";

type Ctx = { request: Request; params: Record<string, string | undefined>; url: URL };
export type Kind = "booking" | "pack";

const HOUR = 3_600_000;
const notFound = () => new Response(null, { status: 404 });
const plural = (kind: Kind) => (kind === "booking" ? "bookings" : "packs");
const q = (v: string) => encodeURIComponent(v);

export const inWindow = (h: number | null, startsAt: number, now: number) => !!h && now <= startsAt - h * HOUR;
export const signInAt = (l: Locale, next: string) => `${path(l, "sign-in")}?next=${q(next)}`;
const safeNext = (v: string | null, fallback: string) => (v && /^\/(?![/\\])/.test(v) ? v : fallback);

const loadGroup = async (request: Request, kind: Kind, id: string, k: string | null) =>
  (await api<Group>(request, "GET", `/${plural(kind)}/${q(id)}${k ? `?k=${q(k)}` : ""}`)).data;

export const groupHref = (l: Locale, g: Group) => `${path(l, plural(g.kind), g.id)}?k=${g.k}`;
export const changeHref = (l: Locale, g: Group, to: "cancel" | "reschedule", t: string) =>
  `${path(l, plural(g.kind), g.id, to)}?t=${q(t)}&k=${g.k}`;

export async function groupStep({ request, params, url }: Ctx, l: Locale, kind: Kind) {
  const g = await loadGroup(request, kind, params.id!, url.searchParams.get("k"));
  if (!g) return notFound();
  const booked = url.searchParams.get("booked");
  const byTimeslot = new Map<string, GroupTicket[]>();
  for (const x of g.tickets) byTimeslot.set(x.timeslotId, [...(byTimeslot.get(x.timeslotId) ?? []), x]);
  const visits = [...byTimeslot.values()]
    .map((tickets) => ({ ...tickets[0], tickets }))
    .sort((a, b) => Number(b.timeslotId === booked) - Number(a.timeslotId === booked) || a.startsAt - b.startsAt);
  const closures = await Promise.all(
    g.closure.map(async (c) => {
      const tickets = byTimeslot.get(c.timeslotId) ?? [];
      const issued = tickets.filter((x) => x.status === "issued").length;
      const quote =
        !c.choice && issued && g.kind === "booking"
          ? (await api<Quote>(request, "GET", `/bookings/${q(g.id)}/quote?t=closed:${q(c.timeslotId)}&k=${g.k}`)).data
          : null;
      return {
        ...c,
        startsAt: tickets[0]?.startsAt ?? 0,
        optionId: tickets[0]?.optionId ?? g.option.id,
        issued,
        refundSen: quote?.refundSen ?? tickets.reduce((s, x) => s + x.refundSen, 0),
      };
    }),
  );
  return {
    locale: l,
    g,
    visits,
    closures: closures.filter((c) => c.choice || c.issued),
    fresh: url.searchParams.has("new"),
    booked,
    cancelled: url.searchParams.get("cancelled"),
    moved: Number(url.searchParams.get("moved")) || null,
  };
}

export async function cancelStep({ request, params, url }: Ctx, l: Locale, kind: Kind) {
  const g = await loadGroup(request, kind, params.id!, url.searchParams.get("k"));
  if (!g) return notFound();
  let t = url.searchParams.get("t") ?? "";
  let requestId: string = crypto.randomUUID();
  let errors: ApiError[] = [];
  if (request.method === "POST") {
    const get = await form(request);
    t = get("t");
    const res = await api<Quote>(request, "POST", `/${plural(kind)}/${q(g.id)}/cancel`, {
      requestId: get("requestId"),
      t,
      expectSen: Number(get("expectSen")),
      expectForfeited: get("expectForfeited").split(",").filter(Boolean),
      k: g.k,
    });
    if (res.data) {
      const returned = res.data.tickets.some((x) => x.outcome === "cancelled");
      return see(`${groupHref(l, g)}&cancelled=${kind === "pack" ? (returned ? "r" : "0") : res.data.refundSen}`);
    }
    if (res.status === 401) return see(signInAt(l, url.pathname + url.search));
    errors = errorsOf(res.error);
    if (res.error.code !== "quote_changed") requestId = get("requestId");
  }
  const quote = await api<Quote>(request, "GET", `/${plural(kind)}/${q(g.id)}/quote?t=${q(t)}&k=${g.k}`);
  if (quote.status === 401) return see(signInAt(l, url.pathname + url.search));
  if (!quote.data && !errors.length) errors = errorsOf(quote.error);
  return { locale: l, g, t, quote: quote.data, requestId, problems: problems(l, errors), status: errors.length ? 409 : 200 };
}

export async function rescheduleStep({ request, params, url }: Ctx, l: Locale, kind: Kind) {
  const g = await loadGroup(request, kind, params.id!, url.searchParams.get("k"));
  if (!g) return notFound();
  let t = url.searchParams.get("t") ?? "";
  let date = url.searchParams.get("date") ?? "";
  let picked = "";
  let requestId: string = crypto.randomUUID();
  let errors: ApiError[] = [];
  if (request.method === "POST") {
    const get = await form(request);
    t = get("t");
    date = get("date");
    picked = get("timeslotId");
    requestId = get("requestId");
    const res = await api<{ startsAt: number }>(request, "POST", `/${plural(kind)}/${q(g.id)}/reschedule`, { requestId, t, timeslotId: picked, k: g.k });
    if (res.data) return see(`${groupHref(l, g)}&moved=${res.data.startsAt}`);
    if (res.status === 401) return see(signInAt(l, url.pathname + url.search));
    errors = errorsOf(res.error);
  }
  const res = await api<{ ticketIds: string[]; slots: { id: string; startsAt: number; spots: number }[] }>(
    request,
    "GET",
    `/${plural(kind)}/${q(g.id)}/slots?t=${q(t)}&k=${g.k}`,
  );
  if (res.status === 401) return see(signInAt(l, url.pathname + url.search));
  if (!res.data && !errors.length) errors = errorsOf(res.error);
  const ids = new Set(res.data?.ticketIds);
  const tickets = g.tickets.filter((x) => ids.has(x.id));
  const blocked = !tickets.length || errors.some((e) => e.code === "started" || e.code === "window_passed");
  const { days, date: day, times, nextOpen } = daysAndTimes(res.data?.slots ?? [], date);
  const selected = times.find((x) => x.id === picked) ?? times[0];
  return { locale: l, g, t, tickets, blocked, days, date: day, times, nextOpen, selected, requestId, problems: problems(l, errors), status: errors.length ? 409 : 200 };
}

export async function signInStep({ request, url }: Ctx, l: Locale) {
  const next = safeNext(url.searchParams.get("next"), path(l, "bookings"));
  let email = "";
  let sentAt = 0;
  let errors: ApiError[] = [];
  if (request.method === "POST") {
    const get = await form(request);
    email = get("email");
    if (get("action") === "verify") {
      sentAt = Number(get("sentAt")) || Date.now();
      const res = await api(request, "POST", "/auth/sign-in/verify", { email, code: get("code") });
      if (res.status === 204) return see(next, res.cookies);
      errors = errorsOf(res.error);
    } else {
      const res = await api(request, "POST", "/auth/sign-in", { email, locale: l });
      if (res.status === 204) sentAt = Date.now();
      else {
        errors = errorsOf(res.error);
        sentAt = get("action") === "resend" ? Number(get("sentAt")) : 0;
      }
    }
  }
  return { locale: l, email, sentAt, problems: problems(l, errors), status: errors.length ? 400 : 200 };
}

export async function meStep({ request, url }: Ctx, l: Locale) {
  const here = path(l, "bookings");
  if (request.method === "POST") {
    const res = await api(request, "POST", "/auth/logout");
    return see(signInAt(l, here), res.cookies);
  }
  const res = await api<Me>(request, "GET", "/me");
  if (!res.data) return see(signInAt(l, here));
  return { locale: l, me: res.data, problems: problems(l, codeFrom(url)) };
}

export async function buyPackStep({ request, params, url }: Ctx, l: Locale) {
  const [row] = await db
    .select({ offer: projPackOffers, activity: { nameEn: activities.nameEn, nameMs: activities.nameMs, listingMode: activities.listingMode } })
    .from(projPackOffers)
    .innerJoin(activities, eq(activities.id, projPackOffers.activityId))
    .where(eq(projPackOffers.id, params.offerId!));
  if (!row || !row.offer.active || !(row.activity.listingMode === "bookable" || (showDrafts && row.activity.listingMode === "hidden"))) return notFound();
  const here = path(l, "packs", "buy", row.offer.id);
  let errors = codeFrom(url);
  if (request.method === "POST") {
    if ((await form(request))("action") === "logout") {
      const res = await api(request, "POST", "/auth/logout");
      return see(signInAt(l, here), res.cookies);
    }
    const res = await api<{ url: string }>(request, "POST", "/pack-orders", { offerId: row.offer.id, locale: l });
    if (res.data && /^https?:\/\//.test(res.data.url)) return see(res.data.url);
    if (res.status === 401) return see(signInAt(l, here));
    errors = errorsOf(res.error);
  }
  const [options, me] = await Promise.all([
    db.select({ id: projOptions.id, nameEn: projOptions.nameEn, nameMs: projOptions.nameMs }).from(projOptions).where(inArray(projOptions.id, row.offer.optionIds)),
    api<Me>(request, "GET", "/me"),
  ]);
  return { locale: l, offer: row.offer, activity: row.activity, options, email: me.data?.email ?? null, here, problems: problems(l, errors) };
}
