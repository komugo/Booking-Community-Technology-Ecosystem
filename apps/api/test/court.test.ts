import { expect, test } from "vitest";
import { devInbox } from "../src/email";
import { client, customer, d1, fake, HOUR, later, member, pay, returnPath, rid, signedIn, signIn, SLOT_AT, slotAt, start, world } from "./helpers";

const COURT = {
  nameEn: "Court hire",
  nameMs: "Sewa gelanggang",
  priceSen: 2000,
  minAge: null,
  maxWeightKg: null,
  bookingUnit: "court" as const,
  needs: [{ kind: "court" as const, quantity: 1 }],
};

async function courts(n = 2, requiresWaiver = false) {
  const w = await world({ horses: 0, requiresWaiver, option: COURT });
  for (let i = 1; i <= n; i++) {
    await w.b.upsertResource({ id: `c${i}_${rid()}`, kind: "court", name: `Court ${i}`, active: true, maxSessionsPerDay: null, restMinutes: 0, maxRiderWeightKg: null });
  }
  await w.flush();
  return w;
}

test("a Customer books a court for 1 hour with no Who step and gets one QR Ticket in their name showing the court", async () => {
  const w = await courts(1);
  const cl = client();
  const started = await cl.json("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 1, addOns: [], locale: "en" });
  expect(started).toEqual({ status: 201, body: { id: expect.any(String), next: "contact" } });
  const id = started.body.id;
  expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({ option: { bookingUnit: "court" }, estimatedSen: 2000 });
  expect((await cl.json("PUT", `/checkouts/${id}/who`, { participants: [] })).body).toEqual({ code: "invalid_state" });
  const email = `${rid()}@example.com`;
  expect((await signIn(cl, id, email)).body).toEqual({ next: "pay" });
  expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({ state: "held", amountSen: 2000, participants: [] });

  const { billId } = await pay(cl, id);
  const r = await cl.json("GET", returnPath((await fake(billId, "pay"))!));
  expect(r.body.state).toBe("booked");
  const booking = await cl.json("GET", `/bookings/${r.body.bookingId}`);
  expect(booking.body.tickets).toEqual([expect.objectContaining({ participantName: "Aiman", court: "Court 1", priceSen: 2000, status: "issued" })]);
  expect((await cl.json("GET", "/me")).body.upcoming).toEqual([expect.objectContaining({ participants: ["Aiman"] })]);
  expect(devInbox.find((e) => e.to === email && e.subject.startsWith("Booking confirmed"))?.text).toContain("1 court · 1 hour · RM 20.00");
});

test("a signed-in Customer goes straight to Pay for as many back-to-back hours as one court is free; only without a waiver", async () => {
  const w = await courts(1);
  await slotAt(w, SLOT_AT + HOUR);
  const cl = await signedIn(`${rid()}@example.com`);
  const post = (quantity: number) => cl.json("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity, addOns: [] });
  expect((await post(3)).body).toEqual({ code: "no_availability", params: { spots: 2 } });
  const started = await post(2);
  expect(started.body).toEqual({ id: expect.any(String), next: "pay" });
  expect((await cl.json("GET", `/checkouts/${started.body.id}`)).body).toMatchObject({
    quantity: 2,
    amountSen: 4000,
    startsAt: SLOT_AT,
    endsAt: SLOT_AT + 2 * HOUR,
  });

  const waived = await courts(1, true);
  expect((await client().json("POST", "/checkouts", { optionId: waived.optionId, timeslotId: waived.timeslotId, quantity: 1, addOns: [] })).body).toEqual({
    code: "not_bookable",
  });
});

test("two Customers at the same hour get different courts, then the hour is full", async () => {
  const w = await courts(2);
  const [a, b, c] = [await signedIn(`${rid()}@example.com`), await signedIn(`${rid()}@example.com`), await signedIn(`${rid()}@example.com`)];
  const ids = [];
  for (const cl of [a, b]) {
    const id = await start(cl, w);
    const { billId } = await pay(cl, id);
    const r = await cl.json("GET", returnPath((await fake(billId, "pay"))!));
    ids.push(r.body.bookingId as string);
  }
  const courtOf = async (cl: typeof a, bookingId: string) => (await cl.json("GET", `/bookings/${bookingId}`)).body.tickets[0].court;
  expect([await courtOf(a, ids[0]), await courtOf(b, ids[1])].sort()).toEqual(["Court 1", "Court 2"]);
  await w.flush();
  expect((await c.json("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 1, addOns: [] })).body).toMatchObject({
    code: "no_availability",
  });
});

test("the Operator checks in a per-court Ticket and sees the Customer's name and court", async () => {
  const w = await courts(1);
  const buyer = await customer();
  const hold = await w.b.createHold({ requestId: rid(), customerId: buyer.id, replaces: null, timeslotId: w.timeslotId, participantIds: [], addOns: [] });
  const paid = await w.b.confirmHold({ billId: rid(), holdId: hold.holdId, amountSen: hold.amountSen });
  if (paid.status !== "paid") throw new Error("not paid");
  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", Date.now() - 60_000, w.timeslotId);
  const m = await member("operator", w.operatorId);
  const base = `/ops/operators/${w.operatorId}`;
  const r = await m.json("POST", `${base}/check-ins`, { requestId: rid(), code: paid.ticketIds[0].slice(0, 8) });
  expect(r.body).toMatchObject({ outcome: "checked_in", ticket: { id: paid.ticketIds[0], participant: { name: "Aiman Rahman" }, waiver: "not_required" } });
  const slot = (await m.json("GET", `${base}/timeslots/${w.timeslotId}`)).body.timeslots[0];
  expect(slot.groups[0].tickets).toEqual([expect.objectContaining({ resources: ["Court 1"], participant: expect.objectContaining({ name: "Aiman Rahman" }) })]);
});

test("ops saves a per-court Option and Court Resources, but not a Pack offer with it", async () => {
  const w = await courts(1);
  const m = await member("staff");
  const base = `/ops/operators/${w.operatorId}`;
  expect((await m.json("POST", `${base}/resources`, { kind: "court", name: "Court 9", active: true, maxSessionsPerDay: null, restMinutes: 0, maxRiderWeightKg: null })).status).toBe(201);
  const option = { activityId: w.activityId, ...COURT, durationMinutes: 60, maxAge: null, requiredCert: null, minParticipants: null, maxPerBooking: null, active: true };
  expect((await m.json("POST", `${base}/options`, option)).status).toBe(201);
  expect(await m.json("POST", `${base}/options`, { ...option, durationMinutes: 90 })).toEqual({ status: 409, body: { code: "invalid_state" } });
  expect((await m.json("POST", `${base}/options`, { ...option, bookingUnit: "team" })).body).toMatchObject({ field: "bookingUnit" });
  const offer = { activityId: w.activityId, nameEn: "4 hours", nameMs: "4 jam", sessions: 4, priceSen: 7000, validDays: 90, optionIds: [w.optionId], active: true };
  expect(await m.json("POST", `${base}/pack-offers`, offer)).toEqual({ status: 409, body: { code: "invalid_state" } });
});

test("closing the second hour of a 2-hour court Ticket sends one Closure notice for the whole Ticket on its first hour", async () => {
  const w = await courts(1);
  const second = await slotAt(w, SLOT_AT + HOUR);
  const email = `${rid()}@example.com`;
  const cl = await signedIn(email);
  const id = (await cl.json("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 2, addOns: [] })).body.id;
  const { billId } = await pay(cl, id);
  const { bookingId } = (await cl.json("GET", returnPath((await fake(billId, "pay"))!))).body;
  const [ticket] = (await cl.json("GET", `/bookings/${bookingId}`)).body.tickets;
  expect(ticket).toMatchObject({ hours: 2, priceSen: 4000, startsAt: SLOT_AT, endsAt: SLOT_AT + 2 * HOUR });
  const m = await member("operator", w.operatorId);
  const close = (id: string, reason: string) => m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${id}/close`, { reason });
  const r = await close(second, "maintenance");
  expect(r.body.affected).toEqual([expect.objectContaining({ bookingId, notice: expect.objectContaining({ choice: null }) })]);
  await close(w.timeslotId, "weather");
  expect(await d1("SELECT timeslot_id, reason FROM closure_notices WHERE booking_id = ?", bookingId)).toEqual([
    { timeslot_id: w.timeslotId, reason: "maintenance" },
  ]);
  expect(devInbox.filter((e) => e.to === email && e.subject.startsWith("Timeslot closed"))).toHaveLength(1);
  await w.flush();
  expect(await d1("SELECT closed_at IS NOT NULL AS closed, ends_at FROM proj_tickets WHERE id = ?", ticket.id)).toEqual([
    { closed: 1, ends_at: SLOT_AT + 2 * HOUR },
  ]);

  const at = later(72);
  const [free] = [await slotAt(w, at), await slotAt(w, at + HOUR), await slotAt(w, at + 3 * HOUR)];
  const { body } = await cl.json("GET", `/bookings/${bookingId}/slots?t=${ticket.id}`);
  expect(body.slots.map((s: { id: string }) => s.id)).toEqual([free]);
});
