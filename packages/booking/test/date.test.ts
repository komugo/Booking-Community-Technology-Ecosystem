import { env, runInDurableObject } from "cloudflare:test";
import { klDate, klWeekday, WEEKDAYS, type OpeningHours } from "@komugo/types";
import { expect, test } from "vitest";
import { migrate } from "../src/migrations";
import { customer, HOUR, kl, operator, rid, UNDO_V15, UNDO_V16 } from "./helpers";

const d1 = (q: string, ...p: unknown[]) =>
  env.DB.prepare(q)
    .bind(...p)
    .all()
    .then((r) => r.results);

const ALL_WEEK: OpeningHours[] = [{ days: WEEKDAYS, opens: "08:00", closes: "22:00" }];
const dayAfter = (n: number) => klDate(Date.now() + n * 24 * HOUR);

async function dateWorld(dailyLimit: number | null = null, hours = ALL_WEEK) {
  const w = await operator();
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, requiresWaiver: false });
  await w.b.setHours([{ activityId: w.activityId, hours }]);
  const optionId = await w.option({ ticketType: "date", dailyLimit, nameEn: "Day pass", nameMs: "Pas harian", priceSen: 1500 }, []);
  const on = async (date: string) =>
    (await w.sql("SELECT id FROM timeslots WHERE option_id = ? AND starts_at = ?", optionId, kl(`${date}T08:00`)))[0]?.id as string;
  return { ...w, optionId, on, tomorrow: await on(dayAfter(1)) };
}

test("a Date ticket Option gets one Timeslot per open date, spanning that date's opening hours", async () => {
  const w = await dateWorld(null, [{ days: WEEKDAYS.filter((d) => d !== klWeekday(dayAfter(2))), opens: "08:00", closes: "22:00" }]);
  const rows = await w.sql("SELECT starts_at, ends_at FROM timeslots WHERE option_id = ? ORDER BY starts_at", w.optionId);
  expect(rows.length).toBeGreaterThan(50);
  expect(rows.every((r) => Number(r.ends_at) - Number(r.starts_at) === 14 * HOUR)).toBe(true);
  expect(await w.on(dayAfter(2))).toBeUndefined();
  expect(w.tomorrow).toBeDefined();
  expect((await w.b.timeslots({ ids: [w.tomorrow] }))[0]).toMatchObject({ endsAt: kl(`${dayAfter(1)}T22:00`), spots: 999 });
});

test("a Customer buys Date tickets for named Participants and the date's hours are on each Ticket", async () => {
  const w = await dateWorld();
  const customerId = await customer();
  const people = [await w.participant(customerId), await w.participant(customerId, { name: "Adam", birthDate: "2015-01-01" })];
  const h = await w.hold(customerId, w.tomorrow, people);
  expect(h.amountSen).toBe(3000);
  const r = await w.pay(h);
  if (r.status !== "paid") throw new Error(r.reason);
  const v = await w.b.bookingView(r.bookingId);
  expect(v.tickets).toHaveLength(2);
  expect(v.tickets[0]).toMatchObject({ startsAt: kl(`${dayAfter(1)}T08:00`), endsAt: kl(`${dayAfter(1)}T22:00`), court: null, priceSen: 1500 });
  await w.flush();
  expect(await d1("SELECT ticket_type, daily_limit FROM proj_options WHERE id = ?", w.optionId)).toEqual([{ ticket_type: "date", daily_limit: null }]);
  expect(await d1("SELECT ends_at FROM proj_tickets WHERE id = ?", r.ticketIds[0])).toEqual([{ ends_at: kl(`${dayAfter(1)}T22:00`) }]);
});

test("the Daily limit counts Holds, and lowering it below what's sold stops sales but keeps the Tickets", async () => {
  const w = await dateWorld(2);
  const [a, b] = [await customer(), await customer()];
  const spots = async () => (await w.b.timeslots({ ids: [w.tomorrow] }))[0].spots;
  const held = await w.hold(a, w.tomorrow, [await w.participant(a)]);
  expect(await spots()).toBe(1);
  await expect(w.hold(b, w.tomorrow, [await w.participant(b), await w.participant(b, { name: "Adam" })])).rejects.toMatchObject({
    code: "no_availability",
  });
  const r = await w.pay(held);
  const { ticketIds } = await w.book(b, w.tomorrow, [await w.participant(b, { name: "Siti" })]);
  expect(await spots()).toBe(0);
  await w.editOption(w.optionId, { dailyLimit: 1 });
  expect(await spots()).toBe(0);
  const c = await customer();
  await expect(w.hold(c, w.tomorrow, [await w.participant(c)])).rejects.toMatchObject({ code: "no_availability" });
  expect(r.status).toBe("paid");
  expect((await w.b.timeslots({ ids: [w.tomorrow] }))[0].tickets.map((t) => t.id)).toContain(ticketIds[0]);
});

test("a Date ticket Hold and a Timeslot Hold for the same Participant on that date don't release each other", async () => {
  const w = await dateWorld();
  await w.resource();
  await w.resource({ name: "Kilat" });
  const rideId = await w.option();
  const [a, b] = [await customer(), await customer()];
  const [p, q] = [await w.participant(a), await w.participant(b)];
  const holds = [
    await w.hold(a, await w.slot(rideId, kl(`${dayAfter(1)}T08:30`)), [p]),
    await w.hold(a, w.tomorrow, [p]),
    await w.hold(b, w.tomorrow, [q]),
    await w.hold(b, await w.slot(rideId, kl(`${dayAfter(1)}T08:00`)), [q]),
  ];
  const active = await w.sql("SELECT id FROM holds WHERE status = 'active'");
  expect(active.map((h) => h.id).sort()).toEqual(holds.map((h) => h.holdId).sort());
});

test("same-day Date tickets sell until the Booking cutoff before closing time", async () => {
  const w = await dateWorld();
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, bookingCutoffMinutes: 60 });
  const today = w.tomorrow;
  const close = async (minutes: number) => w.sql("UPDATE timeslots SET starts_at = ?, ends_at = ? WHERE id = ?", Date.now() - HOUR, Date.now() + minutes * 60_000, today);
  const c = await customer();
  await close(90);
  expect((await w.b.timeslots({ ids: [today] }))[0].spots).toBe(999);
  await w.book(c, today, [await w.participant(c)]);
  await close(30);
  await expect(w.hold(c, today, [await w.participant(c, { name: "Adam" })])).rejects.toMatchObject({ code: "not_bookable" });
});

test("a Date ticket checks in only on its date, once", async () => {
  const w = await dateWorld();
  const c = await customer();
  const { ticketIds } = await w.book(c, w.tomorrow, [await w.participant(c)]);
  const code = ticketIds[0].slice(0, 8);
  expect((await w.b.checkIn({ requestId: rid(), code })).outcome).toBe("not_today");
  await w.sql("UPDATE timeslots SET starts_at = ?, ends_at = ? WHERE id = ?", Date.now() - HOUR, Date.now() + HOUR, w.tomorrow);
  expect((await w.b.checkIn({ requestId: rid(), code })).outcome).toBe("checked_in");
  expect((await w.b.checkIn({ requestId: rid(), code })).outcome).toBe("already");
});

test("a date open past midnight checks in until it closes", async () => {
  const w = await dateWorld();
  const c = await customer();
  const { ticketIds } = await w.book(c, w.tomorrow, [await w.participant(c)]);
  await w.sql("UPDATE timeslots SET starts_at = ?, ends_at = ? WHERE id = ?", kl(`${dayAfter(-1)}T18:00`), Date.now() + HOUR, w.tomorrow);
  expect((await w.b.checkIn({ requestId: rid(), code: ticketIds[0].slice(0, 8) })).outcome).toBe("checked_in");
});

test("a date can't be closed once it has opened", async () => {
  const w = await dateWorld();
  await w.sql("UPDATE timeslots SET starts_at = ?, ends_at = ? WHERE id = ?", Date.now() - HOUR, Date.now() + HOUR, w.tomorrow);
  await expect(w.b.closeTimeslot(w.tomorrow, "weather")).rejects.toMatchObject({ code: "invalid_state" });
});

test("closing a date lists its Tickets, and they reschedule to another date", async () => {
  const w = await dateWorld();
  const c = await customer();
  const p = await w.participant(c);
  const { bookingId, ticketIds } = await w.book(c, w.tomorrow, [p]);
  const { affected } = await w.b.closeTimeslot(w.tomorrow, "maintenance");
  expect(affected.map((t) => t.id)).toEqual(ticketIds);
  const target = await w.on(dayAfter(3));
  await w.reschedule(c, { bookingId }, ticketIds, target, [p], rid(), true);
  expect((await w.b.bookingView(bookingId)).tickets[0]).toMatchObject({ timeslotId: target, endsAt: kl(`${dayAfter(3)}T22:00`) });
});

test("changing the hours moves open dates in place; a booked date that loses its hours is kept", async () => {
  const w = await dateWorld();
  const c = await customer();
  await w.book(c, w.tomorrow, [await w.participant(c)]);
  const other = await w.on(dayAfter(3));
  const shut = [klWeekday(dayAfter(1)), klWeekday(dayAfter(3))];
  await w.b.setHours([{ activityId: w.activityId, hours: [{ days: WEEKDAYS.filter((d) => !shut.includes(d)), opens: "07:00", closes: "21:00" }] }]);
  const [kept, closed] = await w.sql("SELECT id, closed_reason FROM timeslots WHERE id IN (?, ?) ORDER BY starts_at", w.tomorrow, other);
  expect(kept).toEqual({ id: w.tomorrow, closed_reason: null });
  expect(closed).toEqual({ id: other, closed_reason: "schedule" });
  const moved = await w.sql("SELECT starts_at, ends_at FROM timeslots WHERE option_id = ? AND starts_at >= ? LIMIT 1", w.optionId, kl(`${dayAfter(5)}T00:00`));
  expect(Number(moved[0].ends_at) - Number(moved[0].starts_at)).toBe(14 * HOUR);
  expect(new Date(Number(moved[0].starts_at) + 8 * HOUR).toISOString().slice(11, 16)).toBe("07:00");
});

test("a Date ticket Option is per person with no Resources, keeps its Ticket type, and isn't Pack-eligible", async () => {
  const w = await dateWorld();
  for (const patch of [{ ticketType: "timeslot" as const }, { needs: [{ kind: "instructor" as const, quantity: 1 }] }]) {
    await expect(w.editOption(w.optionId, patch)).rejects.toMatchObject({ code: "invalid_state" });
  }
  await expect(w.option({ ticketType: "date", bookingUnit: "court" }, [])).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.option({ dailyLimit: 5 })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.offer({ optionIds: [w.optionId] })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.b.createTimeslots({ optionId: w.optionId, startsAt: [Date.now() + 48 * HOUR] })).rejects.toMatchObject({ code: "invalid_state" });
});

test("the Date ticket migration keeps Options as Timeslot tickets with no Daily limit", async () => {
  const w = await operator();
  const optionId = await w.option();
  await runInDurableObject(w.stub, (_, s) => {
    const sql = s.storage.sql;
    for (const q of [...UNDO_V16, ...UNDO_V15]) sql.exec(q);
    sql.exec("UPDATE meta SET schema_version = 14");
    migrate(s.storage);
    expect(sql.exec("SELECT id, ticket_type, daily_limit FROM options").toArray()).toEqual([{ id: optionId, ticket_type: "timeslot", daily_limit: null }]);
    expect(sql.exec("SELECT hours FROM activities").toArray()).toEqual([{ hours: "[]" }]);
  });
});
