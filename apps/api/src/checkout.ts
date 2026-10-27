import { booking, BookingError } from "@komugo/booking";
import {
  activities,
  bills,
  checkouts,
  createDb,
  customers,
  participants,
  waivers,
  type AddOnPick,
  type Db,
  type DraftParticipant,
} from "@komugo/db";
import { ageOn, klDate, participantKey, WAIVER, waiverText } from "@komugo/types";
import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { checkoutState, createBill, deleteBill } from "./billplz";
import { bookingLink } from "./bookings";
import { klDay, named, optionDetails, type Locale, type OptionDetails } from "./details";
import { fail, limited, logError, MIN, sha256Hex, type ApiError, type Ctx, type WaitUntil } from "./lib";
import { ensureSession, owns, readSession, type Session } from "./session";

const MAX_PEOPLE = 10;
const MAX_HOLDS_PER_CHECKOUT = 8;
const PAY_MARGIN = MIN;

type Checkout = typeof checkouts.$inferSelect;

export async function ownedCheckout(c: Ctx, id: string) {
  const session = await readSession(c);
  const [checkout] = await createDb(c.env.DB).select().from(checkouts).where(eq(checkouts.id, id));
  return checkout && session && owns(session, checkout) ? { checkout, session } : null;
}

const busy = async (c: Ctx, s: Session) => limited(c.env.RL_CHECKOUT, s.idHash);

async function saved(db: Db, customerId: string, operatorId: string) {
  return db
    .select({
      id: participants.id,
      name: participants.name,
      birthDate: participants.birthDate,
      weightKg: participants.weightKg,
      certs: participants.certs,
      waiverSignedAt: waivers.signedAt,
    })
    .from(participants)
    .leftJoin(
      waivers,
      and(
        eq(waivers.participantId, participants.id),
        eq(waivers.operatorId, operatorId),
        eq(waivers.version, WAIVER.version),
      ),
    )
    .where(eq(participants.customerId, customerId))
    .orderBy(participants.name);
}

// participant_ids only changes here while no Hold exists; after that holdStep moves it with the Hold.


export async function persistDraft(db: Db, checkout: Checkout, customerId: string, draft: DraftParticipant[]) {
  const existing = new Map(
    (await db.select().from(participants).where(eq(participants.customerId, customerId))).map((p) => [
      participantKey(p.name, p.birthDate),
      p,
    ]),
  );
  const statements = [];
  const ids: string[] = [];
  for (const d of draft) {
    const match = existing.get(participantKey(d.name, d.birthDate));
    const id = match?.id ?? crypto.randomUUID();
    ids.push(id);
    if (match) {
      const patch = { ...(d.weightKg !== null ? { weightKg: d.weightKg } : {}), ...(d.certs.length ? { certs: d.certs } : {}) };
      if (Object.keys(patch).length) statements.push(db.update(participants).set(patch).where(eq(participants.id, id)));
    } else {
      statements.push(
        db.insert(participants).values({ id, customerId, name: d.name, birthDate: d.birthDate, weightKg: d.weightKg, certs: d.certs }),
      );
    }
    if (d.waiver) {
      const w = {
        signerName: d.waiver.signerName,
        signedAt: d.waiver.signedAt,
        version: WAIVER.version,
        locale: checkout.locale,
        guardian: d.waiver.guardian,
        signerCustomerId: customerId,
        textSha256: d.waiver.textSha256,
      };
      statements.push(
        db
          .insert(waivers)
          .values({ participantId: id, operatorId: checkout.operatorId, ...w })
          .onConflictDoUpdate({ target: [waivers.participantId, waivers.operatorId], set: w }),
      );
    }
  }
  statements.push(
    db
      .update(checkouts)
      .set({ customerId, ...(checkout.holdId ? {} : { participantIds: ids }), draft: null, updatedAt: Date.now() })
      .where(eq(checkouts.id, checkout.id)),
  );
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return ids;
}

async function releaseBill(env: Env, holdId: string) {
  const db = createDb(env.DB);
  const [bill] = await db
    .select({ id: bills.id })
    .from(bills)
    .where(and(eq(bills.holdId, holdId), isNull(bills.paidAt), isNull(bills.deletedAt)));
  if (bill && (await deleteBill(env, bill.id))) {
    await db.update(bills).set({ deletedAt: Date.now() }).where(eq(bills.id, bill.id));
  }
}

export async function holdStep(
  env: Env,
  waitUntil: WaitUntil,
  checkoutId: string,
  participantIds?: string[],
): Promise<string | null> {
  const db = createDb(env.DB);
  const [c] = await db
    .update(checkouts)
    .set({ holdSeq: sql`${checkouts.holdSeq} + 1`, updatedAt: Date.now() })
    .where(eq(checkouts.id, checkoutId))
    .returning();
  const people = participantIds ?? c.participantIds;
  if (!c.customerId || !people) return "invalid_state";
  if (c.holdSeq > MAX_HOLDS_PER_CHECKOUT) return "too_many_holds";
  const [activity] = await db.select({ published: activities.published }).from(activities).where(eq(activities.id, c.activityId));
  if (!activity?.published && env.BOOK_DRAFTS !== "1") return "not_bookable";
  let released: string[];
  try {
    const h = await booking(env, c.operatorId).createHold({
      requestId: `${c.id}:${c.holdSeq}`,
      customerId: c.customerId,
      replaces: c.holdId,
      timeslotId: c.timeslotId,
      participantIds: people,
      addOns: c.addOns.map(({ id, qty }) => ({ id, qty })),
    });
    const now = Date.now();
    const others = h.released.filter((id) => id !== c.holdId);
    await db.batch([
      db
        .update(checkouts)
        .set({
          holdId: h.holdId,
          holdExpiresAt: h.expiresAt,
          amountSen: h.amountSen,
          addOns: h.addOns,
          participantIds: people,
          updatedAt: now,
        })
        .where(and(eq(checkouts.id, c.id), eq(checkouts.holdSeq, c.holdSeq))),
      db
        .update(checkouts)
        .set({ holdExpiresAt: now, updatedAt: now })
        .where(and(inArray(checkouts.holdId, others.length ? others : [""]), ne(checkouts.id, c.id))),
    ]);
    released = [...new Set([...h.released, ...(c.holdId ? [c.holdId] : [])])];
  } catch (e) {
    if (e instanceof BookingError) return e.code;
    throw e;
  }
  for (const holdId of released) {
    waitUntil(releaseBill(env, holdId).catch((e) => logError("bill_release_failed", { checkoutId, error: String(e) })));
  }
  return null;
}

export const holdReply = (c: Ctx, code: string | null) =>
  code ? fail(c, 409, { code }) : c.json({ next: "pay" as const });

type WhoInput = {
  name?: unknown;
  birthDate?: unknown;
  weightKg?: unknown;
  certs?: unknown;
  waiver?: { accepted?: unknown; guardian?: unknown; guardianName?: unknown };
};

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "1900-01-01";
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function validateWho(
  inputs: WhoInput[],
  d: OptionDetails,
  locale: Locale,
  alreadySigned: Set<string>,
): Promise<{ draft: DraftParticipant[]; errors: ApiError[] }> {
  const now = Date.now();
  const today = klDate(now);
  const slotDate = klDate(d.slot!.startsAt);
  const textSha256 = await sha256Hex(waiverText(locale, d.operatorName));
  const o = d.option;
  const errors: ApiError[] = [];
  const draft: DraftParticipant[] = [];
  const seen = new Set<string>();
  inputs.forEach((p, i) => {
    const at = (f: string) => `participants.${i}.${f}`;
    const name = text(p.name, 100);
    const label = { name, n: i + 1 };
    if (!name) errors.push({ code: "name_required", field: at("name"), params: { n: i + 1 } });
    if (!validDate(p.birthDate) || p.birthDate >= today) {
      errors.push({ code: "birth_date_invalid", field: at("birthDate"), params: label });
      return;
    }
    const birthDate = p.birthDate;
    const weight = o.asksWeight ? Number(p.weightKg) : null;
    if (weight !== null && !(Number.isInteger(weight) && weight > 0 && weight <= 300)) {
      errors.push({ code: "weight_invalid", field: at("weightKg"), params: label });
    }
    const certs = Array.isArray(p.certs) ? p.certs.filter((x) => typeof x === "string").slice(0, 5).map((x) => text(x, 50)) : [];
    const age = ageOn(birthDate, slotDate);
    const rule =
      o.minAge !== null && age < o.minAge
        ? { rule: "min_age", value: o.minAge, f: "birthDate" }
        : o.maxAge !== null && age > o.maxAge
          ? { rule: "max_age", value: o.maxAge, f: "birthDate" }
          : o.maxWeightKg !== null && weight !== null && weight > o.maxWeightKg
            ? { rule: "max_weight", value: o.maxWeightKg, f: "weightKg" }
            : o.requiredCert !== null && !certs.includes(o.requiredCert)
              ? { rule: "cert", value: o.requiredCert, f: "certs" }
              : null;
    if (rule) {
      errors.push({ code: "requirement_not_met", field: at(rule.f), params: { ...label, rule: rule.rule, value: rule.value } });
    }
    const key = participantKey(name, birthDate);
    if (seen.has(key)) errors.push({ code: "invalid_participant", field: at("name"), params: label });
    seen.add(key);

    let waiver: DraftParticipant["waiver"] = null;
    if (!alreadySigned.has(key)) {
      const minor = ageOn(birthDate, today) < 18;
      const guardianName = text(p.waiver?.guardianName, 100);
      if (p.waiver?.accepted !== true || (p.waiver.guardian === true) !== minor) {
        errors.push({ code: "waiver_missing", field: at("waiver"), params: label });
      } else if (minor && !guardianName) {
        errors.push({ code: "waiver_missing", field: at("guardianName"), params: label });
      } else {
        waiver = { guardian: minor, signerName: minor ? guardianName : name, textSha256, signedAt: now };
      }
    }
    draft.push({ name, birthDate, weightKg: weight, certs, waiver });
  });
  return { draft, errors };
}

export const checkout = new Hono<{ Bindings: Env }>();

checkout.post("/", async (c) => {
  const existing = await readSession(c);
  if (await limited(c.env.RL_CHECKOUT, existing?.idHash ?? `ip:${c.req.header("x-client-ip") ?? ""}`)) {
    return fail(c, 429, { code: "rate_limited" });
  }
  const body = await c.req.json<{ optionId?: unknown; timeslotId?: unknown; quantity?: unknown; addOns?: unknown; locale?: unknown }>();
  const db = createDb(c.env.DB);
  const picks: AddOnPick[] = (Array.isArray(body.addOns) ? body.addOns : [])
    .map((a: { id?: unknown; qty?: unknown }) => ({ id: String(a?.id ?? ""), qty: Number(a?.qty) }))
    .filter((a) => a.qty !== 0);
  const d = await optionDetails(
    db,
    String(body.optionId ?? ""),
    String(body.timeslotId ?? ""),
    picks.map((a) => a.id),
  );
  const now = Date.now();
  if (
    !d ||
    !d.slot ||
    d.slot.optionId !== d.option.id ||
    !d.option.active ||
    d.slot.closedAt !== null ||
    d.slot.startsAt - (d.bookingCutoffMinutes ?? 0) * MIN <= now ||
    (!d.activity.published && c.env.BOOK_DRAFTS !== "1")
  ) {
    return fail(c, 409, { code: "not_bookable" });
  }
  const quantity = Number(body.quantity);
  const min = d.option.minParticipants ?? 1;
  if (!Number.isInteger(quantity) || quantity < min) {
    return fail(c, 400, { code: "below_min_participants", field: "quantity", params: { min } });
  }
  if (quantity > MAX_PEOPLE) return fail(c, 400, { code: "invalid_participant", field: "quantity", params: { max: MAX_PEOPLE } });
  if (quantity > d.slot.spots) return fail(c, 409, { code: "no_availability", params: { spots: d.slot.spots } });
  const addOnOf = new Map(d.addOns.map((a) => [a.id, a]));
  if (
    new Set(picks.map((a) => a.id)).size !== picks.length ||
    picks.some((a) => {
      const x = addOnOf.get(a.id);
      return !x || !x.active || x.activityId !== d.option.activityId || !Number.isInteger(a.qty) || a.qty < 1 || a.qty > quantity;
    })
  ) {
    return fail(c, 400, { code: "invalid_add_on", field: "addOns" });
  }
  const session = existing ?? (await ensureSession(c));
  const id = crypto.randomUUID();
  await db.insert(checkouts).values({
    id,
    sessionId: session.idHash,
    customerId: session.customerId,
    operatorId: d.option.operatorId,
    activityId: d.option.activityId,
    optionId: d.option.id,
    timeslotId: d.slot.id,
    quantity,
    addOns: picks,
    locale: body.locale === "ms" ? "ms" : "en",
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ id }, 201);
});

checkout.get("/:id", async (c) => {
  const owned = await ownedCheckout(c, c.req.param("id"));
  if (!owned) return fail(c, 404, { code: "not_found" });
  const { checkout: co, session } = owned;
  const db = createDb(c.env.DB);
  const d = await optionDetails(
    db,
    co.optionId,
    co.timeslotId,
    co.addOns.map((a) => a.id),
  );
  if (!d) return fail(c, 404, { code: "not_found" });
  const customerId = session.customerId;
  const [customer] = customerId
    ? await db.select({ name: customers.name, email: customers.email }).from(customers).where(eq(customers.id, customerId))
    : [];
  const [lastPhone] =
    customerId && !co.contactPhone
      ? await db
          .select({ phone: checkouts.contactPhone })
          .from(checkouts)
          .where(and(eq(checkouts.customerId, customerId), isNotNull(checkouts.contactPhone)))
          .orderBy(desc(checkouts.createdAt))
          .limit(1)
      : [];
  const savedPeople = customerId ? await saved(db, customerId, co.operatorId) : [];
  const addOnOf = new Map(d.addOns.map((a) => [a.id, a]));
  const addOns = co.addOns.map((a) => {
    const x = addOnOf.get(a.id)!;
    return { id: a.id, qty: a.qty, nameEn: x.nameEn, nameMs: x.nameMs, priceSen: a.priceSen ?? x.priceSen };
  });
  const savedOf = new Map(savedPeople.map((p) => [p.id, p]));
  const people = (co.participantIds ?? []).flatMap((id) => savedOf.get(id) ?? []);
  const [refund] = co.refundReason
    ? await db
        .select({ sen: bills.paidAmountSen })
        .from(bills)
        .where(and(eq(bills.checkoutId, co.id), eq(bills.holdId, co.holdId ?? "")))
    : [];
  return c.json({
    id: co.id,
    state: checkoutState(co),
    locale: co.locale,
    quantity: co.quantity,
    startsAt: d.slot?.startsAt ?? null,
    timeslotId: co.timeslotId,
    option: {
      id: d.option.id,
      nameEn: d.option.nameEn,
      nameMs: d.option.nameMs,
      priceSen: d.option.priceSen,
      durationMinutes: d.option.durationMinutes,
      minAge: d.option.minAge,
      maxAge: d.option.maxAge,
      maxWeightKg: d.option.maxWeightKg,
      requiredCert: d.option.requiredCert,
      minParticipants: d.option.minParticipants,
      asksWeight: d.option.asksWeight,
    },
    activity: { ...d.activity, city: d.city, category: d.category },
    operatorName: d.operatorName,
    freeCancelHours: d.freeCancelHours,
    waiver: { version: WAIVER.version, text: waiverText(co.locale, d.operatorName) },
    addOns,
    estimatedSen: d.option.priceSen * co.quantity + addOns.reduce((s, a) => s + a.qty * a.priceSen, 0),
    amountSen: co.amountSen,
    holdExpiresAt: co.holdExpiresAt,
    signedIn: !!customerId,
    contact: {
      name: co.contactName ?? customer?.name ?? null,
      email: customer?.email ?? co.contactEmail,
      phone: co.contactPhone ?? lastPhone?.phone ?? null,
    },
    draft: co.draft?.map(({ waiver, ...p }) => ({
      ...p,
      waiver: waiver ? { guardian: waiver.guardian, signerName: waiver.signerName } : null,
    })),
    participants: people.map((p) => ({ id: p.id, name: p.name, birthDate: p.birthDate })),
    savedParticipants: savedPeople,
    bookingId: co.bookingId,
    ...(co.bookingId ? { k: await bookingLink(c.env, co.bookingId) } : {}),
    refundReason: co.refundReason,
    refundSen: refund?.sen ?? co.amountSen,
  });
});

checkout.put("/:id/who", async (c) => {
  const owned = await ownedCheckout(c, c.req.param("id"));
  if (!owned) return fail(c, 404, { code: "not_found" });
  const { checkout: co, session } = owned;
  if (await busy(c, session)) return fail(c, 429, { code: "rate_limited" });
  if (co.bookingId || co.refundReason) return fail(c, 409, { code: "invalid_state" });
  const body = await c.req.json<{ participants?: unknown }>();
  const inputs = Array.isArray(body.participants) ? (body.participants as WhoInput[]) : [];
  if (inputs.length !== co.quantity) return fail(c, 400, { code: "invalid_participant", field: "participants" });
  const db = createDb(c.env.DB);
  const d = await optionDetails(db, co.optionId, co.timeslotId, []);
  if (!d?.slot) return fail(c, 409, { code: "not_bookable" });
  const alreadySigned = new Set(
    session.customerId
      ? (await saved(db, session.customerId, co.operatorId))
          .filter((p) => p.waiverSignedAt !== null)
          .map((p) => participantKey(p.name, p.birthDate))
      : [],
  );
  const { draft, errors } = await validateWho(inputs, d, co.locale, alreadySigned);
  if (errors.length) return fail(c, 400, errors[0], errors);
  if (!session.customerId) {
    await db.update(checkouts).set({ draft, updatedAt: Date.now() }).where(eq(checkouts.id, co.id));
    return c.json({ next: "contact" as const });
  }
  const ids = await persistDraft(db, co, session.customerId, draft);
  return holdReply(c, await holdStep(c.env, (p) => c.executionCtx.waitUntil(p), co.id, ids));
});

checkout.post("/:id/hold", async (c) => {
  const owned = await ownedCheckout(c, c.req.param("id"));
  if (!owned) return fail(c, 404, { code: "not_found" });
  if (await busy(c, owned.session)) return fail(c, 429, { code: "rate_limited" });
  if (owned.checkout.bookingId || owned.checkout.refundReason) return fail(c, 409, { code: "invalid_state" });
  return holdReply(c, await holdStep(c.env, (p) => c.executionCtx.waitUntil(p), owned.checkout.id));
});

checkout.post("/:id/pay", async (c) => {
  const owned = await ownedCheckout(c, c.req.param("id"));
  if (!owned) return fail(c, 404, { code: "not_found" });
  const { checkout: co, session } = owned;
  if (await busy(c, session)) return fail(c, 429, { code: "rate_limited" });
  if (co.bookingId || co.refundReason) return fail(c, 409, { code: "invalid_state" });
  if (!co.holdId || !co.amountSen || !co.customerId || co.holdExpiresAt! <= Date.now() + PAY_MARGIN) {
    return fail(c, 409, { code: "hold_expired" });
  }
  const db = createDb(c.env.DB);
  const winner = () =>
    db
      .select({ url: bills.url })
      .from(bills)
      .where(and(eq(bills.holdId, co.holdId!), isNull(bills.deletedAt)));
  const [existing] = await winner();
  if (existing) return c.json({ url: existing.url });

  const [[customer], d] = await Promise.all([
    db.select({ name: customers.name, email: customers.email }).from(customers).where(eq(customers.id, co.customerId)),
    optionDetails(db, co.optionId, co.timeslotId, []),
  ]);
  if (!customer?.email || !d?.slot) return fail(c, 409, { code: "invalid_state" });
  const l = co.locale;
  let bill;
  try {
    bill = await createBill(c.env, {
      collection_id: c.env.BILLPLZ_COLLECTION_ID,
      email: customer.email,
      name: (co.contactName ?? customer.name).slice(0, 255),
      amount: String(co.amountSen),
      description: `Komugo · ${named(d.activity, l)} – ${named(d.option, l)}, ${klDay(d.slot.startsAt, l)}`.slice(0, 200),
      callback_url: `${c.env.PUBLIC_SITE_URL}/billplz/callback`,
      redirect_url: `${c.env.PUBLIC_SITE_URL}${l === "ms" ? "/ms" : ""}/checkout/return`,
      reference_1_label: "Checkout",
      reference_1: co.id,
      deliver: "false",
    });
  } catch (e) {
    logError("billplz_create_failed", { checkoutId: co.id, error: String(e) });
    return fail(c, 502, { code: "payment_unavailable" });
  }
  const inserted = await db
    .insert(bills)
    .values({
      id: bill.id,
      checkoutId: co.id,
      holdId: co.holdId,
      amountSen: co.amountSen,
      url: bill.url,
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: bills.holdId })
    .returning({ url: bills.url });
  if (inserted.length) return c.json({ url: inserted[0].url });
  c.executionCtx.waitUntil(deleteBill(c.env, bill.id).catch(() => false));
  const [won] = await winner();
  return won ? c.json({ url: won.url }) : fail(c, 409, { code: "hold_expired" });
});
