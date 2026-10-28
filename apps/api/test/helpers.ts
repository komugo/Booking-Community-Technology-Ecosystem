import { createExecutionContext, env, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { booking, type OptionInput } from "@komugo/booking";
import { activities, categories, checkouts, cities, createDb, customers, members, operators, participants, waivers } from "@komugo/db";
import { WAIVER } from "@komugo/types";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { app } from "../src/app";
import { devInbox } from "../src/email";

export const db = createDb(env.DB);
export const rid = () => crypto.randomUUID();
export const kl = (local: string) => new Date(`${local}+08:00`).getTime();
export const SLOT_AT = kl("2030-01-15T09:00");

export const resend: { calls: { key: string | null; to: string }[]; fail: number } = { calls: [], fail: 0 };

export async function dispatch(req: Request, e: Partial<Env> = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(req, { ...env, ...e }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function stubOutbound() {
  resend.calls = [];
  resend.fail = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin === "https://api.test") return dispatch(req);
    if (url.origin === "https://web.test" && url.pathname === "/billplz/callback") {
      return dispatch(new Request(`https://api.test/billplz/callback`, req));
    }
    if (url.origin === "https://api.resend.com") {
      const body = (await req.json()) as { to: string[] };
      resend.calls.push({ key: req.headers.get("Idempotency-Key"), to: body.to[0] });
      if (resend.fail > 0) {
        resend.fail--;
        return new Response("down", { status: 500 });
      }
      return Response.json({ id: rid() });
    }
    throw new Error(`unexpected fetch ${req.url}`);
  });
}

export function client(e: Partial<Env> = {}) {
  let cookie = "";
  const ip = rid();
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const form = body instanceof URLSearchParams;
    const res = await dispatch(
      new Request(`https://api.test${path}`, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          "x-client-ip": ip,
          ...(body && !form ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      }),
      e,
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return res;
  };
  return {
    call,
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      cookie = v;
    },
    json: async <T = Record<string, any>>(method: string, path: string, body?: unknown) => {
      const res = await call(method, path, body);
      return { status: res.status, body: (res.status === 204 ? null : await res.json()) as T };
    },
  };
}
export type Client = ReturnType<typeof client>;

export async function world(o: { published?: boolean; option?: Partial<OptionInput>; horses?: number } = {}) {
  const s = rid();
  const operatorId = `op_${s}`;
  const activityId = `act_${s}`;
  const hub = { slugEn: s, slugMs: `${s}-ms`, nameEn: "Hub", nameMs: "Hub" };
  await db.insert(operators).values({ id: operatorId, name: "Test Stable" });
  const [city] = await db.insert(cities).values(hub).returning();
  const [category] = await db.insert(categories).values(hub).returning();
  await db.insert(activities).values({
    ...hub,
    id: activityId,
    operatorId,
    cityId: city.id,
    categoryId: category.id,
    nameEn: "Trail Riding",
    nameMs: "Tunggang Denai",
    descriptionEn: "x",
    descriptionMs: "x",
    published: o.published ?? true,
  });
  const b = booking(env, operatorId);
  await b.upsertActivity({ id: activityId, freeCancelHours: 24 });
  for (let i = 0; i < (o.horses ?? 2); i++) {
    await b.upsertResource({
      id: `h${i}_${s}`,
      kind: "horse",
      name: `Horse ${i}`,
      active: true,
      maxSessionsPerDay: null,
      restMinutes: 0,
      maxRiderWeightKg: 90,
    });
  }
  const optionId = `opt_${s}`;
  await b.upsertOption({
    id: optionId,
    activityId,
    nameEn: "Ride",
    nameMs: "Tunggang",
    priceSen: 10000,
    durationMinutes: 60,
    minAge: 7,
    maxAge: null,
    maxWeightKg: 90,
    requiredCert: null,
    minParticipants: null,
    active: true,
    needs: [{ kind: "horse", quantity: 1 }],
    ...o.option,
  });
  const helmetId = `helmet_${s}`;
  await b.upsertAddOn({ id: helmetId, activityId, nameEn: "Helmet", nameMs: "Topi", priceSen: 500, active: true });
  const {
    ids: [timeslotId],
  } = await b.createTimeslots({ optionId, startsAt: [SLOT_AT] });
  const stub = env.BOOKING.get(env.BOOKING.idFromName(operatorId));
  const flush = () => runInDurableObject(stub, (i) => i.alarm());
  await flush();
  const doSql = (q: string, ...p: SqlStorageValue[]) =>
    runInDurableObject(stub, (_, st) => st.storage.sql.exec(q, ...p).toArray());
  return { operatorId, activityId, optionId, helmetId, timeslotId, b, stub, flush, doSql };
}
export type World = Awaited<ReturnType<typeof world>>;

export const adult = (name = "Aisyah Rahman", extra: Record<string, unknown> = {}) => ({
  name,
  birthDate: "1990-05-01",
  weightKg: 60,
  waiver: { accepted: true },
  ...extra,
});

export const otpCode = (email: string) => {
  const m = devInbox.find((e) => e.to === email);
  return /(\d{6})/.exec(m?.subject ?? "")?.[1] ?? "";
};

export async function start(cl: Client, w: World, quantity = 1, addOns: { id: string; qty: number }[] = []) {
  const r = await cl.json<{ id: string }>("POST", "/checkouts", {
    optionId: w.optionId,
    timeslotId: w.timeslotId,
    quantity,
    addOns,
    locale: "en",
  });
  if (r.status !== 201) throw new Error(`start ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

export async function signIn(cl: Client, id: string, email: string) {
  const sent = await cl.call("POST", "/auth/otp", { checkoutId: id, name: "Aiman", email });
  if (sent.status !== 204) throw new Error(`otp ${sent.status} ${await sent.text()}`);
  return cl.json("POST", "/auth/otp/verify", { checkoutId: id, email, code: otpCode(email) });
}

export async function held(w: World, o: { quantity?: number; people?: unknown[]; addOns?: { id: string; qty: number }[] } = {}) {
  const cl = client();
  const quantity = o.quantity ?? 1;
  const id = await start(cl, w, quantity, o.addOns);
  const people = o.people ?? Array.from({ length: quantity }, (_, i) => adult(`Rider ${i} ${rid().slice(0, 4)}`));
  const who = await cl.json("PUT", `/checkouts/${id}/who`, { participants: people });
  if (who.status !== 200) throw new Error(`who ${who.status} ${JSON.stringify(who.body)}`);
  const email = `${rid()}@example.com`;
  const v = await signIn(cl, id, email);
  if (v.status !== 200) throw new Error(`verify ${v.status} ${JSON.stringify(v.body)}`);
  return { cl, id, email };
}

export async function pay(cl: Client, id: string) {
  const r = await cl.json<{ url: string }>("POST", `/checkouts/${id}/pay`);
  if (r.status !== 200) throw new Error(`pay ${r.status} ${JSON.stringify(r.body)}`);
  return { url: r.body.url, billId: r.body.url.split("/").pop()! };
}

export async function fake(billId: string, action: string) {
  const res = await dispatch(
    new Request(`https://api.test/dev/billplz/bills/${billId}`, {
      method: "POST",
      body: new URLSearchParams({ action }),
    }),
  );
  return res.headers.get("location");
}

export const returnPath = (location: string) => `/billplz/return?${new URL(location).search.slice(1)}`;

export const d1 = <T = Record<string, unknown>>(q: string, ...p: unknown[]) =>
  env.DB.prepare(q)
    .bind(...p)
    .all<T>()
    .then((r) => r.results);

export async function member(role: "staff" | "operator", operatorId: string | null = null) {
  const email = `${role}+${rid()}@example.com`;
  await db.insert(members).values({ email, name: `The ${role}`, role, operatorId });
  const cl = client();
  const sent = await cl.call("POST", "/ops/auth/otp", { email, locale: "en" });
  if (sent.status !== 204) throw new Error(`ops otp ${sent.status}`);
  const v = await cl.json("POST", "/ops/auth/otp/verify", { email, code: otpCode(email) });
  if (v.status !== 200) throw new Error(`ops verify ${v.status} ${JSON.stringify(v.body)}`);
  return Object.assign(cl, { email });
}

type Person = { name?: string; birthDate?: string; weightKg?: number; waiver?: "signed" | "guardian" | "outdated" };

// A paid Booking made straight through the Durable Object, with its Checkout row for contact and locale.
export async function booked(
  w: World,
  people: Person[] = [{}],
  o: { addOns?: { id: string; qty: number }[]; locale?: "en" | "ms"; phone?: string; timeslotId?: string; customer?: { id: string; email: string | null } } = {},
) {
  const [customer] = o.customer ? [o.customer] : await db.insert(customers).values({ name: "Aiman Rahman", email: `${rid()}@example.com` }).returning();
  const ids: string[] = [];
  for (const p of people) {
    const [row] = await db
      .insert(participants)
      .values({ customerId: customer.id, name: p.name ?? "Aisyah", birthDate: p.birthDate ?? "1990-05-01", weightKg: p.weightKg ?? 60 })
      .returning();
    ids.push(row.id);
    await db.insert(waivers).values({
      participantId: row.id,
      operatorId: w.operatorId,
      signerName: "Aiman Rahman",
      version: WAIVER.version,
      guardian: p.waiver === "guardian",
    });
  }
  const timeslotId = o.timeslotId ?? w.timeslotId;
  const hold = await w.b.createHold({
    requestId: rid(),
    customerId: customer.id,
    replaces: null,
    timeslotId,
    participantIds: ids,
    addOns: o.addOns ?? [],
  });
  const paid = await w.b.confirmHold({ billId: rid(), holdId: hold.holdId, amountSen: hold.amountSen });
  if (paid.status !== "paid") throw new Error("not paid");
  for (const [i, p] of people.entries()) {
    if (p.waiver === "outdated") await db.update(waivers).set({ version: "old" }).where(eq(waivers.participantId, ids[i]));
  }
  const now = Date.now();
  await db.insert(checkouts).values({
    sessionId: rid(),
    customerId: customer.id,
    operatorId: w.operatorId,
    activityId: w.activityId,
    optionId: w.optionId,
    timeslotId,
    quantity: ids.length,
    addOns: hold.addOns,
    participantIds: ids,
    contactName: "Aiman Rahman",
    contactPhone: o.phone ?? "+60123456789",
    locale: o.locale ?? "en",
    holdId: hold.holdId,
    amountSen: hold.amountSen,
    bookingId: paid.bookingId,
    emailedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return { customerId: customer.id, email: customer.email!, participantIds: ids, bookingId: paid.bookingId, ticketIds: paid.ticketIds };
}
