import { expect, test } from "vitest";
import { codes, customer, later, rid, rideWorld } from "./helpers";

async function packed(o: { sessions?: number; validDays?: number } = {}) {
  const w = await rideWorld();
  await w.resource();
  const { packId } = await w.buyPack(w.customerId, { optionIds: [w.optionId], ...o });
  const ts = await w.slot(w.optionId, later(72));
  const redeem = (holdId: string, customerId = w.customerId, requestId = rid()) =>
    w.b.redeemPack({ requestId, customerId, packId, holdId });
  return { ...w, packId, ts, redeem };
}

test("redeeming consumes the Checkout's Hold: Pack Tickets at price 0 keep its Allocations", async () => {
  const w = await packed();
  const people = [await w.participant(w.customerId), await w.participant(w.customerId)];
  const h = await w.hold(w.customerId, w.ts, people);
  const [before] = await w.b.timeslots({ ids: [w.ts] });
  const { ticketIds } = await w.redeem(h.holdId);
  expect(ticketIds).toHaveLength(2);
  expect(await w.sql("SELECT pack_id, booking_id, price_sen, status FROM tickets")).toEqual([
    { pack_id: w.packId, booking_id: null, price_sen: 0, status: "issued" },
    { pack_id: w.packId, booking_id: null, price_sen: 0, status: "issued" },
  ]);
  expect(await w.sql("SELECT count(*) AS n FROM allocations WHERE hold_id IS NULL AND ticket_id IS NOT NULL")).toEqual([{ n: 2 }]);
  expect(await w.sql("SELECT status FROM holds")).toEqual([{ status: "confirmed" }]);
  const [after] = await w.b.timeslots({ ids: [w.ts] });
  expect(after.spots).toBe(before.spots);
});

test("redeem refusals: Add-ons, another Customer, an ineligible Option, expiry, sessions left, an expired Hold", async () => {
  const w = await packed({ sessions: 1, validDays: 1 });
  const helmet = rid();
  await w.b.upsertAddOn({ id: helmet, activityId: w.activityId, nameEn: "Helmet", nameMs: "Topi", priceSen: 500, active: true });
  const p = await w.participant(w.customerId);
  const withAddOn = await w.hold(w.customerId, w.ts, [p], rid(), [{ id: helmet, qty: 1 }]);
  await expect(w.redeem(withAddOn.holdId)).rejects.toMatchObject({ code: "invalid_add_on" });

  const stranger = await customer();
  const theirs = await w.hold(stranger, w.ts, [await w.participant(stranger)]);
  await expect(w.redeem(theirs.holdId)).rejects.toMatchObject({ code: "invalid_state" });
  const strangers = await w.buyPack(stranger, { optionIds: [w.optionId] });
  const mine = await w.hold(w.customerId, await w.slot(w.optionId, later(10)), [await w.participant(w.customerId)]);
  await expect(
    w.b.redeemPack({ requestId: rid(), customerId: w.customerId, packId: strangers.packId, holdId: mine.holdId }),
  ).rejects.toMatchObject({ code: "pack_unavailable" });

  const otherOption = await w.option();
  const ineligible = await w.hold(w.customerId, await w.slot(otherOption, later(12)), [await w.participant(w.customerId)]);
  await expect(w.redeem(ineligible.holdId)).rejects.toMatchObject({ code: "pack_unavailable" });

  const afterExpiry = await w.hold(w.customerId, w.ts, [await w.participant(w.customerId)], rid(), [], withAddOn.holdId);
  await expect(w.redeem(afterExpiry.holdId)).rejects.toMatchObject({ code: "pack_expired" });

  const soon = await w.slot(w.optionId, later(6));
  const pair = [await w.participant(w.customerId), await w.participant(w.customerId)];
  const two = await w.hold(w.customerId, soon, pair, rid(), [], afterExpiry.holdId);
  await expect(w.redeem(two.holdId)).rejects.toMatchObject({ code: "pack_used_up" });

  await w.expireHold(two.holdId);
  await expect(w.redeem(two.holdId)).rejects.toMatchObject({ code: "invalid_state" });
  expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(0);
});

test("two Holds racing for the last session: one redeems, the other is pack_used_up", async () => {
  const w = await packed({ sessions: 1 });
  const a = await w.hold(w.customerId, w.ts, [await w.participant(w.customerId)]);
  const b = await w.hold(w.customerId, await w.slot(w.optionId, later(30)), [await w.participant(w.customerId)]);
  const c = codes(await Promise.allSettled([w.redeem(a.holdId), w.redeem(b.holdId)]));
  expect(c.sort()).toEqual(["ok", "pack_used_up"]);
  expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(1);
});

test("a replayed redeem returns the same Tickets; a late payment for the consumed Hold is a duplicate Refund", async () => {
  const w = await packed();
  const h = await w.hold(w.customerId, w.ts, [await w.participant(w.customerId)]);
  const requestId = rid();
  const results = await Promise.all(Array.from({ length: 3 }, () => w.redeem(h.holdId, w.customerId, requestId)));
  for (const r of results) expect(r).toEqual(results[0]);
  expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(1);
  const billId = rid();
  expect(await w.pay(h, billId)).toEqual({ status: "refund_due", reason: "duplicate" });
  expect(await w.sql("SELECT id, customer_id, amount_sen, reason FROM refunds")).toEqual([
    { id: `bill:${billId}`, customer_id: w.customerId, amount_sen: 10000, reason: "duplicate" },
  ]);
});

test("a Pack with sessions left counts as a future Booking until it is used up or expires", async () => {
  const w = await packed({ sessions: 1 });
  expect(await w.b.hasFutureBookings(w.activityId)).toBe(true);
  const ts = await w.slot(w.optionId, later(48));
  await w.redeem((await w.hold(w.customerId, ts, [await w.participant(w.customerId)])).holdId);
  await w.startSlot(ts);
  expect(await w.b.hasFutureBookings(w.activityId)).toBe(false);

  const other = await packed();
  await other.sql("UPDATE packs SET expires_at = ?", Date.now() - 1);
  expect(await other.b.hasFutureBookings(other.activityId)).toBe(false);
});
