import { expect, test } from "vitest";
import { DAY, kl, rid, rideWorld } from "./helpers";

async function arrived() {
  const w = await rideWorld();
  await w.resource();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const people = [await w.participant(w.customerId), await w.participant(w.customerId)];
  const r = await w.book(w.customerId, ts, people);
  const today = () => w.startSlot(ts, Date.now() - 60_000);
  const checkIn = (code: string, requestId = rid()) => w.b.checkIn({ requestId, code });
  return { ...w, ts, people, ticketIds: r.ticketIds, bookingId: r.bookingId, today, checkIn };
}

test("a full Ticket id or its first 8 hex chars (any case) checks in", async () => {
  const w = await arrived();
  await w.today();
  const a = await w.checkIn(w.ticketIds[0]);
  expect(a).toEqual({
    outcome: "checked_in",
    ticket: {
      id: w.ticketIds[0],
      participantId: w.people[0],
      bookingId: w.bookingId,
      timeslotId: w.ts,
      optionId: w.optionId,
      startsAt: expect.any(Number),
      checkedInAt: expect.any(Number),
    },
  });
  expect(await w.checkIn(` ${w.ticketIds[1].slice(0, 8).toUpperCase()} `)).toMatchObject({ outcome: "checked_in" });
});

test("a replayed requestId returns the original checked_in; a new one is already with the first time", async () => {
  const w = await arrived();
  await w.today();
  const requestId = rid();
  const first = await w.checkIn(w.ticketIds[0], requestId);
  expect(await w.checkIn(w.ticketIds[0].toUpperCase(), requestId)).toEqual(first);
  expect(await w.checkIn(w.ticketIds[0])).toEqual({ ...first, outcome: "already" });
});

test("5 concurrent scans give exactly one checked_in", async () => {
  const w = await arrived();
  await w.today();
  const results = await Promise.all(Array.from({ length: 5 }, () => w.checkIn(w.ticketIds[0])));
  expect(results.map((r) => r.outcome).sort()).toEqual(["already", "already", "already", "already", "checked_in"]);
  expect(new Set(results.map((r) => r.ticket?.checkedInAt)).size).toBe(1);
});

test("cancelled, forfeited, closed and tomorrow's Tickets are reported, not checked in", async () => {
  const w = await arrived();
  expect((await w.checkIn(w.ticketIds[0])).outcome).toBe("not_today");
  await w.cancel(w.customerId, w.ticketIds[0]);
  await w.sql("UPDATE tickets SET status = 'forfeited' WHERE id = ?", w.ticketIds[1]);
  await w.today();
  expect((await w.checkIn(w.ticketIds[0])).outcome).toBe("cancelled");
  expect((await w.checkIn(w.ticketIds[1])).outcome).toBe("cancelled");

  const c = await arrived();
  await c.b.closeTimeslot(c.ts, "weather");
  await c.today();
  expect(await c.checkIn(c.ticketIds[0])).toMatchObject({ outcome: "closed", ticket: { checkedInAt: null } });
  expect(await c.count("SELECT count(*) AS n FROM tickets WHERE checked_in_at IS NOT NULL")).toBe(0);
});

test("garbage and another Operator's Ticket are not_found", async () => {
  const w = await arrived();
  const other = await arrived();
  await w.today();
  for (const code of ["", "DEADBEEF", "not a code", `${w.ticketIds[0]}x`]) {
    expect(await w.checkIn(code)).toEqual({ outcome: "not_found", ticket: null });
  }
  expect(await other.checkIn(w.ticketIds[0])).toEqual({ outcome: "not_found", ticket: null });
});

test("a shared 8-char prefix prefers today's Ticket, else is ambiguous", async () => {
  const w = await arrived();
  const later = await w.slot(w.optionId, kl(`${DAY}T15:00`));
  const {
    ticketIds: [tomorrow],
  } = await w.book(w.customerId, later, [await w.participant(w.customerId)]);
  await w.sql("DELETE FROM allocations");
  for (const id of [w.ticketIds[0], tomorrow]) {
    await w.sql("UPDATE tickets SET id = 'abcdef12' || substr(id, 9) WHERE id = ?", id);
  }
  await w.today();
  expect(await w.checkIn("ABCDEF12")).toMatchObject({ outcome: "checked_in", ticket: { timeslotId: w.ts } });
  await w.startSlot(later, Date.now() - 30_000);
  expect(await w.checkIn("abcdef12")).toEqual({ outcome: "ambiguous", ticket: null });
});

test("Check-in writes nothing to the outbox", async () => {
  const w = await arrived();
  await w.today();
  await w.flush();
  await w.checkIn(w.ticketIds[0]);
  expect(await w.count("SELECT count(*) AS n FROM outbox")).toBe(0);
});
