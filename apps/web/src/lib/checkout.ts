import { activities, operators, optionFrom, projActivities, projAddOns, projOptions, projTimeslots, slotPrices, type Locale } from "@komugo/db";
import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import { api, errorsOf, see, type ApiError, type Checkout } from "./api";
import { db, sells } from "./db";
import { codeFrom, problems } from "./form";
import { path } from "./i18n";
import { daysAndTimes } from "./slots";

type Ctx = { request: Request; params: Record<string, string | undefined>; url: URL };

const DAY = 86_400_000;
const notFound = () => new Response(null, { status: 404 });
const step = (l: Locale, id: string, s: string) => path(l, "checkout", id, s);
export const named = (x: { nameEn: string; nameMs: string }, l: Locale) => (l === "ms" ? x.nameMs : x.nameEn);

const STEP_1 = new Set(["no_availability", "below_min_participants", "above_max_per_booking", "not_bookable", "invalid_add_on"]);
const STEP_2 = new Set(["requirement_not_met", "invalid_participant", "waiver_missing"]);

export function holdRedirect(l: Locale, co: { id: string; option: { id: string } }, code: string, cookies: string[] = []) {
  const to = STEP_1.has(code) ? path(l, "book", co.option.id) : step(l, co.id, STEP_2.has(code) ? "who" : "pay");
  return see(`${to}?e=${code}`, cookies);
}

export async function form(request: Request) {
  const f = await request.formData();
  return (k: string) => String(f.get(k) ?? "").trim();
}

export async function pickStep({ request, params, url }: Ctx, l: Locale) {
  const optionId = params.optionId!;
  const [row] = await db
    .select({
      option: projOptions,
      listingMode: activities.listingMode,
      commissionBps: operators.commissionBps,
      activityNameEn: activities.nameEn,
      activityNameMs: activities.nameMs,
      cutoffMinutes: projActivities.bookingCutoffMinutes,
      freeCancelHours: projActivities.freeCancelHours,
    })
    .from(projOptions)
    .innerJoin(activities, eq(activities.id, projOptions.activityId))
    .innerJoin(operators, eq(operators.id, activities.operatorId))
    .innerJoin(projActivities, eq(projActivities.id, projOptions.activityId))
    .where(and(eq(projOptions.id, optionId), eq(projOptions.active, true)));
  if (!row || !sells(row.listingMode, row.commissionBps)) return notFound();
  const o = row.option;
  const now = Date.now();
  const [options, addOns, slots, prices] = await db.batch([
    db
      .select({ id: projOptions.id, nameEn: projOptions.nameEn, nameMs: projOptions.nameMs, priceSen: projOptions.priceSen })
      .from(projOptions)
      .where(and(eq(projOptions.activityId, o.activityId), eq(projOptions.active, true)))
      .orderBy(asc(projOptions.priceSen), asc(projOptions.durationMinutes)),
    db
      .select()
      .from(projAddOns)
      .where(and(eq(projAddOns.activityId, o.activityId), eq(projAddOns.active, true)))
      .orderBy(asc(projAddOns.priceSen)),
    db
      .select({ id: projTimeslots.id, startsAt: projTimeslots.startsAt, spots: projTimeslots.spots, priceSen: projTimeslots.priceSen })
      .from(projTimeslots)
      .where(
        and(
          eq(projTimeslots.optionId, o.id),
          gt(projTimeslots.startsAt, now + row.cutoffMinutes * 60_000),
          lt(projTimeslots.startsAt, now + 60 * DAY),
          isNull(projTimeslots.closedAt),
          gt(projTimeslots.spots, 0),
        ),
      )
      .orderBy(asc(projTimeslots.startsAt)),
    slotPrices(db, [o.activityId]),
  ]);
  const siblings = options.map((x) => ({ ...x, fromPriceSen: optionFrom(x, prices) }));

  const min = o.minParticipants ?? 1;
  const max = o.maxPerBooking ?? 10;
  let errors: ApiError[] = codeFrom(url);
  const q = (k: string) => Math.max(0, Math.floor(Number(url.searchParams.get(k)) || 0));
  const quantity = Math.min(max, Math.max(min, q("quantity")));
  let values = {
    timeslotId: "",
    quantity,
    addOns: Object.fromEntries(addOns.map((a) => [a.id, Math.min(quantity, q(`addOn.${a.id}`))])) as Record<string, number>,
  };
  let date = url.searchParams.get("date") ?? "";
  let cookies: string[] = [];

  if (request.method === "POST") {
    const get = await form(request);
    values = {
      timeslotId: get("timeslotId"),
      quantity: Number(get("quantity")) || 0,
      addOns: Object.fromEntries(addOns.map((a) => [a.id, Number(get(`addOn.${a.id}`)) || 0])),
    };
    date = get("date");
    if (!values.timeslotId) {
      errors = [{ code: "not_bookable", field: "time" }];
    } else {
      const res = await api<{ id: string }>(request, "POST", "/checkouts", {
        optionId: o.id,
        timeslotId: values.timeslotId,
        quantity: values.quantity,
        addOns: Object.entries(values.addOns)
          .filter(([, qty]) => qty > 0)
          .map(([id, qty]) => ({ id, qty })),
        locale: l,
      });
      if (res.data) return see(step(l, res.data.id, "who"), res.cookies);
      errors = errorsOf(res.error);
      cookies = res.cookies;
    }
  }

  const { days, date: day, times, nextOpen } = daysAndTimes(
    slots.map((x) => ({ ...x, priceSen: x.priceSen ?? o.priceSen })),
    date,
    now,
  );
  if (!times.some((x) => x.id === values.timeslotId)) {
    values.timeslotId = (times.find((x) => x.spots >= values.quantity) ?? times[0])?.id ?? "";
  }

  return {
    locale: l,
    option: o,
    activityName: l === "ms" ? row.activityNameMs : row.activityNameEn,
    freeCancelHours: row.freeCancelHours,
    siblings,
    addOns,
    days,
    date: day,
    times,
    nextOpen,
    values,
    min,
    max,
    problems: problems(l, errors),
    status: errors.length && request.method === "POST" ? 400 : 200,
    cookies,
  };
}

export async function loadCheckout(request: Request, id: string) {
  const res = await api<Checkout>(request, "GET", `/checkouts/${encodeURIComponent(id)}`);
  return res.data;
}

const pad = (v: string, n: number) => v.replace(/\D/g, "").padStart(n, "0").slice(-n);

export async function whoStep({ request, params, url }: Ctx, l: Locale) {
  const co = await loadCheckout(request, params.id!);
  if (!co) return notFound();
  if (co.state === "booked" || co.state === "refund_due" || co.state === "redeemed") return see(step(l, co.id, "pay"));
  let errors: ApiError[] = codeFrom(url);
  let values: Record<string, string> = {};
  if (request.method === "POST") {
    const f = await request.formData();
    values = Object.fromEntries([...f].map(([k, v]) => [k, String(v).trim()]));
    const people = Array.from({ length: co.quantity }, (_, i) => {
      const v = (k: string) => values[`p${i}.${k}`] ?? "";
      const accepted = v("accept") === "on";
      return {
        name: v("name"),
        birthDate: `${pad(v("yyyy"), 4)}-${pad(v("mm"), 2)}-${pad(v("dd"), 2)}`,
        weightKg: co.option.asksWeight ? Number(v("weight")) : undefined,
        certs: v("cert") === "yes" && co.option.requiredCert ? [co.option.requiredCert] : [],
        waiver: { accepted, guardian: accepted && v("signedAs") === "minor", guardianName: v("guardianName") },
      };
    });
    const res = await api<{ next: "contact" | "pay" }>(request, "PUT", `/checkouts/${co.id}/who`, { participants: people });
    if (res.data) return see(step(l, co.id, res.data.next), res.cookies);
    if (res.status === 409) return holdRedirect(l, co, res.error.code);
    errors = errorsOf(res.error);
  }
  return { locale: l, co, values, problems: problems(l, errors), status: request.method === "POST" ? 400 : 200 };
}

export async function contactStep({ request, params, url }: Ctx, l: Locale) {
  const co = await loadCheckout(request, params.id!);
  if (!co) return notFound();
  if (co.signedIn) return see(step(l, co.id, co.participants.length ? "pay" : "who"));
  let errors: ApiError[] = codeFrom(url);
  let values = { name: co.contact.name ?? "", email: co.contact.email ?? "", phone: co.contact.phone ?? "" };
  let editing = !co.contact.email || url.searchParams.has("change");
  if (request.method === "POST") {
    const get = await form(request);
    const action = get("action");
    if (action === "verify") {
      const res = await api<{ next: "pay" | "who" }>(request, "POST", "/auth/otp/verify", {
        checkoutId: co.id,
        email: co.contact.email,
        code: get("code"),
      });
      if (res.data) return see(step(l, co.id, res.data.next), res.cookies);
      if (res.status === 409) return holdRedirect(l, co, res.error.code, res.cookies);
      errors = errorsOf(res.error);
    } else {
      if (action === "send") values = { name: get("name"), email: get("email"), phone: get("phone") };
      const res = await api(request, "POST", "/auth/otp", { checkoutId: co.id, ...values, phone: values.phone || undefined });
      if (res.status === 204) return see(`${step(l, co.id, "contact")}?sent=${Date.now()}`);
      errors = errorsOf(res.error);
      editing = action === "send";
    }
  }
  const sentAt = Number(url.searchParams.get("sent")) || 0;
  return { locale: l, co, values, editing, sentAt, problems: problems(l, errors), status: errors.length && request.method === "POST" ? 400 : 200 };
}

export async function payStep({ request, params, url }: Ctx, l: Locale) {
  const co = await loadCheckout(request, params.id!);
  if (!co) return notFound();
  if (co.state === "booked") return see(`${path(l, "bookings", co.bookingId!)}?k=${co.k}`);
  if (co.state === "redeemed") return see(`${path(l, "packs", co.packId!)}?k=${co.k}&booked=${co.timeslotId}`);
  if (co.state === "draft") return see(step(l, co.id, !co.signedIn && co.draft ? "contact" : "who") + url.search);
  let errors: ApiError[] = codeFrom(url);
  if (request.method === "POST") {
    const get = await form(request);
    const action = get("action");
    if (action === "logout") {
      const res = await api(request, "POST", "/auth/logout");
      return see(path(l, "book", co.option.id), res.cookies);
    }
    if (action === "hold") {
      const res = await api(request, "POST", `/checkouts/${co.id}/hold`);
      return res.status === 200 ? see(step(l, co.id, "pay")) : holdRedirect(l, co, res.error.code);
    }
    if (action === "pack") {
      const res = await api<{ packId: string; k: string }>(request, "POST", `/checkouts/${co.id}/redeem`, { packId: get("packId") });
      if (res.data) return see(`${path(l, "packs", res.data.packId)}?k=${res.data.k}&booked=${co.timeslotId}`);
      return see(`${step(l, co.id, "pay")}?e=${res.error.code}`);
    }
    const res = await api<{ url: string }>(request, "POST", `/checkouts/${co.id}/pay`);
    if (res.data && /^https?:\/\//.test(res.data.url)) return see(res.data.url);
    return see(`${step(l, co.id, "pay")}?e=${res.error.code}`);
  }
  if (co.state === "expired") errors = errors.filter((e) => e.code !== "hold_expired");
  return { locale: l, co, problems: problems(l, errors) };
}

type Return =
  | { state: "booked" | "refund_due" | "pending" | "failed"; checkoutId: string; bookingId?: string; k?: string }
  | { state: "pack" | "refund_due" | "pending" | "failed"; offerId: string; packId?: string; k?: string };

export async function returnStep({ request, url }: Ctx, l: Locale) {
  const res = await api<Return>(request, "GET", `/billplz/return${url.search}`);
  const r = res.data;
  const tries = Number(url.searchParams.get("n")) || 0;
  if (!r) return { locale: l, state: res.status === 403 || res.status === 404 ? ("invalid" as const) : ("pending" as const), tries };
  if ("offerId" in r) {
    if (r.state === "pack") return see(r.k ? `${path(l, "packs", r.packId!)}?k=${r.k}&new=1` : path(l, "bookings"));
    if (r.state === "refund_due") return see(`${path(l, "bookings")}?e=pack_refund_due`);
    if (r.state === "failed") return see(`${path(l, "packs", "buy", r.offerId)}?e=payment_failed`);
    return { locale: l, state: r.state, tries };
  }
  if (r.state === "booked" && r.bookingId && r.k) return see(`${path(l, "bookings", r.bookingId)}?k=${r.k}`);
  if (r.state === "refund_due") return see(step(l, r.checkoutId, "pay"));
  if (r.state === "failed") return see(`${step(l, r.checkoutId, "pay")}?e=payment_failed`);
  return { locale: l, state: r.state, tries };
}
