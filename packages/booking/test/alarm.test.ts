import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { drain } from "../src/outbox";
import { DAY, kl, rideWorld } from "./helpers";

const alarmOf = (w: { stub: DurableObjectStub }) => runInDurableObject(w.stub, (_, s) => s.storage.getAlarm());

test("the alarm sits on the earliest Hold expiry once the outbox drains", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  await w.flush();
  expect(await alarmOf(w)).toBe(h.expiresAt);
});

test("an expired Hold is swept by the alarm, and a second run is a no-op", async () => {
  const w = await rideWorld();
  await w.resource();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const first = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  const second = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  await w.flush();
  await w.expireHold(first.holdId);
  await runDurableObjectAlarm(w.stub);
  await w.flush();
  expect(await w.sql("SELECT status FROM holds WHERE id = ?", first.holdId)).toEqual([{ status: "expired" }]);
  expect(await w.count("SELECT count(*) AS n FROM allocations WHERE hold_id = ?", first.holdId)).toBe(0);
  expect(await alarmOf(w)).toBe(second.expiresAt);

  const before = await w.sql("SELECT id, status FROM holds ORDER BY id");
  await runDurableObjectAlarm(w.stub);
  expect(await w.sql("SELECT id, status FROM holds ORDER BY id")).toEqual(before);
  expect(await w.count("SELECT count(*) AS n FROM outbox")).toBe(0);

  await w.expireHold(second.holdId);
  await runDurableObjectAlarm(w.stub);
  await w.flush();
  expect(await alarmOf(w)).toBeNull();
});

test("without the alarm, an expired Hold blocks neither createHold nor spots", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  await w.flush();
  await runInDurableObject(w.stub, async (_, s) => {
    s.storage.sql.exec("UPDATE holds SET created_at = created_at - 120000, expires_at = created_at - 60000");
    await s.storage.deleteAlarm();
    await drain(s.storage, w.operatorId, env.DB);
  });
  const spots = await env.DB.prepare("SELECT spots FROM proj_timeslots WHERE id = ?").bind(ts).first("spots");
  expect(spots).toBe(1);
  expect(await w.sql("SELECT status FROM holds WHERE id = ?", h.holdId)).toEqual([{ status: "expired" }]);

  await w.expireHold(h.holdId);
  await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
});

test("an alarm that fails before draining still re-arms in 30 s", async () => {
  const w = await rideWorld();
  const h = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [
    await w.participant(w.customerId),
  ]);
  await w.expireHold(h.holdId);
  await w.sql("ALTER TABLE requests RENAME TO requests_away");
  try {
    await runInDurableObject(w.stub, (instance) => instance.alarm());
    const alarm = (await alarmOf(w))!;
    expect(alarm - Date.now()).toBeGreaterThan(20_000);
    expect(alarm - Date.now()).toBeLessThanOrEqual(30_000);
  } finally {
    await w.sql("ALTER TABLE requests_away RENAME TO requests");
  }
  await w.flush();
});
