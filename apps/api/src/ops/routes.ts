import { BookingError, type ClosureReason, type ResourceKind } from "@komugo/booking";
import { activities, createDb, operators } from "@komugo/db";
import { CLOSED_DAY, HHMM, WEEKDAYS, type Weekday } from "@komugo/types";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { validDate } from "../checkout";
import { DAY, fail, UUID, type ApiError, type Ctx } from "../lib";
import { staffOnly, type Ops } from "./auth";
import { recordClosure } from "./closure";
import { enrichCheckIn, enrichTimeslots } from "./enrich";

type Body = Record<string, unknown>;

const KINDS: ResourceKind[] = ["horse", "instructor", "belayer", "auto_belay_lane"];
const REASONS: ClosureReason[] = ["weather", "horse_unfit", "other"];

const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const intOrNull = (v: unknown, min: number, max: number) => v === null || int(v, min, max);
const name = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 200;
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const list = <T>(v: unknown, max: number, ok: (x: unknown) => boolean): v is T[] => Array.isArray(v) && v.length <= max && v.every(ok);

function invalid(checks: [boolean, string][]): ApiError[] {
  return checks.filter(([ok]) => !ok).map(([, field]) => ({ code: "invalid_field", field }));
}

export const routes = new Hono<Ops>();

routes.onError((e, c) => {
  if (e instanceof BookingError) return fail(c, 409, { code: e.code });
  throw e;
});

const json = (c: Ctx) => c.req.json<Body>().catch((): Body => ({}));

async function ownsActivity(env: Env, operatorId: string, id: unknown) {
  if (typeof id !== "string") return false;
  const [row] = await createDb(env.DB)
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.operatorId, operatorId)));
  return !!row;
}

async function commissionBps(env: Env, operatorId: string) {
  const [o] = await createDb(env.DB).select({ bps: operators.commissionBps }).from(operators).where(eq(operators.id, operatorId));
  return o.bps;
}

routes.get("/setup", async (c) => {
  const [setup, commission, catalogue] = await Promise.all([
    c.var.b.setup(),
    commissionBps(c.env, c.req.param("operatorId")!),
    createDb(c.env.DB)
      .select({
        id: activities.id,
        nameEn: activities.nameEn,
        nameMs: activities.nameMs,
        slugEn: activities.slugEn,
        slugMs: activities.slugMs,
        published: activities.published,
      })
      .from(activities)
      .where(eq(activities.operatorId, c.req.param("operatorId")!)),
  ]);
  return c.json({ ...setup, commissionBps: commission, catalogue });
});

routes.put("/commission", staffOnly, async (c) => {
  const body = await json(c);
  if (!int(body.commissionBps, 0, 10_000)) return fail(c, 400, { code: "invalid_field", field: "commissionBps" });
  await createDb(c.env.DB).update(operators).set({ commissionBps: body.commissionBps }).where(eq(operators.id, c.req.param("operatorId")!));
  return c.json({ commissionBps: body.commissionBps });
});

routes.put("/activities/:id", async (c) => {
  const body = await json(c);
  const errors = invalid([
    [int(body.freeCancelHours, 0, 720), "freeCancelHours"],
    [int(body.bookingCutoffMinutes, 0, 1440), "bookingCutoffMinutes"],
    [list<string>(body.closedDays, 14, (d) => typeof d === "string" && CLOSED_DAY.test(d)), "closedDays"],
  ]);
  if (errors.length) return fail(c, 400, errors[0], errors);
  if (!(await ownsActivity(c.env, c.req.param("operatorId")!, c.req.param("id")))) return fail(c, 404, { code: "not_found" });
  const generated = await c.var.b.upsertActivity({
    id: c.req.param("id"),
    freeCancelHours: body.freeCancelHours as number,
    bookingCutoffMinutes: body.bookingCutoffMinutes as number,
    closedDays: [...new Set(body.closedDays as string[])],
  });
  return c.json({ generated });
});

routes.put("/activities/:id/published", staffOnly, async (c) => {
  const body = await json(c);
  if (!bool(body.published)) return fail(c, 400, { code: "invalid_field", field: "published" });
  if (!(await ownsActivity(c.env, c.req.param("operatorId")!, c.req.param("id")))) return fail(c, 404, { code: "not_found" });
  if (body.published && (await commissionBps(c.env, c.req.param("operatorId")!)) === null) {
    return fail(c, 409, { code: "commission_unset" });
  }
  await createDb(c.env.DB).update(activities).set({ published: body.published }).where(eq(activities.id, c.req.param("id")));
  return c.json({ published: body.published });
});

function optionInput(body: Body) {
  const needs = body.needs as { kind?: unknown; quantity?: unknown }[];
  const errors = invalid([
    [name(body.nameEn), "nameEn"],
    [name(body.nameMs), "nameMs"],
    [int(body.priceSen, 0, 10_000_000), "priceSen"],
    [int(body.durationMinutes, 1, 720), "durationMinutes"],
    [intOrNull(body.minAge, 0, 120), "minAge"],
    [intOrNull(body.maxAge, 0, 120) && !(int(body.minAge, 0, 120) && int(body.maxAge, 0, 120) && body.minAge > body.maxAge), "maxAge"],
    [intOrNull(body.maxWeightKg, 1, 300), "maxWeightKg"],
    [body.requiredCert === null || (typeof body.requiredCert === "string" && name(body.requiredCert) && body.requiredCert.length <= 50), "requiredCert"],
    [intOrNull(body.minParticipants, 1, 10), "minParticipants"],
    [bool(body.active), "active"],
    [
      list(body.needs, 4, (n) => KINDS.includes((n as { kind: ResourceKind })?.kind) && int((n as { quantity: unknown }).quantity, 1, 10)) &&
        new Set(needs.map((n) => n.kind)).size === needs.length,
      "needs",
    ],
  ]);
  return {
    errors,
    value: () => ({
      activityId: body.activityId as string,
      nameEn: (body.nameEn as string).trim(),
      nameMs: (body.nameMs as string).trim(),
      priceSen: body.priceSen as number,
      durationMinutes: body.durationMinutes as number,
      minAge: body.minAge as number | null,
      maxAge: body.maxAge as number | null,
      maxWeightKg: body.maxWeightKg as number | null,
      requiredCert: (body.requiredCert as string | null)?.trim() ?? null,
      minParticipants: body.minParticipants as number | null,
      active: body.active as boolean,
      needs: needs.map((n) => ({ kind: n.kind as ResourceKind, quantity: n.quantity as number })),
    }),
  };
}

function addOnInput(body: Body) {
  return {
    errors: invalid([
      [name(body.nameEn), "nameEn"],
      [name(body.nameMs), "nameMs"],
      [int(body.priceSen, 0, 10_000_000), "priceSen"],
      [bool(body.active), "active"],
    ]),
    value: () => ({
      activityId: body.activityId as string,
      nameEn: (body.nameEn as string).trim(),
      nameMs: (body.nameMs as string).trim(),
      priceSen: body.priceSen as number,
      active: body.active as boolean,
    }),
  };
}

function resourceInput(body: Body) {
  const horse = body.kind === "horse";
  return {
    errors: invalid([
      [KINDS.includes(body.kind as ResourceKind), "kind"],
      [name(body.name), "name"],
      [bool(body.active), "active"],
      [horse ? intOrNull(body.maxSessionsPerDay, 1, 50) : body.maxSessionsPerDay === null, "maxSessionsPerDay"],
      [horse ? int(body.restMinutes, 0, 720) : body.restMinutes === 0, "restMinutes"],
      [horse ? intOrNull(body.maxRiderWeightKg, 1, 300) : body.maxRiderWeightKg === null, "maxRiderWeightKg"],
    ]),
    value: () => ({
      kind: body.kind as ResourceKind,
      name: (body.name as string).trim(),
      active: body.active as boolean,
      maxSessionsPerDay: body.maxSessionsPerDay as number | null,
      restMinutes: body.restMinutes as number,
      maxRiderWeightKg: body.maxRiderWeightKg as number | null,
    }),
  };
}

function scheduleInput(body: Body) {
  return {
    errors: invalid([
      [list(body.optionIds, 20, (o) => typeof o === "string") && (body.optionIds as string[]).length > 0, "optionIds"],
      [list(body.weekdays, 7, (d) => WEEKDAYS.includes(d as Weekday)) && (body.weekdays as string[]).length > 0, "weekdays"],
      [list(body.times, 48, (t) => typeof t === "string" && HHMM.test(t)) && (body.times as string[]).length > 0, "times"],
      [validDate(body.startsOn), "startsOn"],
      [body.endsOn === null || (validDate(body.endsOn) && body.endsOn >= (body.startsOn as string)), "endsOn"],
      [bool(body.active), "active"],
    ]),
    value: () => ({
      activityId: body.activityId as string,
      optionIds: body.optionIds as string[],
      weekdays: body.weekdays as Weekday[],
      times: body.times as string[],
      startsOn: body.startsOn as string,
      endsOn: body.endsOn as string | null,
      active: body.active as boolean,
    }),
  };
}

function packOfferInput(body: Body) {
  return {
    errors: invalid([
      [name(body.nameEn), "nameEn"],
      [name(body.nameMs), "nameMs"],
      [int(body.sessions, 1, 50), "sessions"],
      [int(body.priceSen, 100, 10_000_000), "priceSen"],
      [int(body.validDays, 1, 730), "validDays"],
      [list(body.optionIds, 20, (o) => typeof o === "string") && (body.optionIds as string[]).length > 0, "optionIds"],
      [bool(body.active), "active"],
    ]),
    value: () => ({
      activityId: body.activityId as string,
      nameEn: (body.nameEn as string).trim(),
      nameMs: (body.nameMs as string).trim(),
      sessions: body.sessions as number,
      priceSen: body.priceSen as number,
      validDays: body.validDays as number,
      optionIds: body.optionIds as string[],
      active: body.active as boolean,
    }),
  };
}

type Kind = "options" | "addOns" | "resources" | "schedules" | "packOffers";

// Ids are always minted here: a client-chosen id could overwrite another Operator's proj_* row.
async function save<T>(
  c: Ctx,
  id: string | null,
  kind: Kind,
  parse: (body: Body) => { errors: ApiError[]; value: () => T },
  upsert: (input: T & { id: string }) => Promise<unknown>,
) {
  const body = await json(c);
  const { errors, value } = parse(body);
  if (errors.length) return fail(c, 400, errors[0], errors);
  if (kind !== "resources" && !(await ownsActivity(c.env, c.req.param("operatorId")!, body.activityId))) {
    return fail(c, 404, { code: "not_found" });
  }
  if (id && !(await c.var.b.setup())[kind].some((x) => x.id === id)) return fail(c, 404, { code: "not_found" });
  const input = { ...value(), id: id ?? crypto.randomUUID() };
  const result = await upsert(input);
  return c.json(kind === "schedules" ? { id: input.id, ...(result as object) } : { id: input.id }, id ? 200 : 201);
}

routes.post("/options", (c) => save(c, null, "options", optionInput, c.var.b.upsertOption));
routes.put("/options/:id", (c) => save(c, c.req.param("id"), "options", optionInput, c.var.b.upsertOption));
routes.post("/add-ons", (c) => save(c, null, "addOns", addOnInput, c.var.b.upsertAddOn));
routes.put("/add-ons/:id", (c) => save(c, c.req.param("id"), "addOns", addOnInput, c.var.b.upsertAddOn));
routes.post("/resources", (c) => save(c, null, "resources", resourceInput, c.var.b.upsertResource));
routes.put("/resources/:id", (c) => save(c, c.req.param("id"), "resources", resourceInput, c.var.b.upsertResource));
routes.post("/schedules", (c) => save(c, null, "schedules", scheduleInput, c.var.b.upsertSchedule));
routes.put("/schedules/:id", (c) => save(c, c.req.param("id"), "schedules", scheduleInput, c.var.b.upsertSchedule));
routes.post("/pack-offers", (c) => save(c, null, "packOffers", packOfferInput, c.var.b.upsertPackOffer));
routes.put("/pack-offers/:id", (c) => save(c, c.req.param("id"), "packOffers", packOfferInput, c.var.b.upsertPackOffer));

routes.post("/timeslots", async (c) => {
  const body = await json(c);
  if (typeof body.optionId !== "string") return fail(c, 400, { code: "invalid_field", field: "optionId" });
  if (!list<number>(body.startsAt, 50, Number.isInteger) || !(body.startsAt as number[]).length) {
    return fail(c, 400, { code: "invalid_field", field: "startsAt" });
  }
  return c.json(await c.var.b.createTimeslots({ optionId: body.optionId, startsAt: body.startsAt as number[] }), 201);
});

routes.get("/timeslots", async (c) => {
  const from = c.req.query("from");
  const days = Number(c.req.query("days") ?? 1);
  if (!validDate(from)) return fail(c, 400, { code: "invalid_field", field: "from" });
  if (!int(days, 1, 14)) return fail(c, 400, { code: "invalid_field", field: "days" });
  const start = Date.parse(`${from}T00:00:00+08:00`);
  const rows = await c.var.b.timeslots({ from: start, to: start + days * DAY });
  return c.json({ timeslots: await enrichTimeslots(c.env, c.req.param("operatorId")!, rows) });
});

routes.get("/timeslots/:id", async (c) => {
  const rows = await c.var.b.timeslots({ ids: [c.req.param("id")] });
  if (!rows.length) return fail(c, 404, { code: "not_found" });
  return c.json({ timeslots: await enrichTimeslots(c.env, c.req.param("operatorId")!, rows) });
});

routes.post("/timeslots/:id/close", async (c) => {
  const body = await json(c);
  if (!REASONS.includes(body.reason as ClosureReason)) return fail(c, 400, { code: "invalid_field", field: "reason" });
  const op = c.req.param("operatorId")!;
  const id = c.req.param("id");
  await recordClosure(c.env, (p) => c.executionCtx.waitUntil(p), op, id, body.reason as ClosureReason);
  const [slot] = await enrichTimeslots(c.env, op, await c.var.b.timeslots({ ids: [id] }));
  return c.json({ timeslot: slot, affected: slot.groups });
});

routes.post("/check-ins", async (c) => {
  const body = await json(c);
  if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) {
    return fail(c, 400, { code: "invalid_field", field: "requestId" });
  }
  if (typeof body.code !== "string" || body.code.length > 64) return fail(c, 400, { code: "invalid_field", field: "code" });
  const r = await c.var.b.checkIn({ requestId: body.requestId, code: body.code });
  return c.json(await enrichCheckIn(c.env, c.req.param("operatorId")!, r));
});
