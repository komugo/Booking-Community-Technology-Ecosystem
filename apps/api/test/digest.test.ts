import { env } from "cloudflare:test";
import { activities, operatorContacts } from "@komugo/db";
import { klDate, WEEKDAYS } from "@komugo/types";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { cron } from "../src/cron";
import { closeLink, DIGEST, listLink } from "../src/digest";
import { devOutbox } from "../src/whatsapp";
import { booked, client, d1, DAY_MS, db, HOUR, kl, rid, SLOT_AT, slotAt, world, type World } from "./helpers";

const phone = () => `+6018${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function contacts(w: World) {
  const [en, ms] = await db
    .insert(operatorContacts)
    .values([
      { operatorId: w.operatorId, name: "Siti", phone: phone(), role: "counter", locale: "en", createdAt: Date.now() },
      { operatorId: w.operatorId, name: "Aminah", phone: phone(), role: "owner", locale: "ms", createdAt: Date.now() },
    ])
    .returning();
  return { en, ms };
}

const sent = (c: { phone: string }) => devOutbox.filter((m) => m.to === c.phone).map((m) => m.text);
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
  expect(en).toContain(`Close this time: ${await closeLink(env, w.operatorId, w.timeslotId, to.en)}`);
  expect(ms).toContain(`Tutup masa ini: ${await closeLink(env, w.operatorId, w.timeslotId, to.ms)}`);

  const link = en.match(/https:\/\/web\.test\/list\/\S+/)![0];
  expect(link).toBe(await listLink(env, w.operatorId, "2030-01-15", to.en));
  expect(ms).toContain(await listLink(env, w.operatorId, "2030-01-15", to.ms));

  const cl = client();
  const list = await cl.json("GET", apiPath(link));
  expect(list.status).toBe(200);
  expect(list.body).toEqual({
    operator: "Test Stable",
    date: "2030-01-15",
    timeslots: [
      {
        id: w.timeslotId,
        startsAt: kl("2030-01-15T09:00"),
        date: false,
        closed: false,
        closedBy: null,
        option: { nameEn: "Ride", nameMs: "Tunggang" },
        groups: [{ name: "Aiman Rahman", codes, names: ["Aisyah", "Adam"], court: null, endsAt: null }],
        closeK: new URL(await closeLink(env, w.operatorId, w.timeslotId, to.en)).searchParams.get("k"),
      },
    ],
  });

  await w.b.closeTimeslot(w.timeslotId, "weather");
  expect((await cl.json("GET", apiPath(link))).body.timeslots[0]).toMatchObject({ closed: true, groups: [], closeK: null });
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

test("a tampered, expired or removed contact's today's list link is refused", async () => {
  const w = await world();
  const to = await contacts(w);
  const cl = client();
  const path = apiPath(await listLink(env, w.operatorId, "2030-01-15", to.en));
  expect((await cl.json("GET", path)).status).toBe(200);
  expect((await cl.json("GET", path.replace("2030-01-15", "2030-01-16"))).status).toBe(404);
  expect((await cl.json("GET", path.replace("k=", "k=zz"))).status).toBe(404);
  expect((await cl.json("GET", path.replace(/&k=.*/, ""))).status).toBe(404);

  const yesterday = new Date(Date.now() + 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  const expired = await cl.json("GET", apiPath(await listLink(env, w.operatorId, yesterday, to.en)));
  expect(expired).toMatchObject({ status: 410, body: { code: "link_expired" } });

  expect((await cl.json("GET", path.replace(to.en.id, to.ms.id))).status).toBe(404);
  await db.delete(operatorContacts).where(eq(operatorContacts.id, to.en.id));
  expect((await cl.json("GET", path)).status).toBe(404);
});

test("a per-court Ticket shows its court and back-to-back hours once", async () => {
  const w = await world({
    horses: 0,
    requiresWaiver: false,
    option: { nameEn: "Court hire", nameMs: "Sewa gelanggang", minAge: null, maxWeightKg: null, bookingUnit: "court", needs: [{ kind: "court", quantity: 1 }] },
  });
  await w.b.upsertResource({ id: `c1_${rid()}`, kind: "court", name: "Court 1", active: true, maxSessionsPerDay: null, restMinutes: 0, maxRiderWeightKg: null });
  const next = await slotAt(w, SLOT_AT + HOUR);
  const b = await booked(w, [], { hours: 2 });
  const to = await contacts(w);
  await cron(env, () => {}, kl("2030-01-14T21:00"), DIGEST);

  const code = b.ticketIds[0].slice(0, 8).toUpperCase();
  const [en] = sent(to.en);
  expect(en).toContain(`09:00 Court hire\n• Court 1, 09:00–11:00 · Aiman Rahman: ${code}\nClose this time:`);
  expect(en).not.toContain("10:00 Court hire");
  expect(sent(to.ms)[0]).toContain(`09:00 Sewa gelanggang\n• Court 1, 09:00–11:00 · Aiman Rahman: ${code}`);

  const list = await client().json("GET", apiPath(await listLink(env, w.operatorId, "2030-01-15", to.en)));
  expect(list.body.timeslots.map((s: { id: string }) => s.id)).toEqual([w.timeslotId]);
  expect(list.body.timeslots[0].groups).toEqual([{ name: "Aiman Rahman", codes: [code], names: ["Aiman Rahman"], court: "Court 1", endsAt: SLOT_AT + 2 * HOUR }]);
  expect(list.body.timeslots.some((s: { id: string }) => s.id === next)).toBe(false);
});

// A Date ticket Option open 07:00–22:00 every day; its Timeslots are dates, so tomorrow is a real date.
async function gym() {
  const w = await world({ requiresWaiver: false });
  const hours = [{ days: WEEKDAYS, opens: "07:00", closes: "22:00" }];
  await db.update(activities).set({ openingHours: hours }).where(eq(activities.id, w.activityId));
  await w.b.setHours([{ activityId: w.activityId, hours }], []);
  const optionId = `date_${rid()}`;
  await w.b.upsertOption({
    id: optionId,
    activityId: w.activityId,
    nameEn: "Day pass",
    nameMs: "Pas harian",
    priceSen: 1500,
    durationMinutes: 60,
    minAge: null,
    maxAge: null,
    maxWeightKg: null,
    requiredCert: null,
    minParticipants: null,
    maxPerBooking: null,
    bookingUnit: "person",
    ticketType: "date",
    dailyLimit: null,
    weekendPriceSen: null,
    active: true,
    needs: [],
  });
  await w.flush();
  const date = klDate(Date.now() + DAY_MS);
  const [slot] = await d1<{ id: string }>("SELECT id FROM proj_timeslots WHERE option_id = ? AND starts_at = ?", optionId, kl(`${date}T07:00`));
  return { ...w, date, dateSlot: slot.id };
}

test("Date tickets show as a count per Option with names and no time; closing the date from today's list closes them", async () => {
  const g = await gym();
  const a = await booked(g, [{ name: "Aisyah" }, { name: "Adam" }], { timeslotId: g.dateSlot });
  const b = await booked(g, [{ name: "Ali" }], { timeslotId: g.dateSlot });
  const to = await contacts(g);
  await cron(env, () => {}, Date.now(), DIGEST);

  const codes = (ids: string[]) => ids.map((id) => id.slice(0, 8).toUpperCase());
  const [x, y] = [codes(a.ticketIds), codes(b.ticketIds)];
  const [en] = sent(to.en);
  expect(en).toContain(`Day pass: 3 tickets\n• Aiman Rahman: Aisyah ${x[0]}, Adam ${x[1]}\n• Aiman Rahman: Ali ${y[0]}\nClose this date:`);
  expect(en).not.toContain("07:00 Day pass");
  expect(sent(to.ms)[0]).toContain("Pas harian: 3 tiket");
  expect(sent(to.ms)[0]).toContain("Tutup tarikh ini:");

  const cl = client();
  const list = await cl.json("GET", apiPath(await listLink(env, g.operatorId, g.date, to.en)));
  const day = list.body.timeslots.find((s: { id: string }) => s.id === g.dateSlot);
  expect(day).toMatchObject({ date: true, groups: [{ names: ["Aisyah", "Adam"], codes: x }, { names: ["Ali"], codes: y }] });

  const close = `/closes/${g.operatorId}/${g.dateSlot}?c=${to.en.id}&k=${day.closeK}`;
  expect((await cl.json("GET", close)).body).toMatchObject({ customers: 2, timeslot: { id: g.dateSlot, date: true, closedAt: null } });
  expect(await cl.json("POST", close, { reason: "maintenance" })).toEqual({ status: 204, body: null });
  expect(await d1("SELECT customer_id FROM closure_notices WHERE timeslot_id = ?", g.dateSlot)).toHaveLength(2);
  const after = (await cl.json("GET", apiPath(await listLink(env, g.operatorId, g.date, to.en)))).body.timeslots.find((s: { id: string }) => s.id === g.dateSlot);
  expect(after).toMatchObject({ closed: true, closedBy: "Siti", groups: [], closeK: null });
});
