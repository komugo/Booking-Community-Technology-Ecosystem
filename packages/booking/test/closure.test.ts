import { expect, test } from "vitest";
import { DAY, kl, rideWorld } from "./helpers";

async function booked() {
  const w = await rideWorld();
  await w.resource();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const p = await w.participant(w.customerId);
  const r = await w.book(w.customerId, ts, [p]);
  return { ...w, ts, p, ticketId: r.ticketIds[0], bookingId: r.bookingId };
}

test("a Closure stores its reason, deletes Ticket Allocations and releases active Holds", async () => {
  const w = await booked();
  const h = await w.hold(w.customerId, w.ts, [await w.participant(w.customerId)]);
  await w.b.closeTimeslot(w.ts, "horse_unfit");
  expect(await w.sql("SELECT closed_reason FROM timeslots WHERE id = ?", w.ts)).toEqual([{ closed_reason: "horse_unfit" }]);
  expect(await w.allocationCount()).toBe(0);
  expect(await w.sql("SELECT status FROM holds WHERE id = ?", h.holdId)).toEqual([{ status: "released" }]);
  expect(await w.pay(h)).toEqual({ status: "refund_due", reason: "unavailable" });
});

test("affected lists the issued Tickets including a Pack Ticket; a re-close returns the same list and writes nothing", async () => {
  const w = await booked();
  const { packId } = await w.pack(w.customerId, 2, kl("2030-12-31T00:00"));
  const p2 = await w.participant(w.customerId);
  const {
    ticketIds: [packTicket],
  } = await w.redeem(w.customerId, packId, w.ts, [p2]);
  const first = await w.b.closeTimeslot(w.ts, "weather");
  expect(first.affected).toEqual([
    { id: w.ticketId, timeslotId: w.ts, customerId: w.customerId, participantId: w.p, bookingId: w.bookingId, packId: null },
    { id: packTicket, timeslotId: w.ts, customerId: w.customerId, participantId: p2, bookingId: null, packId },
  ]);
  await w.flush();
  expect(await w.b.closeTimeslot(w.ts, "other")).toEqual(first);
  expect(await w.count("SELECT count(*) AS n FROM outbox")).toBe(0);
  expect(await w.sql("SELECT closed_reason FROM timeslots WHERE id = ?", w.ts)).toEqual([{ closed_reason: "weather" }]);
});

test("a started Timeslot cannot be closed", async () => {
  const w = await booked();
  await w.startSlot(w.ts);
  await expect(w.b.closeTimeslot(w.ts, "weather")).rejects.toMatchObject({ code: "invalid_state" });
});

test("a rescheduled or cancelled Ticket leaves the affected list", async () => {
  const w = await booked();
  const p2 = await w.participant(w.customerId);
  const {
    ticketIds: [other],
  } = await w.book(w.customerId, w.ts, [p2]);
  await w.b.closeTimeslot(w.ts, "weather");
  await w.reschedule(w.customerId, w.ticketId, await w.slot(w.optionId, kl(`${DAY}T11:00`)), w.p);
  expect(await w.cancel(w.customerId, other)).toEqual({ status: "cancelled" });
  expect(await w.b.closeTimeslot(w.ts, "weather")).toEqual({ affected: [] });
});
