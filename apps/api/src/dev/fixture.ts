import { booking } from "@komugo/booking";
import { activities, categories, checkouts, cities, createDb, customers, members, operators, participants, waivers } from "@komugo/db";
import { WAIVER } from "@komugo/types";
import { DAY, HOUR, MIN } from "../lib";
import { ticketCode } from "../ops/enrich";

// An isolated Operator with one booked Timeslot today, so each e2e test owns its data.
export async function fixture(env: Env, o: { locale?: unknown; staff?: unknown }) {
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
    db.insert(operators).values({ id: operatorId, name: `Fixture Stable ${rid}` }),
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
    active: true,
    needs: [{ kind: "horse", quantity: 1 }],
  });
  const helmetId = `addon_${rid}_helmet`;
  await b.upsertAddOn({ id: helmetId, activityId, nameEn: "Helmet", nameMs: "Topi keledar", priceSen: 500, active: true });
  const klMidnight = Math.floor((now + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
  const {
    ids: [timeslotId],
  } = await b.createTimeslots({ optionId, startsAt: [Math.min(now + 2 * HOUR, klMidnight + DAY - 5 * MIN)] });

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
    addOns: [{ id: helmetId, qty: 1 }],
  });
  const paid = await b.confirmHold({ billId: `dev_${rid}`, holdId: hold.holdId, amountSen: hold.amountSen });
  if (paid.status !== "paid") throw new Error(`fixture_not_paid:${paid.reason}`);
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
    bookingId: paid.bookingId,
    emailedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return {
    operatorId,
    activityId,
    optionId,
    timeslotId,
    ticketIds: paid.ticketIds,
    codes: paid.ticketIds.map(ticketCode),
    email,
    ...(staffEmail ? { staffEmail } : {}),
  };
}
