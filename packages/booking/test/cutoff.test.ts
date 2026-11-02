import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { BookingError } from "../src";
import { confirmHold, createHold, expireDue, upsertActivity, type ParticipantFacts } from "../src/engine";
import { DAY, kl, rid, rideWorld } from "./helpers";

type World = Awaited<ReturnType<typeof rideWorld>>;
const MIN = 60_000;
const S = kl(`${DAY}T09:00`);

const person = (customerId: string): ParticipantFacts => ({
  id: rid(),
  customerId,
  birthDate: "1990-01-01",
  weightKg: 60,
  certs: [],
  waiverSigned: true,
});

const holdAt = (w: World, ts: string, now: number) =>
  runInDurableObject(w.stub, (_, s) => {
    try {
      return createHold(s.storage.sql, now, {
        customerId: w.customerId,
        replaces: null,
        timeslotId: ts,
        participants: [person(w.customerId)],
        addOns: [],
      });
    } catch (e) {
      if (e instanceof BookingError) return e.code;
      throw e;
    }
  });

const payAt = (w: World, h: { holdId: string; amountSen: number }, now: number) =>
  runInDurableObject(w.stub, (_, s) => {
    expireDue(s.storage.sql, now);
    return confirmHold(s.storage.sql, now, { billId: rid(), commissionBps: null, ...h });
  });

const held = (h: Awaited<ReturnType<typeof holdAt>>) => {
  if (typeof h === "string") throw new Error(h);
  return h;
};

test("default Booking cutoff is 60 minutes: bookable 1 ms before, not at or after", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, S);
  expect(await holdAt(w, ts, S - 60 * MIN)).toBe("not_bookable");
  expect(await holdAt(w, ts, S - 60 * MIN + 1)).toBe("not_bookable");
  expect(await holdAt(w, ts, S - 60 * MIN - 1)).toMatchObject({ amountSen: 10000 });
});

test("a custom Booking cutoff applies and is kept when an update omits it", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, S);
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, bookingCutoffMinutes: 120 });
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 12 });
  expect(await w.sql("SELECT free_cancel_hours, booking_cutoff_minutes FROM activities")).toEqual([
    { free_cancel_hours: 12, booking_cutoff_minutes: 120 },
  ]);
  expect(await holdAt(w, ts, S - 90 * MIN)).toBe("not_bookable");
  expect(await holdAt(w, ts, S - 120 * MIN - 1)).toMatchObject({ amountSen: 10000 });

  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, bookingCutoffMinutes: 0 });
  const late = await w.slot(w.optionId, kl(`${DAY}T15:00`));
  expect(await holdAt(w, late, kl(`${DAY}T15:00`))).toBe("not_bookable");
  expect(await holdAt(w, late, kl(`${DAY}T15:00`) - 1)).toMatchObject({ amountSen: 10000 });
});

test("a negative Booking cutoff is rejected", async () => {
  const w = await rideWorld();
  await runInDurableObject(w.stub, (_, s) => {
    expect(() => upsertActivity(s.storage.sql, Date.now(), { id: w.activityId, freeCancelHours: 24, bookingCutoffMinutes: -1 })).toThrow(
      "CHECK constraint failed",
    );
  });
});

test("an active Hold still confirms inside the Booking cutoff", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, S);
  const h = held(await holdAt(w, ts, S - 61 * MIN));
  expect(await payAt(w, h, S - 50 * MIN)).toMatchObject({ status: "paid" });
});

test("an expired Hold re-allocates only outside the Booking cutoff", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, S);
  const inside = held(await holdAt(w, ts, S - 120 * MIN));
  expect(await payAt(w, inside, S - 30 * MIN)).toEqual({ status: "refund_due", reason: "unavailable" });

  const outside = held(await holdAt(w, ts, S - 200 * MIN));
  expect(await payAt(w, outside, S - 90 * MIN)).toMatchObject({ status: "paid" });
});

test("Pack redemption and Reschedule respect the Booking cutoff", async () => {
  const w = await rideWorld();
  const p = await w.participant(w.customerId);
  const soon = await w.slot(w.optionId, Date.now() + 30 * MIN);
  const { packId } = await w.buyPack(w.customerId, { sessions: 5, optionIds: [w.optionId] });
  await expect(w.redeem(w.customerId, packId, soon, [p])).rejects.toMatchObject({ code: "not_bookable" });

  const closed = await w.slot(w.optionId, S);
  const { bookingId, ticketIds } = await w.book(w.customerId, closed, [p]);
  await w.b.closeTimeslot(closed, "weather");
  await expect(w.reschedule(w.customerId, { bookingId }, ticketIds, soon, [p])).rejects.toMatchObject({ code: "not_bookable" });
});

test("the Booking cutoff is projected to proj_activities", async () => {
  const w = await rideWorld();
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, bookingCutoffMinutes: 90 });
  await w.flush();
  expect(
    await env.DB.prepare("SELECT booking_cutoff_minutes FROM proj_activities WHERE id = ?").bind(w.activityId).all(),
  ).toMatchObject({ results: [{ booking_cutoff_minutes: 90 }] });
});
