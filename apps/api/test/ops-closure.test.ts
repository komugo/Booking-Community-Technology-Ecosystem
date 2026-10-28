import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { cron } from "../src/cron";
import { devInbox } from "../src/email";
import { booked, client, d1, member, resend, world } from "./helpers";

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
    { emailedAt: expect.any(Number) },
    { emailedAt: expect.any(Number) },
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
