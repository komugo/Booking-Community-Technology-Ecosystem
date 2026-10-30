import { env } from "cloudflare:test";
import { klDate } from "@komugo/types";
import { expect, test } from "vitest";
import { later, rid, rideWorld } from "./helpers";

async function booked(o: { people?: number; horse?: { maxSessionsPerDay?: number } } = {}) {
  const w = await rideWorld(o.horse ?? {});
  for (let i = 1; i < (o.people ?? 1); i++) await w.resource(o.horse ?? {});
  const ts = await w.slot(w.optionId, later(72));
  const people = await Promise.all(Array.from({ length: o.people ?? 1 }, () => w.participant(w.customerId)));
  const r = await w.book(w.customerId, ts, people);
  const group = { bookingId: r.bookingId };
  const move = (timeslotId: string, ticketIds = r.ticketIds, ps = people, requestId = rid(), onlyClosed = false) =>
    w.reschedule(w.customerId, group, ticketIds, timeslotId, ps, requestId, onlyClosed);
  return { ...w, ts, people, group, ticketIds: r.ticketIds, move };
}

test("inside the window a Reschedule keeps the Ticket and moves its Allocations; replays return the same answer", async () => {
  const w = await booked();
  const next = await w.slot(w.optionId, later(96));
  const requestId = rid();
  const moved = await w.move(next, undefined, undefined, requestId);
  expect(moved).toEqual({ timeslotId: next, startsAt: later(96), refund: null });
  expect(await w.move(next, undefined, undefined, requestId)).toEqual(moved);
  expect(await w.sql("SELECT id, timeslot_id, status FROM tickets")).toEqual([{ id: w.ticketIds[0], timeslot_id: next, status: "issued" }]);
  expect(await w.sql("SELECT ticket_id, block_start FROM allocations")).toEqual([{ ticket_id: w.ticketIds[0], block_start: later(96) }]);
});

test("after the window it is window_passed, once started it is started, and another Option is invalid_state", async () => {
  const w = await booked();
  const next = await w.slot(w.optionId, later(96));
  await w.sql("UPDATE timeslots SET starts_at = ? WHERE id = ?", later(2), w.ts);
  await expect(w.move(next)).rejects.toMatchObject({ code: "window_passed" });
  await w.startSlot(w.ts);
  await expect(w.move(next)).rejects.toMatchObject({ code: "started" });

  const o = await booked();
  const otherOption = await o.slot(await o.option(), later(96));
  await expect(o.move(otherOption)).rejects.toMatchObject({ code: "invalid_state" });
  await expect(o.move(o.ts)).rejects.toMatchObject({ code: "invalid_state" });
  await expect(o.move(await o.slot(o.optionId, later(97)), undefined, undefined, rid(), true)).rejects.toMatchObject({
    code: "invalid_state",
  });
});

// Sold at 10000; the target's Schedule price is what changes.
const priced = async (w: Awaited<ReturnType<typeof booked>>, ts: string, sen: number) => {
  const id = rid();
  await w.sql(
    "INSERT INTO schedules (id, activity_id, option_ids, weekdays, times, starts_on, price_sen) VALUES (?, ?, '[]', '[]', '[]', '2026-01-01', ?)",
    id,
    w.activityId,
    sen,
  );
  await w.sql("UPDATE timeslots SET schedule_id = ? WHERE id = ?", id, ts);
};

test("inside the window a target priced unlike the current Timeslot is price_differs; a later Option price change moves both", async () => {
  const w = await booked();
  const next = await w.slot(w.optionId, later(96));
  await w.sql("UPDATE options SET price_sen = price_sen + 4000 WHERE id = ?", w.optionId);
  expect(await w.move(next)).toMatchObject({ timeslotId: next, refund: null });

  const o = await booked();
  const dearer = await o.slot(o.optionId, later(96));
  await priced(o, dearer, 14000);
  await expect(o.move(dearer)).rejects.toMatchObject({ code: "price_differs" });
});

test("after a Closure a dearer target is price_differs and a cheaper one refunds the difference", async () => {
  const w = await booked();
  const dearer = await w.slot(w.optionId, later(96));
  const cheaper = await w.slot(w.optionId, later(97));
  await priced(w, dearer, 14000);
  await priced(w, cheaper, 6000);
  await w.b.closeTimeslot(w.ts, "weather");
  await expect(w.move(dearer, undefined, undefined, rid(), true)).rejects.toMatchObject({ code: "price_differs" });
  expect(await w.move(cheaper, undefined, undefined, rid(), true)).toMatchObject({
    timeslotId: cheaper,
    refund: { amountSen: 4000, reason: "closure" },
  });
  expect(await w.sql("SELECT price_sen, refund_id FROM tickets")).toEqual([{ price_sen: 6000, refund_id: null }]);
  expect(await w.sql("SELECT amount_sen, reason FROM refunds")).toEqual([{ amount_sen: 4000, reason: "closure" }]);
});

test("after a Closure any future open Timeslot is free, ignoring the window and Pack expiry", async () => {
  const w = await booked();
  await w.b.closeTimeslot(w.ts, "weather");
  const soon = await w.slot(w.optionId, later(2));
  expect(await w.move(soon, undefined, undefined, rid(), true)).toMatchObject({ timeslotId: soon });

  const p = await rideWorld();
  const { packId } = await p.buyPack(p.customerId, { optionIds: [p.optionId], validDays: 2 });
  const ts = await p.slot(p.optionId, later(30));
  const person = await p.participant(p.customerId);
  const { ticketIds } = await p.redeem(p.customerId, packId, ts, [person]);
  const beyond = await p.slot(p.optionId, later(240));
  await expect(p.reschedule(p.customerId, { packId }, ticketIds, beyond, [person])).rejects.toMatchObject({ code: "pack_expired" });
  await p.b.closeTimeslot(ts, "weather");
  expect(await p.reschedule(p.customerId, { packId }, ticketIds, beyond, [person])).toMatchObject({ timeslotId: beyond });
});

test("Resources are re-allocated: Requirements on the new date and Welfare Rules apply", async () => {
  const w = await rideWorld();
  await w.editOption(w.optionId, { maxAge: 17 });
  const ts = await w.slot(w.optionId, later(72));
  const next = await w.slot(w.optionId, later(96));
  const birthday = klDate(later(96));
  const teen = await w.participant(w.customerId, { birthDate: `${Number(birthday.slice(0, 4)) - 18}${birthday.slice(4)}` });
  const r = await w.book(w.customerId, ts, [teen]);
  await expect(w.reschedule(w.customerId, { bookingId: r.bookingId }, r.ticketIds, next, [teen])).rejects.toMatchObject({
    code: "requirement_not_met",
  });

  const h = await booked({ horse: { maxSessionsPerDay: 1 } });
  const dayA = await h.slot(h.optionId, later(120));
  const dayB = await h.slot(h.optionId, later(122));
  await h.book(h.customerId, dayA, [await h.participant(h.customerId)]);
  await expect(h.move(dayB)).rejects.toMatchObject({ code: "no_availability" });
});

test("a move overlapping the Ticket's own Timeslot works; two Tickets move together or not at all", async () => {
  const w = await booked();
  const overlap = await w.slot(w.optionId, later(72.5));
  expect(await w.move(overlap)).toMatchObject({ timeslotId: overlap });

  const two = await booked({ people: 2 });
  const busy = await two.slot(two.optionId, later(96));
  await two.book(two.customerId, busy, [await two.participant(two.customerId)]);
  await expect(two.move(busy)).rejects.toMatchObject({ code: "no_availability" });
  expect(await two.sql("SELECT DISTINCT timeslot_id FROM tickets WHERE booking_id = ?", two.group.bookingId)).toEqual([
    { timeslot_id: two.ts },
  ]);
  expect(await two.count("SELECT count(*) AS n FROM allocations")).toBe(3);

  const next = await two.slot(two.optionId, later(100));
  await two.move(next, [two.ticketIds[0]], [two.people[0]]);
  await expect(two.move(await two.slot(two.optionId, later(104)))).rejects.toMatchObject({ code: "invalid_state" });
});

test("old and new Timeslot spots are re-projected", async () => {
  const w = await booked();
  const next = await w.slot(w.optionId, later(96));
  await w.flush();
  await w.move(next);
  await w.flush();
  const spots = (id: string) =>
    env.DB.prepare("SELECT spots FROM proj_timeslots WHERE id = ?").bind(id).first<{ spots: number }>().then((r) => r?.spots);
  expect([await spots(w.ts), await spots(next)]).toEqual([1, 0]);
});
