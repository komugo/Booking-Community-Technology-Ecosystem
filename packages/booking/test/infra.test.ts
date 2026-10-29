import { env, runInDurableObject } from "cloudflare:test";
import { klDate } from "@komugo/types";
import { expect, test } from "vitest";
import { migrate, migrations } from "../src/migrations";
import { tx } from "../src/tx";
import { DAY, kl, rid, rideWorld, UNDO_V6, UNDO_V8, UNDO_V9 } from "./helpers";

const stubFor = (op: string) => env.BOOKING.get(env.BOOKING.idFromName(op));

test("an RPC whose operatorId does not match the Durable Object throws", async () => {
  await runInDurableObject(stubFor(rid()), async (instance) => {
    await expect(instance.upsertActivity(rid(), { id: rid(), freeCancelHours: 1 })).rejects.toThrow("wrong_operator");
  });
});

test("a fresh Durable Object is at the latest schema version and re-running migrate is a no-op", async () => {
  await runInDurableObject(stubFor(rid()), (_, s) => {
    const objects = () => s.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master").one().n;
    const version = () => s.storage.sql.exec("SELECT schema_version AS v FROM meta").one().v;
    expect(version()).toBe(migrations.length);
    const before = objects();
    migrate(s.storage);
    expect(version()).toBe(migrations.length);
    expect(objects()).toBe(before);
  });
});

test("an async callback inside tx throws and leaves no rows", async () => {
  await runInDurableObject(stubFor(rid()), (_, s) => {
    const write = async () => {
      s.storage.sql.exec("INSERT INTO activities (id, free_cancel_hours) VALUES (?, 1)", rid());
    };
    expect(() => tx(s.storage, write as () => never)).toThrow("async_in_transaction");
    expect(s.storage.sql.exec("SELECT count(*) AS n FROM activities").one().n).toBe(0);
  });
});

test("migration 6 on a v5 Durable Object keeps its rows and defaults the new columns", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const { ticketIds } = await w.book(w.customerId, ts, [await w.participant(w.customerId)]);
  await runInDurableObject(w.stub, (_, s) => {
    const sql = s.storage.sql;
    for (const q of [...UNDO_V8, ...UNDO_V6]) sql.exec(q);
    sql.exec("UPDATE meta SET schema_version = 5");
    migrate(s.storage);
    expect(sql.exec("SELECT schema_version AS v FROM meta").one().v).toBe(migrations.length);
    expect(sql.exec("SELECT closed_days FROM activities").toArray()).toEqual([{ closed_days: "[]" }]);
    expect(sql.exec("SELECT id, schedule_id, closed_reason FROM timeslots").toArray()).toEqual([
      { id: ts, schedule_id: null, closed_reason: null },
    ]);
    expect(sql.exec("SELECT id, status, checked_in_at FROM tickets").toArray()).toEqual([
      { id: ticketIds[0], status: "issued", checked_in_at: null },
    ]);
    expect(sql.exec("SELECT count(*) AS n FROM schedules").one().n).toBe(0);
  });
});

test("migration 7 closes free step-4 Timeslots so a Schedule adopts the times it wants and Closed days stay closed", async () => {
  const w = await rideWorld();
  // Schedules only generate within the 60-day horizon, so use the Monday 1 to 2 weeks out.
  const monDay = klDate(Date.now() + (7 + ((8 - new Date(Date.now() + 8 * 3_600_000).getUTCDay()) % 7)) * 86_400_000);
  const tueDay = klDate(kl(`${monDay}T12:00`) + 86_400_000);
  const tue = kl(`${tueDay}T09:00`);
  const mon = kl(`${monDay}T09:00`);
  const booked = await w.slot(w.optionId, kl(`${tueDay}T11:00`));
  await w.book(w.customerId, booked, [await w.participant(w.customerId)]);
  const [free, monday] = [await w.slot(w.optionId, tue), await w.slot(w.optionId, mon)];
  await runInDurableObject(w.stub, (_, s) => {
    for (const q of [...UNDO_V9, ...UNDO_V8]) s.storage.sql.exec(q);
    s.storage.sql.exec("UPDATE meta SET schema_version = 6");
    s.storage.sql.exec("DELETE FROM outbox");
    migrate(s.storage);
    expect(s.storage.sql.exec("SELECT entity_id FROM outbox ORDER BY entity_id").toArray()).toEqual(
      [free, monday].sort().map((entity_id) => ({ entity_id })),
    );
  });
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, closedDays: ["Mo"] });
  await w.b.upsertSchedule({
    id: rid(),
    activityId: w.activityId,
    optionIds: [w.optionId],
    weekdays: ["Mo", "Tu"],
    times: ["09:00"],
    startsOn: monDay,
    endsOn: tueDay,
    priceSen: null,
    active: true,
  });
  const rows = await w.sql("SELECT id, schedule_id IS NOT NULL AS scheduled, closed_reason FROM timeslots WHERE id IN (?, ?, ?)", free, monday, booked);
  expect(rows).toEqual(
    expect.arrayContaining([
      { id: free, scheduled: 1, closed_reason: null },
      { id: monday, scheduled: 0, closed_reason: "schedule" },
      { id: booked, scheduled: 0, closed_reason: null },
    ]),
  );
});
