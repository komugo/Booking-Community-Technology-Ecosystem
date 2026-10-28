import { expect, test } from "vitest";
import { DAY, kl, rid, rideWorld } from "./helpers";

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
  await expect(w.cancel(w.customerId, rid(), requestId)).rejects.toMatchObject({ code: "idempotency_conflict" });
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

test("redeemPack replayed five times issues one Ticket", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const { packId } = await w.pack(w.customerId, 5, kl("2030-12-31T00:00"));
  const p = await w.participant(w.customerId);
  const requestId = rid();
  const results = await Promise.all(Array.from({ length: 5 }, () => w.redeem(w.customerId, packId, ts, [p], requestId)));
  for (const r of results) expect(r).toEqual(results[0]);
  expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(1);
});

test("cancelTicket and rescheduleTicket replays return the original response", async () => {
  const w = await rideWorld();
  const closed = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const later = await w.slot(w.optionId, kl(`${DAY}T12:00`));
  const p = await w.participant(w.customerId);
  const {
    ticketIds: [ticketId],
  } = await w.book(w.customerId, closed, [p]);
  await w.b.closeTimeslot(closed, "weather");
  const move = rid();
  await w.reschedule(w.customerId, ticketId, later, p, move);
  await w.reschedule(w.customerId, ticketId, later, p, move);
  expect(await w.allocationCount()).toBe(1);

  const cancel = rid();
  const first = await w.cancel(w.customerId, ticketId, cancel);
  expect(first).toEqual({ status: "cancelled" });
  expect(await w.cancel(w.customerId, ticketId, cancel)).toEqual(first);
});
