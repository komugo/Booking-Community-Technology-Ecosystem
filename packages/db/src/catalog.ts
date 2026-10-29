import { and, asc, eq, gt, inArray, isNull, ne, or, sql, type Column, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { activities, categories, cities, operators, photos, projActivities, projAddOns, projOptions, projPackOffers, projTimeslots } from "./schema";

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

export type ActivityCard = {
  id: string;
  slugs: Slugs;
  city: Slugs;
  category: Slugs & { name: string };
  name: string;
  published: boolean;
  fromPriceSen: number | null;
  minDurationMinutes: number | null;
  maxDurationMinutes: number | null;
  minAge: number | null;
  photo: Photo | null;
};

export type CatalogQuery = { locale: Locale; includeDrafts: boolean };

type PhotoRow = typeof photos.$inferSelect;
type HubRow = typeof cities.$inferSelect;
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
const draftGate = (q: CatalogQuery) => (q.includeDrafts ? undefined : eq(activities.published, true));

// json_each keeps it to one bound parameter; D1 caps a statement at 100.
export const within = (col: Column, ids: string[]) => sql`${col} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(ids)])}))`;

async function toHubs(db: Db, rows: HubRow[], l: Locale): Promise<Hub[]> {
  const ids = rows.flatMap((r) => (r.photoId ? [r.photoId] : []));
  const found = ids.length ? await db.select().from(photos).where(inArray(photos.id, ids)) : [];
  const byId = new Map(found.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = r.photoId ? byId.get(r.photoId) : undefined;
    return {
      id: r.id,
      slugs: { en: r.slugEn, ms: r.slugMs },
      name: l === "en" ? r.nameEn : r.nameMs,
      intro: l === "en" ? r.introEn : r.introMs,
      photo: p ? toPhoto(p, l) : null,
    };
  });
}

// Lowest price of each Option's open future Timeslots (a Schedule's price, else the Option's).
export const slotPrices = (db: Db, activityIds: string[]) =>
  db
    .select({ optionId: projTimeslots.optionId, priceSen: sql<number>`min(coalesce(${projTimeslots.priceSen}, ${projOptions.priceSen}))` })
    .from(projTimeslots)
    .innerJoin(projOptions, eq(projOptions.id, projTimeslots.optionId))
    .where(and(within(projOptions.activityId, activityIds), isNull(projTimeslots.closedAt), gt(projTimeslots.startsAt, Date.now())))
    .groupBy(projTimeslots.optionId);

type SlotPrice = { optionId: string; priceSen: number };

// An Option with no open Timeslot counts at its own price.
export const optionFrom = (o: { id: string; priceSen: number }, slots: SlotPrice[]) => slots.find((s) => s.optionId === o.id)?.priceSen ?? o.priceSen;

const fromPrice = (options: { id: string; priceSen: number }[], slots: SlotPrice[]) => {
  const prices = options.map((o) => optionFrom(o, slots));
  return prices.length ? Math.min(...prices) : null;
};

const hubQuery = (db: Db, table: typeof cities | typeof categories, l: Locale, slug: string) =>
  db.select().from(table).where(bySlug(table, slug)).orderBy(localeFirst(table, l, slug)).limit(1);

async function listCards(db: Db, q: CatalogQuery, where?: SQL): Promise<ActivityCard[]> {
  const rows = await db
    .select({ a: activities, city: cities, category: categories })
    .from(activities)
    .innerJoin(cities, eq(cities.id, activities.cityId))
    .innerJoin(categories, eq(categories.id, activities.categoryId))
    .where(and(where, draftGate(q)))
    .orderBy(asc(activities.nameEn));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.a.id);
  const [opts, covers, slots] = await db.batch([
    db
      .select({
        id: projOptions.id,
        activityId: projOptions.activityId,
        priceSen: projOptions.priceSen,
        durationMinutes: projOptions.durationMinutes,
        minAge: projOptions.minAge,
      })
      .from(projOptions)
      .where(and(within(projOptions.activityId, ids), eq(projOptions.active, true))),
    db
      .select()
      .from(photos)
      .where(and(within(photos.activityId, ids), eq(photos.position, 0))),
    slotPrices(db, ids),
  ]);
  const min = (xs: (number | null)[]) => {
    const n = xs.filter((x): x is number => x !== null);
    return n.length ? Math.min(...n) : null;
  };
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  return rows.map(({ a, city, category }) => {
    const o = opts.filter((x) => x.activityId === a.id);
    const cover = covers.find((p) => p.activityId === a.id);
    return {
      id: a.id,
      slugs: { en: a.slugEn, ms: a.slugMs },
      city: { en: city.slugEn, ms: city.slugMs },
      category: { en: category.slugEn, ms: category.slugMs, name: q.locale === "en" ? category.nameEn : category.nameMs },
      name: q.locale === "en" ? a.nameEn : a.nameMs,
      published: a.published,
      fromPriceSen: fromPrice(o, slots),
      minDurationMinutes: min(o.map((x) => x.durationMinutes)),
      maxDurationMinutes: max(o.map((x) => x.durationMinutes)),
      minAge: o.some((x) => x.minAge === null) ? null : min(o.map((x) => x.minAge)),
      photo: cover ? toPhoto(cover, q.locale) : null,
    };
  });
}

const hasPublished = (cards: ActivityCard[]) => cards.some((c) => c.published);

export async function getHome(db: Db, q: CatalogQuery) {
  const [cityRows, categoryRows] = await db.batch([
    db.select().from(cities).orderBy(asc(cities.nameEn)),
    db.select().from(categories).orderBy(asc(categories.nameEn)),
  ]);
  const [cityHubs, categoryHubs, cards] = await Promise.all([
    toHubs(db, cityRows, q.locale),
    toHubs(db, categoryRows, q.locale),
    listCards(db, q),
  ]);
  return { cities: cityHubs, categories: categoryHubs, activities: cards };
}

async function categoryHubs(db: Db, cards: ActivityCard[], l: Locale) {
  const slugs = [...new Set(cards.map((c) => c.category.en))];
  if (slugs.length === 0) return [];
  const rows = await db.select().from(categories).where(inArray(categories.slugEn, slugs)).orderBy(asc(categories.nameEn));
  return toHubs(db, rows, l);
}

export async function getCityHub(db: Db, q: CatalogQuery & { city: string }) {
  const [row] = await hubQuery(db, cities, q.locale, q.city);
  if (!row) return null;
  const [[city], cards] = await Promise.all([toHubs(db, [row], q.locale), listCards(db, q, eq(activities.cityId, row.id))]);
  return { city, categories: await categoryHubs(db, cards, q.locale), activities: cards, indexable: hasPublished(cards) };
}

export async function getCategoryHub(db: Db, q: CatalogQuery & { city: string; category: string }) {
  const [[cityRow], [categoryRow]] = await db.batch([
    hubQuery(db, cities, q.locale, q.city),
    hubQuery(db, categories, q.locale, q.category),
  ]);
  if (!cityRow || !categoryRow) return null;
  const inCity = eq(activities.cityId, cityRow.id);
  const [[city, category], cards, others] = await Promise.all([
    toHubs(db, [cityRow, categoryRow], q.locale),
    listCards(db, q, and(inCity, eq(activities.categoryId, categoryRow.id))),
    listCards(db, q, and(inCity, ne(activities.categoryId, categoryRow.id))),
  ]);
  return {
    city,
    category,
    activities: cards,
    otherCategories: await categoryHubs(db, others, q.locale),
    indexable: hasPublished(cards),
  };
}

export async function getActivityPage(db: Db, q: CatalogQuery & { city: string; category: string; activity: string }) {
  const [[row], [cityRow], [categoryRow]] = await db.batch([
    db
      .select({ a: activities, operatorName: operators.name, freeCancelHours: projActivities.freeCancelHours })
      .from(activities)
      .innerJoin(operators, eq(operators.id, activities.operatorId))
      .leftJoin(projActivities, eq(projActivities.id, activities.id))
      .where(and(bySlug(activities, q.activity), draftGate(q)))
      .orderBy(localeFirst(activities, q.locale, q.activity))
      .limit(1),
    hubQuery(db, cities, q.locale, q.city),
    hubQuery(db, categories, q.locale, q.category),
  ]);
  if (!row || cityRow?.id !== row.a.cityId || categoryRow?.id !== row.a.categoryId) return null;
  const { a } = row;
  const en = q.locale === "en";
  const [[opts, extras, gallery, offers, slots], [city, category], related] = await Promise.all([
    db.batch([
      db
        .select()
        .from(projOptions)
        .where(and(eq(projOptions.activityId, a.id), eq(projOptions.active, true)))
        .orderBy(asc(projOptions.priceSen), asc(projOptions.durationMinutes)),
      db
        .select()
        .from(projAddOns)
        .where(and(eq(projAddOns.activityId, a.id), eq(projAddOns.active, true)))
        .orderBy(asc(projAddOns.priceSen)),
      db.select().from(photos).where(eq(photos.activityId, a.id)).orderBy(asc(photos.position)),
      db
        .select()
        .from(projPackOffers)
        .where(and(eq(projPackOffers.activityId, a.id), eq(projPackOffers.active, true)))
        .orderBy(asc(projPackOffers.priceSen)),
      slotPrices(db, [a.id]),
    ]),
    toHubs(db, [cityRow, categoryRow], q.locale),
    listCards(db, q, and(eq(activities.cityId, a.cityId), ne(activities.id, a.id))),
  ]);

  return {
    id: a.id,
    slugs: { en: a.slugEn, ms: a.slugMs },
    city,
    category,
    operatorName: row.operatorName,
    name: en ? a.nameEn : a.nameMs,
    description: en ? a.descriptionEn : a.descriptionMs,
    published: a.published,
    freeCancelHours: row.freeCancelHours,
    fromPriceSen: fromPrice(opts, slots),
    streetAddress: a.streetAddress,
    postalCode: a.postalCode,
    lat: a.lat,
    lng: a.lng,
    phone: a.phone,
    openingHours: a.openingHours,
    hoursNote: en ? a.hoursNoteEn : a.hoursNoteMs,
    highlights: en ? a.highlightsEn : a.highlightsMs,
    faq: en ? a.faqEn : a.faqMs,
    options: opts.map((o) => ({
      id: o.id,
      name: en ? o.nameEn : o.nameMs,
      fromPriceSen: optionFrom(o, slots),
      durationMinutes: o.durationMinutes,
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
    photos: gallery.map((p) => toPhoto(p, q.locale)),
    related,
  };
}

export type SitemapEntry = { city: Slugs; category?: Slugs; activity?: Slugs };

export async function listSitemapEntries(db: Db): Promise<SitemapEntry[]> {
  const rows = await db
    .select({
      a: { en: activities.slugEn, ms: activities.slugMs },
      city: { en: cities.slugEn, ms: cities.slugMs },
      category: { en: categories.slugEn, ms: categories.slugMs },
    })
    .from(activities)
    .innerJoin(cities, eq(cities.id, activities.cityId))
    .innerJoin(categories, eq(categories.id, activities.categoryId))
    .where(eq(activities.published, true))
    .orderBy(asc(cities.slugEn), asc(categories.slugEn), asc(activities.slugEn));
  const out = new Map<string, SitemapEntry>();
  for (const r of rows) {
    out.set(r.city.en, { city: r.city });
    out.set(`${r.city.en}/${r.category.en}`, { city: r.city, category: r.category });
    out.set(`${r.city.en}/${r.category.en}/${r.a.en}`, { city: r.city, category: r.category, activity: r.a });
  }
  return [...out.values()];
}
