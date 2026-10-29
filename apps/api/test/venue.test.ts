import { activities, activitySlugs, categories, cities, getActivityPage, getVenuePage, operators, slugify, venues, venueSlugs, type ListingMode } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { db, rid } from "./helpers";

async function place() {
  const s = rid();
  const [city] = await db.insert(cities).values({ slugEn: `c-${s}`, slugMs: `c-${s}-ms`, nameEn: "City", nameMs: "Bandar" }).returning();
  const [category] = await db.insert(categories).values({ slugEn: "badminton", slugMs: "badminton", nameEn: "Badminton", nameMs: "Badminton" }).onConflictDoNothing().returning();
  const [badminton] = category ? [category] : await db.select().from(categories).where(eq(categories.slugEn, "badminton"));
  const [operator] = await db.insert(operators).values({ name: "PPJ", signedUp: true, commissionBps: 1000 }).returning();
  const names = { nameEn: `Sports Complex ${s}`, nameMs: `Kompleks Sukan ${s}` };
  const slugs = await venueSlugs(db, city.id, names);
  const [venue] = await db.insert(venues).values({ cityId: city.id, ...names, slugEn: slugs.en, slugMs: slugs.ms, presint: 9 }).returning();
  const activity = async (nameEn: string, listingMode: ListingMode) => {
    const a = await activitySlugs(db, slugs, { en: badminton.slugEn, ms: badminton.slugMs });
    const [row] = await db
      .insert(activities)
      .values({
        operatorId: operator.id,
        cityId: city.id,
        categoryId: badminton.id,
        venueId: venue.id,
        slugEn: a.en,
        slugMs: a.ms,
        nameEn,
        nameMs: `${nameEn} BM`,
        descriptionEn: "x",
        descriptionMs: "x",
        listingMode,
      })
      .returning();
    return row;
  };
  return { s, city, venue, slugs, badminton, activity };
}

const q = (locale: "en" | "ms") => ({ locale, includeDrafts: false });

describe("Venue page", () => {
  test("renders in EN and BM with Bookable Activities first and Hidden ones left out", async () => {
    const p = await place();
    const info = await p.activity("A court", "info");
    const bookable = await p.activity("B court", "bookable");
    await p.activity("C court", "hidden");

    const en = (await getVenuePage(db, { ...q("en"), city: p.city.slugEn, venue: p.slugs.en }))!;
    expect(en).toMatchObject({ name: `Sports Complex ${p.s}`, slugs: p.slugs, presint: 9, indexable: true, city: { name: "City" } });
    expect(en.activities.map((a) => [a.id, a.listingMode])).toEqual([
      [bookable.id, "bookable"],
      [info.id, "info"],
    ]);
    const ms = (await getVenuePage(db, { ...q("ms"), city: p.city.slugMs, venue: p.slugs.ms }))!;
    expect(ms).toMatchObject({ name: `Kompleks Sukan ${p.s}`, city: { name: "Bandar" } });
    expect(ms.activities.map((a) => a.name)).toEqual(["B court BM", "A court BM"]);
  });

  test("is hidden when all its Activities are Hidden", async () => {
    const p = await place();
    const a = await p.activity("Court", "hidden");
    const page = { city: p.city.slugEn, venue: p.slugs.en };
    expect(await getVenuePage(db, { ...q("en"), ...page })).toBeNull();
    expect(await getVenuePage(db, { locale: "en", includeDrafts: true, ...page })).toMatchObject({ indexable: false });
    await db.update(activities).set({ listingMode: "info" }).where(eq(activities.id, a.id));
    expect(await getVenuePage(db, { ...q("en"), ...page })).not.toBeNull();
  });

  test("is only found in its own City", async () => {
    const p = await place();
    await p.activity("Court", "info");
    const other = await place();
    expect(await getVenuePage(db, { ...q("en"), city: other.city.slugEn, venue: p.slugs.en })).toBeNull();
  });

  test("an Activity links to its Venue", async () => {
    const p = await place();
    const a = await p.activity("Court", "info");
    const page = await getActivityPage(db, { ...q("ms"), city: p.city.slugMs, category: p.badminton.slugMs, activity: a.slugMs });
    expect(page?.venue).toEqual({ name: `Kompleks Sukan ${p.s}`, presint: 9, slugs: p.slugs });
  });

  test("renaming after publish keeps the slugs", async () => {
    const p = await place();
    const a = await p.activity("Court", "bookable");
    await db.update(venues).set({ nameEn: "Renamed Hall", nameMs: "Dewan Baharu" }).where(eq(venues.id, p.venue.id));
    await db.update(activities).set({ nameEn: "Renamed Court", nameMs: "Gelanggang Baharu" }).where(eq(activities.id, a.id));
    expect(await getVenuePage(db, { ...q("en"), city: p.city.slugEn, venue: p.slugs.en })).toMatchObject({ name: "Renamed Hall", slugs: p.slugs });
    expect(await getActivityPage(db, { ...q("en"), city: p.city.slugEn, category: "badminton", activity: a.slugEn })).toMatchObject({
      name: "Renamed Court",
      slugs: { en: a.slugEn, ms: a.slugMs },
    });
  });
});

describe("Slugs", () => {
  test("slugify keeps letters and digits only", () => {
    expect(slugify("  Kompleks Sukan Presint 9 (Dewan Serbaguna) ")).toBe("kompleks-sukan-presint-9-dewan-serbaguna");
    expect(slugify("Café & Bistro")).toBe("cafe-bistro");
  });

  test("a Venue slug is unique per City, across EN and BM", async () => {
    const p = await place();
    expect(p.slugs).toEqual({ en: `sports-complex-${p.s}`, ms: `kompleks-sukan-${p.s}` });
    expect(await venueSlugs(db, p.city.id, { nameEn: `Kompleks Sukan ${p.s}`, nameMs: "Lain" })).toEqual({
      en: `kompleks-sukan-${p.s}-2`,
      ms: "lain",
    });
    const [other] = await db.insert(cities).values({ slugEn: `o-${p.s}`, slugMs: `o-${p.s}-ms`, nameEn: "O", nameMs: "O" }).returning();
    expect(await venueSlugs(db, other.id, { nameEn: `Kompleks Sukan ${p.s}`, nameMs: `Kompleks Sukan ${p.s}` })).toEqual({
      en: `kompleks-sukan-${p.s}`,
      ms: `kompleks-sukan-${p.s}`,
    });
    await expect(db.insert(venues).values({ cityId: p.city.id, nameEn: "x", nameMs: "x", slugEn: p.slugs.en })).rejects.toThrow();
  });

  test("an Activity slug is its Venue slug plus its sport, numbered when taken", async () => {
    const p = await place();
    const first = await p.activity("Court 1", "info");
    const second = await p.activity("Court 2", "info");
    expect([first.slugEn, first.slugMs]).toEqual([`${p.slugs.en}-badminton`, `${p.slugs.ms}-badminton`]);
    expect([second.slugEn, second.slugMs]).toEqual([`${p.slugs.en}-badminton-2`, `${p.slugs.ms}-badminton-2`]);
  });
});
