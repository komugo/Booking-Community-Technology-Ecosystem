import { env, runInDurableObject } from "cloudflare:test";
import { waivers } from "@komugo/db";
import { describe, expect, test } from "vitest";
import { migrate, migrations } from "../src/migrations";
import { customer, db, DAY, kl, rid, rideWorld, UNDO_V6, UNDO_V8, UNDO_V9 } from "./helpers";

const d1 = (query: string, ...params: unknown[]) =>
  env.DB.prepare(query)
    .bind(...params)
    .all()
    .then((r) => r.results);

async function addOn(w: Awaited<ReturnType<typeof rideWorld>>, priceSen: number, o: { activityId?: string; active?: boolean } = {}) {
  const id = rid();
  await w.b.upsertAddOn({ id, activityId: w.activityId, nameEn: "Helmet", nameMs: "Topi", priceSen, active: true, ...o });
  return id;
}

describe("Add-ons", () => {
  test("are priced into the Hold total and settle checks that total", async () => {
    const w = await rideWorld();
    await w.resource();
    const helmet = await addOn(w, 500);
    const photos = await addOn(w, 2000);
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const people = [await w.participant(w.customerId), await w.participant(w.customerId)];
    const h = await w.hold(w.customerId, ts, people, rid(), [
      { id: helmet, qty: 2 },
      { id: photos, qty: 1 },
    ]);
    expect(h.amountSen).toBe(2 * 10000 + 2 * 500 + 2000);
    expect(await w.pay({ ...h, amountSen: 20000 })).toEqual({ status: "refund_due", reason: "amount_mismatch" });
    expect(await w.pay(h)).toMatchObject({ status: "paid" });
  });

  test("inactive, another Activity's, duplicated, or more than the Participants is invalid_add_on", async () => {
    const w = await rideWorld();
    const other = rid();
    await w.b.upsertActivity({ id: other, freeCancelHours: 0 });
    const inactive = await addOn(w, 500, { active: false });
    const foreign = await addOn(w, 500, { activityId: other });
    const helmet = await addOn(w, 500);
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const p = await w.participant(w.customerId);
    for (const picks of [
      [{ id: inactive, qty: 1 }],
      [{ id: foreign, qty: 1 }],
      [{ id: helmet, qty: 2 }],
      [{ id: helmet, qty: 0 }],
      [{ id: rid(), qty: 1 }],
      [
        { id: helmet, qty: 1 },
        { id: helmet, qty: 1 },
      ],
    ]) {
      await expect(w.hold(w.customerId, ts, [p], rid(), picks)).rejects.toMatchObject({ code: "invalid_add_on" });
    }
    expect(await w.count("SELECT count(*) AS n FROM holds")).toBe(0);
  });

  test("the idempotency fingerprint includes the Add-ons", async () => {
    const w = await rideWorld();
    const helmet = await addOn(w, 500);
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const p = await w.participant(w.customerId);
    const requestId = rid();
    await w.hold(w.customerId, ts, [p], requestId, [{ id: helmet, qty: 1 }]);
    await expect(w.hold(w.customerId, ts, [p], requestId)).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
});

test("fewer Participants than min_participants is below_min_participants", async () => {
  const w = await rideWorld();
  await w.editOption(w.optionId, { minParticipants: 2 });
  await expect(
    w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [await w.participant(w.customerId)]),
  ).rejects.toMatchObject({ code: "below_min_participants" });
});

test("a fourth active Hold is too_many_holds; replacing a Hold still works", async () => {
  const w = await rideWorld();
  const people = await Promise.all([1, 2, 3, 4].map(() => w.participant(w.customerId)));
  const slots = await Promise.all(["09", "11", "13", "15"].map((h) => w.slot(w.optionId, kl(`${DAY}T${h}:00`))));
  const holds = [];
  for (let i = 0; i < 3; i++) holds.push(await w.hold(w.customerId, slots[i], [people[i]]));
  await expect(w.hold(w.customerId, slots[3], [people[3]])).rejects.toMatchObject({ code: "too_many_holds" });
  await w.hold(w.customerId, slots[3], [people[0]], rid(), [], holds[0].holdId);
  expect(await w.count("SELECT count(*) AS n FROM holds WHERE status = 'active'")).toBe(3);
});

test("more than 10 people held by one Customer on one Timeslot is too_many_holds", async () => {
  const w = await rideWorld();
  for (let i = 0; i < 11; i++) await w.resource();
  await w.editOption(w.optionId, { maxWeightKg: null });
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const people = await Promise.all(Array.from({ length: 11 }, () => w.participant(w.customerId)));
  await w.hold(w.customerId, ts, people.slice(0, 10));
  await expect(w.hold(w.customerId, ts, people.slice(10))).rejects.toMatchObject({ code: "too_many_holds" });
});

describe("supersede", () => {
  test("a new Hold releases the replaced Hold and a clashing Hold of the same Participant, and returns them", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const p = await w.participant(w.customerId);
    const first = await w.hold(w.customerId, ts, [p]);
    const second = await w.hold(w.customerId, ts, [p]);
    expect(second.released).toEqual([first.holdId]);
    const q = await w.participant(w.customerId);
    const third = await w.hold(w.customerId, ts, [q], rid(), [], second.holdId);
    expect(third.released).toEqual([second.holdId]);
    expect(await w.sql("SELECT id, status FROM holds ORDER BY created_at, status")).toEqual(
      expect.arrayContaining([
        { id: first.holdId, status: "released" },
        { id: second.holdId, status: "released" },
        { id: third.holdId, status: "active" },
      ]),
    );
    expect(await w.allocationCount()).toBe(1);
  });

  test("a Hold for another time with the same Participant stays active", async () => {
    const w = await rideWorld();
    const p = await w.participant(w.customerId);
    const first = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p]);
    const other = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T12:00`)), [p]);
    expect(other.released).toEqual([]);
    expect(await w.sql("SELECT status FROM holds WHERE id = ?", first.holdId)).toEqual([{ status: "active" }]);
    expect(await w.pay(first)).toMatchObject({ status: "paid" });
  });

  test("rolls back when the new Hold fails, so the old Hold survives", async () => {
    const w = await rideWorld();
    const p = await w.participant(w.customerId);
    const first = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p]);
    const later = await w.slot(w.optionId, kl(`${DAY}T12:00`));
    const other = await customer();
    await w.book(other, later, [await w.participant(other)]);
    await expect(w.hold(w.customerId, later, [p], rid(), [], first.holdId)).rejects.toMatchObject({ code: "no_availability" });
    expect(await w.sql("SELECT status FROM holds WHERE id = ?", first.holdId)).toEqual([{ status: "active" }]);
  });

  test("a replaced Hold paid late is re-allocated when free, else refund_due/unavailable", async () => {
    const free = await rideWorld();
    const p = await free.participant(free.customerId);
    const old = await free.hold(free.customerId, await free.slot(free.optionId, kl(`${DAY}T09:00`)), [p]);
    await free.hold(free.customerId, await free.slot(free.optionId, kl(`${DAY}T12:00`)), [p], rid(), [], old.holdId);
    expect(await free.pay(old)).toMatchObject({ status: "paid" });

    const taken = await rideWorld();
    const q = await taken.participant(taken.customerId);
    const ts = await taken.slot(taken.optionId, kl(`${DAY}T09:00`));
    const stale = await taken.hold(taken.customerId, ts, [q]);
    const other = await customer();
    await taken.hold(taken.customerId, await taken.slot(taken.optionId, kl(`${DAY}T12:00`)), [q], rid(), [], stale.holdId);
    await taken.book(other, ts, [await taken.participant(other)]);
    expect(await taken.pay(stale)).toEqual({ status: "refund_due", reason: "unavailable" });
  });

  test("a replaced Hold paid late books its replacement for the same people, Timeslot and amount", async () => {
    const w = await rideWorld();
    const p = await w.participant(w.customerId);
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const stale = await w.hold(w.customerId, ts, [p]);
    const next = await w.hold(w.customerId, ts, [p], rid(), [], stale.holdId);
    const r = await w.pay(stale);
    if (r.status !== "paid") throw new Error(r.reason);
    expect(await w.sql("SELECT hold_id FROM bookings WHERE id = ?", r.bookingId)).toEqual([{ hold_id: next.holdId }]);
    expect(await w.sql("SELECT status FROM holds WHERE id = ?", next.holdId)).toEqual([{ status: "confirmed" }]);
    expect(await w.allocationCount()).toBe(1);
    expect(await w.pay(next)).toEqual({ status: "refund_due", reason: "duplicate" });
  });
});

test("bookingView returns the Booking's Tickets, Add-ons and total", async () => {
  const w = await rideWorld();
  const helmet = await addOn(w, 500);
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const p = await w.participant(w.customerId);
  const h = await w.hold(w.customerId, ts, [p], rid(), [{ id: helmet, qty: 1 }]);
  const r = await w.pay(h);
  if (r.status !== "paid") throw new Error("not paid");
  expect(await w.b.bookingView(r.bookingId)).toEqual({
    customerId: w.customerId,
    optionId: w.optionId,
    amountSen: 10500,
    freeCancelHours: 24,
    tickets: [
      {
        id: r.ticketIds[0],
        participantId: p,
        status: "issued",
        optionId: w.optionId,
        timeslotId: ts,
        startsAt: kl(`${DAY}T09:00`),
        closedAt: null,
        refundId: null,
        refundSen: 0,
      },
    ],
    closureChoices: [],
    addOns: [{ addOnId: helmet, quantity: 1, priceSen: 500 }],
  });
  await expect(w.b.bookingView(rid())).rejects.toMatchObject({ code: "invalid_state" });
});

test("asks_weight is projected for a horse need or a max weight", async () => {
  const w = await rideWorld();
  const lane = await w.option({}, [["auto_belay_lane", 1]]);
  const heavy = await w.option({ maxWeightKg: 100 }, [["auto_belay_lane", 1]]);
  await w.flush();
  const asks = async (id: string) => (await d1("SELECT asks_weight FROM proj_options WHERE id = ?", id))[0].asks_weight;
  expect([await asks(w.optionId), await asks(lane), await asks(heavy)]).toEqual([1, 0, 1]);
});

test("only a Waiver of the current version counts", async () => {
  const w = await rideWorld();
  const p = await w.participant(w.customerId, { waiver: false });
  await db.insert(waivers).values({ participantId: p, operatorId: w.operatorId, signerName: "Aiman", version: "old" });
  await expect(w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p])).rejects.toMatchObject({
    code: "waiver_missing",
  });
});

test("an Activity that doesn't require a Waiver holds without one; a new or migrated Activity requires one", async () => {
  const w = await rideWorld();
  const p = await w.participant(w.customerId, { waiver: false });
  const slot = (t: string) => w.slot(w.optionId, kl(`${DAY}T${t}`));
  await runInDurableObject(w.stub, (_, s) => {
    s.storage.sql.exec(UNDO_V9[0]);
    s.storage.sql.exec("UPDATE meta SET schema_version = ?", migrations.length - 1);
    migrate(s.storage);
  });
  await expect(w.hold(w.customerId, await slot("09:00"), [p])).rejects.toMatchObject({ code: "waiver_missing" });
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, requiresWaiver: false });
  await expect(w.hold(w.customerId, await slot("10:00"), [p])).resolves.toBeDefined();
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 12 });
  await w.flush();
  expect(await d1("SELECT requires_waiver FROM proj_activities WHERE id = ?", w.activityId)).toEqual([{ requires_waiver: 0 }]);
});

test("migrations 3 to 5 on a Durable Object with v2 data keep its Holds, re-project every Option and default the Booking cutoff", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  await runInDurableObject(w.stub, (_, s) => {
    const sql = s.storage.sql;
    for (const q of [...UNDO_V9, ...UNDO_V8, ...UNDO_V6]) sql.exec(q);
    sql.exec("DROP INDEX holds_customer_active");
    sql.exec("DROP TABLE hold_add_ons");
    sql.exec("ALTER TABLE holds DROP COLUMN amount_sen");
    sql.exec("ALTER TABLE activities DROP COLUMN booking_cutoff_minutes");
    sql.exec("UPDATE meta SET schema_version = 2");
    sql.exec("DELETE FROM outbox");
    migrate(s.storage);
    expect(sql.exec("SELECT schema_version AS v FROM meta").one().v).toBe(migrations.length);
    expect(sql.exec("SELECT id, amount_sen FROM holds").toArray()).toEqual([{ id: h.holdId, amount_sen: null }]);
    expect(sql.exec("SELECT entity_id FROM outbox WHERE entity = 'option'").toArray()).toEqual([{ entity_id: w.optionId }]);
    expect(sql.exec("SELECT booking_cutoff_minutes AS m FROM activities").one().m).toBe(60);
  });
  expect(await w.pay({ holdId: h.holdId, amountSen: 10000 })).toMatchObject({ status: "paid" });
});
