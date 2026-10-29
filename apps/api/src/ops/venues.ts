import { activities, cities, createDb, photos, venues as venueTable, type OpeningHours } from "@komugo/db";
import { HHMM, WEEKDAYS, type Weekday } from "@komugo/types";
import { Hono } from "hono";
import { and, asc, count, eq, isNotNull, ne } from "drizzle-orm";
import { fail, type Ctx } from "../lib";
import { requireMember, staffOnly, type Ops } from "./auth";
import { int, intOrNull, invalid, json, list, name, type Body } from "./input";

export type PhotoInput = {
  url: string;
  width: number;
  height: number;
  altEn: string;
  altMs: string;
  creditName: string;
  creditUrl: string;
  sourceUrl: string;
};

// Stock photos for now: the web pages resize them through Unsplash's image URL parameters.
const UNSPLASH = /^https:\/\/images\.unsplash\.com\/[^\s?#]+$/;
const https = (v: unknown) => typeof v === "string" && v.length <= 500 && /^https:\/\/\S+$/.test(v);

const photoOk = (v: unknown) => {
  const p = v as Partial<PhotoInput> | null;
  return (
    typeof p === "object" &&
    p !== null &&
    https(p.url) &&
    UNSPLASH.test(p.url!) &&
    int(p.width, 1, 20_000) &&
    int(p.height, 1, 20_000) &&
    name(p.altEn) &&
    name(p.altMs) &&
    name(p.creditName) &&
    https(p.creditUrl) &&
    https(p.sourceUrl)
  );
};

export const photoList = (v: unknown): v is PhotoInput[] => list(v, 10, photoOk);

export const photoRows = (owner: { activityId: string } | { venueId: string }, list: PhotoInput[]) =>
  list.map((p, position) => ({
    ...owner,
    position,
    url: p.url,
    width: p.width,
    height: p.height,
    altEn: p.altEn.trim(),
    altMs: p.altMs.trim(),
    creditName: p.creditName.trim(),
    creditUrl: p.creditUrl,
    sourceUrl: p.sourceUrl,
  }));

export const photoView =(p: typeof photos.$inferSelect): PhotoInput => ({
  url: p.url,
  width: p.width,
  height: p.height,
  altEn: p.altEn,
  altMs: p.altMs,
  creditName: p.creditName,
  creditUrl: p.creditUrl,
  sourceUrl: p.sourceUrl,
});

export type Gap = "venue" | "mapPin" | "descriptionEn" | "descriptionMs" | "photo";

// What an Activity still lacks to leave Hidden. Category is required by the schema.
export function publishGaps(
  a: { descriptionEn: string; descriptionMs: string; photos: number },
  venue: { lat: number | null; lng: number | null } | null,
): Gap[] {
  const gaps: [boolean, Gap][] = [
    [!venue, "venue"],
    [!!venue && (venue.lat === null || venue.lng === null), "mapPin"],
    [!a.descriptionEn.trim(), "descriptionEn"],
    [!a.descriptionMs.trim(), "descriptionMs"],
    [a.photos === 0, "photo"],
  ];
  return gaps.filter(([missing]) => missing).map(([, g]) => g);
}

export async function activityGaps(env: Env, id: string) {
  const db = createDb(env.DB);
  const [[a], [p]] = await db.batch([
    db
      .select({ descriptionEn: activities.descriptionEn, descriptionMs: activities.descriptionMs, venueId: venueTable.id, lat: venueTable.lat, lng: venueTable.lng })
      .from(activities)
      .leftJoin(venueTable, eq(venueTable.id, activities.venueId))
      .where(eq(activities.id, id)),
    db.select({ n: count() }).from(photos).where(eq(photos.activityId, id)),
  ]);
  return publishGaps({ ...a, photos: p.n }, a.venueId ? a : null);
}

export const publishBar = (c: Ctx, gaps: Gap[], field?: string) =>
  fail(c, 409, { code: "publish_bar", ...(field ? { field } : {}), params: { missing: gaps.join(",") } });

const textOrNull = (v: unknown, max: number) => v === null || (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max);
const coord = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

const hoursOk = (v: unknown) => {
  const h = v as Partial<OpeningHours> | null;
  return (
    typeof h === "object" &&
    h !== null &&
    list<Weekday>(h.days, 7, (d) => WEEKDAYS.includes(d as Weekday)) &&
    h.days.length > 0 &&
    new Set(h.days).size === h.days.length &&
    typeof h.opens === "string" &&
    typeof h.closes === "string" &&
    HHMM.test(h.opens) &&
    HHMM.test(h.closes) &&
    h.opens !== h.closes
  );
};

function venueInput(body: Body) {
  return {
    errors: invalid([
      [typeof body.cityId === "string", "cityId"],
      [name(body.nameEn), "nameEn"],
      [name(body.nameMs), "nameMs"],
      [textOrNull(body.streetAddress, 300), "streetAddress"],
      [body.postalCode === null || (typeof body.postalCode === "string" && /^\d{5}$/.test(body.postalCode.trim())), "postalCode"],
      [intOrNull(body.presint, 1, 20), "presint"],
      [textOrNull(body.phone, 30), "phone"],
      [(body.lat === null && body.lng === null) || (coord(body.lat, 90) && coord(body.lng, 180)), "lat"],
      [list(body.openingHours, 14, hoursOk), "openingHours"],
      [photoList(body.photos), "photos"],
    ]),
    value: () => ({
      cityId: body.cityId as string,
      nameEn: (body.nameEn as string).trim(),
      nameMs: (body.nameMs as string).trim(),
      streetAddress: (body.streetAddress as string | null)?.trim() ?? null,
      postalCode: (body.postalCode as string | null)?.trim() ?? null,
      presint: body.presint as number | null,
      phone: (body.phone as string | null)?.trim() ?? null,
      lat: body.lat as number | null,
      lng: body.lng as number | null,
      openingHours: body.openingHours as OpeningHours[],
    }),
  };
}

export const venues = new Hono<Ops>();

venues.use(requireMember, staffOnly);

venues.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const [rows, gallery, cityRows] = await db.batch([
    db.select().from(venueTable).orderBy(asc(venueTable.nameEn)),
    db.select().from(photos).where(isNotNull(photos.venueId)).orderBy(asc(photos.position)),
    db.select({ id: cities.id, nameEn: cities.nameEn, nameMs: cities.nameMs }).from(cities).orderBy(asc(cities.nameEn)),
  ]);
  return c.json({
    venues: rows.map((v) => ({ ...v, photos: gallery.filter((p) => p.venueId === v.id).map(photoView) })),
    cities: cityRows,
  });
});

async function save(c: Ctx, id: string | null) {
  const body = await json(c);
  const { errors, value } = venueInput(body);
  if (errors.length) return fail(c, 400, errors[0], errors);
  const db = createDb(c.env.DB);
  const v = value();
  const [[city], [existing], [listed]] = await db.batch([
    db.select({ id: cities.id }).from(cities).where(eq(cities.id, v.cityId)),
    db.select({ id: venueTable.id }).from(venueTable).where(eq(venueTable.id, id ?? "")),
    db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.venueId, id ?? ""), ne(activities.listingMode, "hidden")))
      .limit(1),
  ]);
  if (!city) return fail(c, 400, { code: "invalid_field", field: "cityId" });
  if (id && !existing) return fail(c, 404, { code: "not_found" });
  if (listed && v.lat === null) return publishBar(c, ["mapPin"], "lat");
  const venueId = id ?? crypto.randomUUID();
  const list = body.photos as PhotoInput[];
  await db.batch([
    id ? db.update(venueTable).set(v).where(eq(venueTable.id, id)) : db.insert(venueTable).values({ ...v, id: venueId }),
    db.delete(photos).where(eq(photos.venueId, venueId)),
    ...(list.length ? [db.insert(photos).values(photoRows({ venueId }, list))] : []),
  ]);
  return c.json({ id: venueId }, id ? 200 : 201);
}

venues.post("/", (c) => save(c, null));
venues.put("/:id", (c) => save(c, c.req.param("id")));
