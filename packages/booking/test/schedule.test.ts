import { env } from "cloudflare:test";
import { klDate, klWeekday, WEEKDAYS } from "@komugo/types";
import { describe, expect, test } from "vitest";
import type { ScheduleInput } from "../src";
import { expand } from "../src/schedule";
import { kl, operator, rid, rideWorld } from "./helpers";

const D = 86_400_000;
const daysFromNow = (n: number) => klDate(Date.now() + n * D);

const d1 = (query: string, ...params: unknown[]) =>
  env.DB.prepare(query)
    .bind(...params)
    .all()
    .then((r) => r.results);

describe("expand", () => {
  const rule = { weekdays: WEEKDAYS, times: ["09:00"], startsOn: "2030-01-06", endsOn: "2030-01-13" };

  test('["Mo"] skips every Monday', () => {
    const dates = expand(rule, ["Mo"], kl("2030-01-01T00:00")).map(klDate);
    expect(dates).toEqual(["2030-01-06", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11", "2030-01-12", "2030-01-13"]);
  });

  test('["Mo#1","Mo#3"] skips 7 and 21 Jan 2030 and keeps 14 and 28', () => {
    const r = { ...rule, weekdays: ["Mo" as const], startsOn: "2030-01-01", endsOn: "2030-01-31" };
    expect(expand(r, ["Mo#1", "Mo#3"], kl("2030-01-01T00:00"))).toEqual([kl("2030-01-14T09:00"), kl("2030-01-28T09:00")]);
  });

  test("times are KL wall-clock and past times are dropped", () => {
    const r = { ...rule, times: ["09:00", "11:00"], startsOn: "2030-01-14", endsOn: "2030-01-14" };
    expect(expand(r, [], kl("2030-01-14T00:00"))).toEqual([kl("2030-01-14T09:00"), kl("2030-01-14T11:00")]);
    expect(expand(r, [], kl("2030-01-14T10:00"))).toEqual([kl("2030-01-14T11:00")]);
  });

  test("startsOn and endsOn bound the range, and a past startsOn starts today", () => {
    expect(expand({ ...rule, startsOn: "2029-01-01", endsOn: "2030-01-15" }, [], kl("2030-01-14T00:00"))).toEqual([
      kl("2030-01-14T09:00"),
      kl("2030-01-15T09:00"),
    ]);
    expect(expand({ ...rule, startsOn: "2030-02-01", endsOn: null }, [], kl("2030-01-14T00:00"))[0]).toBe(kl("2030-02-01T09:00"));
  });

  test("an open-ended rule stops at the 60-day horizon", () => {
    const starts = expand({ ...rule, startsOn: "2030-01-01", endsOn: null }, [], kl("2030-01-01T00:00"));
    expect(starts).toHaveLength(61);
    expect(starts.at(-1)).toBe(kl("2030-03-02T09:00"));
  });
});

async function scheduled(times = ["09:00"]) {
  const w = await rideWorld();
  await w.resource();
  const s: ScheduleInput = {
    id: rid(),
    activityId: w.activityId,
    optionIds: [w.optionId],
    weekdays: WEEKDAYS,
    times,
    startsOn: daysFromNow(2),
    endsOn: daysFromNow(8),
    active: true,
  };
  const save = (patch: Partial<ScheduleInput> = {}) => w.b.upsertSchedule({ ...s, ...patch });
  const open = () =>
    w.sql("SELECT id, starts_at FROM timeslots WHERE closed_at IS NULL ORDER BY starts_at") as Promise<
      { id: string; starts_at: number }[]
    >;
  return { ...w, s, save, open };
}

describe("Schedules", () => {
  test("upsertSchedule creates Timeslots; a rerun creates none and writes no outbox rows", async () => {
    const w = await scheduled(["09:00", "11:00"]);
    expect(await w.save()).toEqual({ created: 14, removed: 0, kept: [] });
    await w.flush();
    expect(await d1("SELECT count(*) AS n FROM proj_timeslots WHERE operator_id = ?", w.operatorId)).toEqual([{ n: 14 }]);
    expect(await w.save()).toEqual({ created: 0, removed: 0, kept: [] });
    expect(await w.count("SELECT count(*) AS n FROM outbox")).toBe(0);
    expect(await w.count("SELECT count(*) AS n FROM timeslots WHERE schedule_id = ?", w.s.id)).toBe(14);
  });

  test("removing a time closes unbooked Timeslots as 'schedule'; booked or held ones are kept; re-adding reopens them", async () => {
    const w = await scheduled(["09:00", "11:00"]);
    await w.save();
    const elevens = (await w.open()).filter((r) => new Date(r.starts_at).getUTCHours() === 3);
    const booked = elevens[0];
    const held = elevens[1];
    await w.book(w.customerId, booked.id, [await w.participant(w.customerId)]);
    await w.hold(w.customerId, held.id, [await w.participant(w.customerId)]);

    const r = await w.save({ times: ["09:00"] });
    expect(r.created).toBe(0);
    expect(r.removed).toBe(5);
    expect(r.kept.map((k) => k.id).sort()).toEqual([booked.id, held.id].sort());
    expect(await w.count("SELECT count(*) AS n FROM timeslots WHERE closed_reason = 'schedule'")).toBe(5);
    await w.flush();
    const gone = elevens[2].id;
    expect((await d1("SELECT closed_at FROM proj_timeslots WHERE id = ?", gone))[0].closed_at).not.toBeNull();

    expect(await w.save()).toMatchObject({ created: 5, removed: 0 });
    expect((await w.open()).map((s) => s.id)).toEqual(expect.arrayContaining(elevens.map((e) => e.id)));
    expect(await w.count("SELECT count(*) AS n FROM timeslots")).toBe(14);
  });

  test("a weather Closure is never reopened and one-offs are left alone", async () => {
    const w = await scheduled();
    await w.save();
    const [first] = await w.open();
    await w.b.closeTimeslot(first.id, "weather");
    const oneOff = await w.slot(w.optionId, Date.parse(`${daysFromNow(3)}T10:00:00+08:00`));
    await w.save({ times: ["10:00"] });
    await w.save();
    expect(await w.sql("SELECT closed_reason FROM timeslots WHERE id = ?", first.id)).toEqual([{ closed_reason: "weather" }]);
    expect(await w.sql("SELECT closed_at, schedule_id FROM timeslots WHERE id = ?", oneOff)).toEqual([
      { closed_at: null, schedule_id: null },
    ]);
  });

  test("a one-off on a slot the Schedule removed reopens it and detaches it from the Schedule", async () => {
    const w = await scheduled();
    await w.save();
    const [first] = await w.open();
    await w.save({ active: false });
    expect(await w.slot(w.optionId, first.starts_at)).toBe(first.id);
    await w.save({ active: false });
    expect(await w.sql("SELECT closed_at, schedule_id FROM timeslots WHERE id = ?", first.id)).toEqual([
      { closed_at: null, schedule_id: null },
    ]);
  });

  test("active:false removes every unbooked Timeslot", async () => {
    const w = await scheduled();
    await w.save();
    const [booked] = await w.open();
    await w.book(w.customerId, booked.id, [await w.participant(w.customerId)]);
    expect(await w.save({ active: false })).toMatchObject({ created: 0, removed: 6, kept: [{ id: booked.id }] });
    expect((await w.open()).map((s) => s.id)).toEqual([booked.id]);
  });

  test("an Option of another Activity, an unknown Activity, or moving to another Activity is invalid_state", async () => {
    const w = await scheduled();
    const other = rid();
    await w.b.upsertActivity({ id: other, freeCancelHours: 0 });
    const foreign = await w.option({ activityId: other });
    for (const patch of [{ optionIds: [foreign] }, { activityId: rid() }]) {
      await expect(w.save(patch)).rejects.toMatchObject({ code: "invalid_state" });
    }
    await w.save();
    await expect(w.save({ activityId: other, optionIds: [foreign] })).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("an inactive Option is skipped", async () => {
    const w = await scheduled();
    const off = await w.option({ active: false });
    expect(await w.save({ optionIds: [w.optionId, off] })).toMatchObject({ created: 7 });
    expect(await w.count("SELECT count(*) AS n FROM timeslots WHERE option_id = ?", off)).toBe(0);
  });

  test("deactivating and reactivating an Option regenerates its Timeslots right away", async () => {
    const w = await scheduled();
    await w.save();
    expect(await w.editOption(w.optionId, { active: false })).toEqual({ created: 0, removed: 7, kept: [] });
    expect(await w.open()).toEqual([]);
    expect(await w.editOption(w.optionId, { active: true })).toMatchObject({ created: 7 });
    expect(await w.open()).toHaveLength(7);
    expect(await w.editOption(w.optionId, { priceSen: 9000 })).toBeNull();
  });

  test("changing Closed days via upsertActivity regenerates", async () => {
    const w = await scheduled(["09:00", "11:00"]);
    await w.save();
    const day = daysFromNow(4);
    const r = await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 24, closedDays: [klWeekday(day)] });
    expect(r).toEqual({ created: 0, removed: 2, kept: [] });
    expect((await w.open()).map((s) => klDate(s.starts_at))).not.toContain(day);
    expect(await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 12, closedDays: [klWeekday(day)] })).toBeNull();
    expect(await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 12, closedDays: [] })).toMatchObject({ created: 2 });
  });

  test("generateTimeslots with no Schedules is all zeros", async () => {
    const w = await operator();
    expect(await w.b.generateTimeslots()).toEqual({ created: 0, removed: 0, kept: [] });
  });
});
