import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Slugs } from "./catalog";
import type { Db } from "./client";
import { activities, venues } from "./schema";

export const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// A page matches either language's slug, so neither may equal another row's EN or BM slug.
async function unique(db: Db, t: typeof venues | typeof activities, base: Slugs, scope?: SQL): Promise<Slugs> {
  // Not LIKE: D1 caps a LIKE pattern at 50 bytes.
  const starts = (c: SQLiteColumn) => or(...[base.en, base.ms].map((b) => sql`substr(${c}, 1, ${b.length}) = ${b}`));
  const rows = await db
    .select({ en: t.slugEn, ms: t.slugMs })
    .from(t)
    .where(and(scope, or(starts(t.slugEn), starts(t.slugMs))));
  const taken = new Set(rows.flatMap((r) => [r.en, r.ms]));
  const free = (slug: string) => {
    let s = slug;
    for (let n = 2; taken.has(s); n++) s = `${slug}-${n}`;
    return s;
  };
  return { en: free(base.en), ms: free(base.ms) };
}

export const venueSlugs = (db: Db, cityId: string, names: { nameEn: string; nameMs: string }) =>
  unique(db, venues, { en: slugify(names.nameEn), ms: slugify(names.nameMs) }, eq(venues.cityId, cityId));

// An Activity's slug is its Venue's slug plus its sport (Category).
export const activitySlugs = (db: Db, venue: Slugs, category: Slugs) =>
  unique(db, activities, { en: `${venue.en}-${category.en}`, ms: `${venue.ms}-${category.ms}` });
