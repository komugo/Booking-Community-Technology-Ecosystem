import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { cron } from "../src/cron";
import { devInbox } from "../src/email";
import { booked, boughtPack, client, customer, d1, later, member, packOffer, resend, rid, signedIn, SLOT_AT, slotAt, world } from "./helpers";

test("closing a booked Timeslot emails each Customer once, in their language, with a link to choose", async () => {
  const w = await world();
  const en = await booked(w);
  const ms = await booked(w, [{ name: "Ali" }], { locale: "ms" });
  const m = await member("operator", w.operatorId);
  const url = `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`;
  const r = await m.json("POST", url, { reason: "weather" });
  expect(r.status).toBe(200);
  expect(r.body.timeslot).toMatchObject({ id: w.timeslotId, closedReason: "weather" });
  expect(r.body.affected.map((g: { customerId: string }) => g.customerId)).toEqual([en.customerId, ms.customerId]);
  expect(r.body.affected[1].tickets[0].participant.name).toBe("Ali");
  expect(await d1("SELECT customer_id, reason, emailed_at IS NOT NULL AS sent FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toEqual(
    expect.arrayContaining([
      { customer_id: en.customerId, reason: "weather", sent: 1 },
      { customer_id: ms.customerId, reason: "weather", sent: 1 },
    ]),
  );
  const mail = (email: string) => devInbox.filter((e) => e.to === email);
  const [bm] = mail(ms.email);
  expect(bm.subject).toBe("Slot masa ditutup: Tunggang Denai");
  expect(bm.idempotencyKey).toBe(`closure:${w.timeslotId}:${ms.bookingId}`);
  expect(bm.text).toContain("kerana cuaca");
  expect(bm.text).toMatch(new RegExp(`https://web\\.test/ms/bookings/${ms.bookingId}\\?k=[A-Za-z0-9_-]+`));
  expect(mail(en.email)[0].subject).toBe("Timeslot closed: Trail Riding");

  expect((await m.json("POST", url, { reason: "weather" })).body.affected.map((g: { notice: unknown }) => g.notice)).toEqual([
    { emailedAt: expect.any(Number), choice: null, chosenAt: null },
    { emailedAt: expect.any(Number), choice: null, chosenAt: null },
  ]);
  expect(mail(ms.email)).toHaveLength(1);
  expect(mail(en.email)).toHaveLength(1);
});

test("a Customer with two Bookings in the closed Timeslot gets a link for each", async () => {
  const w = await world({ horses: 2 });
  const a = await booked(w, [{ name: "Ali" }]);
  const b = await booked(w, [{ name: "Abu" }], { customer: { id: a.customerId, email: a.email } });
  const m = await member("operator", w.operatorId);
  await m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`, { reason: "weather" });
  const links = devInbox.filter((e) => e.to === a.email).map((e) => /\/bookings\/([^?]+)/.exec(e.text)?.[1]);
  expect(links.sort()).toEqual([a.bookingId, b.bookingId].sort());
});

test("a failed closure email stays unsent and the cron sends it after 2 minutes", async () => {
  const w = await world();
  const c = await booked(w);
  const m = await member("operator", w.operatorId);
  const failing = client({ EMAIL_MODE: "resend" });
  failing.cookie = m.cookie;
  resend.fail = 1;
  const url = `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`;
  expect((await failing.json("POST", url, { reason: "horse_unfit" })).status).toBe(200);
  const notice = () => d1("SELECT emailed_at IS NOT NULL AS sent FROM closure_notices WHERE timeslot_id = ?", w.timeslotId);
  expect(await notice()).toEqual([{ sent: 0 }]);
  const e = { ...env, EMAIL_MODE: "resend" };
  await cron(e, () => {});
  expect(resend.calls.filter((x) => x.to === c.email)).toHaveLength(1);
  await cron(e, () => {}, Date.now() + 3 * 60_000);
  expect(resend.calls.filter((x) => x.key === `closure:${w.timeslotId}:${c.bookingId}`)).toHaveLength(2);
  expect(await notice()).toEqual([{ sent: 1 }]);
});

test("closing a started Timeslot is 409 and records nothing", async () => {
  const w = await world();
  await booked(w);
  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", Date.now() - 60_000, w.timeslotId);
  const m = await member("operator", w.operatorId);
  const r = await m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`, { reason: "weather" });
  expect(r).toEqual({ status: 409, body: { code: "invalid_state" } });
  expect(await d1("SELECT count(*) AS n FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toEqual([{ n: 0 }]);
});

test("maintenance and event close any Timeslot; horse unfit is refused off horse Activities", async () => {
  const w = await world({ horses: 0, option: { needs: [{ kind: "instructor", quantity: 1 }] } });
  const m = await member("operator", w.operatorId);
  const url = (id: string) => `/ops/operators/${w.operatorId}/timeslots/${id}/close`;
  expect(await m.json("POST", url(w.timeslotId), { reason: "horse_unfit" })).toEqual({ status: 400, body: { code: "invalid_field", field: "reason" } });
  expect((await m.json("POST", url(w.timeslotId), { reason: "maintenance" })).body.timeslot).toMatchObject({ closedReason: "maintenance", horse: false });
  const other = await slotAt(w, SLOT_AT + 3_600_000);
  expect((await m.json("POST", url(other), { reason: "event" })).body.timeslot).toMatchObject({ closedReason: "event" });
});

test("a Pack group's notice links to its Pack and stays listed with the Customer's choice", async () => {
  const w = await world();
  const ts = await slotAt(w, later(72));
  const c = await customer();
  const packId = await boughtPack(w, c.id, (await packOffer(w)).id);
  await booked(w, [{ name: "Ali" }], { timeslotId: ts, customer: c, packId });
  const m = await member("operator", w.operatorId);
  const closed = await m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${ts}/close`, { reason: "weather" });
  expect(closed.body.affected).toEqual([expect.objectContaining({ packId, notice: expect.objectContaining({ choice: null }) })]);
  expect(await d1("SELECT pack_id, booking_id FROM closure_notices WHERE timeslot_id = ?", ts)).toEqual([{ pack_id: packId, booking_id: null }]);
  const [email] = devInbox.filter((e) => e.to === c.email);
  expect(email.text).toMatch(new RegExp(`Choose: new time or session back: https://web\\.test/packs/${packId}\\?k=`));

  const owner = await signedIn(c.email);
  const r = await owner.json("POST", `/packs/${packId}/cancel`, { requestId: rid(), t: `closed:${ts}`, expectSen: 0, expectForfeited: [] });
  expect(r.body).toMatchObject({ reason: "closure", refund: null });
  await w.flush();
  const { body } = await m.json("GET", `/ops/operators/${w.operatorId}/timeslots/${ts}`);
  expect(body.timeslots[0].groups).toEqual([
    expect.objectContaining({ packId, tickets: [], notice: { emailedAt: expect.any(Number), choice: "refund", chosenAt: expect.any(Number) } }),
  ]);
  expect(await w.doSql("SELECT count(*) AS n FROM tickets WHERE pack_id = ? AND status = 'cancelled'", packId)).toEqual([{ n: 1 }]);
});
