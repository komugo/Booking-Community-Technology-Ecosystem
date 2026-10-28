import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { cancelQuote, type Group } from "../src/engine";
import { HOUR, later, rid, rideWorld } from "./helpers";

const d1 = (q: string, ...p: unknown[]) =>
  env.DB.prepare(q)
    .bind(...p)
    .all()
    .then((r) => r.results);

async function booked(o: { people?: number; addOnSen?: number; freeCancelHours?: number; at?: number } = {}) {
  const w = await rideWorld({}, o.freeCancelHours ?? 24);
  for (let i = 1; i < (o.people ?? 1); i++) await w.resource();
  const startsAt = o.at ?? later(72);
  const ts = await w.slot(w.optionId, startsAt);
  const people = await Promise.all(Array.from({ length: o.people ?? 1 }, () => w.participant(w.customerId)));
  const addOns = [];
  if (o.addOnSen) {
    const id = rid();
    await w.b.upsertAddOn({ id, activityId: w.activityId, nameEn: "Photos", nameMs: "Foto", priceSen: o.addOnSen / 2, active: true });
    addOns.push({ id, qty: 2 });
  }
  const h = await w.hold(w.customerId, ts, people, rid(), addOns);
  const paid = await w.pay(h);
  if (paid.status !== "paid") throw new Error("not paid");
  const group: Group = { bookingId: paid.bookingId };
  return { ...w, ts, startsAt, people, amountSen: h.amountSen, group, ticketIds: paid.ticketIds };
}

const quoteAt = (w: Awaited<ReturnType<typeof booked>>, now: number) =>
  runInDurableObject(w.stub, (_, s) =>
    cancelQuote(s.storage.sql, now, { customerId: w.customerId, group: w.group, ticketIds: w.ticketIds, onlyClosed: false }),
  );

test("the free-cancel window ends exactly free_cancel_hours before the start; 0 hours means no free cancel", async () => {
  const w = await booked();
  expect((await quoteAt(w, w.startsAt - 24 * HOUR)).tickets[0]).toMatchObject({ outcome: "cancelled", refundSen: 10000 });
  expect((await quoteAt(w, w.startsAt - 24 * HOUR + 1)).tickets[0]).toMatchObject({ outcome: "forfeited", refundSen: 0 });
  const none = await booked({ freeCancelHours: 0 });
  expect(await none.quote(none.customerId, none.group, none.ticketIds)).toEqual({
    tickets: [{ id: none.ticketIds[0], outcome: "forfeited", refundSen: 0 }],
    refundSen: 0,
    reason: null,
  });
});

test("a started Timeslot can't be cancelled; a closed one is a full Refund even after its original start", async () => {
  const w = await booked();
  await w.startSlot(w.ts);
  await expect(w.quote(w.customerId, w.group, w.ticketIds)).rejects.toMatchObject({ code: "started" });

  const c = await booked();
  await c.b.closeTimeslot(c.ts, "weather");
  await c.startSlot(c.ts);
  expect(await c.cancel(c.customerId, c.group, c.ticketIds, true)).toMatchObject({
    refundSen: 10000,
    reason: "closure",
    refund: { amountSen: 10000, reason: "closure" },
  });
});

test("Add-on shares split 1000 sen as 334/333/333 and cancelling everything refunds exactly what was paid", async () => {
  const w = await booked({ people: 3, addOnSen: 1000 });
  const q = await w.quote(w.customerId, w.group, w.ticketIds);
  expect(q.tickets.map((t) => t.refundSen)).toEqual([10334, 10333, 10333]);
  const r = await w.cancel(w.customerId, w.group, w.ticketIds);
  expect(r).toEqual({ ...q, refund: { id: expect.any(String), amountSen: 31000, reason: "cancel" } });
  expect(r.refundSen).toBe(w.amountSen);
  expect(await w.sql("SELECT bill_id IS NOT NULL AS bill, booking_id, amount_sen FROM refunds")).toEqual([
    { bill: 1, booking_id: w.group.bookingId, amount_sen: 31000 },
  ]);
  expect(await w.count("SELECT count(*) AS n FROM tickets WHERE refund_id = ?", r.refund!.id)).toBe(3);
  expect((await w.b.bookingView(w.group.bookingId)).tickets.map((t) => [t.status, t.refundSen])).toEqual([
    ["cancelled", 10334],
    ["cancelled", 10333],
    ["cancelled", 10333],
  ]);
});

test("cancelling one Ticket then two gives the same total; a forfeited middle Ticket keeps its share", async () => {
  const w = await booked({ people: 3, addOnSen: 1000 });
  await w.cancel(w.customerId, w.group, [w.ticketIds[0]]);
  await w.cancel(w.customerId, w.group, w.ticketIds.slice(1));
  expect(await w.count("SELECT sum(amount_sen) AS n FROM refunds")).toBe(31000);

  const f = await booked({ people: 3, addOnSen: 1000 });
  const soon = await f.slot(f.optionId, later(73));
  await f.reschedule(f.customerId, f.group, [f.ticketIds[1]], soon, [f.people[1]]);
  await f.sql("UPDATE timeslots SET starts_at = ? WHERE id = ?", later(2), soon);
  expect(await f.cancel(f.customerId, f.group, [f.ticketIds[1]])).toMatchObject({ refundSen: 0, refund: null });
  expect(await f.cancel(f.customerId, f.group, [f.ticketIds[0], f.ticketIds[2]])).toMatchObject({ refundSen: 20667 });
});

test("a changed outcome is quote_changed and writes nothing", async () => {
  const w = await booked();
  const i = { requestId: rid(), customerId: w.customerId, group: w.group, ticketIds: w.ticketIds, onlyClosed: false };
  await expect(w.b.cancelTickets({ ...i, expectSen: 9999, expectForfeited: [] })).rejects.toMatchObject({ code: "quote_changed" });
  await expect(w.b.cancelTickets({ ...i, expectSen: 10000, expectForfeited: w.ticketIds })).rejects.toMatchObject({
    code: "quote_changed",
  });
  expect(await w.sql("SELECT status FROM tickets")).toEqual([{ status: "issued" }]);
  expect(await w.count("SELECT count(*) AS n FROM refunds")).toBe(0);
  const r = await w.b.cancelTickets({ ...i, expectSen: 10000, expectForfeited: [] });
  expect(await w.b.cancelTickets({ ...i, expectSen: 10000, expectForfeited: [] })).toEqual(r);
  expect(await w.count("SELECT count(*) AS n FROM refunds")).toBe(1);
});

test("Tickets must be the Customer's own, of the group, all issued, and all closed or all open", async () => {
  const w = await booked({ people: 2 });
  const stranger = await booked();
  for (const [customerId, ticketIds] of [
    [w.customerId, [...w.ticketIds, stranger.ticketIds[0]]],
    [stranger.customerId, w.ticketIds],
    [w.customerId, [w.ticketIds[0], w.ticketIds[0]]],
    [w.customerId, []],
  ] as [string, string[]][]) {
    await expect(w.quote(customerId, w.group, ticketIds)).rejects.toMatchObject({ code: "invalid_state" });
  }
  await expect(w.quote(w.customerId, { packId: rid() }, w.ticketIds)).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.quote(w.customerId, w.group, w.ticketIds, true)).rejects.toMatchObject({ code: "invalid_state" });

  const next = await w.slot(w.optionId, later(80));
  await w.reschedule(w.customerId, w.group, [w.ticketIds[1]], next, [w.people[1]]);
  await w.b.closeTimeslot(w.ts, "weather");
  await expect(w.quote(w.customerId, w.group, w.ticketIds)).rejects.toMatchObject({ code: "invalid_state" });
});

test("a Pack Ticket cancelled in the window returns its session; Refunds and spots are projected", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, later(72));
  const { packId } = await w.buyPack(w.customerId, { sessions: 2, optionIds: [w.optionId] });
  const { ticketIds } = await w.redeem(w.customerId, packId, ts, [await w.participant(w.customerId)]);
  await w.flush();
  expect(await d1("SELECT sessions_used FROM proj_packs WHERE id = ?", packId)).toEqual([{ sessions_used: 1 }]);
  expect(await d1("SELECT spots FROM proj_timeslots WHERE id = ?", ts)).toEqual([{ spots: 0 }]);
  expect(await w.cancel(w.customerId, { packId }, ticketIds)).toMatchObject({ refundSen: 0, reason: null, refund: null });
  await w.flush();
  expect(await d1("SELECT sessions_used FROM proj_packs WHERE id = ?", packId)).toEqual([{ sessions_used: 0 }]);
  expect(await d1("SELECT spots FROM proj_timeslots WHERE id = ?", ts)).toEqual([{ spots: 1 }]);

  const b = await booked();
  const r = await b.cancel(b.customerId, b.group, b.ticketIds);
  await b.flush();
  expect(await d1("SELECT operator_id, customer_id, booking_id, amount_sen, reason FROM proj_refunds WHERE id = ?", r.refund!.id)).toEqual([
    { operator_id: b.operatorId, customer_id: b.customerId, booking_id: b.group.bookingId, amount_sen: 10000, reason: "cancel" },
  ]);
});

test("a checked-in Ticket counts as started: no cancel or Reschedule before its start", async () => {
  const w = await booked({ people: 2 });
  await w.sql("UPDATE tickets SET checked_in_at = ? WHERE id = ?", Date.now(), w.ticketIds[0]);
  await expect(w.quote(w.customerId, w.group, [w.ticketIds[0]])).rejects.toMatchObject({ code: "started" });
  const next = await w.slot(w.optionId, later(80));
  await expect(w.reschedule(w.customerId, w.group, [w.ticketIds[0]], next, [w.people[0]])).rejects.toMatchObject({ code: "started" });
  expect(await w.quote(w.customerId, w.group, [w.ticketIds[1]])).toMatchObject({ refundSen: 10000, reason: "cancel" });
});

test("the Closure choice takes all the group's closed Tickets, is recorded once and shows in the view", async () => {
  const w = await booked({ people: 2 });
  await w.b.closeTimeslot(w.ts, "weather");
  await expect(w.quote(w.customerId, w.group, [w.ticketIds[0]], true)).rejects.toMatchObject({ code: "invalid_state" });
  const next = await w.slot(w.optionId, later(80));
  await expect(w.reschedule(w.customerId, w.group, [w.ticketIds[1]], next, [w.people[1]], rid(), true)).rejects.toMatchObject({
    code: "invalid_state",
  });
  await w.cancel(w.customerId, w.group, w.ticketIds, true);
  expect((await w.b.bookingView(w.group.bookingId)).closureChoices).toEqual([{ timeslotId: w.ts, choice: "refund", chosenAt: expect.any(Number) }]);
  await expect(w.reschedule(w.customerId, w.group, w.ticketIds, next, w.people, rid(), true)).rejects.toMatchObject({ code: "invalid_state" });
});
