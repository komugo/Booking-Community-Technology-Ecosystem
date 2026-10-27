import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { cancelTicket } from "../src/engine";
import { drain, mark } from "../src/outbox";
import { tx } from "../src/tx";
import { DAY, kl, rid, rideWorld } from "./helpers";

const d1 = (query: string, ...params: unknown[]) =>
  env.DB.prepare(query)
    .bind(...params)
    .all()
    .then((r) => r.results);

test("confirm projects Tickets, Payment and Timeslot spots, then empties the outbox", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.flush();
  expect(await d1("SELECT spots FROM proj_timeslots WHERE id = ?", ts)).toEqual([{ spots: 1 }]);

  const p = await w.participant(w.customerId);
  const h = await w.hold(w.customerId, ts, [p]);
  const r = await w.pay(h, "bill-1-" + w.operatorId);
  await w.flush();
  if (r.status !== "paid") throw new Error("not paid");

  expect(await d1("SELECT * FROM proj_tickets WHERE operator_id = ?", w.operatorId)).toEqual([
    expect.objectContaining({
      id: r.ticketIds[0],
      customer_id: w.customerId,
      participant_id: p,
      booking_id: r.bookingId,
      pack_id: null,
      option_id: w.optionId,
      timeslot_id: ts,
      starts_at: kl(`${DAY}T09:00`),
      closed_at: null,
      price_sen: 10000,
      status: "issued",
    }),
  ]);
  expect(await d1("SELECT * FROM proj_payments WHERE operator_id = ?", w.operatorId)).toEqual([
    expect.objectContaining({
      bill_id: "bill-1-" + w.operatorId,
      hold_id: h.holdId,
      booking_id: r.bookingId,
      amount_sen: 10000,
      status: "paid",
      refund_reason: null,
    }),
  ]);
  expect(await d1("SELECT spots, option_id FROM proj_timeslots WHERE id = ?", ts)).toEqual([
    { spots: 0, option_id: w.optionId },
  ]);
  expect(await d1("SELECT free_cancel_hours, booking_cutoff_minutes FROM proj_activities WHERE id = ?", w.activityId)).toEqual([
    { free_cancel_hours: 24, booking_cutoff_minutes: 60 },
  ]);
  expect(await d1("SELECT name_en, price_sen, active FROM proj_options WHERE id = ?", w.optionId)).toEqual([
    { name_en: "Ride", price_sen: 10000, active: 1 },
  ]);
  expect(await w.count("SELECT count(*) AS n FROM outbox")).toBe(0);
});

test("an Add-on and an Option's min_participants reach proj_*", async () => {
  const w = await rideWorld();
  await w.editOption(w.optionId, { minParticipants: 2 });
  const addOnId = rid();
  await w.b.upsertAddOn({ id: addOnId, activityId: w.activityId, nameEn: "Helmet", nameMs: "Topi keledar", priceSen: 500, active: true });
  await w.flush();
  expect(await d1("SELECT min_participants FROM proj_options WHERE id = ?", w.optionId)).toEqual([{ min_participants: 2 }]);
  expect(await d1("SELECT * FROM proj_add_ons WHERE id = ?", addOnId)).toEqual([
    expect.objectContaining({
      operator_id: w.operatorId,
      activity_id: w.activityId,
      name_en: "Helmet",
      name_ms: "Topi keledar",
      price_sen: 500,
      active: 1,
    }),
  ]);
  await expect(
    w.b.upsertAddOn({ id: rid(), activityId: rid(), nameEn: "x", nameMs: "x", priceSen: 0, active: true }),
  ).rejects.toThrow("invalid_state");
});

test("redeem and cancel update proj_packs.sessions_used", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const { packId } = await w.pack(w.customerId, 3, kl("2030-12-31T00:00"));
  const {
    ticketIds: [ticketId],
  } = await w.redeem(w.customerId, packId, ts, [await w.participant(w.customerId)]);
  await w.flush();
  expect(await d1("SELECT sessions_total, sessions_used FROM proj_packs WHERE id = ?", packId)).toEqual([
    { sessions_total: 3, sessions_used: 1 },
  ]);
  await w.cancel(w.customerId, ticketId);
  await w.flush();
  expect(await d1("SELECT sessions_used FROM proj_packs WHERE id = ?", packId)).toEqual([{ sessions_used: 0 }]);
});

test("a Closure projects closed_at onto the Timeslot and its Tickets", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.book(w.customerId, ts, [await w.participant(w.customerId)]);
  await w.b.closeTimeslot(ts);
  await w.flush();
  const [slot] = await d1("SELECT closed_at, spots FROM proj_timeslots WHERE id = ?", ts);
  expect(slot).toMatchObject({ closed_at: expect.any(Number), spots: 0 });
  expect(await d1("SELECT closed_at FROM proj_tickets WHERE timeslot_id = ?", ts)).toEqual([
    { closed_at: slot.closed_at },
  ]);
});

test("an older or repeated projection version never overwrites a newer one", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.flush();
  const batches: D1PreparedStatement[][] = [];
  const recording = {
    prepare: (q: string) => env.DB.prepare(q),
    batch: (s: D1PreparedStatement[]) => (batches.push(s), env.DB.batch(s)),
  };
  const run = () => runInDurableObject(w.stub, (_, s) => drain(s.storage, w.operatorId, recording));

  await w.editOption(w.optionId, { priceSen: 11000 });
  await run();
  await w.editOption(w.optionId, { priceSen: 12000 });
  await run();
  const latest = await d1("SELECT price_sen, version FROM proj_options WHERE id = ?", w.optionId);
  expect(latest).toMatchObject([{ price_sen: 12000 }]);

  await env.DB.batch(batches[0]);
  expect(await d1("SELECT price_sen, version FROM proj_options WHERE id = ?", w.optionId)).toEqual(latest);
  await env.DB.batch(batches[1]);
  expect(await d1("SELECT price_sen, version FROM proj_options WHERE id = ?", w.optionId)).toEqual(latest);
});

test("a D1 outage keeps the outbox, retries in 30 s, and RPCs keep working", async () => {
  const w = await rideWorld();
  await w.resource();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.flush();
  await env.DB.exec("ALTER TABLE proj_tickets RENAME TO proj_tickets_away");
  try {
    await w.book(w.customerId, ts, [await w.participant(w.customerId)]);
    await runDurableObjectAlarm(w.stub);
    expect(await w.count("SELECT count(*) AS n FROM outbox")).toBeGreaterThan(0);
    const alarm = await runInDurableObject(w.stub, (_, s) => s.storage.getAlarm());
    expect(alarm! - Date.now()).toBeGreaterThan(20_000);
    expect(alarm! - Date.now()).toBeLessThanOrEqual(30_000);
    await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  } finally {
    await env.DB.exec("ALTER TABLE proj_tickets_away RENAME TO proj_tickets");
  }
  await w.flush();
  expect(await d1("SELECT count(*) AS n FROM proj_tickets WHERE operator_id = ?", w.operatorId)).toEqual([{ n: 1 }]);
});

test("a change made while a batch is in flight stays queued and is re-drained with a higher version", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const {
    ticketIds: [ticketId],
  } = await w.book(w.customerId, ts, [await w.participant(w.customerId)]);
  await w.flush();

  const versions: unknown[] = [];
  await runInDurableObject(w.stub, async (_, s) => {
    await s.storage.deleteAlarm();
    tx(s.storage, () => mark(s.storage.sql, "option", [w.optionId]));
    let mutated = false;
    await drain(s.storage, w.operatorId, {
      prepare: (q) => env.DB.prepare(q),
      batch: async (stmts) => {
        if (!mutated) {
          mutated = true;
          tx(s.storage, () => cancelTicket(s.storage.sql, Date.now(), { customerId: w.customerId, ticketId }));
        }
        const r = await env.DB.batch(stmts);
        versions.push((await d1("SELECT version FROM proj_tickets WHERE id = ?", ticketId))[0]?.version);
        return r;
      },
    });
  });
  expect(await d1("SELECT status FROM proj_tickets WHERE id = ?", ticketId)).toEqual([{ status: "cancelled" }]);
  expect(versions).toHaveLength(2);
  expect(versions[1]).toBeGreaterThan(versions[0] as number);
  expect(await w.count("SELECT count(*) AS n FROM outbox")).toBe(0);
});

test("projection versions keep rising after meta.rev is rewound, as by a restore", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const {
    ticketIds: [ticketId],
  } = await w.book(w.customerId, ts, [await w.participant(w.customerId)]);
  await w.flush();
  await w.sql("UPDATE meta SET rev = 1");
  await w.cancel(w.customerId, ticketId);
  await w.flush();
  expect(await d1("SELECT status FROM proj_tickets WHERE id = ?", ticketId)).toEqual([{ status: "cancelled" }]);
});

test("a row D1 rejects stays queued without blocking the rest", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.flush();
  await env.DB.exec("ALTER TABLE proj_options RENAME TO proj_options_away");
  try {
    await runInDurableObject(w.stub, async (_, s) => {
      await s.storage.deleteAlarm();
      tx(s.storage, () => {
        mark(s.storage.sql, "option", [w.optionId]);
        s.storage.sql.exec("UPDATE timeslots SET closed_at = 1 WHERE id = ?", ts);
        mark(s.storage.sql, "timeslot", [ts]);
      });
      await expect(drain(s.storage, w.operatorId, env.DB)).rejects.toThrow("outbox_rows_rejected");
      expect(s.storage.sql.exec("SELECT entity FROM outbox").toArray()).toEqual([{ entity: "option" }]);
    });
    expect(await d1("SELECT closed_at FROM proj_timeslots WHERE id = ?", ts)).toEqual([{ closed_at: 1 }]);
  } finally {
    await env.DB.exec("ALTER TABLE proj_options_away RENAME TO proj_options");
  }
  await w.flush();
});

test("an outbox row of an unknown entity is skipped, kept, and does not re-arm the alarm", async () => {
  const w = await rideWorld();
  await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.sql("INSERT INTO outbox (entity, entity_id, rev) VALUES ('booking', 'x', 0)");
  await runInDurableObject(w.stub, (instance) => instance.alarm());
  expect(await w.sql("SELECT entity FROM outbox")).toEqual([{ entity: "booking" }]);
  expect(await runInDurableObject(w.stub, (_, s) => s.storage.getAlarm())).toBeNull();
});
