// Insert-only load of the reviewed data file: rows already in D1 are never touched, so staff edits survive a re-run.
import type { HOW_TO_BOOK, OpeningHours } from "@komugo/db";

export type HowToBook = (typeof HOW_TO_BOOK)[number];
export type Hours = OpeningHours;
export type Note = { rows: number[]; note: string };

export type CatalogueVenue = {
  id: string;
  slugEn: string;
  slugMs: string;
  nameEn: string;
  nameMs: string;
  streetAddress: string | null;
  presint: number | null;
  phone: string | null;
  openingHours: Hours[];
  rows: number[];
};

export type CatalogueActivity = {
  id: string;
  venueId: string;
  operatorId: string;
  categoryId: string;
  slugEn: string;
  slugMs: string;
  nameEn: string;
  nameMs: string;
  listingMode: string;
  howToBook: HowToBook;
  priceNoteEn: string | null;
  priceNoteMs: string | null;
  phone: string | null;
  openingHours: Hours[];
  rows: number[];
};

export type Catalogue = {
  source: string;
  city: { id: string; slugEn: string; slugMs: string; nameEn: string; nameMs: string; introEn: string; introMs: string };
  operators: { id: string; name: string; unknown?: boolean; rows: number[] }[];
  venues: CatalogueVenue[];
  activities: CatalogueActivity[];
  excluded: { row: number; venue: string; activity: string; reason: string }[];
  review: Note[];
};

export const EXISTING_SQL = [
  "SELECT id, slug_en FROM cities",
  "SELECT id FROM operators",
  "SELECT id, city_id, slug_en, slug_ms FROM venues",
  "SELECT id, slug_en, slug_ms FROM activities",
];

export type Existing = {
  cities: { id: string; slug_en: string }[];
  operators: { id: string }[];
  venues: { id: string; city_id: string; slug_en: string | null; slug_ms: string | null }[];
  activities: { id: string; slug_en: string; slug_ms: string }[];
};

export const existingFrom = ([cities, operators, venues, activities]: unknown[][]) => ({ cities, operators, venues, activities }) as Existing;

type Skip = { id: string; reason: string };

export type Plan = {
  cityId: string;
  city: Catalogue["city"] | null;
  operators: Catalogue["operators"];
  venues: CatalogueVenue[];
  activities: CatalogueActivity[];
  kept: { operators: number; venues: number; activities: number };
  skipped: Skip[];
};

export function plan(data: Catalogue, existing: Existing): Plan {
  const shown = data.activities.find((a) => a.listingMode !== "hidden");
  if (shown) throw new Error(`${shown.id}: imported Activities must be Hidden`);
  const city = existing.cities.find((c) => c.slug_en === data.city.slugEn);
  const cityId = city?.id ?? data.city.id;
  const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const [operatorIds, venueIds, activityIds] = [ids(existing.operators), ids(existing.venues), ids(existing.activities)];
  const venueSlugs = new Set(existing.venues.filter((v) => v.city_id === cityId).flatMap((v) => [v.slug_en, v.slug_ms]));
  const activitySlugs = new Set(existing.activities.flatMap((a) => [a.slug_en, a.slug_ms]));
  const taken = (r: { slugEn: string; slugMs: string }, slugs: Set<string | null>) => slugs.has(r.slugEn) || slugs.has(r.slugMs);
  const skipped: Skip[] = [];
  const venues: CatalogueVenue[] = [];
  for (const v of data.venues) {
    if (venueIds.has(v.id)) continue;
    if (taken(v, venueSlugs)) skipped.push({ id: v.id, reason: `slug ${v.slugEn} / ${v.slugMs} already taken` });
    else venues.push(v);
  }
  const placed = new Set([...venueIds, ...venues.map((v) => v.id)]);
  const activities: CatalogueActivity[] = [];
  for (const a of data.activities) {
    if (activityIds.has(a.id)) continue;
    if (!placed.has(a.venueId)) skipped.push({ id: a.id, reason: `Venue ${a.venueId} skipped` });
    else if (taken(a, activitySlugs)) skipped.push({ id: a.id, reason: `slug ${a.slugEn} / ${a.slugMs} already taken` });
    else activities.push(a);
  }
  return {
    cityId,
    city: city ? null : data.city,
    operators: data.operators.filter((o) => !operatorIds.has(o.id)),
    venues,
    activities,
    kept: {
      operators: data.operators.filter((o) => operatorIds.has(o.id)).length,
      venues: data.venues.filter((v) => venueIds.has(v.id)).length,
      activities: data.activities.filter((a) => activityIds.has(a.id)).length,
    },
    skipped,
  };
}

export function diff(p: Plan): string[] {
  const hours = (h: Hours[]) => h.map((x) => `${x.days.join("")} ${x.opens}-${x.closes}`).join(", ");
  return [
    p.city ? `+ city ${p.city.id}  ${p.city.nameEn}` : `= city ${p.cityId}`,
    `Operators: ${p.operators.length} new, ${p.kept.operators} kept`,
    ...p.operators.map((o) => `+ operator ${o.id}  ${o.name}${o.unknown ? "  (unknown Operator)" : ""}`),
    `Venues: ${p.venues.length} new, ${p.kept.venues} kept`,
    ...p.venues.map((v) => `+ venue ${v.id}  ${v.nameEn} / ${v.nameMs}  presint=${v.presint ?? "-"}  hours=${hours(v.openingHours) || "-"}`),
    `Activities: ${p.activities.length} new, ${p.kept.activities} kept`,
    ...p.activities.map((a) => `+ activity ${a.id}  ${a.nameEn}  [${a.categoryId}] ${a.listingMode} ${a.howToBook}  price=${a.priceNoteEn ?? "-"}`),
    `Skipped: ${p.skipped.length}`,
    ...p.skipped.map((s) => `! ${s.id}: ${s.reason}`),
  ];
}

const lit = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replaceAll("'", "''")}'`);

const insert = (table: string, row: Record<string, string | number | null>) =>
  `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(lit).join(", ")}) ON CONFLICT DO NOTHING;`;

export function insertSql(p: Plan): string[] {
  const c = p.city;
  return [
    ...(c ? [insert("cities", { id: c.id, slug_en: c.slugEn, slug_ms: c.slugMs, name_en: c.nameEn, name_ms: c.nameMs, intro_en: c.introEn, intro_ms: c.introMs })] : []),
    ...p.operators.map((o) => insert("operators", { id: o.id, name: o.name })),
    ...p.venues.map((v) =>
      insert("venues", {
        id: v.id,
        city_id: p.cityId,
        name_en: v.nameEn,
        name_ms: v.nameMs,
        slug_en: v.slugEn,
        slug_ms: v.slugMs,
        street_address: v.streetAddress,
        presint: v.presint,
        phone: v.phone,
        opening_hours: JSON.stringify(v.openingHours),
      }),
    ),
    ...p.activities.map((a) =>
      insert("activities", {
        id: a.id,
        operator_id: a.operatorId,
        city_id: p.cityId,
        category_id: a.categoryId,
        venue_id: a.venueId,
        slug_en: a.slugEn,
        slug_ms: a.slugMs,
        name_en: a.nameEn,
        name_ms: a.nameMs,
        description_en: "",
        description_ms: "",
        listing_mode: "hidden",
        how_to_book: a.howToBook,
        price_note_en: a.priceNoteEn,
        price_note_ms: a.priceNoteMs,
        phone: a.phone,
        opening_hours: JSON.stringify(a.openingHours),
      }),
    ),
  ];
}
