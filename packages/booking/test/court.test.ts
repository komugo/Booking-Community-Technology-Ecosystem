import { env, runInDurableObject } from "cloudflare:test";
import { klDate, WEEKDAYS } from "@komugo/types";
import { expect, test } from "vitest";
import { migrate } from "../src/migrations";
import { customer, DAY, kl, OLD_KIND_TABLES, operator, rid, UNDO_V14, UNDO_V15, UNDO_V16 } from "./helpers";

const d1 = (q: string, ...p: unknown[]) =>
  env.DB.prepare(q)
    .bind(...p)
    .all()
    .then((r) => r.results);

const COURT = { bookingUnit: "court" as const, nameEn: "Court hire", nameMs: "Sewa gelanggang", priceSen: 2000 };

async function courtWorld(courts = 2) {
  const w = await operator();
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, requiresWaiver: false });
  const optionId = await w.option(COURT, [["court", 1]]);
  const courtIds = [];
  for (let i = 1; i <= courts; i++) courtIds.push(await w.resource({ kind: "court", name: `Court ${i}` }));
  const ts = await w.slot(optionId, kl(`${DAY}T20:00`));
  return { ...w, optionId, courtIds, ts };
}

test("a Customer books a court for 1 hour with no Participants and gets one Ticket showing the court", async () => {
  const w = await courtWorld(1);
  const customerId = await customer();
  const h = await w.hold(customerId, w.ts, []);
  expect(h.amountSen).toBe(2000);
  const r = await w.pay(h);
  expect(r).toMatchObject({ status: "paid", ticketIds: [expect.any(String)] });
  if (r.status !== "paid") return;
  const v = await w.b.bookingView(r.bookingId);
  expect(v.tickets).toEqual([expect.objectContaining({ id: r.ticketIds[0], participantId: h.holdId, court: "Court 1", priceSen: 2000 })]);
  await w.flush();
  expect(await d1("SELECT participant_id, price_sen FROM proj_tickets WHERE id = ?", r.ticketIds[0])).toEqual([
    { participant_id: h.holdId, price_sen: 2000 },
  ]);
  expect(await d1("SELECT booking_unit FROM proj_options WHERE id = ?", w.optionId)).toEqual([{ booking_unit: "court" }]);
});

test("two Customers at the same hour get different courts and the hour is full once every court is taken", async () => {
  const w = await courtWorld(2);
  const [a, b, c] = [await customer(), await customer(), await customer()];
  const spots = async () => (await w.b.timeslots({ ids: [w.ts] }))[0].spots;
  expect(await spots()).toBe(2);
  const first = await w.book(a, w.ts, []);
  expect(await spots()).toBe(1);
  const second = await w.book(b, w.ts, []);
  expect(await spots()).toBe(0);
  const courts = [
    (await w.b.bookingView(first.bookingId)).tickets[0].court,
    (await w.b.bookingView(second.bookingId)).tickets[0].court,
  ];
  expect(courts.sort()).toEqual(["Court 1", "Court 2"]);
  await expect(w.hold(c, w.ts, [])).rejects.toMatchObject({ code: "no_availability" });
  expect((await w.b.timeslots({ ids: [w.ts] }))[0].tickets.map((t) => t.resources)).toEqual(
    expect.arrayContaining([["Court 1"], ["Court 2"]]),
  );
});

test("a paid Hold that expired meanwhile still gets a free court", async () => {
  const w = await courtWorld(1);
  const customerId = await customer();
  const h = await w.hold(customerId, w.ts, []);
  await w.expireHold(h.holdId);
  const r = await w.pay(h);
  expect(r).toMatchObject({ status: "paid" });
  if (r.status === "paid") expect((await w.b.bookingView(r.bookingId)).tickets[0].court).toBe("Court 1");
});

test("a paid court Hold that expired gets its own court, not the Customer's other court Hold", async () => {
  const w = await courtWorld(3);
  const customerId = await customer();
  const a = await w.hold(customerId, w.ts, []);
  const b = await w.hold(customerId, w.ts, []);
  await w.expireHold(a.holdId);
  const ra = await w.pay(a);
  const rb = await w.pay(b);
  expect(ra).toMatchObject({ status: "paid" });
  expect(rb).toMatchObject({ status: "paid" });
  if (ra.status !== "paid" || rb.status !== "paid") return;
  const courts = [(await w.b.bookingView(ra.bookingId)).tickets[0].court, (await w.b.bookingView(rb.bookingId)).tickets[0].court];
  expect(new Set(courts).size).toBe(2);
});

test("check-in works on a per-court Ticket", async () => {
  const w = await courtWorld(1);
  const customerId = await customer();
  const { ticketIds } = await w.book(customerId, w.ts, []);
  await w.startSlot(w.ts);
  const r = await w.b.checkIn({ requestId: rid(), code: ticketIds[0].slice(0, 8) });
  expect(r).toMatchObject({ outcome: "checked_in", ticket: { id: ticketIds[0], customerId } });
});

test("a per-court Hold takes no Participants and needs the Activity's Waiver off", async () => {
  const w = await courtWorld(1);
  const customerId = await customer();
  const p = await w.participant(customerId);
  await expect(w.hold(customerId, w.ts, [p])).rejects.toMatchObject({ code: "invalid_participant" });
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, requiresWaiver: true });
  await expect(w.hold(customerId, w.ts, [])).rejects.toMatchObject({ code: "not_bookable" });
});

test("a per-court Option needs exactly one court for 60 minutes, no Requirements, and keeps its Booking unit", async () => {
  const w = await courtWorld(1);
  const bad = [
    { durationMinutes: 90 },
    { minAge: 12 },
    { maxPerBooking: 4 },
    { needs: [{ kind: "court" as const, quantity: 2 }] },
    { needs: [{ kind: "court" as const, quantity: 1 }, { kind: "instructor" as const, quantity: 1 }] },
    { bookingUnit: "person" as const },
  ];
  for (const patch of bad) await expect(w.editOption(w.optionId, patch)).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.option({}, [["court", 1]])).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.resource({ kind: "squash" as never })).rejects.toMatchObject({ code: "invalid_state" });
});

test("per-court Options can't be added to a Pack offer", async () => {
  const w = await courtWorld(1);
  const ride = await w.option();
  await expect(w.offer({ optionIds: [w.optionId] })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.offer({ optionIds: [ride, w.optionId] })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.offer({ optionIds: [ride] })).resolves.toBeDefined();
});

test("a closed per-court Ticket reschedules whole onto a free court", async () => {
  const w = await courtWorld(1);
  const customerId = await customer();
  const target = await w.slot(w.optionId, kl(`${DAY}T21:00`));
  const { bookingId, ticketIds } = await w.book(customerId, w.ts, []);
  await w.b.closeTimeslot(w.ts, "maintenance");
  await w.reschedule(customerId, { bookingId }, ticketIds, target, [], rid(), true);
  expect((await w.b.bookingView(bookingId)).tickets[0]).toMatchObject({ timeslotId: target, court: "Court 1" });
});

test("the Resource kind migration keeps Resources, Option needs and Allocations and accepts courts", async () => {
  const w = await operator();
  const optionId = await w.option();
  const horse = await w.resource();
  const customerId = await customer();
  const ts = await w.slot(optionId, kl(`${DAY}T09:00`));
  await w.book(customerId, ts, [await w.participant(customerId)]);
  await runInDurableObject(w.stub, (_, s) => {
    const sql = s.storage.sql;
    for (const q of [...UNDO_V16, ...UNDO_V15, ...UNDO_V14, ...OLD_KIND_TABLES]) sql.exec(q);
    expect(() => sql.exec("INSERT INTO resources (id, kind, name) VALUES ('x', 'court', 'Court')")).toThrow();
    sql.exec("UPDATE meta SET schema_version = 13");
    migrate(s.storage);
    expect(sql.exec("SELECT id, kind FROM resources").toArray()).toEqual([{ id: horse, kind: "horse" }]);
    expect(sql.exec("SELECT option_id, kind, quantity FROM option_resources").toArray()).toEqual([{ option_id: optionId, kind: "horse", quantity: 1 }]);
    expect(sql.exec("SELECT resource_id FROM allocations").toArray()).toEqual([{ resource_id: horse }]);
    expect(sql.exec("SELECT booking_unit FROM options").toArray()).toEqual([{ booking_unit: "person" }]);
    expect(sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 'resources_kind'").one().n).toBe(1);
  });
  await w.resource({ kind: "court", name: "Court 1" });
});

async function hours(w: Awaited<ReturnType<typeof courtWorld>>) {
  const later = [await w.slot(w.optionId, kl(`${DAY}T21:00`)), await w.slot(w.optionId, kl(`${DAY}T22:00`))];
  const hold = (customerId: string, timeslotId: string, h: number) =>
    w.b.createHold({ requestId: rid(), customerId, replaces: null, timeslotId, hours: h, participantIds: [], addOns: [] });
  const book = async (customerId: string, timeslotId: string, h: number) => {
    const r = await w.pay(await hold(customerId, timeslotId, h));
    if (r.status !== "paid") throw new Error("not paid");
    return r;
  };
  return { ts: [w.ts, ...later], hold, book };
}

test("only lengths one court is free for are offered, and the Ticket keeps that court for every hour", async () => {
  const w = await courtWorld(2);
  const { ts, hold, book } = await hours(w);
  const maxHours = async () => {
    await w.flush();
    return (await d1("SELECT id, max_hours FROM proj_timeslots WHERE id IN (?, ?, ?)", ...ts)) as { id: string; max_hours: number }[];
  };
  expect(new Map((await maxHours()).map((r) => [r.id, r.max_hours]))).toEqual(new Map([[ts[0], 3], [ts[1], 2], [ts[2], 1]]));
  const [a, b, c] = [await customer(), await customer(), await customer()];
  await book(a, ts[1], 1);
  await book(b, ts[2], 1);
  expect(new Map((await maxHours()).map((r) => [r.id, r.max_hours]))).toEqual(new Map([[ts[0], 2], [ts[1], 1], [ts[2], 1]]));
  await expect(hold(c, ts[0], 3)).rejects.toMatchObject({ code: "no_availability" });

  const r = await book(c, ts[0], 2);
  const [ticket] = (await w.b.bookingView(r.bookingId)).tickets;
  const taken = new Set([(await w.b.timeslots({ ids: [ts[1]] }))[0].tickets.find((t) => t.customerId === a)!.resources[0]]);
  expect(taken.has(ticket.court!)).toBe(false);
  expect(ticket).toMatchObject({ hours: 2, priceSen: 4000, startsAt: kl(`${DAY}T20:00`), endsAt: kl(`${DAY}T22:00`) });
  const rows = await w.b.timeslots({ ids: ts.slice(0, 2) });
  expect(rows.map((s) => s.tickets.filter((t) => t.id === ticket.id).map((t) => [t.timeslotId, t.resources]))).toEqual([
    [[ts[0], [ticket.court]]],
    [[ts[0], [ticket.court]]],
  ]);
  expect(rows[1].spots).toBe(0);
  await w.flush();
  expect(await d1("SELECT starts_at, ends_at, price_sen FROM proj_tickets WHERE id = ?", ticket.id)).toEqual([
    { starts_at: kl(`${DAY}T20:00`), ends_at: kl(`${DAY}T22:00`), price_sen: 4000 },
  ]);
});

test("a Customer may hold 2 overlapping per-court Tickets per Activity unless the Operator allows more", async () => {
  const w = await courtWorld(6);
  const { ts, hold, book } = await hours(w);
  const a = await customer();
  await book(a, ts[0], 2);
  await hold(a, ts[1], 1);
  await expect(hold(a, ts[1], 2)).rejects.toMatchObject({ code: "court_limit" });
  await expect(hold(a, ts[1], 1)).rejects.toMatchObject({ code: "court_limit" });
  await expect(hold(a, ts[2], 1)).resolves.toBeDefined();
  const b = await customer();
  await book(b, ts[0], 1);
  await book(b, ts[1], 1);
  await expect(hold(b, ts[0], 2)).resolves.toBeDefined();
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, maxCourtTickets: 3 });
  await expect(hold(a, ts[1], 1)).resolves.toBeDefined();
  expect((await w.b.setup()).activities[0].maxCourtTickets).toBe(3);
});

test("closing one hour of a per-court Ticket closes the whole Ticket with one Closure choice on its first hour", async () => {
  const w = await courtWorld(1);
  const { ts, book } = await hours(w);
  const a = await customer();
  const { bookingId, ticketIds } = await book(a, ts[0], 2);
  const affected = [{ id: ticketIds[0], timeslotId: ts[0], customerId: a, bookingId }];
  expect((await w.b.closeTimeslot(ts[1], "maintenance")).affected).toMatchObject(affected);
  expect((await w.b.closeTimeslot(ts[0], "weather")).affected).toMatchObject(affected);
  expect((await w.b.bookingView(bookingId)).tickets[0].closedAt).not.toBeNull();
  expect((await w.b.timeslots({ ids: [ts[2]] }))[0].spots).toBe(1);
  const r = await w.cancel(a, { bookingId }, ticketIds, true);
  expect(r).toMatchObject({ refundSen: 4000, reason: "closure", tickets: [{ id: ticketIds[0], outcome: "cancelled" }] });
  expect((await w.b.bookingView(bookingId)).closureChoices).toEqual([expect.objectContaining({ timeslotId: ts[0], choice: "refund" })]);
});

test("a closed per-court Ticket reschedules whole to the same number of back-to-back hours on one court", async () => {
  const w = await courtWorld(1);
  const { ts, book } = await hours(w);
  const target = await w.slot(w.optionId, kl(`${DAY}T23:00`));
  const a = await customer();
  const { bookingId, ticketIds } = await book(a, ts[0], 2);
  await w.b.closeTimeslot(ts[1], "event");
  await expect(w.reschedule(a, { bookingId }, ticketIds, target, [], rid(), true)).rejects.toMatchObject({ code: "no_availability" });
  await w.reschedule(a, { bookingId }, ticketIds, ts[2], [], rid(), true);
  expect((await w.b.bookingView(bookingId)).tickets[0]).toMatchObject({ timeslotId: ts[2], hours: 2, court: "Court 1", closedAt: null });
});

test("a Schedule change keeps the later hours of a booked per-court Ticket open", async () => {
  const w = await courtWorld(1);
  const on = klDate(Date.now() + 2 * 86_400_000);
  const s = { id: rid(), activityId: w.activityId, optionIds: [w.optionId], weekdays: WEEKDAYS, times: ["20:00", "21:00"], startsOn: on, endsOn: on, priceSen: null, active: true };
  await w.b.upsertSchedule(s);
  const [first, second] = (await w.sql("SELECT id FROM timeslots WHERE schedule_id = ? ORDER BY starts_at", s.id)) as { id: string }[];
  await w.b.createHold({ requestId: rid(), customerId: await customer(), replaces: null, timeslotId: first.id, hours: 2, participantIds: [], addOns: [] });
  expect(await w.b.upsertSchedule({ ...s, times: ["20:00"] })).toMatchObject({ removed: 0, kept: [{ id: second.id }] });
});

test("back-to-back hours stop where the price changes, so a run costs its hourly price times its hours", async () => {
  const w = await courtWorld(1);
  const on = klDate(Date.now() + 2 * 86_400_000);
  const base = { activityId: w.activityId, optionIds: [w.optionId], weekdays: WEEKDAYS, startsOn: on, endsOn: on, active: true };
  await w.b.upsertSchedule({ ...base, id: rid(), times: ["20:00", "21:00"], priceSen: null });
  await w.b.upsertSchedule({ ...base, id: rid(), times: ["22:00"], priceSen: 3000 });
  const [first] = (await w.sql("SELECT id FROM timeslots WHERE schedule_id IS NOT NULL ORDER BY starts_at")) as { id: string }[];
  await w.flush();
  expect(await d1("SELECT max_hours FROM proj_timeslots WHERE id = ?", first.id)).toEqual([{ max_hours: 2 }]);
  const customerId = await customer();
  const hold = (h: number) => w.b.createHold({ requestId: rid(), customerId, replaces: null, timeslotId: first.id, hours: h, participantIds: [], addOns: [] });
  await expect(hold(3)).rejects.toMatchObject({ code: "no_availability" });
  await expect(hold(25)).rejects.toMatchObject({ code: "invalid_state" });
  await expect(hold(2)).resolves.toMatchObject({ amountSen: 4000 });
});

test("the court hours migration re-projects open per-court Timeslots so their max hours are set", async () => {
  const w = await courtWorld(1);
  await w.flush();
  await d1("UPDATE proj_timeslots SET max_hours = NULL WHERE id = ?", w.ts);
  await runInDurableObject(w.stub, (_, s) => {
    const sql = s.storage.sql;
    for (const q of UNDO_V16) sql.exec(q);
    sql.exec("UPDATE meta SET schema_version = 15");
    migrate(s.storage);
  });
  await w.flush();
  expect(await d1("SELECT max_hours FROM proj_timeslots WHERE id = ?", w.ts)).toEqual([{ max_hours: 1 }]);
});
