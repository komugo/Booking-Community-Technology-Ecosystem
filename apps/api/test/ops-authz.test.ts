import { describe, expect, test } from "vitest";
import { client, d1, member, publishable, rid, unsplash, world, type World } from "./helpers";

const option = (activityId: string) => ({
  activityId,
  nameEn: "Ride",
  nameMs: "Tunggang",
  priceSen: 5000,
  durationMinutes: 30,
  minAge: null,
  maxAge: null,
  maxWeightKg: null,
  requiredCert: null,
  minParticipants: null,
  maxPerBooking: null,
  active: true,
  needs: [{ kind: "horse", quantity: 1 }],
});
const addOn = (activityId: string) => ({ activityId, nameEn: "Helmet", nameMs: "Topi", priceSen: 500, active: true });
const resource = { kind: "instructor", name: "Ali", active: true, maxSessionsPerDay: null, restMinutes: 0, maxRiderWeightKg: null };
const schedule = (w: World) => ({
  activityId: w.activityId,
  optionIds: [w.optionId],
  weekdays: ["Sa"],
  times: ["09:00"],
  startsOn: "2030-01-01",
  endsOn: "2030-01-31",
  priceSen: null,
  active: true,
});

async function routesFor(w: World) {
  const scheduleId = rid();
  const venueId = await publishable(w);
  await w.b.upsertSchedule({ ...schedule(w), id: scheduleId, weekdays: ["Sa"] });
  const {
    ids: [closable],
  } = await w.b.createTimeslots({ optionId: w.optionId, startsAt: [Date.parse("2030-01-15T15:00:00+08:00")] });
  return [
    ["GET", "/setup", 200],
    ["PUT", `/activities/${w.activityId}`, 200, { freeCancelHours: 24, bookingCutoffMinutes: 60, closedDays: ["Mo"], requiresWaiver: true }],
    ["PUT", `/activities/${w.activityId}/copy`, 204, { descriptionEn: "x", descriptionMs: "x", venueId, photos: [unsplash()] }],
    ["POST", "/options", 201, option(w.activityId)],
    ["PUT", `/options/${w.optionId}`, 200, { ...option(w.activityId), durationMinutes: 60, maxWeightKg: 90, minAge: 7 }],
    ["POST", "/add-ons", 201, addOn(w.activityId)],
    ["PUT", `/add-ons/${w.helmetId}`, 200, addOn(w.activityId)],
    ["POST", "/resources", 201, resource],
    ["POST", "/schedules", 201, schedule(w)],
    ["PUT", `/schedules/${scheduleId}`, 200, schedule(w)],
    ["POST", "/timeslots", 201, { optionId: w.optionId, startsAt: [Date.parse("2030-01-15T13:00:00+08:00")] }],
    ["GET", "/timeslots?from=2030-01-15&days=1", 200],
    ["GET", `/timeslots/${w.timeslotId}`, 200],
    ["POST", `/timeslots/${closable}/close`, 200, { reason: "weather" }],
    ["POST", "/check-ins", 200, { requestId: crypto.randomUUID(), code: "deadbeef" }],
    [
      "POST",
      "/pack-offers",
      201,
      { activityId: w.activityId, nameEn: "4 rides", nameMs: "4 tunggangan", sessions: 4, priceSen: 25000, validDays: 30, optionIds: [w.optionId], active: true },
    ],
  ] as [string, string, number, unknown?][];
}

describe("ops authorization", () => {
  test("every route: signed out 401, another operator 404, staff OK", async () => {
    const a = await world();
    const b = await world();
    const routes = await routesFor(a);
    const outsider = await member("operator", b.operatorId);
    const staff = await member("staff");
    for (const [method, path, ok, body] of routes) {
      const url = `/ops/operators/${a.operatorId}${path}`;
      expect([path, (await client().call(method, url, body)).status]).toEqual([path, 401]);
      expect([path, (await outsider.call(method, url, body)).status]).toEqual([path, 404]);
      expect([path, (await staff.call(method, url, body)).status]).toEqual([path, ok]);
    }
    expect((await staff.call("GET", `/ops/operators/op_missing/setup`)).status).toBe(404);
  });

  test("Listing mode and Commission are staff-only, and Bookable needs a Commission", async () => {
    const w = await world({ listingMode: "hidden", signedUp: false, commissionBps: null });
    const own = await member("operator", w.operatorId);
    const url = `/ops/operators/${w.operatorId}/activities/${w.activityId}/listing-mode`;
    const commission = `/ops/operators/${w.operatorId}/commission`;
    expect((await own.json("PUT", url, { listingMode: "bookable" })).body).toEqual({ code: "forbidden" });
    expect((await own.json("PUT", commission, { commissionBps: 1000 })).body).toEqual({ code: "forbidden" });
    const staff = await member("staff");
    expect((await staff.json("PUT", url, { listingMode: "bookable" })).body).toEqual({ code: "not_signed_up", field: "listingMode" });
    const unset = await world({ listingMode: "hidden", commissionBps: null });
    expect((await staff.json("PUT", `/ops/operators/${unset.operatorId}/activities/${unset.activityId}/listing-mode`, { listingMode: "bookable" })).body).toEqual({
      code: "commission_unset",
      field: "listingMode",
    });
    expect((await staff.json("PUT", commission, { commissionBps: 10_001 })).body).toEqual({ code: "invalid_field", field: "commissionBps" });
    expect((await staff.json("PUT", commission, { commissionBps: 1250 })).body).toEqual({ commissionBps: 1250 });
    expect((await own.json("GET", `/ops/operators/${w.operatorId}/setup`)).body.commissionBps).toBe(1250);
    expect(await d1("SELECT signed_up FROM operators WHERE id = ?", w.operatorId)).toEqual([{ signed_up: 1 }]);
    await publishable(w);
    expect((await staff.json("PUT", url, { listingMode: "bookable" })).body).toEqual({ listingMode: "bookable" });
    expect(await d1("SELECT listing_mode, published FROM activities WHERE id = ?", w.activityId)).toEqual([{ listing_mode: "bookable", published: 1 }]);
  });

  test("ids from another Operator are 404 and leave its rows untouched", async () => {
    const a = await world();
    const b = await world();
    const m = await member("operator", a.operatorId);
    const base = `/ops/operators/${a.operatorId}`;
    expect((await m.call("PUT", `${base}/options/${b.optionId}`, option(a.activityId))).status).toBe(404);
    expect((await m.call("PUT", `${base}/add-ons/${b.helmetId}`, addOn(a.activityId))).status).toBe(404);
    expect((await m.call("POST", `${base}/options`, option(b.activityId))).status).toBe(404);
    expect((await m.call("PUT", `${base}/activities/${b.activityId}`, { freeCancelHours: 0, bookingCutoffMinutes: 0, closedDays: [], requiresWaiver: true })).status).toBe(404);
    const copy = { descriptionEn: "Mine", descriptionMs: "Saya", venueId: null, photos: [] };
    expect((await m.call("PUT", `${base}/activities/${b.activityId}/copy`, copy)).status).toBe(404);
    expect((await m.call("PUT", `/ops/operators/${b.operatorId}/activities/${b.activityId}/copy`, copy)).status).toBe(404);
    expect(await d1("SELECT description_en FROM activities WHERE id = ?", b.activityId)).toEqual([{ description_en: "x" }]);
    await a.flush();
    await b.flush();
    expect(await d1("SELECT operator_id, duration_minutes FROM proj_options WHERE id = ?", b.optionId)).toEqual([
      { operator_id: b.operatorId, duration_minutes: 60 },
    ]);
  });
});
