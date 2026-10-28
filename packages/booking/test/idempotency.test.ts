import { expect, test } from "vitest";
import { DAY, kl, later, rid, rideWorld } from "./helpers";

test("the same requestId ten times in parallel makes one Hold with identical responses", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const p = await w.participant(w.customerId);
  const requestId = rid();
  const results = await Promise.all(Array.from({ length: 10 }, () => w.hold(w.customerId, ts, [p], requestId)));
  for (const r of results) expect(r).toEqual(results[0]);
  expect(await w.count("SELECT count(*) AS n FROM holds")).toBe(1);
});

test("a reused requestId with different intent or method is idempotency_conflict", async () => {
  const w = await rideWorld();
  await w.resource();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const p = await w.participant(w.customerId);
  const q = await w.participant(w.customerId);
  const requestId = rid();
  await w.hold(w.customerId, ts, [p], requestId);
  await expect(w.hold(w.customerId, ts, [q], requestId)).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(
    w.b.cancelTickets({
      requestId,
      customerId: w.customerId,
      group: { bookingId: rid() },
      ticketIds: [rid()],
      onlyClosed: false,
      expectSen: 0,
      expectForfeited: [],
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
});

test("a failed Hold is not recorded, so its retry succeeds once the slot frees", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const first = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  const p = await w.participant(w.customerId);
  const requestId = rid();
  await expect(w.hold(w.customerId, ts, [p], requestId)).rejects.toMatchObject({ code: "no_availability" });
  await w.expireHold(first.holdId);
  expect(await w.hold(w.customerId, ts, [p], requestId)).toMatchObject({ amountSen: 10000 });
});

test("redeemPack replayed five times issues one set of Tickets", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, later(72));
  const { packId } = await w.buyPack(w.customerId, { sessions: 5, optionIds: [w.optionId] });
  const { holdId } = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  const i = { requestId: rid(), customerId: w.customerId, packId, holdId };
  const results = await Promise.all(Array.from({ length: 5 }, () => w.b.redeemPack(i)));
  for (const r of results) expect(r).toEqual(results[0]);
  expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(1);
});

test("cancelTickets and rescheduleTickets replays return the original response", async () => {
  const w = await rideWorld();
  const closed = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const next = await w.slot(w.optionId, kl(`${DAY}T12:00`));
  const p = await w.participant(w.customerId);
  const { bookingId, ticketIds } = await w.book(w.customerId, closed, [p]);
  await w.b.closeTimeslot(closed, "weather");
  const move = rid();
  const moved = await w.reschedule(w.customerId, { bookingId }, ticketIds, next, [p], move);
  expect(await w.reschedule(w.customerId, { bookingId }, ticketIds, next, [p], move)).toEqual(moved);
  expect(await w.allocationCount()).toBe(1);

  const i = {
    requestId: rid(),
    customerId: w.customerId,
    group: { bookingId },
    ticketIds,
    onlyClosed: false,
    expectSen: 0,
    expectForfeited: [],
  };
  const q = await w.quote(w.customerId, { bookingId }, ticketIds);
  const first = await w.b.cancelTickets({ ...i, expectSen: q.refundSen });
  expect(await w.b.cancelTickets({ ...i, expectSen: q.refundSen })).toEqual(first);
  expect(await w.count("SELECT count(*) AS n FROM refunds")).toBe(1);
});
