import { BookingError, type ClosureReason, type ResourceKind } from "@komugo/booking";
import { activities, bills, checkouts, createDb, LISTING_MODES, operators, packOrders, photos, projPackOffers, venues, type Db, type ListingMode } from "@komugo/db";
import { CLOSED_DAY, HHMM, WEEKDAYS, type Weekday } from "@komugo/types";
import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { validDate } from "../checkout";
import { DAY, fail, UUID, type ApiError, type Ctx } from "../lib";
import { staffOnly, type Ops } from "./auth";
import { recordClosure } from "./closure";
import { enrichCheckIn, enrichTimeslots } from "./enrich";
import { bool, int, intOrNull, invalid, json, list, name, type Body } from "./input";
import { activityGaps, photoList, photoRows, photoView, publishBar, publishGaps, type PhotoInput } from "./venues";

const KINDS: ResourceKind[] = ["horse", "instructor", "belayer", "auto_belay_lane"];
const REASONS: ClosureReason[] = ["weather", "maintenance", "event", "horse_unfit", "other"];

export const routes = new Hono<Ops>();

routes.onError((e, c) => {
  if (e instanceof BookingError) return fail(c, 409, { code: e.code });
  throw e;
});

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
  const op = c.req.param("operatorId")!;
  const db = createDb(c.env.DB);
  const [setup, commission, [catalogue, gallery]] = await Promise.all([
    c.var.b.setup(),
    commissionBps(c.env, op),
    db.batch([
      db
        .select({
          id: activities.id,
          nameEn: activities.nameEn,
          nameMs: activities.nameMs,
          slugEn: activities.slugEn,
          slugMs: activities.slugMs,
          listingMode: activities.listingMode,
          descriptionEn: activities.descriptionEn,
          descriptionMs: activities.descriptionMs,
          venueId: activities.venueId,
        })
        .from(activities)
        .where(eq(activities.operatorId, op)),
      db
        .select({ photo: photos })
        .from(photos)
        .innerJoin(activities, eq(activities.id, photos.activityId))
        .where(eq(activities.operatorId, op))
        .orderBy(asc(photos.position)),
    ]),
  ]);
  return c.json({
    ...setup,
    commissionBps: commission,
    catalogue: catalogue.map((a) => ({ ...a, photos: gallery.filter((p) => p.photo.activityId === a.id).map((p) => photoView(p.photo)) })),
  });
});

routes.put("/commission", staffOnly, async (c) => {
  const body = await json(c);
  if (!int(body.commissionBps, 0, 10_000)) return fail(c, 400, { code: "invalid_field", field: "commissionBps" });
  // Agreeing the Commission is what signs an Operator up.
  await createDb(c.env.DB)
    .update(operators)
    .set({ commissionBps: body.commissionBps, signedUp: true })
    .where(eq(operators.id, c.req.param("operatorId")!));
  return c.json({ commissionBps: body.commissionBps });
});

routes.put("/activities/:id", async (c) => {
  const body = await json(c);
  const errors = invalid([
    [int(body.freeCancelHours, 0, 720), "freeCancelHours"],
    [int(body.bookingCutoffMinutes, 0, 1440), "bookingCutoffMinutes"],
    [list<string>(body.closedDays, 14, (d) => typeof d === "string" && CLOSED_DAY.test(d)), "closedDays"],
    [bool(body.requiresWaiver), "requiresWaiver"],
  ]);
  if (errors.length) return fail(c, 400, errors[0], errors);
  if (!(await ownsActivity(c.env, c.req.param("operatorId")!, c.req.param("id")))) return fail(c, 404, { code: "not_found" });
  const generated = await c.var.b.upsertActivity({
    id: c.req.param("id"),
    freeCancelHours: body.freeCancelHours as number,
    bookingCutoffMinutes: body.bookingCutoffMinutes as number,
    closedDays: [...new Set(body.closedDays as string[])],
    requiresWaiver: body.requiresWaiver as boolean,
  });
  return c.json({ generated });
});

const text = (v: unknown) => typeof v === "string" && v.trim().length <= 5000;

// Operators edit their own Activity's copy; only staff move it to another Venue.
routes.put("/activities/:id/copy", async (c) => {
  const body = await json(c);
  const errors = invalid([
    [text(body.descriptionEn), "descriptionEn"],
    [text(body.descriptionMs), "descriptionMs"],
    [body.venueId === null || typeof body.venueId === "string", "venueId"],
    [photoList(body.photos), "photos"],
  ]);
  if (errors.length) return fail(c, 400, errors[0], errors);
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const [a] = await db
    .select({ cityId: activities.cityId, venueId: activities.venueId, listingMode: activities.listingMode })
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.operatorId, c.req.param("operatorId")!)));
  if (!a) return fail(c, 404, { code: "not_found" });
  const venueId = body.venueId as string | null;
  if (venueId !== a.venueId && c.var.member.role !== "staff") return fail(c, 403, { code: "forbidden", field: "venueId" });
  const [venue] = venueId ? await db.select({ cityId: venues.cityId, lat: venues.lat, lng: venues.lng }).from(venues).where(eq(venues.id, venueId)) : [];
  if (venueId && venue?.cityId !== a.cityId) return fail(c, 400, { code: "invalid_field", field: "venueId" });
  const copy = { descriptionEn: (body.descriptionEn as string).trim(), descriptionMs: (body.descriptionMs as string).trim(), venueId };
  const list = body.photos as PhotoInput[];
  // A listed Activity can't drop below the publish bar.
  const gaps = a.listingMode === "hidden" ? [] : publishGaps({ ...copy, photos: list.length }, venue ?? null);
  if (gaps.length) return publishBar(c, gaps);
  await db.batch([
    db.update(activities).set(copy).where(eq(activities.id, id)),
    db.delete(photos).where(eq(photos.activityId, id)),
    ...(list.length ? [db.insert(photos).values(photoRows({ activityId: id }, list))] : []),
  ]);
  return c.body(null, 204);
});

// A bill not yet paid or deleted can still be paid late and make a sale.
async function hasOpenBills(db: Db, activityId: string) {
  const [open] = await db
    .select({ id: bills.id })
    .from(bills)
    .where(
      and(
        isNull(bills.paidAt),
        isNull(bills.deletedAt),
        or(
          inArray(bills.checkoutId, db.select({ id: checkouts.id }).from(checkouts).where(eq(checkouts.activityId, activityId))),
          inArray(
            bills.checkoutId,
            db
              .select({ id: packOrders.id })
              .from(packOrders)
              .innerJoin(projPackOffers, eq(projPackOffers.id, packOrders.offerId))
              .where(eq(projPackOffers.activityId, activityId)),
          ),
        ),
      ),
    )
    .limit(1);
  return !!open;
}

routes.put("/activities/:id/listing-mode", staffOnly, async (c) => {
  const body = await json(c);
  const mode = body.listingMode as ListingMode;
  if (!LISTING_MODES.includes(mode)) return fail(c, 400, { code: "invalid_field", field: "listingMode" });
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const [row] = await db
    .select({ listingMode: activities.listingMode, signedUp: operators.signedUp, commissionBps: operators.commissionBps })
    .from(activities)
    .innerJoin(operators, eq(operators.id, activities.operatorId))
    .where(and(eq(activities.id, id), eq(activities.operatorId, c.req.param("operatorId")!)));
  if (!row) return fail(c, 404, { code: "not_found" });
  if (mode === "bookable" && !row.signedUp) return fail(c, 409, { code: "not_signed_up", field: "listingMode" });
  if (mode === "bookable" && row.commissionBps === null) return fail(c, 409, { code: "commission_unset", field: "listingMode" });
  if (row.listingMode === "hidden" && mode !== "hidden") {
    const gaps = await activityGaps(c.env, id);
    if (gaps.length) return publishBar(c, gaps, "listingMode");
  }
  const set = (m: ListingMode) => db.update(activities).set({ listingMode: m, published: m === "bookable" }).where(eq(activities.id, id));
  await set(mode);
  // Written before the check so a Hold made after it is refused at pay or redeem.
  if (row.listingMode === "bookable" && mode !== "bookable" && ((await c.var.b.hasFutureBookings(id)) || (await hasOpenBills(db, id)))) {
    await set("bookable");
    return fail(c, 409, { code: "has_future_tickets", field: "listingMode" });
  }
  return c.json({ listingMode: mode });
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
    [
      intOrNull(body.maxPerBooking, 1, 50) &&
        !(int(body.minParticipants, 1, 10) && int(body.maxPerBooking, 1, 50) && body.minParticipants > body.maxPerBooking),
      "maxPerBooking",
    ],
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
      maxPerBooking: body.maxPerBooking as number | null,
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
      [intOrNull(body.priceSen ?? null, 0, 10_000_000), "priceSen"],
      [bool(body.active), "active"],
    ]),
    value: () => ({
      activityId: body.activityId as string,
      optionIds: body.optionIds as string[],
      weekdays: body.weekdays as Weekday[],
      times: body.times as string[],
      startsOn: body.startsOn as string,
      endsOn: body.endsOn as string | null,
      priceSen: (body.priceSen ?? null) as number | null,
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
  const id = c.req.param("id");
  if (!REASONS.includes(body.reason as ClosureReason) || (body.reason === "horse_unfit" && !(await c.var.b.timeslots({ ids: [id] }))[0]?.horse)) {
    return fail(c, 400, { code: "invalid_field", field: "reason" });
  }
  const op = c.req.param("operatorId")!;
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
