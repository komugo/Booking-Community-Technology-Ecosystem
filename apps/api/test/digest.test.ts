import { env } from "cloudflare:test";
import { operatorContacts } from "@komugo/db";
import { expect, test } from "vitest";
import { cron } from "../src/cron";
import { DIGEST, listLink } from "../src/digest";
import { devOutbox } from "../src/whatsapp";
import { booked, client, db, kl, slotAt, world, type World } from "./helpers";

const phone = () => `+6018${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function contacts(w: World) {
  const en = phone();
  const ms = phone();
  await db.insert(operatorContacts).values([
    { operatorId: w.operatorId, name: "Siti", phone: en, role: "counter", locale: "en", createdAt: Date.now() },
    { operatorId: w.operatorId, name: "Aminah", phone: ms, role: "owner", locale: "ms", createdAt: Date.now() },
  ]);
  return { en, ms };
}

const sent = (to: string) => devOutbox.filter((m) => m.to === to).map((m) => m.text);
const apiPath = (link: string) => {
  const u = new URL(link);
  return `/lists${u.pathname.replace(/^(\/ms)?\/list/, "")}${u.search}`;
};

test("at 9pm KL every contact gets tomorrow's Tickets in their language, with a today's list link", async () => {
  const w = await world();
  const b = await booked(w, [{ name: "Aisyah" }, { name: "Adam" }]);
  const to = await contacts(w);
  await cron(env, () => {}, kl("2030-01-14T21:00"), DIGEST);

  const codes = b.ticketIds.map((id) => id.slice(0, 8).toUpperCase());
  const [en] = sent(to.en);
  expect(en).toContain("Test Stable: Tickets for tomorrow, 15 Jan 2030");
  expect(en).toContain(`09:00 Ride\n• Aiman Rahman: ${codes.join(", ")}`);
  const [ms] = sent(to.ms);
  expect(ms).toContain("Tiket untuk esok");
  expect(ms).toContain("09:00 Tunggang");

  const link = en.match(/https:\/\/web\.test\/list\/\S+/)![0];
  expect(link).toBe(await listLink(env, w.operatorId, "2030-01-15", "en"));
  expect(ms).toContain(await listLink(env, w.operatorId, "2030-01-15", "ms"));

  const cl = client();
  const list = await cl.json("GET", apiPath(link));
  expect(list.status).toBe(200);
  expect(list.body).toEqual({
    operator: "Test Stable",
    date: "2030-01-15",
    timeslots: [
      { id: w.timeslotId, startsAt: kl("2030-01-15T09:00"), closed: false, option: { nameEn: "Ride", nameMs: "Tunggang" }, groups: [{ name: "Aiman Rahman", codes }] },
    ],
  });

  await w.b.closeTimeslot(w.timeslotId, "weather");
  expect((await cl.json("GET", apiPath(link))).body.timeslots[0]).toMatchObject({ closed: true, groups: [] });
});

test("an empty day sends the one-liner; a Closed day sends nothing", async () => {
  const w = await world();
  const to = await contacts(w);
  await cron(env, () => {}, kl("2030-01-15T21:00"), DIGEST);
  expect(sent(to.en)[0]).toContain("No bookings tomorrow.");
  expect(sent(to.ms)[0]).toContain("Tiada tempahan esok.");

  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, closedDays: ["Th"] });
  await cron(env, () => {}, kl("2030-01-16T21:00"), DIGEST);
  expect(sent(to.en)).toHaveLength(1);

  const open = await slotAt(w, kl("2030-01-17T10:00"));
  const shut = await slotAt(w, kl("2030-01-17T11:00"));
  await booked(w, [{}], { timeslotId: open });
  await booked(w, [{}], { timeslotId: shut });
  await w.b.closeTimeslot(shut, "weather");
  await cron(env, () => {}, kl("2030-01-16T21:00"), DIGEST);
  expect(sent(to.en)).toHaveLength(2);
  expect(sent(to.en)[0]).toContain("10:00 Ride");
  expect(sent(to.en)[0]).not.toContain("11:00");
});

test("a tampered or expired today's list link is refused", async () => {
  const w = await world();
  const cl = client();
  const path = apiPath(await listLink(env, w.operatorId, "2030-01-15", "en"));
  expect((await cl.json("GET", path)).status).toBe(200);
  expect((await cl.json("GET", path.replace("2030-01-15", "2030-01-16"))).status).toBe(404);
  expect((await cl.json("GET", path.replace("k=", "k=zz"))).status).toBe(404);
  expect((await cl.json("GET", path.replace(/\?k=.*/, ""))).status).toBe(404);

  const yesterday = new Date(Date.now() + 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  const expired = await cl.json("GET", apiPath(await listLink(env, w.operatorId, yesterday, "en")));
  expect(expired).toMatchObject({ status: 410, body: { code: "link_expired" } });
});
