import { operators, whatsappMessages } from "@komugo/db";
import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import { devDevice, devOutbox } from "../src/whatsapp";
import { client, db, member, rid } from "./helpers";

type Failed = { id: string; operatorId: string; operator: string; contact: string | null; phone: string; template: string; error: string | null; at: number };
type State = { connected: boolean; failed: Failed[] };

afterEach(() => {
  devDevice.connected = true;
});

async function operator() {
  const id = `op_${rid()}`;
  await db.insert(operators).values({ id, name: "Kompleks Sukan Presint 9" });
  const staff = await member("staff");
  const down = client({ WHATSAPP_MODE: "sendontime", SENDONTIME_URL: "", SENDONTIME_DEVICE_URL: "" });
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

  const stillDown = await o.down.json<State>("POST", `/ops/whatsapp/${m.id}/retry`, {});
  expect(stillDown.body.connected).toBe(true);
  expect(mine(stillDown.body, o.id)[0].error).toBeTruthy();
  expect(mine(stillDown.body, o.id)).toHaveLength(1);

  const retried = await o.staff.json<State>("POST", `/ops/whatsapp/${m.id}/retry`, {});
  expect(retried.status).toBe(200);
  expect(mine(retried.body, o.id)).toEqual([]);
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
  const up = await o.staff.json<State>("POST", `/ops/whatsapp/${m.id}/retry`, {});
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

test("a failed Digest can be retried only until its day starts", async () => {
  const o = await operator();
  const added = await o.staff.json<{ contacts: { id: string }[] }>("POST", o.contacts, { name: "Nora", phone: "0181120006", role: "counter" });
  const [d] = await db
    .insert(whatsappMessages)
    .values({ operatorId: o.id, contactId: added.body.contacts[0].id, phone: "+60181120006", template: "digest", text: "Tickets for tomorrow", status: "failed", createdAt: Date.now() - 2 * 3_600_000 })
    .returning();
  expect(mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id)).toMatchObject([{ id: d.id, template: "digest" }]);

  await db.update(whatsappMessages).set({ createdAt: Date.now() - 4 * 3_600_000 }).where(eq(whatsappMessages.id, d.id));
  expect(mine((await o.staff.json<State>("GET", "/ops/whatsapp")).body, o.id)).toEqual([]);
  expect((await o.staff.json("POST", `/ops/whatsapp/${d.id}/retry`, {})).status).toBe(404);
});
