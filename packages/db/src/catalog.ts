import { and, asc, eq, gt, inArray, isNull, ne, notInArray, or, sql, type Column, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { activities, categories, cities, operators, photos, projActivities, projAddOns, projOptions, projPackOffers, projTimeslots, venues, type ListingMode, type Setting } from "./schema";

export type Locale = "en" | "ms";
export type Slugs = { en: string; ms: string };

export type Photo = {
  url: string;
  width: number;
  height: number;
  alt: string;
  creditName: string;
  creditUrl: string;
  sourceUrl: string;
};

export type Hub = { id: string; slugs: Slugs; name: string; intro: string; photo: Photo | null };

export type CardVenue = { id: string; slugs: Slugs | null; name: string; presint: number | null; lat: number | null; lng: number | null };

export type ActivityCard = {
  id: string;
  slugs: Slugs;
  city: Slugs;
  category: Slugs & { name: string };
  venue: CardVenue | null;
  name: string;
  listingMode: ListingMode;
  free: boolean;
  setting: Setting | null;
  fromPriceSen: number | null;
  minDurationMinutes: number | null;
  maxDurationMinutes: number | null;
  minAge: number | null;
  photo: Photo | null;
};

export type CatalogQuery = { locale: Locale; includeDrafts: boolean };

type PhotoRow = Omit<typeof photos.$inferSelect, "id" | "activityId" | "venueId" | "position">;
type Sluggable = { slugEn: SQLiteColumn; slugMs: SQLiteColumn };

const toPhoto = (p: PhotoRow, l: Locale): Photo => ({
  url: p.url,
  width: p.width,
  height: p.height,
  alt: l === "en" ? p.altEn : p.altMs,
  creditName: p.creditName,
  creditUrl: p.creditUrl,
  sourceUrl: p.sourceUrl,
});

const bySlug = (t: Sluggable, slug: string) => or(eq(t.slugEn, slug), eq(t.slugMs, slug));
const localeFirst = (t: Sluggable, l: Locale, slug: string) => sql`${l === "en" ? t.slugEn : t.slugMs} = ${slug} desc`;
const listed = ne(activities.listingMode, "hidden");
const draftGate = (q: CatalogQuery) => (q.includeDrafts ? undefined : listed);

// json_each keeps it to one bound parameter; D1 caps a statement at 100.
export const within = (col: Column, ids: string[]) => sql`${col} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(ids)])}))`;

type HubRow = { hub: typeof cities.$inferSelect; photo: PhotoRow | null };
type HubTable = typeof cities | typeof categories;

const toHub = ({ hub: r, photo: p }: HubRow, l: Locale): Hub => ({
  id: r.id,
  slugs: { en: r.slugEn, ms: r.slugMs },
  name: l === "en" ? r.nameEn : r.nameMs,
  intro: l === "en" ? r.introEn : r.introMs,
  photo: p ? toPhoto(p, l) : null,
});

const photoCols = {
  url: photos.url,
  width: photos.width,
  height: photos.height,
  altEn: photos.altEn,
  altMs: photos.altMs,
  creditName: photos.creditName,
  creditUrl: photos.creditUrl,
  sourceUrl: photos.sourceUrl,
};

// D1 batch results are keyed by column name, so batched selects never join tables sharing one (photos.id would clobber the hub's id).
const hubs = (db: Db, table: HubTable) => db.select({ hub: table, photo: photoCols }).from(table).leftJoin(photos, eq(photos.id, table.photoId));

// Lowest price of each Option's open future Timeslots (a Schedule's or Weekend price, else the Option's).
const slotPricesWhere = (db: Db, options: SQL) =>
  db
    .select({ optionId: projTimeslots.optionId, priceSen: sql<number>`min(coalesce(${projTimeslots.priceSen}, ${projOptions.priceSen}))` })
    .from(projTimeslots)
    .innerJoin(projOptions, eq(projOptions.id, projTimeslots.optionId))
    .where(and(options, isNull(projTimeslots.closedAt), gt(projTimeslots.startsAt, Date.now())))
    .groupBy(projTimeslots.optionId);

export const slotPrices = (db: Db, activityIds: string[]) => slotPricesWhere(db, within(projOptions.activityId, activityIds));

type SlotPrice = { optionId: string; priceSen: number };

// An Option with no open Timeslot counts at its own price.
export const optionFrom = (o: { id: string; priceSen: number }, slots: SlotPrice[]) => slots.find((s) => s.optionId === o.id)?.priceSen ?? o.priceSen;

const fromPrice = (options: { id: string; priceSen: number }[], slots: SlotPrice[]) => {
  const prices = options.map((o) => optionFrom(o, slots));
  return prices.length ? Math.min(...prices) : null;
};

const hubQuery = (db: Db, table: HubTable, l: Locale, slug: string) =>
  hubs(db, table).where(bySlug(table, slug)).orderBy(localeFirst(table, l, slug)).limit(1);

// The hub a slug resolves to, as a subquery, so dependent queries share one batch.
const hubId = (db: Db, table: HubTable, l: Locale, slug: string) =>
  db.select({ id: table.id }).from(table).where(bySlug(table, slug)).orderBy(localeFirst(table, l, slug)).limit(1);

// Statements for listed cards; run them in a db.batch and pass the results to toCards.
function cardQueries(db: Db, q: CatalogQuery, where?: SQL) {
  const gate = and(where, draftGate(q));
  const of = (col: SQLiteColumn) => db.select({ id: col }).from(activities).where(gate);
  const ids = of(activities.id);
  return [
    db
      .select({
        id: activities.id,
        slugEn: activities.slugEn,
        slugMs: activities.slugMs,
        nameEn: activities.nameEn,
        nameMs: activities.nameMs,
        listingMode: activities.listingMode,
        free: activities.free,
        setting: activities.setting,
        cityId: activities.cityId,
        categoryId: activities.categoryId,
        venueId: activities.venueId,
      })
      .from(activities)
      .where(gate)
      .orderBy(sql`${activities.listingMode} = 'bookable' desc`, asc(activities.nameEn)),
    db
      .select({
        id: projOptions.id,
        activityId: projOptions.activityId,
        priceSen: projOptions.priceSen,
        durationMinutes: projOptions.durationMinutes,
        minAge: projOptions.minAge,
      })
      .from(projOptions)
      .where(and(inArray(projOptions.activityId, ids), eq(projOptions.active, true))),
    db
      .select({ activityId: photos.activityId, ...photoCols })
      .from(photos)
      .where(and(inArray(photos.activityId, ids), eq(photos.position, 0))),
    slotPricesWhere(db, inArray(projOptions.activityId, ids)),
    db.select({ id: cities.id, slugEn: cities.slugEn, slugMs: cities.slugMs }).from(cities).where(inArray(cities.id, of(activities.cityId))),
    db
      .select({ id: categories.id, slugEn: categories.slugEn, slugMs: categories.slugMs, nameEn: categories.nameEn, nameMs: categories.nameMs })
      .from(categories)
      .where(inArray(categories.id, of(activities.categoryId))),
    db
      .select({
        id: venues.id,
        slugEn: venues.slugEn,
        slugMs: venues.slugMs,
        nameEn: venues.nameEn,
        nameMs: venues.nameMs,
        presint: venues.presint,
        lat: venues.lat,
        lng: venues.lng,
      })
      .from(venues)
      .where(inArray(venues.id, of(activities.venueId))),
  ] as const;
}

type Results<T> = { -readonly [K in keyof T]: Awaited<T[K]> };
type CardRows = Results<ReturnType<typeof cardQueries>>;

function toCards(q: CatalogQuery, [rows, opts, covers, slots, cityRows, categoryRows, venueRows]: CardRows): ActivityCard[] {
  const min = (xs: (number | null)[]) => {
    const n = xs.filter((x): x is number => x !== null);
    return n.length ? Math.min(...n) : null;
  };
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const [cityOf, categoryOf, venueOf] = [byId(cityRows), byId(categoryRows), byId(venueRows)];
  const en = q.locale === "en";
  return rows.map((a) => {
    const o = opts.filter((x) => x.activityId === a.id);
    const cover = covers.find((p) => p.activityId === a.id);
    const city = cityOf.get(a.cityId)!;
    const category = categoryOf.get(a.categoryId)!;
    const v = a.venueId ? venueOf.get(a.venueId) : undefined;
    return {
      id: a.id,
      slugs: { en: a.slugEn, ms: a.slugMs },
      city: { en: city.slugEn, ms: city.slugMs },
      category: { en: category.slugEn, ms: category.slugMs, name: en ? category.nameEn : category.nameMs },
      venue: v
        ? {
            id: v.id,
            slugs: v.slugEn && v.slugMs ? { en: v.slugEn, ms: v.slugMs } : null,
            name: en ? v.nameEn : v.nameMs,
            presint: v.presint,
            lat: v.lat,
            lng: v.lng,
          }
        : null,
      name: en ? a.nameEn : a.nameMs,
      listingMode: a.listingMode,
      free: a.free,
      setting: a.setting,
      fromPriceSen: fromPrice(o, slots),
      minDurationMinutes: min(o.map((x) => x.durationMinutes)),
      maxDurationMinutes: max(o.map((x) => x.durationMinutes)),
      minAge: o.some((x) => x.minAge === null) ? null : min(o.map((x) => x.minAge)),
      photo: cover ? toPhoto(cover, q.locale) : null,
    };
  });
}

const hasListed = (cards: ActivityCard[]) => cards.some((c) => c.listingMode !== "hidden");

export async function getHome(db: Db, q: CatalogQuery) {
  const [cityRows, categoryRows, ...cards] = await db.batch([
    hubs(db, cities).orderBy(asc(cities.nameEn)),
    hubs(db, categories).orderBy(asc(categories.nameEn)),
    ...cardQueries(db, q),
  ]);
  return {
    cities: cityRows.map((r) => toHub(r, q.locale)),
    categories: categoryRows.map((r) => toHub(r, q.locale)),
    activities: toCards(q, cards),
  };
}

// Categories with listed Activities matching `where`.
const categoriesWith = (db: Db, q: CatalogQuery, where: SQL | undefined) =>
  hubs(db, categories)
    .where(inArray(categories.id, db.select({ id: activities.categoryId }).from(activities).where(and(where, draftGate(q)))))
    .orderBy(asc(categories.nameEn));

export type CityFilters = { bookable: boolean; free: boolean; setting: Setting | null; presint: number | null };
export type MapVenue = { id: string; slugs: Slugs; name: string; lat: number; lng: number };

const matches = (c: ActivityCard, f: CityFilters) =>
  (!f.bookable || c.listingMode === "bookable") &&
  (!f.free || c.free) &&
  (!f.setting || c.setting === f.setting) &&
  (f.presint === null || c.venue?.presint === f.presint);

function mapVenues(cards: ActivityCard[]): MapVenue[] {
  const out = new Map<string, MapVenue>();
  for (const { venue: v } of cards) {
    if (v?.slugs && v.lat !== null && v.lng !== null) out.set(v.id, { id: v.id, slugs: v.slugs, name: v.name, lat: v.lat, lng: v.lng });
  }
  return [...out.values()];
}

export async function getCityHub(db: Db, q: CatalogQuery & { city: string; filters?: CityFilters }) {
  const inCity = inArray(activities.cityId, hubId(db, cities, q.locale, q.city));
  const [[row], categoryRows, ...rows] = await db.batch([hubQuery(db, cities, q.locale, q.city), categoriesWith(db, q, inCity), ...cardQueries(db, q, inCity)]);
  if (!row) return null;
  const cards = toCards(q, rows);
  const { filters } = q;
  const shown = filters ? cards.filter((c) => matches(c, filters)) : cards;
  return {
    city: toHub(row, q.locale),
    categories: categoryRows.map((r) => toHub(r, q.locale)),
    activities: shown,
    venues: mapVenues(shown),
    presints: [...new Set(cards.flatMap((c) => (c.venue?.presint ? [c.venue.presint] : [])))].sort((a, b) => a - b),
    indexable: hasListed(cards),
  };
}

export async function getCategoryHub(db: Db, q: CatalogQuery & { city: string; category: string }) {
  const inCity = inArray(activities.cityId, hubId(db, cities, q.locale, q.city));
  const categoryId = hubId(db, categories, q.locale, q.category);
  const [[cityRow], [categoryRow], others, ...rows] = await db.batch([
    hubQuery(db, cities, q.locale, q.city),
    hubQuery(db, categories, q.locale, q.category),
    categoriesWith(db, q, and(inCity, notInArray(activities.categoryId, categoryId))),
    ...cardQueries(db, q, and(inCity, inArray(activities.categoryId, categoryId))),
  ]);
  if (!cityRow || !categoryRow) return null;
  const cards = toCards(q, rows);
  return {
    city: toHub(cityRow, q.locale),
    category: toHub(categoryRow, q.locale),
    activities: cards,
    otherCategories: others.map((r) => toHub(r, q.locale)),
    indexable: hasListed(cards),
  };
}

export async function getActivityPage(db: Db, q: CatalogQuery & { city: string; category: string; activity: string }) {
  const found = and(bySlug(activities, q.activity), draftGate(q));
  const id = db.select({ id: activities.id }).from(activities).where(found).orderBy(localeFirst(activities, q.locale, q.activity)).limit(1);
  const venueId = db.select({ id: activities.venueId }).from(activities).where(inArray(activities.id, id));
  const cityId = db.select({ id: activities.cityId }).from(activities).where(inArray(activities.id, id));
  const [[row], [cityRow], [categoryRow], opts, extras, gallery, offers, [venue], venueGallery, slots, ...rows] = await db.batch([
    db
      .select({ a: activities, operatorName: operators.name, commissionBps: operators.commissionBps, freeCancelHours: projActivities.freeCancelHours })
      .from(activities)
      .innerJoin(operators, eq(operators.id, activities.operatorId))
      .leftJoin(projActivities, eq(projActivities.id, activities.id))
      .where(found)
      .orderBy(localeFirst(activities, q.locale, q.activity))
      .limit(1),
    hubQuery(db, cities, q.locale, q.city),
    hubQuery(db, categories, q.locale, q.category),
    db
      .select()
      .from(projOptions)
      .where(and(inArray(projOptions.activityId, id), eq(projOptions.active, true)))
      .orderBy(asc(projOptions.priceSen), asc(projOptions.durationMinutes)),
    db
      .select()
      .from(projAddOns)
      .where(and(inArray(projAddOns.activityId, id), eq(projAddOns.active, true)))
      .orderBy(asc(projAddOns.priceSen)),
    db.select().from(photos).where(inArray(photos.activityId, id)).orderBy(asc(photos.position)),
    db
      .select()
      .from(projPackOffers)
      .where(and(inArray(projPackOffers.activityId, id), eq(projPackOffers.active, true)))
      .orderBy(asc(projPackOffers.priceSen)),
    db.select().from(venues).where(inArray(venues.id, venueId)),
    db.select().from(photos).where(inArray(photos.venueId, venueId)).orderBy(asc(photos.position)),
    slotPricesWhere(db, inArray(projOptions.activityId, id)),
    ...cardQueries(db, q, and(inArray(activities.cityId, cityId), notInArray(activities.id, id))),
  ]);
  if (!row || cityRow?.hub.id !== row.a.cityId || categoryRow?.hub.id !== row.a.categoryId) return null;
  const { a } = row;
  const en = q.locale === "en";

  return {
    id: a.id,
    slugs: { en: a.slugEn, ms: a.slugMs },
    city: toHub(cityRow, q.locale),
    category: toHub(categoryRow, q.locale),
    operatorName: row.operatorName,
    name: en ? a.nameEn : a.nameMs,
    description: en ? a.descriptionEn : a.descriptionMs,
    listingMode: a.listingMode,
    commissionBps: row.commissionBps,
    howToBook: a.howToBook,
    bookUrl: a.bookUrl,
    priceNote: en ? a.priceNoteEn : a.priceNoteMs,
    freeCancelHours: row.freeCancelHours,
    fromPriceSen: fromPrice(opts, slots),
    venue: venue && {
      name: en ? venue.nameEn : venue.nameMs,
      presint: venue.presint,
      slugs: venue.slugEn && venue.slugMs ? { en: venue.slugEn, ms: venue.slugMs } : null,
    },
    streetAddress: venue ? venue.streetAddress : a.streetAddress,
    postalCode: venue ? venue.postalCode : a.postalCode,
    lat: venue ? venue.lat : a.lat,
    lng: venue ? venue.lng : a.lng,
    phone: a.phone ?? venue?.phone ?? null,
    openingHours: a.openingHours.length ? a.openingHours : (venue?.openingHours ?? []),
    hoursNote: en ? a.hoursNoteEn : a.hoursNoteMs,
    highlights: en ? a.highlightsEn : a.highlightsMs,
    faq: en ? a.faqEn : a.faqMs,
    options: opts.map((o) => ({
      id: o.id,
      name: en ? o.nameEn : o.nameMs,
      fromPriceSen: optionFrom(o, slots),
      durationMinutes: o.durationMinutes,
      ticketType: o.ticketType,
      minAge: o.minAge,
      maxAge: o.maxAge,
      maxWeightKg: o.maxWeightKg,
      requiredCert: o.requiredCert,
      minParticipants: o.minParticipants,
    })),
    addOns: extras.map((x) => ({ id: x.id, name: en ? x.nameEn : x.nameMs, priceSen: x.priceSen })),
    packOffers: offers.map((o) => ({
      id: o.id,
      name: en ? o.nameEn : o.nameMs,
      sessions: o.sessions,
      priceSen: o.priceSen,
      validDays: o.validDays,
      options: opts.filter((x) => o.optionIds.includes(x.id)).map((x) => (en ? x.nameEn : x.nameMs)),
    })),
    photos: (gallery.length ? gallery : venueGallery).map((p) => toPhoto(p, q.locale)),
    related: toCards(q, rows),
  };
}

const RANK: Record<ListingMode, number> = { bookable: 0, info: 1, hidden: 2 };

export async function getVenuePage(db: Db, q: CatalogQuery & { city: string; venue: string }) {
  const inCity = and(inArray(venues.cityId, hubId(db, cities, q.locale, q.city)), bySlug(venues, q.venue));
  const venueId = db.select({ id: venues.id }).from(venues).where(inCity).orderBy(localeFirst(venues, q.locale, q.venue)).limit(1);
  const [[cityRow], [v], gallery, ...rows] = await db.batch([
    hubQuery(db, cities, q.locale, q.city),
    db.select().from(venues).where(inArray(venues.id, venueId)),
    db.select().from(photos).where(inArray(photos.venueId, venueId)).orderBy(asc(photos.position)),
    ...cardQueries(db, q, inArray(activities.venueId, venueId)),
  ]);
  if (!cityRow || !v?.slugEn || !v.slugMs) return null;
  const city = toHub(cityRow, q.locale);
  const cards = toCards(q, rows);
  if (cards.length === 0) return null;
  const en = q.locale === "en";
  return {
    id: v.id,
    slugs: { en: v.slugEn, ms: v.slugMs },
    city,
    name: en ? v.nameEn : v.nameMs,
    streetAddress: v.streetAddress,
    postalCode: v.postalCode,
    presint: v.presint,
    phone: v.phone,
    lat: v.lat,
    lng: v.lng,
    openingHours: v.openingHours,
    photos: gallery.map((p) => toPhoto(p, q.locale)),
    activities: cards.sort((a, b) => RANK[a.listingMode] - RANK[b.listingMode]),
    indexable: hasListed(cards),
  };
}

export type SitemapEntry = { city: Slugs; category?: Slugs; activity?: Slugs; venue?: Slugs };

export async function listSitemapEntries(db: Db): Promise<SitemapEntry[]> {
  const rows = await db
    .select({
      a: { en: activities.slugEn, ms: activities.slugMs },
      city: { en: cities.slugEn, ms: cities.slugMs },
      category: { en: categories.slugEn, ms: categories.slugMs },
      venue: { en: venues.slugEn, ms: venues.slugMs },
    })
    .from(activities)
    .innerJoin(cities, eq(cities.id, activities.cityId))
    .innerJoin(categories, eq(categories.id, activities.categoryId))
    .leftJoin(venues, and(eq(venues.id, activities.venueId), eq(venues.cityId, activities.cityId)))
    .where(listed)
    .orderBy(asc(cities.slugEn), asc(categories.slugEn), asc(activities.slugEn));
  const out = new Map<string, SitemapEntry>();
  for (const r of rows) {
    out.set(r.city.en, { city: r.city });
    out.set(`${r.city.en}/${r.category.en}`, { city: r.city, category: r.category });
    out.set(`${r.city.en}/${r.category.en}/${r.a.en}`, { city: r.city, category: r.category, activity: r.a });
    if (r.venue?.en && r.venue.ms) out.set(`${r.city.en}/venue/${r.venue.en}`, { city: r.city, venue: { en: r.venue.en, ms: r.venue.ms } });
  }
  return [...out.values()];
}
