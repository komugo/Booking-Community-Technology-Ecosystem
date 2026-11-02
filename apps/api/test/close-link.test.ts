import { env } from "cloudflare:test";
import { operatorContacts } from "@komugo/db";
import { expect, test } from "vitest";
import { closeLink } from "../src/digest";
import { devInbox } from "../src/email";
import { booked, client, d1, db, member, world, type World } from "./helpers";

async function link(w: World, timeslotId = w.timeslotId) {
  const [contact] = await db
    .insert(operatorContacts)
    .values({ operatorId: w.operatorId, name: "Siti", phone: `+6018${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`, role: "counter", locale: "en", createdAt: Date.now() })
    .returning();
  const u = new URL(await closeLink(env, w.operatorId, timeslotId, contact));
  return `/closes${u.pathname.replace(/^\/close/, "")}${u.search}`;
}

test("a close link counts the Customers, makes the same Closure as the dashboard, and shows the contact who made it", async () => {
  const w = await world({ horses: 3 });
  const a = await booked(w);
  await booked(w, [{ name: "Ali" }], { customer: { id: a.customerId, email: a.email } });
  const b = await booked(w, [{ name: "Abu" }]);
  const path = await link(w);
  const cl = client();

  const shown = await cl.json("GET", path);
  expect(shown).toMatchObject({ status: 200, body: { operator: "Test Stable", customers: 2, timeslot: { id: w.timeslotId, closedAt: null, closedBy: null } } });

  expect((await cl.json("POST", path, { reason: "nope" })).status).toBe(400);
  expect(await cl.json("POST", path, { reason: "maintenance" })).toEqual({ status: 204, body: null });
  expect(await d1("SELECT customer_id, reason, emailed_at IS NOT NULL AS sent FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toHaveLength(3);
  expect(devInbox.filter((e) => e.to === a.email)).toHaveLength(2);
  expect(devInbox.filter((e) => e.to === b.email)).toHaveLength(1);

  const staff = await member("staff");
  const [slot] = (await staff.json("GET", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}`)).body.timeslots;
  expect(slot).toMatchObject({ closedReason: "maintenance", closedBy: "Siti" });
  expect((await cl.json("GET", path)).body.timeslot).toMatchObject({ closedAt: expect.any(Number), closedBy: "Siti" });

  expect(await cl.json("POST", path, { reason: "weather" })).toEqual({ status: 409, body: { code: "already_closed" } });
  expect(devInbox.filter((e) => e.to === b.email)).toHaveLength(1);
});

test("a close link is refused once the Timeslot started, and when tampered", async () => {
  const w = await world();
  await booked(w);
  const path = await link(w);
  const cl = client();
  expect((await cl.json("GET", path.replace("k=", "k=zz"))).status).toBe(404);
  expect((await cl.json("POST", path.replace("k=", "k=zz"), { reason: "weather" })).status).toBe(404);

  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", Date.now() - 60_000, w.timeslotId);
  expect(await cl.json("GET", path)).toEqual({ status: 410, body: { code: "link_expired" } });
  expect(await cl.json("POST", path, { reason: "weather" })).toEqual({ status: 410, body: { code: "link_expired" } });
  expect(await d1("SELECT count(*) AS n FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toEqual([{ n: 0 }]);
});

test("a Timeslot closed by staff refuses the link and shows no contact", async () => {
  const w = await world();
  const path = await link(w);
  const m = await member("operator", w.operatorId);
  await m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`, { reason: "weather" });
  const cl = client();
  expect((await cl.json("GET", path)).body.timeslot).toMatchObject({ closedAt: expect.any(Number), closedBy: null });
  expect(await cl.json("POST", path, { reason: "weather" })).toEqual({ status: 409, body: { code: "already_closed" } });
});
