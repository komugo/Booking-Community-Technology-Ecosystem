import { expect, test } from "vitest";
import { devInbox } from "../src/email";
import { client, customer, fake, member, pay, returnPath, rid, signedIn, signIn, start, world } from "./helpers";

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
  expect(devInbox.find((e) => e.to === email && e.subject.startsWith("Booking confirmed"))?.text).toContain("1 court · RM 20.00");
});

test("a signed-in Customer goes straight to Pay; a court Option sells one court and only without a waiver", async () => {
  const w = await courts(1);
  const cl = await signedIn(`${rid()}@example.com`);
  const post = (quantity: number) => cl.json("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity, addOns: [] });
  expect((await post(2)).body).toEqual({ code: "above_max_per_booking", field: "quantity", params: { max: 1 } });
  expect((await post(1)).body).toEqual({ id: expect.any(String), next: "pay" });

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
  const m = await member("operator", w.operatorId);
  const base = `/ops/operators/${w.operatorId}`;
  expect((await m.json("POST", `${base}/resources`, { kind: "court", name: "Court 9", active: true, maxSessionsPerDay: null, restMinutes: 0, maxRiderWeightKg: null })).status).toBe(201);
  const option = { activityId: w.activityId, ...COURT, durationMinutes: 60, maxAge: null, requiredCert: null, minParticipants: null, maxPerBooking: null, active: true };
  expect((await m.json("POST", `${base}/options`, option)).status).toBe(201);
  expect(await m.json("POST", `${base}/options`, { ...option, durationMinutes: 90 })).toEqual({ status: 409, body: { code: "invalid_state" } });
  expect((await m.json("POST", `${base}/options`, { ...option, bookingUnit: "team" })).body).toMatchObject({ field: "bookingUnit" });
  const offer = { activityId: w.activityId, nameEn: "4 hours", nameMs: "4 jam", sessions: 4, priceSen: 7000, validDays: 90, optionIds: [w.optionId], active: true };
  expect(await m.json("POST", `${base}/pack-offers`, offer)).toEqual({ status: 409, body: { code: "invalid_state" } });
});
