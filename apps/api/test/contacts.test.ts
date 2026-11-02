import { operators, whatsappMessages } from "@komugo/db";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { devOutbox } from "../src/whatsapp";
import { client, d1, db, member, rid } from "./helpers";

type Contact = { id: string; name: string; phone: string; role: string; locale: string; email: string | null; welcome: { status: string } | null };

async function operator() {
  const id = `op_${rid()}`;
  await db.insert(operators).values({ id, name: "Kompleks Sukan Presint 9" });
  return { id, base: `/ops/operators/${id}/contacts`, staff: await member("staff") };
}

const sentTo = (phone: string) => devOutbox.filter((m) => m.to === phone);

test("staff add, edit and remove an Operator's contacts; operator Members can't see them", async () => {
  const o = await operator();
  const own = await member("operator", o.id);
  expect((await own.json("GET", o.base)).status).toBe(403);
  expect((await own.json("POST", o.base, { name: "Aminah", phone: "0123456789", role: "counter", locale: "ms" })).status).toBe(403);

  const added = await o.staff.json<{ contacts: Contact[] }>("POST", o.base, { name: " Aminah ", phone: "012-345 6789", role: "counter" });
  expect(added.status).toBe(201);
  const [c] = added.body.contacts;
  expect(c).toMatchObject({ name: "Aminah", phone: "+60123456789", role: "counter", locale: "ms", email: null, welcome: { status: "sent" } });
  expect((await o.staff.json("POST", o.base, { name: "Again", phone: "+60 12-345 6789", role: "counter" })).body).toMatchObject({
    code: "contact_exists",
    field: "phone",
  });
  const other = await o.staff.json<{ contacts: Contact[] }>("POST", o.base, { name: "Other", phone: "0060 11-2223 3344", role: "counter" });
  const d = other.body.contacts[1];
  expect(d.phone).toBe("+601122233344");
  expect((await o.staff.json("PUT", `${o.base}/${d.id}`, { name: "Other", phone: "0123456789", role: "counter" })).status).toBe(409);
  await o.staff.json("POST", `${o.base}/${d.id}/remove`, {});

  expect((await own.json("PUT", `${o.base}/${c.id}`, { name: "Aminah", phone: "0123456789", role: "counter", locale: "en" })).status).toBe(403);
  const edited = await o.staff.json<{ contacts: Contact[] }>("PUT", `${o.base}/${c.id}`, { name: "Aminah Yusof", phone: "0123456789", role: "counter", locale: "en" });
  expect(edited.body.contacts[0]).toMatchObject({ name: "Aminah Yusof", locale: "en" });
  expect(sentTo("+60123456789")).toHaveLength(1);
  await o.staff.json("PUT", `${o.base}/${c.id}`, { name: "Aminah Yusof", phone: "0198887777", role: "counter", locale: "en" });
  expect(sentTo("+60198887777")[0].text).toContain("Hi Aminah Yusof, this is Komugo.");

  expect((await own.json("POST", `${o.base}/${c.id}/remove`, {})).status).toBe(403);
  expect((await o.staff.json("POST", `${o.base}/${c.id}/remove`, {})).body).toEqual({ contacts: [] });
  expect((await own.json("GET", `/ops/operators/${o.id}/setup`)).body).not.toHaveProperty("contacts");
});

test("an owner needs an email; a counter doesn't", async () => {
  const o = await operator();
  const owner = { name: "Encik Hafiz", phone: "0171112222", role: "owner", locale: "en" };
  expect((await o.staff.json("POST", o.base, owner)).body).toMatchObject({ code: "invalid_field", field: "email" });
  expect((await o.staff.json("POST", o.base, { ...owner, email: "not-an-email" })).body).toMatchObject({ field: "email" });
  expect((await o.staff.json("POST", o.base, { ...owner, phone: "12", email: "hafiz@example.com" })).body).toMatchObject({ field: "phone" });
  expect((await o.staff.json("POST", o.base, { ...owner, phone: "+012-345 6789", email: "hafiz@example.com" })).body).toMatchObject({ field: "phone" });
  expect((await o.staff.json("POST", o.base, { ...owner, role: "boss", email: "hafiz@example.com" })).body).toMatchObject({ field: "role" });
  const added = await o.staff.json<{ contacts: Contact[] }>("POST", o.base, { ...owner, email: " Hafiz@Example.com " });
  expect(added.body.contacts[0]).toMatchObject({ role: "owner", email: "hafiz@example.com" });
  const counter = await o.staff.json<{ contacts: Contact[] }>("POST", o.base, { name: "Kaunter", phone: "0173334444", role: "counter", email: "ignored@example.com" });
  expect(counter.body.contacts[1]).toMatchObject({ role: "counter", email: null });
});

test("the Welcome goes out in the contact's language and every send is logged with its status", async () => {
  const o = await operator();
  await o.staff.json("POST", o.base, { name: "Aminah", phone: "0181110001", role: "counter" });
  await o.staff.json("POST", o.base, { name: "Hafiz", phone: "0181110002", role: "owner", locale: "en", email: "hafiz@example.com" });
  const [bm] = sentTo("+60181110001");
  expect(bm.text).toContain("Salam Aminah, ini Komugo. Kami akan menghantar tempahan Kompleks Sukan Presint 9 ke nombor ini.");
  expect(bm.text).toContain('balas "OK"');
  expect(bm.text).toContain("senarai harian");
  const [en] = sentTo("+60181110002");
  expect(en.text).toContain("Hi Hafiz, this is Komugo. We'll send Kompleks Sukan Presint 9's bookings to this number.");
  expect(en.text).toContain('reply "OK"');

  const down = client({ WHATSAPP_MODE: "sendontime", SENDONTIME_URL: "" });
  down.cookie = o.staff.cookie;
  const failed = await down.json<{ contacts: Contact[] }>("POST", o.base, { name: "Siti", phone: "0181110003", role: "counter" });
  expect(failed.status).toBe(201);
  expect(failed.body.contacts[2]).toMatchObject({ name: "Siti", welcome: { status: "failed" } });

  const log = await d1<{ phone: string; template: string; status: string; error: string | null; text: string }>(
    "SELECT phone, template, status, error, text FROM whatsapp_messages WHERE operator_id = ? ORDER BY created_at, phone",
    o.id,
  );
  expect(log.map((m) => [m.phone, m.template, m.status])).toEqual([
    ["+60181110001", "welcome", "sent"],
    ["+60181110002", "welcome", "sent"],
    ["+60181110003", "welcome", "failed"],
  ]);
  expect(log[0].text).toBe(bm.text);
  expect(log[2].error).toBeTruthy();
});

test("staff send a free-text message to chosen contacts, logged like all others; operator Members can't", async () => {
  const o = await operator();
  await o.staff.json("POST", o.base, { name: "Aminah", phone: "0135550001", role: "counter" });
  const both = await o.staff.json<{ contacts: Contact[] }>("POST", o.base, { name: "Hafiz", phone: "0135550002", role: "counter" });
  const [a, h] = both.body.contacts;
  const msg = `${o.base}/message`;
  const text = "Closed Sunset ride, Thu 6 Nov 20:00–22:00, 5 Customers asked to choose a Refund or Reschedule";

  expect((await (await member("operator", o.id)).json("POST", msg, { contactIds: [a.id], text })).status).toBe(403);
  expect((await o.staff.json("POST", msg, { contactIds: [], text })).body).toMatchObject({ field: "contactIds" });
  expect((await o.staff.json("POST", msg, { contactIds: [a.id], text: "  " })).body).toMatchObject({ field: "text" });
  const other = await operator();
  const theirs = await other.staff.json<{ contacts: Contact[] }>("POST", other.base, { name: "Zul", phone: "0135550003", role: "counter" });
  expect((await o.staff.json("POST", msg, { contactIds: [a.id, theirs.body.contacts[0].id], text })).status).toBe(404);

  const res = await o.staff.json("POST", msg, { contactIds: [h.id, h.id], text: ` ${text} ` });
  expect(res.body).toEqual({ sent: 1, failed: 0 });
  expect(sentTo("+60135550002").map((m) => m.text)).toContain(text);
  expect(sentTo("+60135550001").map((m) => m.text)).not.toContain(text);
  const logged = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.contactId, h.id), eq(whatsappMessages.template, "staff")));
  expect(logged).toMatchObject([{ operatorId: o.id, phone: "+60135550002", text, status: "sent" }]);
});
