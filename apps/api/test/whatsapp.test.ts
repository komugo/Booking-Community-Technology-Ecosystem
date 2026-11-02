import { operatorContacts, operators, whatsappMessages } from "@komugo/db";
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { devDevice, devOutbox } from "../src/whatsapp";
import { client, db, drain, member, rid, wasender, whatsappQueue, world } from "./helpers";

type Failed = { id: string; operatorId: string; operator: string; contact: string | null; phone: string; template: string; error: string | null; at: number };
type State = { connected: boolean; failed: Failed[] };

afterEach(() => {
  devDevice.connected = true;
});

async function operator() {
  const id = `op_${rid()}`;
  await db.insert(operators).values({ id, name: "Kompleks Sukan Presint 9" });
  const staff = await member("staff");
  wasender.code = 400;
  const down = client({ WHATSAPP_MODE: "wasender" });
  down.cookie = staff.cookie;
  return { id, contacts: `/ops/operators/${id}/contacts`, staff, down };
}

const mine = (s: State, operatorId: string) => s.failed.filter((m) => m.operatorId === operatorId);

test("a failed send shows for staff with its Operator and contact; retry resends it and clears it", async () => {
  const o = await operator();
  expect((await (await member("operator", o.id)).json("GET", "/ops/whatsapp")).status).toBe(403);

  await o.down.json("POST", o.contacts, { name: "Siti", phone: "0181120001", role: "counter" });
  const before = await o.staff.json<State>("GET", "/ops/whatsapp");
  expect(before.body.connected).toBe(true);
  const [m] = mine(before.body, o.id);
  expect(m).toMatchObject({ operator: "Kompleks Sukan Presint 9", contact: "Siti", phone: "+60181120001", template: "welcome" });
  expect(m.error).toBeTruthy();

  expect((await o.down.json("POST", `/ops/whatsapp/${m.id}/retry`, {})).status).toBe(200);
  const stillDown = await o.down.json<State>("GET", "/ops/whatsapp");
  expect(stillDown.body.connected).toBe(true);
  expect(mine(stillDown.body, o.id)[0].error).toBeTruthy();
  expect(mine(stillDown.body, o.id)).toHaveLength(1);

  expect(await o.staff.json("POST", `/ops/whatsapp/${m.id}/retry`, {})).toMatchObject({ status: 200, body: { queued: true } });
  expect(mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id)).toEqual([]);
  expect(devOutbox.find((x) => x.to === "+60181120001")?.text).toContain("Salam Siti, ini Komugo.");
  const listed = await o.staff.json<{ contacts: { welcome: { status: string } }[] }>("GET", o.contacts);
  expect(listed.body.contacts[0].welcome.status).toBe("sent");
  expect((await o.staff.json("POST", `/ops/whatsapp/${m.id}/retry`, {})).status).toBe(404);
});

test("a disconnected device shows, and sends fail until it's linked again", async () => {
  const o = await operator();
  devDevice.connected = false;
  await o.staff.json("POST", o.contacts, { name: "Aminah", phone: "0181120002", role: "counter" });
  const down = await o.staff.json<State>("GET", "/ops/whatsapp");
  expect(down.body.connected).toBe(false);
  const [m] = mine(down.body, o.id);
  expect(m).toMatchObject({ contact: "Aminah", error: "device_disconnected" });

  devDevice.connected = true;
  await o.staff.json("POST", `/ops/whatsapp/${m.id}/retry`, {});
  const up = await o.staff.json<State>("GET", "/ops/whatsapp");
  expect(up.body.connected).toBe(true);
  expect(mine(up.body, o.id)).toEqual([]);
});

test("a failed message stays listed after its contact is removed", async () => {
  const o = await operator();
  const added = await o.down.json<{ contacts: { id: string }[] }>("POST", o.contacts, { name: "Hafiz", phone: "0181120003", role: "counter" });
  await o.staff.json("POST", `${o.contacts}/${added.body.contacts[0].id}/remove`, {});
  const [m] = mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id);
  expect(m).toMatchObject({ contact: null, phone: "+60181120003" });
  expect((await o.staff.json("POST", `/ops/whatsapp/${m.id}/retry`, {})).status).toBe(404);
  expect(devOutbox.some((x) => x.to === "+60181120003")).toBe(false);
});

test("a failed Welcome drops off once the contact's new number gets one", async () => {
  const o = await operator();
  const added = await o.down.json<{ contacts: { id: string }[] }>("POST", o.contacts, { name: "Zul", phone: "0181120004", role: "counter" });
  const [old] = mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id);
  await o.staff.json("PUT", `${o.contacts}/${added.body.contacts[0].id}`, { name: "Zul", phone: "0181120005", role: "counter" });
  expect(mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id)).toEqual([]);
  expect((await o.staff.json("POST", `/ops/whatsapp/${old.id}/retry`, {})).status).toBe(404);
  expect(devOutbox.some((x) => x.to === "+60181120004")).toBe(false);
});

test("an old failed Digest is never shown or retried: its close links are gone", async () => {
  const o = await operator();
  const added = await o.staff.json<{ contacts: { id: string }[] }>("POST", o.contacts, { name: "Nora", phone: "0181120006", role: "counter" });
  const [d] = await db
    .insert(whatsappMessages)
    .values({ operatorId: o.id, contactId: added.body.contacts[0].id, phone: "+60181120006", template: "digest", text: "Tickets for tomorrow", status: "failed", createdAt: Date.now() - 2 * 3_600_000 })
    .returning();
  expect(mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id)).toEqual([]);
  expect((await o.staff.json("POST", `/ops/whatsapp/${d.id}/retry`, {})).status).toBe(404);
});

test("a message is stored as queued, then sent through WasenderAPI with the API key", async () => {
  const o = await operator();
  const live = client({ WHATSAPP_MODE: "wasender" });
  live.cookie = o.staff.cookie;
  wasender.code = 200;
  whatsappQueue.held = true;
  const added = await live.json<{ contacts: { welcome: { status: string } }[] }>("POST", o.contacts, { name: "Siti", phone: "0181120007", role: "counter" });
  expect(added.body.contacts[0].welcome.status).toBe("queued");
  expect(wasender.sent).toEqual([]);

  await drain();
  expect(wasender.sent).toEqual([{ key: "Bearer wasender_test", to: "+60181120007", text: expect.stringContaining("Salam Siti, ini Komugo.") }]);
  const listed = await o.staff.json<{ contacts: { welcome: { status: string } }[] }>("GET", o.contacts);
  expect(listed.body.contacts[0].welcome.status).toBe("sent");
});

test("a burst of Closure done to 5 contacts all goes out through a rate-limiting WasenderAPI", async () => {
  const w = await world();
  const phones = Array.from({ length: 5 }, (_, i) => `+6018113000${i}`);
  await db.insert(operatorContacts).values(phones.map((phone, i) => ({ operatorId: w.operatorId, name: `C${i}`, phone, role: "counter" as const, createdAt: Date.now() })));
  const staff = await member("staff");
  const live = client({ WHATSAPP_MODE: "wasender" });
  live.cookie = staff.cookie;
  wasender.codes = [200, 429, 429, 200, 429, 503, 429, 200, 429, 429, 429, 200, 429];

  expect((await live.json("POST", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`, { reason: "weather" })).status).toBe(200);
  expect(wasender.sent.map((m) => m.to).sort()).toEqual(phones);
  const rows = await db.select().from(whatsappMessages).where(eq(whatsappMessages.operatorId, w.operatorId));
  expect(rows.map((r) => r.status)).toEqual(Array(5).fill("sent"));
  expect(whatsappQueue.delays.length).toBe(9);
  expect(Math.max(...whatsappQueue.delays.map(Number))).toBeGreaterThan(10);
});

test("a failing status check during a 429 burst isn't read as a disconnected device", async () => {
  const o = await operator();
  const live = client({ WHATSAPP_MODE: "wasender" });
  live.cookie = o.staff.cookie;
  wasender.statusCode = 429;
  wasender.codes = [429, 503, 429];
  wasender.code = 200;
  await live.json("POST", o.contacts, { name: "Aishah", phone: "0181120010", role: "counter" });
  expect(wasender.sent.map((m) => m.to)).toEqual(["+60181120010"]);
  expect(whatsappQueue.delays).toEqual([10, 20, 40]);
  const s = await live.json<State>("GET", "/ops/whatsapp");
  expect(s.body.connected).toBe(true);
  expect(mine(s.body, o.id)).toEqual([]);
});

test("a message the queue won't take shows as failed, and Retry sends it once the queue is back", async () => {
  const o = await operator();
  wasender.code = 200;
  whatsappQueue.down = true;
  const live = client({ WHATSAPP_MODE: "wasender" });
  live.cookie = o.staff.cookie;
  await live.json("POST", o.contacts, { name: "Kamal", phone: "0181120011", role: "counter" });
  const [m] = mine((await live.json<State>("GET", "/ops/whatsapp")).body, o.id);
  expect(m).toMatchObject({ contact: "Kamal", error: "queue_unavailable" });

  whatsappQueue.down = false;
  await live.json("POST", `/ops/whatsapp/${m.id}/retry`, {});
  expect(wasender.sent.map((x) => x.to)).toEqual(["+60181120011"]);
  expect(mine((await live.json<State>("GET", "/ops/whatsapp")).body, o.id)).toEqual([]);
});

test("a message that keeps failing ends as failed after its last attempt; Retry re-queues it", async () => {
  const o = await operator();
  const live = client({ WHATSAPP_MODE: "wasender" });
  live.cookie = o.staff.cookie;
  wasender.code = 500;
  await live.json("POST", o.contacts, { name: "Rosnah", phone: "0181120008", role: "counter" });
  expect(whatsappQueue.delays).toEqual([10, 20, 40, 80, 160, 320, 600]);
  const [m] = mine((await live.json<State>("GET", "/ops/whatsapp")).body, o.id);
  expect(m).toMatchObject({ contact: "Rosnah", error: "wasender_500" });

  wasender.code = 200;
  whatsappQueue.held = true;
  await live.json("POST", `/ops/whatsapp/${m.id}/retry`, {});
  expect(mine((await live.json<State>("GET", "/ops/whatsapp")).body, o.id)).toEqual([]);
  expect((await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, m.id)))[0].status).toBe("queued");
  await drain();
  expect(wasender.sent.map((x) => x.to)).toEqual(["+60181120008"]);
  expect((await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, m.id)))[0].status).toBe("sent");
});

test("the banner shows a disconnected device when WasenderAPI's session isn't connected, and sends fail without retrying", async () => {
  const o = await operator();
  const live = client({ WHATSAPP_MODE: "wasender" });
  live.cookie = o.staff.cookie;
  expect((await live.json<State>("GET", "/ops/whatsapp")).body.connected).toBe(true);
  wasender.status = "disconnected";
  wasender.code = 500;
  await live.json("POST", o.contacts, { name: "Hafiz", phone: "0181120009", role: "counter" });
  const s = await live.json<State>("GET", "/ops/whatsapp");
  expect(s.body.connected).toBe(false);
  expect(mine(s.body, o.id)).toMatchObject([{ contact: "Hafiz", error: "device_disconnected" }]);
  expect(whatsappQueue.delays).toEqual([]);
});
