import { expect, test } from "vitest";
import { boughtPack, booked, client, customer, d1, DAY_MS, otpCode, packOffer, rid, signedIn, SLOT_AT, slotAt, world } from "./helpers";

test("Sign-in by email code creates a new Customer, reuses a known one, and sets the session", async () => {
  const email = `${rid()}@example.com`;
  const cl = await signedIn(email);
  expect(cl.cookie).toMatch(/^__Host-sid=/);
  expect((await cl.json("GET", "/me")).body).toMatchObject({ email, awaiting: [], upcoming: [], packs: [], past: [] });
  expect((await client().call("POST", "/auth/sign-in", { email, locale: "en" })).status).toBe(429);
  expect(await d1("SELECT name, email_verified_at IS NOT NULL AS verified FROM customers WHERE email = ?", email)).toEqual([
    { name: email, verified: 1 },
  ]);
  const known = await customer();
  await signedIn(known.email);
  expect(await d1("SELECT id, name FROM customers WHERE email = ?", known.email)).toEqual([{ id: known.id, name: "Aiman Rahman" }]);
});

test("a wrong code is otp_invalid, a bad email is 400, and /me is 401 signed out", async () => {
  const email = `${rid()}@example.com`;
  const cl = client();
  expect((await cl.json("POST", "/auth/sign-in", { email: "nope", locale: "en" })).body).toMatchObject({ code: "email_invalid" });
  expect((await cl.call("POST", "/auth/sign-in", { email, locale: "en" })).status).toBe(204);
  const wrong = otpCode(email) === "000000" ? "111111" : "000000";
  expect((await cl.json("POST", "/auth/sign-in/verify", { email, code: wrong })).body).toMatchObject({ code: "otp_invalid" });
  expect((await client().json("GET", "/me")).status).toBe(401);
});

test("/me lists only the Customer's own Closure choices, upcoming visits, Packs and past visits", async () => {
  const w = await world({ horses: 3 });
  const me = await customer();
  const upcoming = await booked(w, [{ name: "Aisyah" }], { customer: me });
  const closedSlot = await slotAt(w, SLOT_AT + DAY_MS);
  const closed = await booked(w, [{ name: "Ali" }], { customer: me, timeslotId: closedSlot });
  await w.b.closeTimeslot(closedSlot, "weather");
  const pastSlot = await slotAt(w, SLOT_AT + 2 * DAY_MS);
  const past = await booked(w, [{ name: "Abu" }], { customer: me, timeslotId: pastSlot });
  const q = await w.b.cancelQuote({ customerId: me.id, group: { bookingId: past.bookingId }, ticketIds: past.ticketIds, onlyClosed: false });
  await w.b.cancelTickets({
    requestId: rid(),
    customerId: me.id,
    group: { bookingId: past.bookingId },
    ticketIds: past.ticketIds,
    onlyClosed: false,
    expectSen: q.refundSen,
    expectForfeited: [],
  });
  const packId = await boughtPack(w, me.id, (await packOffer(w)).id);
  await booked(w, [{ name: "Stranger" }]);
  await w.flush();

  const { body } = await (await signedIn(me.email)).json("GET", "/me");
  expect(body.awaiting).toEqual([
    expect.objectContaining({ kind: "booking", id: closed.bookingId, k: expect.any(String), closed: true, participants: ["Ali"], statuses: ["issued"] }),
  ]);
  expect(body.upcoming).toEqual([
    expect.objectContaining({
      id: upcoming.bookingId,
      timeslotId: w.timeslotId,
      startsAt: SLOT_AT,
      option: { nameEn: "Ride", nameMs: "Tunggang" },
      activity: { nameEn: "Trail Riding", nameMs: "Tunggang Denai" },
      participants: ["Aisyah"],
    }),
  ]);
  expect(body.past).toEqual([expect.objectContaining({ id: past.bookingId, statuses: ["cancelled"] })]);
  expect(body.packs).toEqual([
    { id: packId, k: expect.any(String), nameEn: "4 rides", nameMs: "4 tunggangan", sessionsTotal: 4, sessionsUsed: 0, expiresAt: expect.any(Number), expired: false },
  ]);
});
