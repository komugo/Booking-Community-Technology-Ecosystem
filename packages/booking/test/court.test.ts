import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { migrate } from "../src/migrations";
import { customer, DAY, kl, OLD_KIND_TABLES, operator, rid, UNDO_V14 } from "./helpers";

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
    for (const q of [...UNDO_V14, ...OLD_KIND_TABLES]) sql.exec(q);
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
