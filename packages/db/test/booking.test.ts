import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  activities,
  allocations,
  cancelTicket,
  categories,
  cities,
  closeTimeslot,
  confirmHold,
  createHold,
  customers,
  holds,
  operators,
  optionResources,
  options,
  packs,
  participants,
  redeemPack,
  rescheduleTicket,
  resources,
  tickets,
  timeslots,
  waivers,
} from "../src";
import * as schema from "../src/schema";

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 25, onnotice: () => {} });
const db = drizzle(client, { schema, casing: "snake_case" });

afterAll(() => client.end());
beforeEach(async () => {
  await db.execute(sql`truncate operators, cities, categories, customers cascade`);
});

const kl = (local: string) => new Date(`${local}+08:00`);
const DAY = "2030-01-15";

async function operator(freeCancelHours = 24) {
  const s = randomUUID();
  const [op] = await db.insert(operators).values({ name: "Stable" }).returning();
  const hub = { slugEn: s, slugMs: `${s}-ms`, nameEn: "x", nameMs: "x" };
  const [city] = await db.insert(cities).values(hub).returning();
  const [category] = await db.insert(categories).values(hub).returning();
  const [activity] = await db
    .insert(activities)
    .values({
      ...hub,
      operatorId: op.id,
      cityId: city.id,
      categoryId: category.id,
      descriptionEn: "x",
      descriptionMs: "x",
      freeCancelHours,
    })
    .returning();
  return { operatorId: op.id, activityId: activity.id };
}

async function option(
  activityId: string,
  o: Partial<typeof options.$inferInsert> = {},
  needs: [(typeof resources.$inferInsert)["kind"], number][] = [["horse", 1]],
) {
  const [row] = await db
    .insert(options)
    .values({ activityId, nameEn: "Ride", nameMs: "Tunggang", priceSen: 10000, durationMinutes: 60, ...o })
    .returning();
  if (needs.length) {
    await db.insert(optionResources).values(needs.map(([kind, quantity]) => ({ optionId: row.id, kind, quantity })));
  }
  return row.id;
}

async function resource(operatorId: string, r: Partial<typeof resources.$inferInsert> = {}) {
  const [row] = await db
    .insert(resources)
    .values({ operatorId, kind: "horse", name: "Bella", ...r })
    .returning();
  return row.id;
}

async function slot(optionId: string, startsAt: Date) {
  const [row] = await db.insert(timeslots).values({ optionId, startsAt }).returning();
  return row.id;
}

async function customer() {
  const [row] = await db.insert(customers).values({ name: "Aiman", email: `${randomUUID()}@x.my` }).returning();
  return row.id;
}

async function participant(
  customerId: string,
  operatorId: string | null,
  p: Partial<typeof participants.$inferInsert> = {},
) {
  const [row] = await db
    .insert(participants)
    .values({ customerId, name: "Aisyah", birthDate: "1990-01-01", weightKg: 60, ...p })
    .returning();
  if (operatorId) await db.insert(waivers).values({ participantId: row.id, operatorId, signerName: "Aiman" });
  return row.id;
}

async function rideWorld(horse: Partial<typeof resources.$inferInsert> = {}) {
  const { operatorId, activityId } = await operator();
  const optionId = await option(activityId);
  const horseId = await resource(operatorId, horse);
  const customerId = await customer();
  return { operatorId, activityId, optionId, horseId, customerId };
}

const hold = (customerId: string, timeslotId: string, participantIds: string[]) =>
  createHold(db, { customerId, timeslotId, participantIds });

async function book(customerId: string, timeslotId: string, participantIds: string[]) {
  const { holdId } = await hold(customerId, timeslotId, participantIds);
  return confirmHold(db, holdId);
}

const codes = (results: PromiseSettledResult<unknown>[]) =>
  results.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code ?? String(r.reason)));

const allocationCount = async () => (await db.select().from(allocations)).length;

async function waitForLockWaiters(n: number) {
  for (;;) {
    const [{ waiting }] = await client`select count(*)::int as waiting from pg_locks where not granted`;
    if (waiting >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("concurrency", () => {
  test("20 concurrent holds on the last free horse: exactly one wins", async () => {
    const w = await rideWorld();
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const people = await Promise.all(Array.from({ length: 20 }, () => participant(w.customerId, w.operatorId)));
    const results = await Promise.allSettled(people.map((p) => hold(w.customerId, ts, [p])));
    const c = codes(results);
    expect(c.filter((x) => x === "ok")).toHaveLength(1);
    expect(c.filter((x) => x === "no_availability")).toHaveLength(19);
    expect(await allocationCount()).toBe(1);
  });

  test("day cap holds under 10 concurrent holds on separate slots", async () => {
    const w = await rideWorld({ maxSessionsPerDay: 2 });
    const p = await participant(w.customerId, w.operatorId);
    await book(w.customerId, await slot(w.optionId, kl(`${DAY}T07:00`)), [p]);
    const slots = await Promise.all(
      Array.from({ length: 10 }, (_, i) => slot(w.optionId, kl(`${DAY}T${String(8 + i).padStart(2, "0")}:00`))),
    );
    const people = await Promise.all(slots.map(() => participant(w.customerId, w.operatorId)));
    const results = await Promise.allSettled(slots.map((ts, i) => hold(w.customerId, ts, [people[i]])));
    expect(codes(results).filter((x) => x === "ok")).toHaveLength(1);
    expect(await allocationCount()).toBe(2);
  });

  test("a Pack session cannot be double-redeemed concurrently", async () => {
    const w = await rideWorld();
    for (let i = 0; i < 4; i++) await resource(w.operatorId);
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const [pack] = await db
      .insert(packs)
      .values({ customerId: w.customerId, operatorId: w.operatorId, sessionsTotal: 1, expiresAt: kl("2030-12-31T00:00") })
      .returning();
    const people = await Promise.all(Array.from({ length: 5 }, () => participant(w.customerId, w.operatorId)));
    const results = await Promise.allSettled(
      people.map((p) => redeemPack(db, { packId: pack.id, timeslotId: ts, participantIds: [p] })),
    );
    const c = codes(results);
    expect(c.filter((x) => x === "ok")).toHaveLength(1);
    expect(c.filter((x) => x === "pack_unavailable")).toHaveLength(4);
  });

  test("confirm racing a Closure never leaves allocations on the closed slot", async () => {
    const w = await rideWorld();
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const { holdId } = await hold(w.customerId, ts, [await participant(w.customerId, w.operatorId)]);
    const blocker = await client.reserve();
    await blocker`begin`;
    await blocker`select 1 from holds where id = ${holdId} for update`;
    const confirm = confirmHold(db, holdId);
    await waitForLockWaiters(1);
    const closure = closeTimeslot(db, ts);
    await waitForLockWaiters(2);
    await blocker`rollback`;
    blocker.release();
    await Promise.all([confirm, closure]);
    expect(await allocationCount()).toBe(0);
  });

  test("cancel racing a Reschedule applies the Cancellation Policy of the new Timeslot", async () => {
    const w = await rideWorld();
    const closed = await slot(w.optionId, kl(`${DAY}T09:00`));
    const soon = await slot(w.optionId, new Date(Date.now() + 3600_000));
    const {
      ticketIds: [ticketId],
    } = await book(w.customerId, closed, [await participant(w.customerId, w.operatorId)]);
    await closeTimeslot(db, closed);
    const reschedule = await client.reserve();
    await reschedule`begin`;
    await reschedule`select 1 from tickets where id = ${ticketId} for update`;
    await reschedule`update tickets set timeslot_id = ${soon} where id = ${ticketId}`;
    const cancel = cancelTicket(db, ticketId);
    await waitForLockWaiters(1);
    await reschedule`commit`;
    reschedule.release();
    expect(await cancel).toEqual({ status: "forfeited" });
  });

  test("concurrent confirms of one Hold return the same Booking", async () => {
    const w = await rideWorld();
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const { holdId } = await hold(w.customerId, ts, [await participant(w.customerId, w.operatorId)]);
    const [a, b] = await Promise.all([confirmHold(db, holdId), confirmHold(db, holdId)]);
    expect(a).toEqual(b);
    expect(await confirmHold(db, holdId)).toEqual(a);
    expect(await db.select().from(tickets)).toHaveLength(1);
  });
});

test("the exclusion constraint rejects an overlapping raw insert", async () => {
  const w = await rideWorld();
  const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
  const p = await participant(w.customerId, w.operatorId);
  const { holdId } = await hold(w.customerId, ts, [p]);
  await expect(
    db.insert(allocations).values({
      resourceId: w.horseId,
      holdId,
      participantId: p,
      block: `[${kl(`${DAY}T09:30`).toISOString()},${kl(`${DAY}T10:30`).toISOString()})`,
    }),
  ).rejects.toMatchObject({ cause: { code: "23P01" } });
});

describe("welfare rules", () => {
  test("rest gap blocks back-to-back use in both directions", async () => {
    const w = await rideWorld({ restMinutes: 30 });
    const p = await participant(w.customerId, w.operatorId);
    await book(w.customerId, await slot(w.optionId, kl(`${DAY}T09:00`)), [p]);
    for (const t of ["08:00", "10:00"]) {
      await expect(hold(w.customerId, await slot(w.optionId, kl(`${DAY}T${t}`)), [p])).rejects.toMatchObject({
        code: "no_availability",
      });
    }
    await hold(w.customerId, await slot(w.optionId, kl(`${DAY}T10:30`)), [p]);
  });

  test("max sessions/day counts the Kuala Lumpur day, not the UTC day", async () => {
    const w = await rideWorld({ maxSessionsPerDay: 1 });
    const p = await participant(w.customerId, w.operatorId);
    await book(w.customerId, await slot(w.optionId, kl(`${DAY}T08:00`)), [p]);
    await expect(hold(w.customerId, await slot(w.optionId, kl(`${DAY}T23:00`)), [p])).rejects.toMatchObject({
      code: "no_availability",
    });
    await hold(w.customerId, await slot(w.optionId, kl("2030-01-16T00:30")), [p]);
  });

  test("rider weight picks the tightest horse, heaviest rider first", async () => {
    const { operatorId, activityId } = await operator();
    const optionId = await option(activityId);
    const h80 = await resource(operatorId, { maxRiderWeightKg: 80 });
    const h100 = await resource(operatorId, { maxRiderWeightKg: 100 });
    const customerId = await customer();
    const heavy = await participant(customerId, operatorId, { weightKg: 90 });
    const tooHeavy = await participant(customerId, operatorId, { weightKg: 110 });
    const light = await participant(customerId, operatorId, { weightKg: 70 });
    const ts1 = await slot(optionId, kl(`${DAY}T09:00`));
    const ts2 = await slot(optionId, kl(`${DAY}T11:00`));

    await hold(customerId, ts1, [heavy]);
    const [a] = await db.select().from(allocations);
    expect(a.resourceId).toBe(h100);
    await expect(hold(customerId, ts2, [tooHeavy])).rejects.toMatchObject({ code: "no_availability" });

    await hold(customerId, ts2, [light, heavy]);
    const picked = await db.select().from(allocations).where(sql`lower(${allocations.block}) = ${kl(`${DAY}T11:00`).toISOString()}`);
    expect(Object.fromEntries(picked.map((r) => [r.participantId, r.resourceId]))).toEqual({
      [heavy]: h100,
      [light]: h80,
    });
  });
});

test("multi-resource Option is atomic when one Resource is busy", async () => {
  const { operatorId, activityId } = await operator();
  const lesson = await option(activityId, {}, [["horse", 1], ["instructor", 1]]);
  const instructorOnly = await option(activityId, {}, [["instructor", 1]]);
  await resource(operatorId);
  await resource(operatorId, { kind: "instructor", name: "Faiz" });
  const customerId = await customer();
  const p = await participant(customerId, operatorId);
  const q = await participant(customerId, operatorId);
  await hold(customerId, await slot(instructorOnly, kl(`${DAY}T09:00`)), [p]);
  await expect(hold(customerId, await slot(lesson, kl(`${DAY}T09:00`)), [q])).rejects.toMatchObject({
    code: "no_availability",
  });
  expect(await allocationCount()).toBe(1);
});

describe("holds", () => {
  test("a swept expired Hold releases its Resources and can no longer be confirmed", async () => {
    const w = await rideWorld();
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const old = await hold(w.customerId, ts, [await participant(w.customerId, w.operatorId)]);
    await db.update(holds).set({ expiresAt: sql`now() - interval '1 minute'` });
    await hold(w.customerId, ts, [await participant(w.customerId, w.operatorId)]);
    await expect(confirmHold(db, old.holdId)).rejects.toMatchObject({ code: "hold_gone" });
  });

  test("an expired Hold, or one whose Timeslot has started, cannot be confirmed even if not swept", async () => {
    const w = await rideWorld();
    await resource(w.operatorId);
    const p = await participant(w.customerId, w.operatorId);
    const expired = await hold(w.customerId, await slot(w.optionId, kl(`${DAY}T09:00`)), [p]);
    await db.update(holds).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(holds.id, expired.holdId));
    await expect(confirmHold(db, expired.holdId)).rejects.toMatchObject({ code: "hold_gone" });

    const ts = await slot(w.optionId, kl(`${DAY}T12:00`));
    const started = await hold(w.customerId, ts, [p]);
    await db.update(timeslots).set({ startsAt: sql`now() - interval '1 minute'` }).where(eq(timeslots.id, ts));
    await expect(confirmHold(db, started.holdId)).rejects.toMatchObject({ code: "hold_gone" });
    expect(await db.select().from(tickets)).toHaveLength(0);
  });

  test("confirm keeps the Hold price and moves allocations to the Tickets", async () => {
    const w = await rideWorld();
    await resource(w.operatorId);
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const people = [await participant(w.customerId, w.operatorId), await participant(w.customerId, w.operatorId)];
    const { holdId, amountSen } = await hold(w.customerId, ts, people);
    expect(amountSen).toBe(20000);
    await db.update(options).set({ priceSen: 99900 });
    const { ticketIds } = await confirmHold(db, holdId);
    expect(ticketIds).toHaveLength(2);
    const rows = await db
      .select({ price: tickets.priceSen, tp: tickets.participantId, ap: allocations.participantId, h: allocations.holdId })
      .from(tickets)
      .innerJoin(allocations, eq(allocations.ticketId, tickets.id));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ price: 10000, tp: r.ap, h: null });
    expect(await db.select().from(holds)).toHaveLength(0);
  });

  test("a Closure during a Hold makes confirm fail with hold_gone", async () => {
    const w = await rideWorld();
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const { holdId } = await hold(w.customerId, ts, [await participant(w.customerId, w.operatorId)]);
    await closeTimeslot(db, ts);
    await expect(confirmHold(db, holdId)).rejects.toMatchObject({ code: "hold_gone" });
    expect(await allocationCount()).toBe(0);
  });
});

describe("gating", () => {
  test("Requirements", async () => {
    const { operatorId, activityId } = await operator();
    const optionId = await option(activityId, { minAge: 12, maxWeightKg: 90, requiredCert: "level1" });
    await resource(operatorId);
    const customerId = await customer();
    const ts = await slot(optionId, kl(`${DAY}T09:00`));
    const ok = { certs: ["level1"] };
    const cases = [
      await participant(customerId, operatorId, { ...ok, birthDate: "2018-01-16" }),
      await participant(customerId, operatorId, { ...ok, weightKg: 95 }),
      await participant(customerId, operatorId, { ...ok, weightKg: null }),
      await participant(customerId, operatorId),
    ];
    for (const p of cases) {
      await expect(hold(customerId, ts, [p])).rejects.toMatchObject({ code: "requirement_not_met" });
    }
    await hold(customerId, ts, [await participant(customerId, operatorId, { ...ok, birthDate: "2018-01-15" })]);
  });

  test("unknown weight on an Option where every free horse has a weight cap is requirement_not_met", async () => {
    const w = await rideWorld({ maxRiderWeightKg: 100 });
    const p = await participant(w.customerId, w.operatorId, { weightKg: null });
    await expect(hold(w.customerId, await slot(w.optionId, kl(`${DAY}T09:00`)), [p])).rejects.toMatchObject({
      code: "requirement_not_met",
    });
  });

  test("Participants must be unique, the Customer's own, and not already on the Timeslot", async () => {
    const w = await rideWorld();
    await resource(w.operatorId);
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const p = await participant(w.customerId, w.operatorId);
    const stranger = await participant(await customer(), w.operatorId);
    for (const ids of [[p, p], [stranger], []]) {
      await expect(hold(w.customerId, ts, ids)).rejects.toMatchObject({ code: "invalid_participant" });
    }
    await hold(w.customerId, ts, [p]);
    await expect(hold(w.customerId, ts, [p])).rejects.toMatchObject({ code: "invalid_participant" });
  });

  test("Waiver is required before a Hold and at Pack redemption", async () => {
    const w = await rideWorld();
    const p = await participant(w.customerId, null);
    await expect(hold(w.customerId, await slot(w.optionId, kl(`${DAY}T09:00`)), [p])).rejects.toMatchObject({
      code: "waiver_missing",
    });
    expect(await db.select().from(holds)).toHaveLength(0);
    const [pack] = await db
      .insert(packs)
      .values({ customerId: w.customerId, operatorId: w.operatorId, sessionsTotal: 5, expiresAt: kl("2030-12-31T00:00") })
      .returning();
    await expect(
      redeemPack(db, { packId: pack.id, timeslotId: await slot(w.optionId, kl(`${DAY}T12:00`)), participantIds: [p] }),
    ).rejects.toMatchObject({ code: "waiver_missing" });
  });

  test("closed, past, and Resource-less Timeslots are not bookable", async () => {
    const w = await rideWorld();
    const p = await participant(w.customerId, w.operatorId);
    const closed = await slot(w.optionId, kl(`${DAY}T09:00`));
    await closeTimeslot(db, closed);
    const past = await slot(w.optionId, kl("2020-01-01T09:00"));
    const bare = await slot(await option(w.activityId, {}, []), kl(`${DAY}T09:00`));
    for (const ts of [closed, past, bare]) {
      await expect(hold(w.customerId, ts, [p])).rejects.toMatchObject({ code: "not_bookable" });
    }
  });
});

describe("Closure, cancel and Packs", () => {
  async function packWorld(expiresAt = kl("2030-12-31T00:00")) {
    const w = await rideWorld();
    const [pack] = await db
      .insert(packs)
      .values({ customerId: w.customerId, operatorId: w.operatorId, sessionsTotal: 2, expiresAt })
      .returning();
    const p = await participant(w.customerId, w.operatorId);
    const redeem = (timeslotId: string) => redeemPack(db, { packId: pack.id, timeslotId, participantIds: [p] });
    const used = async () =>
      (await db.select().from(tickets).where(sql`${tickets.packId} = ${pack.id} and ${tickets.status} <> 'cancelled'`))
        .length;
    return { ...w, pack, p, redeem, used };
  }

  test("Closure frees Resources; Refund returns the Pack session", async () => {
    const w = await packWorld();
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const {
      ticketIds: [ticketId],
    } = await w.redeem(ts);
    expect(await w.used()).toBe(1);
    await closeTimeslot(db, ts);
    expect(await allocationCount()).toBe(0);
    const other = await option(w.activityId);
    await hold(w.customerId, await slot(other, kl(`${DAY}T09:00`)), [await participant(w.customerId, w.operatorId)]);
    expect(await cancelTicket(db, ticketId)).toEqual({ status: "cancelled" });
    expect(await w.used()).toBe(0);
  });

  test("Reschedule only from a closed Timeslot, same Option, ignoring Pack expiry", async () => {
    const w = await packWorld(kl(`${DAY}T12:00`));
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const later = await slot(w.optionId, kl("2030-02-01T09:00"));
    const otherOption = await slot(await option(w.activityId), kl("2030-02-01T12:00"));
    const {
      ticketIds: [ticketId],
    } = await w.redeem(ts);
    await expect(rescheduleTicket(db, { ticketId, timeslotId: later })).rejects.toMatchObject({ code: "invalid_state" });
    await closeTimeslot(db, ts);
    await expect(rescheduleTicket(db, { ticketId, timeslotId: otherOption })).rejects.toMatchObject({
      code: "invalid_state",
    });
    await rescheduleTicket(db, { ticketId, timeslotId: later });
    const [t] = await db.select().from(tickets);
    expect(t).toMatchObject({ timeslotId: later, status: "issued" });
    const [a] = await db.select().from(allocations);
    expect(a.ticketId).toBe(ticketId);
    await expect(rescheduleTicket(db, { ticketId, timeslotId: later })).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("Cancellation Policy: in window cancelled, late forfeited and the Pack session stays used", async () => {
    const w = await packWorld();
    const p2 = await participant(w.customerId, w.operatorId);
    const early = await book(w.customerId, await slot(w.optionId, kl(`${DAY}T09:00`)), [p2]);
    expect(await cancelTicket(db, early.ticketIds[0])).toEqual({ status: "cancelled" });
    await expect(cancelTicket(db, early.ticketIds[0])).rejects.toMatchObject({ code: "invalid_state" });

    const soon = await slot(w.optionId, new Date(Date.now() + 3600_000));
    const {
      ticketIds: [late],
    } = await w.redeem(soon);
    expect(await cancelTicket(db, late)).toEqual({ status: "forfeited" });
    expect(await w.used()).toBe(1);
    expect(await allocationCount()).toBe(0);
  });

  test("a started Timeslot can be neither cancelled nor closed, so its Welfare Rule usage stays", async () => {
    const w = await rideWorld({ maxSessionsPerDay: 1 });
    const p = await participant(w.customerId, w.operatorId);
    const ts = await slot(w.optionId, kl(`${DAY}T09:00`));
    const {
      ticketIds: [ticketId],
    } = await book(w.customerId, ts, [p]);
    await db.update(timeslots).set({ startsAt: sql`now() - interval '1 minute'` }).where(eq(timeslots.id, ts));
    await expect(cancelTicket(db, ticketId)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(closeTimeslot(db, ts)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await allocationCount()).toBe(1);
  });

  test("Pack expiry and another Operator's Timeslot are pack_unavailable", async () => {
    const w = await packWorld(kl(`${DAY}T00:00`));
    await expect(w.redeem(await slot(w.optionId, kl(`${DAY}T09:00`)))).rejects.toMatchObject({
      code: "pack_unavailable",
    });
    const other = await operator();
    await resource(other.operatorId);
    const foreign = await slot(await option(other.activityId), kl("2029-06-01T09:00"));
    await expect(w.redeem(foreign)).rejects.toMatchObject({ code: "pack_unavailable" });
  });
});
