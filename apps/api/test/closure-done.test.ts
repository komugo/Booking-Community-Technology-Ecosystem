import { env } from "cloudflare:test";
import { operatorContacts, whatsappMessages } from "@komugo/db";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { klWhen } from "../src/details";
import { closeLink } from "../src/digest";
import { devOutbox } from "../src/whatsapp";
import { booked, client, db, member, world, type World } from "./helpers";

const phone = () => `+6018${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function contacts(w: World) {
  const [counter, owner] = await db
    .insert(operatorContacts)
    .values([
      { operatorId: w.operatorId, name: "Siti", phone: phone(), role: "counter", locale: "en", createdAt: Date.now() },
      { operatorId: w.operatorId, name: "Aminah", phone: phone(), role: "owner", locale: "ms", createdAt: Date.now() },
    ])
    .returning();
  return { counter, owner };
}

const sent = (c: { phone: string }) => devOutbox.filter((m) => m.to === c.phone).map((m) => m.text);

test("a staff Closure sends Closure done once to every contact in their language, with the Customers notified", async () => {
  const w = await world({ horses: 3 });
  const a = await booked(w);
  await booked(w, [{ name: "Ali" }], { customer: { id: a.customerId, email: a.email } });
  await booked(w, [{ name: "Abu" }]);
  const to = await contacts(w);
  const staff = await member("staff");
  const url = `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`;
  expect((await staff.json("POST", url, { reason: "weather" })).status).toBe(200);

  const [slot] = await w.b.timeslots({ ids: [w.timeslotId] });
  expect(sent(to.counter)).toEqual([`Test Stable: Closure done\n\nRide, ${klWhen(slot, "en")}\nReason: Weather\nCustomers notified: 2`]);
  expect(sent(to.owner)).toEqual([`Test Stable: Penutupan selesai\n\nTunggang, ${klWhen(slot, "ms")}\nSebab: Cuaca\nPelanggan dimaklumkan: 2`]);
  expect(await db.select().from(whatsappMessages).where(eq(whatsappMessages.contactId, to.counter.id))).toMatchObject([{ template: "closure", status: "sent" }]);

  expect((await staff.json("POST", url, { reason: "weather" })).status).toBe(200);
  expect(sent(to.counter)).toHaveLength(1);
  expect(sent(to.owner)).toHaveLength(1);
});

test("a close link Closure sends Closure done to every contact, also with no Customers", async () => {
  const w = await world();
  const to = await contacts(w);
  const u = new URL(await closeLink(env, w.operatorId, w.timeslotId, to.counter));
  const path = `/closes${u.pathname.replace(/^\/close/, "")}${u.search}`;
  const cl = client();
  expect((await cl.json("POST", path, { reason: "maintenance" })).status).toBe(204);
  expect(await cl.json("POST", path, { reason: "maintenance" })).toEqual({ status: 409, body: { code: "already_closed" } });

  expect(sent(to.counter)).toHaveLength(1);
  expect(sent(to.counter)[0]).toMatch(/Reason: Maintenance\nCustomers notified: 0$/);
  expect(sent(to.owner)).toHaveLength(1);
  expect(sent(to.owner)[0]).toMatch(/Sebab: Penyelenggaraan\nPelanggan dimaklumkan: 0$/);
});

test("a failed Closure done can be retried for a day", async () => {
  const w = await world();
  const to = await contacts(w);
  const [m] = await db
    .insert(whatsappMessages)
    .values({ operatorId: w.operatorId, contactId: to.counter.id, phone: to.counter.phone, template: "closure", text: "Closure done", status: "failed", createdAt: Date.now() - 4 * 3_600_000 })
    .returning();
  const staff = await member("staff");
  const failed = async () => (await staff.json<{ failed: { id: string }[] }>("GET", "/ops/whatsapp")).body.failed.filter((f) => f.id === m.id);
  expect(await failed()).toHaveLength(1);

  await db.update(whatsappMessages).set({ createdAt: Date.now() - 25 * 3_600_000 }).where(eq(whatsappMessages.id, m.id));
  expect(await failed()).toEqual([]);
  expect((await staff.json("POST", `/ops/whatsapp/${m.id}/retry`, {})).status).toBe(404);
});
