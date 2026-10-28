import { expect, test } from "vitest";
import { booked, member, world } from "./helpers";

test("Check-in returns the Participant and Waiver, replays the same answer, and is not_found for another Operator", async () => {
  const w = await world();
  const b = await booked(w, [{ name: "Adam", birthDate: "2015-03-01", weightKg: 30, waiver: "guardian" }]);
  const startsAt = Date.now() - 60_000;
  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", startsAt, w.timeslotId);
  const m = await member("operator", w.operatorId);
  const url = `/ops/operators/${w.operatorId}/check-ins`;
  const requestId = crypto.randomUUID();
  const code = b.ticketIds[0].slice(0, 8).toUpperCase();
  const first = await m.json("POST", url, { requestId, code });
  expect(first).toEqual({
    status: 200,
    body: {
      outcome: "checked_in",
      ticket: {
        id: b.ticketIds[0],
        code,
        bookingId: b.bookingId,
        timeslotId: w.timeslotId,
        startsAt,
        checkedInAt: expect.any(Number),
        option: { nameEn: "Ride", nameMs: "Tunggang" },
        participant: { name: "Adam", age: expect.any(Number), weightKg: 30 },
        waiver: "guardian",
        signerName: "Aiman Rahman",
      },
    },
  });
  expect(await m.json("POST", url, { requestId, code })).toEqual(first);
  expect((await m.json("POST", url, { requestId: crypto.randomUUID(), code: b.ticketIds[0] })).body).toMatchObject({
    outcome: "already",
    ticket: { checkedInAt: first.body.ticket.checkedInAt },
  });
  expect((await m.json("POST", url, { requestId, code: "DEADBEEF" })).body).toEqual({ code: "idempotency_conflict" });
  expect((await m.json("POST", url, { requestId: "nope", code })).body).toMatchObject({ field: "requestId" });

  const other = await world();
  const o = await member("operator", other.operatorId);
  expect(await o.json("POST", `/ops/operators/${other.operatorId}/check-ins`, { requestId: crypto.randomUUID(), code })).toEqual({
    status: 200,
    body: { outcome: "not_found", ticket: null },
  });
});
