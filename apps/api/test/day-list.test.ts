import { env } from "cloudflare:test";
import { activities, operatorContacts } from "@komugo/db";
import { klDate, WEEKDAYS } from "@komugo/types";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { listLink } from "../src/day-list";
import { devInbox } from "../src/email";
import { booked, client, d1, DAY_MS, db, HOUR, kl, member, rid, SLOT_AT, slotAt, world, type World } from "./helpers";

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

const apiPath = (link: string) => {
  const u = new URL(link);
  return `/lists${u.pathname.replace(/^(\/ms)?\/list/, "")}${u.search}`;
};

const today = () => klDate(Date.now());
const todayEnds = () => Date.parse(`${today()}T00:00:00+08:00`) + DAY_MS;

// Books the world's Timeslot, then moves it to later today, so its Day list is today's.
async function bookedToday(w: World, people: Parameters<typeof booked>[1] = [{}]) {
  const b = await booked(w, people);
  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", Math.min(Date.now() + HOUR, todayEnds() - 60_000), w.timeslotId);
  return b;
}

test("a future day's Day list shows its Tickets with no close action", async () => {
  const w = await world();
  const b = await booked(w, [{ name: "Aisyah" }, { name: "Adam" }]);
  const to = await contacts(w);
  const cl = client();
  const path = apiPath(await listLink(env, w.operatorId, "2030-01-15", to.en));
  const list = await cl.json("GET", path);
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
        groups: [{ name: "Aiman Rahman", codes: b.ticketIds.map((id) => id.slice(0, 8).toUpperCase()), names: ["Aisyah", "Adam"], court: null, endsAt: null }],
        horse: true,
        customers: 1,
        closable: false,
      },
    ],
  });
  expect(await cl.json("POST", path, { timeslotId: w.timeslotId, reason: "weather" })).toEqual({ status: 410, body: { code: "link_expired" } });
  expect(await d1("SELECT count(*) AS n FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toEqual([{ n: 0 }]);

  await w.b.closeTimeslot(w.timeslotId, "weather");
  expect((await cl.json("GET", path)).body.timeslots[0]).toMatchObject({ closed: true, groups: [], closable: false });
});

test("a tampered, expired or removed contact's Day list link is refused", async () => {
  const w = await world();
  const to = await contacts(w);
  const cl = client();
  const path = apiPath(await listLink(env, w.operatorId, "2030-01-15", to.en));
  expect((await cl.json("GET", path)).status).toBe(200);
  expect((await cl.json("GET", path.replace("2030-01-15", "2030-01-16"))).status).toBe(404);
  expect((await cl.json("GET", path.replace("k=", "k=zz"))).status).toBe(404);
  expect((await cl.json("GET", path.replace(/&k=.*/, ""))).status).toBe(404);
  expect((await cl.json("POST", path.replace("k=", "k=zz"), { timeslotId: w.timeslotId, reason: "weather" })).status).toBe(404);

  const yesterday = new Date(Date.now() + 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  const expired = await cl.json("GET", apiPath(await listLink(env, w.operatorId, yesterday, to.en)));
  expect(expired).toMatchObject({ status: 410, body: { code: "link_expired" } });

  expect((await cl.json("GET", path.replace(to.en.id, to.ms.id))).status).toBe(404);
  await db.delete(operatorContacts).where(eq(operatorContacts.id, to.en.id));
  expect((await cl.json("GET", path)).status).toBe(404);
});

test("on the day, a Timeslot closes from the Day list like the dashboard does, once, and shows the contact who closed it", async () => {
  const w = await world({ horses: 3 });
  const a = await booked(w);
  await booked(w, [{ name: "Ali" }], { customer: { id: a.customerId, email: a.email } });
  const b = await bookedToday(w, [{ name: "Abu" }]);
  const to = await contacts(w);
  const cl = client();
  const path = apiPath(await listLink(env, w.operatorId, today(), to.en));
  const other = await slotAt(w, SLOT_AT + DAY_MS);

  expect((await cl.json("GET", path)).body.timeslots).toMatchObject([{ id: w.timeslotId, customers: 2, closable: true, closed: false }]);
  expect((await cl.json("POST", path, { timeslotId: other, reason: "weather" })).status).toBe(404);
  expect((await cl.json("POST", path, { timeslotId: w.timeslotId, reason: "nope" })).status).toBe(400);
  expect(await cl.json("POST", path, { timeslotId: w.timeslotId, reason: "maintenance" })).toEqual({ status: 204, body: null });
  expect(await d1("SELECT customer_id FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toHaveLength(3);
  expect(devInbox.filter((e) => e.to === a.email)).toHaveLength(2);
  expect(devInbox.filter((e) => e.to === b.email)).toHaveLength(1);

  const staff = await member("staff");
  const [slot] = (await staff.json("GET", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}`)).body.timeslots;
  expect(slot).toMatchObject({ closedReason: "maintenance", closedBy: "Siti" });
  expect((await cl.json("GET", path)).body.timeslots[0]).toMatchObject({ closed: true, closedBy: "Siti", groups: [], closable: false });

  expect(await cl.json("POST", path, { timeslotId: w.timeslotId, reason: "weather" })).toEqual({ status: 409, body: { code: "already_closed" } });
  expect(devInbox.filter((e) => e.to === b.email)).toHaveLength(1);
});

test("a started Timeslot can't be closed from the Day list, and one closed by staff shows no contact", async () => {
  const w = await world();
  await bookedToday(w);
  const to = await contacts(w);
  const cl = client();
  const path = apiPath(await listLink(env, w.operatorId, today(), to.en));
  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", Math.max(todayEnds() - DAY_MS, Date.now() - 60_000), w.timeslotId);
  expect((await cl.json("GET", path)).body.timeslots[0]).toMatchObject({ closed: false, closable: false });
  expect(await cl.json("POST", path, { timeslotId: w.timeslotId, reason: "weather" })).toEqual({ status: 410, body: { code: "link_expired" } });
  expect(await d1("SELECT count(*) AS n FROM closure_notices WHERE timeslot_id = ?", w.timeslotId)).toEqual([{ n: 0 }]);

  await w.doSql("UPDATE timeslots SET starts_at = ? WHERE id = ?", Math.min(Date.now() + HOUR, todayEnds() - 60_000), w.timeslotId);
  const m = await member("operator", w.operatorId);
  await m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${w.timeslotId}/close`, { reason: "weather" });
  expect((await cl.json("GET", path)).body.timeslots[0]).toMatchObject({ closed: true, closedBy: null });
  expect(await cl.json("POST", path, { timeslotId: w.timeslotId, reason: "weather" })).toEqual({ status: 409, body: { code: "already_closed" } });
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

  const code = b.ticketIds[0].slice(0, 8).toUpperCase();
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

test("Date tickets show by name with no time, and tomorrow's date has no close action", async () => {
  const g = await gym();
  const a = await booked(g, [{ name: "Aisyah" }, { name: "Adam" }], { timeslotId: g.dateSlot });
  const b = await booked(g, [{ name: "Ali" }], { timeslotId: g.dateSlot });
  const to = await contacts(g);

  const codes = (ids: string[]) => ids.map((id) => id.slice(0, 8).toUpperCase());
  const cl = client();
  const path = apiPath(await listLink(env, g.operatorId, g.date, to.en));
  const day = (await cl.json("GET", path)).body.timeslots.find((s: { id: string }) => s.id === g.dateSlot);
  expect(day).toMatchObject({
    date: true,
    customers: 2,
    closable: false,
    groups: [
      { names: ["Aisyah", "Adam"], codes: codes(a.ticketIds) },
      { names: ["Ali"], codes: codes(b.ticketIds) },
    ],
  });
  expect((await cl.json("POST", path, { timeslotId: g.dateSlot, reason: "maintenance" })).status).toBe(410);
});
