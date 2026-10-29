import { booking } from "@komugo/booking";
import { activities, categories, checkouts, cities, createDb, customers, members, operators, packOrders, participants, projTimeslots, venues, venueSlugs, waivers } from "@komugo/db";
import { eq } from "drizzle-orm";
import { WAIVER } from "@komugo/types";
import { DAY, HOUR, MIN, type WaitUntil } from "../lib";
import { groupLink } from "../manage";
import { recordClosure } from "../ops/closure";
import { ticketCode } from "../ops/enrich";

// An isolated Operator with one booked Timeslot (today, or 3 days ahead inWindow), so each e2e test owns its data.
// viaPack books it with a Pack instead of paying.
export async function fixture(
  env: Env,
  waitUntil: WaitUntil,
  o: {
    locale?: unknown;
    staff?: unknown;
    inWindow?: unknown;
    packOffer?: unknown;
    packSessions?: unknown;
    packValidDays?: unknown;
    viaPack?: unknown;
    extraSlots?: unknown;
    close?: unknown;
    info?: unknown;
  },
) {
  const db = createDb(env.DB);
  const rid = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const operatorId = `op_${rid}`;
  const activityId = `act_${rid}`;
  const email = `ops+${rid}@example.com`;
  const staffEmail = o.staff === true ? `staff+${rid}@example.com` : undefined;
  const locale = o.locale === "ms" ? "ms" : "en";
  const hub = { slugEn: `fx-${rid}`, slugMs: `fx-${rid}-ms`, nameEn: "Fixture", nameMs: "Fixture" };
  const [city] = await db.insert(cities).values(hub).returning();
  const [category] = await db.insert(categories).values(hub).returning();
  await db.batch([
    db.insert(operators).values({ id: operatorId, name: `Fixture Stable ${rid}`, signedUp: true }),
    db.insert(activities).values({
      ...hub,
      id: activityId,
      operatorId,
      cityId: city.id,
      categoryId: category.id,
      nameEn: "Trail Riding",
      nameMs: "Tunggang Denai",
      descriptionEn: "Fixture",
      descriptionMs: "Fixture",
    }),
    db.insert(members).values({ email, name: "Fixture Operator", role: "operator", operatorId }),
    ...(staffEmail ? [db.insert(members).values({ email: staffEmail, name: "Fixture Staff", role: "staff" })] : []),
  ]);

  const b = booking(env, operatorId);
  await b.upsertActivity({ id: activityId, freeCancelHours: 24, bookingCutoffMinutes: 0, closedDays: ["Mo#1", "Mo#3"] });
  await b.upsertResource({ id: `res_${rid}_bayu`, kind: "horse", name: "Bayu", active: true, maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 90 });
  await b.upsertResource({ id: `res_${rid}_kilat`, kind: "horse", name: "Kilat", active: true, maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: null });
  const optionId = `opt_${rid}`;
  await b.upsertOption({
    id: optionId,
    activityId,
    nameEn: "Trail ride",
    nameMs: "Tunggang denai",
    priceSen: 8000,
    durationMinutes: 60,
    minAge: null,
    maxAge: null,
    maxWeightKg: 90,
    requiredCert: null,
    minParticipants: null,
    maxPerBooking: null,
    active: true,
    needs: [{ kind: "horse", quantity: 1 }],
  });
  const helmetId = `addon_${rid}_helmet`;
  await b.upsertAddOn({ id: helmetId, activityId, nameEn: "Helmet", nameMs: "Topi keledar", priceSen: 500, active: true });
  const klMidnight = Math.floor((now + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
  const minute = Math.floor(now / MIN) * MIN;
  const {
    ids: [timeslotId],
  } = await b.createTimeslots({
    optionId,
    startsAt: [o.inWindow === true ? minute + 3 * DAY : Math.min(now + 2 * HOUR, klMidnight + DAY - 5 * MIN)],
  });
  const extra = Number.isInteger(o.extraSlots) ? Math.min(o.extraSlots as number, 3) : 0;
  const { ids: extraSlotIds } = extra
    ? await b.createTimeslots({ optionId, startsAt: Array.from({ length: extra }, (_, i) => minute + (i + 1) * DAY + HOUR) })
    : { ids: [] };
  const offerId = `po_${rid}`;
  const viaPack = o.viaPack === true;
  if (o.packOffer === true || viaPack) {
    await b.upsertPackOffer({
      id: offerId,
      activityId,
      nameEn: "4 rides",
      nameMs: "4 tunggangan",
      sessions: Number.isInteger(o.packSessions) ? (o.packSessions as number) : 4,
      priceSen: 25000,
      validDays: Number.isInteger(o.packValidDays) ? (o.packValidDays as number) : 30,
      optionIds: [optionId],
      active: true,
    });
  }

  const [customer] = await db
    .insert(customers)
    .values({ name: "Aisyah Rahman", email: `cust+${rid}@example.com`, emailVerifiedAt: now, createdAt: now })
    .returning();
  const people = await db
    .insert(participants)
    .values([
      { customerId: customer.id, name: "Aisyah Rahman", birthDate: "1990-05-01", weightKg: 62 },
      { customerId: customer.id, name: "Adam Rahman", birthDate: "2015-03-01", weightKg: 30 },
    ])
    .returning();
  await db.insert(waivers).values(
    people.map((p, i) => ({
      participantId: p.id,
      operatorId,
      signerName: "Aisyah Rahman",
      version: WAIVER.version,
      locale,
      guardian: i === 1,
      signerCustomerId: customer.id,
    })),
  );
  const participantIds = people.map((p) => p.id);
  const hold = await b.createHold({
    requestId: `fixture:${rid}`,
    customerId: customer.id,
    replaces: null,
    timeslotId,
    participantIds,
    addOns: viaPack ? [] : [{ id: helmetId, qty: 1 }],
  });
  let group: { kind: "booking" | "pack"; id: string; ticketIds: string[] };
  if (viaPack) {
    const orderId = `order_${rid}`;
    const { amountSen } = await b.orderPack({ orderId, customerId: customer.id, offerId });
    const issued = await b.confirmPackBill({ billId: `dev_pack_${rid}`, orderId, amountSen });
    if (issued.status !== "paid") throw new Error(`fixture_pack_not_paid:${issued.reason}`);
    await db.insert(packOrders).values({ id: orderId, customerId: customer.id, operatorId, offerId, amountSen, locale, packId: issued.packId, emailedAt: now, createdAt: now });
    const { ticketIds } = await b.redeemPack({ requestId: `fixture:${rid}:redeem`, customerId: customer.id, packId: issued.packId, holdId: hold.holdId });
    group = { kind: "pack", id: issued.packId, ticketIds };
  } else {
    const paid = await b.confirmHold({ billId: `dev_${rid}`, holdId: hold.holdId, amountSen: hold.amountSen });
    if (paid.status !== "paid") throw new Error(`fixture_not_paid:${paid.reason}`);
    group = { kind: "booking", id: paid.bookingId, ticketIds: paid.ticketIds };
  }
  await db.insert(checkouts).values({
    sessionId: `fixture:${rid}`,
    customerId: customer.id,
    operatorId,
    activityId,
    optionId,
    timeslotId,
    quantity: 2,
    addOns: hold.addOns,
    participantIds,
    contactName: "Aisyah Rahman",
    contactEmail: customer.email,
    contactPhone: "+60123456789",
    locale,
    holdId: hold.holdId,
    amountSen: hold.amountSen,
    ...(group.kind === "booking" ? { bookingId: group.id } : { packId: group.id }),
    emailedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (o.close === true) {
    // The Closure email reads proj_timeslots, which the outbox drains a moment after the write.
    const projected = async () => (await db.select({ id: projTimeslots.id }).from(projTimeslots).where(eq(projTimeslots.id, timeslotId))).length > 0;
    for (let i = 0; i < 50 && !(await projected()); i++) await new Promise((r) => setTimeout(r, 100));
    await recordClosure(env, waitUntil, operatorId, timeslotId, "weather");
  }
  let venueSlug: string | undefined;
  if (o.info === true) {
    const names = { nameEn: "Kompleks Sukan Presint 9", nameMs: "Kompleks Sukan Presint 9" };
    const slugs = await venueSlugs(db, city.id, names);
    const [venue] = await db.insert(venues).values({ cityId: city.id, ...names, slugEn: slugs.en, slugMs: slugs.ms, presint: 9 }).returning();
    venueSlug = slugs.en;
    await db.update(activities).set({ venueId: venue.id, listingMode: "info" }).where(eq(activities.id, activityId));
  }
  return {
    operatorId,
    activityId,
    optionId,
    timeslotId,
    extraSlotIds,
    ticketIds: group.ticketIds,
    codes: group.ticketIds.map(ticketCode),
    ...(group.kind === "booking" ? { bookingId: group.id } : { packId: group.id }),
    k: await groupLink(env, group.kind, group.id),
    customerEmail: customer.email!,
    activityPath: `/${hub.slugEn}/${hub.slugEn}/${hub.slugEn}`,
    venueSlug,
    email,
    ...(staffEmail ? { staffEmail } : {}),
    ...(o.packOffer === true || viaPack ? { offerId } : {}),
  };
}
