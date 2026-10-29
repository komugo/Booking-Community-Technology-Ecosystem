import { describe, expect, test } from "vitest";
import { booked, member, rid, world } from "./helpers";

const D = 86_400_000;
const klDay = (n: number) => new Date(Date.now() + 8 * 3_600_000 + n * D).toISOString().slice(0, 10);

describe("ops Setup", () => {
  test("Resources with Welfare Rules, Options, Add-ons and Activity settings round-trip through GET /setup", async () => {
    const w = await world();
    const m = await member("operator", w.operatorId);
    const base = `/ops/operators/${w.operatorId}`;
    const horse = { kind: "horse", name: "Bayu", active: true, maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 90 };
    const r = await m.json<{ id: string }>("POST", `${base}/resources`, horse);
    expect(r.status).toBe(201);
    expect((await m.json("PUT", `${base}/resources/${r.body.id}`, { ...horse, name: "Bayu II", maxSessionsPerDay: 5 })).status).toBe(200);
    const option = {
      activityId: w.activityId,
      nameEn: " Group lesson ",
      nameMs: "Kelas berkumpulan",
      priceSen: 6000,
      durationMinutes: 45,
      minAge: 7,
      maxAge: 60,
      maxWeightKg: 90,
      requiredCert: null,
      minParticipants: 2,
      active: true,
      needs: [{ kind: "horse", quantity: 1 }, { kind: "instructor", quantity: 1 }],
    };
    const o = await m.json<{ id: string }>("POST", `${base}/options`, option);
    const a = await m.json<{ id: string }>("POST", `${base}/add-ons`, { activityId: w.activityId, nameEn: "Photos", nameMs: "Foto", priceSen: 2000, active: true });
    expect(
      await m.json("PUT", `${base}/activities/${w.activityId}`, { freeCancelHours: 48, bookingCutoffMinutes: 30, closedDays: ["Mo#1", "Mo#3"] }),
    ).toEqual({ status: 200, body: { generated: expect.anything() } });

    const { body } = await m.json("GET", `${base}/setup`);
    expect(body.resources).toContainEqual({ ...horse, id: r.body.id, name: "Bayu II", maxSessionsPerDay: 5 });
    expect(body.options).toContainEqual({ ...option, id: o.body.id, nameEn: "Group lesson" });
    expect(body.addOns).toContainEqual({ id: a.body.id, activityId: w.activityId, nameEn: "Photos", nameMs: "Foto", priceSen: 2000, active: true });
    expect(body.activities).toEqual([{ id: w.activityId, freeCancelHours: 48, bookingCutoffMinutes: 30, closedDays: ["Mo#1", "Mo#3"] }]);
    expect(body.catalogue).toEqual([expect.objectContaining({ id: w.activityId, nameEn: "Trail Riding", listingMode: "bookable" })]);
  });

  test("bad fields are 400 invalid_field with the field name", async () => {
    const w = await world();
    const m = await member("operator", w.operatorId);
    const base = `/ops/operators/${w.operatorId}`;
    const bad = async (method: string, path: string, body: unknown) => (await m.json(method, `${base}${path}`, body)).body;
    expect(await bad("PUT", `/activities/${w.activityId}`, { freeCancelHours: 721, bookingCutoffMinutes: 0, closedDays: ["Mo#6"] })).toEqual({
      code: "invalid_field",
      field: "freeCancelHours",
      errors: [
        { code: "invalid_field", field: "freeCancelHours" },
        { code: "invalid_field", field: "closedDays" },
      ],
    });
    const schedule = { activityId: w.activityId, optionIds: [w.optionId], weekdays: ["Mo"], times: ["9:00"], startsOn: klDay(1), endsOn: null, active: true };
    expect(await bad("POST", "/schedules", schedule)).toMatchObject({ field: "times" });
    expect(await bad("POST", "/schedules", { ...schedule, times: ["09:00"], weekdays: ["Monday"] })).toMatchObject({ field: "weekdays" });
    expect(await bad("POST", "/schedules", { ...schedule, times: ["09:00"], endsOn: klDay(0) })).toMatchObject({ field: "endsOn" });
    expect(
      await bad("POST", "/resources", { kind: "belayer", name: "Ali", active: true, maxSessionsPerDay: 4, restMinutes: 0, maxRiderWeightKg: null }),
    ).toMatchObject({ field: "maxSessionsPerDay" });
    expect(await bad("POST", "/timeslots/x/close", { reason: "rain" })).toMatchObject({ field: "reason" });
  });

  test("lengthening an Option under a live Booking is 409 invalid_state", async () => {
    const w = await world();
    await booked(w);
    const m = await member("operator", w.operatorId);
    const { body } = await m.json("GET", `/ops/operators/${w.operatorId}/setup`);
    const { id, ...option } = body.options[0];
    expect(await m.json("PUT", `/ops/operators/${w.operatorId}/options/${id}`, { ...option, durationMinutes: 90 })).toEqual({
      status: 409,
      body: { code: "invalid_state" },
    });
  });

  test("POST /schedules returns the generation summary", async () => {
    const w = await world();
    const m = await member("operator", w.operatorId);
    const r = await m.json("POST", `/ops/operators/${w.operatorId}/schedules`, {
      activityId: w.activityId,
      optionIds: [w.optionId],
      weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
      times: ["09:00", "14:00"],
      startsOn: klDay(2),
      endsOn: klDay(8),
      active: true,
    });
    expect(r).toEqual({ status: 201, body: { id: expect.any(String), created: 14, removed: 0, kept: [] } });
  });

  test("Pack offers are created, updated and validated; another Operator's Option is 409", async () => {
    const w = await world();
    const other = await world();
    const m = await member("operator", w.operatorId);
    const base = `/ops/operators/${w.operatorId}`;
    const offer = { activityId: w.activityId, nameEn: "8 rides", nameMs: "8 tunggangan", sessions: 8, priceSen: 52000, validDays: 90, optionIds: [w.optionId], active: true };
    const r = await m.json<{ id: string }>("POST", `${base}/pack-offers`, offer);
    expect(r.status).toBe(201);
    expect((await m.json("PUT", `${base}/pack-offers/${r.body.id}`, { ...offer, priceSen: 50000, active: false })).status).toBe(200);
    expect((await m.json("GET", `${base}/setup`)).body.packOffers).toEqual([{ ...offer, id: r.body.id, priceSen: 50000, active: false }]);
    expect(await m.json("POST", `${base}/pack-offers`, { ...offer, optionIds: [other.optionId] })).toEqual({
      status: 409,
      body: { code: "invalid_state" },
    });
    const bad = await m.json("POST", `${base}/pack-offers`, { ...offer, sessions: 0, priceSen: 99, validDays: 731, optionIds: [] });
    expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual(["sessions", "priceSen", "validDays", "optionIds"]);
    expect((await m.json("PUT", `${base}/pack-offers/${rid()}`, offer)).status).toBe(404);
  });
});
