import { expect, test } from "vitest";
import { DAY, kl, rid, rideWorld } from "./helpers";

test("deactivating a horse during a Hold: confirm still works, new Holds skip it", async () => {
  const w = await rideWorld();
  const h = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [await w.participant(w.customerId)]);
  await w.editResource(w.horseId, { active: false });
  expect(await w.pay(h)).toMatchObject({ status: "paid" });
  await expect(
    w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T12:00`)), [await w.participant(w.customerId)]),
  ).rejects.toMatchObject({ code: "no_availability" });
});

test("upsertResource marks every open future Timeslot", async () => {
  const w = await rideWorld();
  const slots = [await w.slot(w.optionId, kl(`${DAY}T09:00`)), await w.slot(w.optionId, kl("2030-03-01T09:00"))];
  await w.flush();
  await w.editResource(w.horseId, { maxSessionsPerDay: 3 });
  const queued = await w.sql("SELECT entity_id FROM outbox WHERE entity = 'timeslot' ORDER BY entity_id");
  expect(queued.map((r) => r.entity_id)).toEqual([...slots].sort());
});

test("an Option cannot move to another Activity, and a Resource cannot change kind", async () => {
  const w = await rideWorld();
  const other = rid();
  await w.b.upsertActivity({ id: other, freeCancelHours: 0 });
  await expect(w.editOption(w.optionId, { activityId: other })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.editResource(w.horseId, { kind: "instructor" })).rejects.toMatchObject({ code: "invalid_state" });
});

test("lengthening an Option or a rest gap under live Allocations is invalid_state", async () => {
  const w = await rideWorld();
  await w.book(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [await w.participant(w.customerId)]);
  await expect(w.editOption(w.optionId, { durationMinutes: 120 })).rejects.toMatchObject({ code: "invalid_state" });
  await expect(w.editResource(w.horseId, { restMinutes: 30 })).rejects.toMatchObject({ code: "invalid_state" });
  await w.editOption(w.optionId, { durationMinutes: 45 });
  await w.editOption(w.optionId, { priceSen: 9000 });

  const idle = await rideWorld();
  await idle.editOption(idle.optionId, { durationMinutes: 120 });
  await idle.editResource(idle.horseId, { restMinutes: 30 });
});
