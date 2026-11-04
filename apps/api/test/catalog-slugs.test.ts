import { activities, categories, cities, getActivityPage, getCategoryHub, getCityHub, getVenuePage, operators, venues } from "@komugo/db";
import { describe, expect, test } from "vitest";
import { db, rid } from "./helpers";

// One slug used as A's EN slug and B's BM slug, at every level.
async function clash() {
  const s = rid();
  const x = `x-${s}`;
  const hubs = (t: typeof cities | typeof categories, k: string) =>
    db
      .insert(t)
      .values([
        { slugEn: x, slugMs: `${k}-a-ms-${s}`, nameEn: `${k} A`, nameMs: `${k} A BM` },
        { slugEn: `${k}-b-${s}`, slugMs: x, nameEn: `${k} B`, nameMs: `${k} B BM` },
      ])
      .returning();
  const [cityA, cityB] = await hubs(cities, "city");
  const [catA, catB] = await hubs(categories, "cat");
  const [operator] = await db.insert(operators).values({ name: "Op", signedUp: true, commissionBps: 1000 }).returning();
  const [venueA, venueB] = await db
    .insert(venues)
    .values([
      { cityId: cityA.id, nameEn: "Venue A", nameMs: "Venue A BM", slugEn: x, slugMs: `venue-a-ms-${s}` },
      { cityId: cityA.id, nameEn: "Venue B", nameMs: "Venue B BM", slugEn: `venue-b-${s}`, slugMs: x },
    ])
    .returning();
  const activity = (cityId: string, categoryId: string, venueId: string, slugEn: string, slugMs: string) => ({
    operatorId: operator.id,
    cityId,
    categoryId,
    venueId,
    slugEn,
    slugMs,
    nameEn: slugEn,
    nameMs: slugMs,
    descriptionEn: "x",
    descriptionMs: "x",
    listingMode: "info" as const,
  });
  const [actA, actB] = await db
    .insert(activities)
    .values([
      activity(cityA.id, catA.id, venueA.id, x, `act-a-ms-${s}`),
      activity(cityB.id, catB.id, venueB.id, `act-b-${s}`, x),
      activity(cityA.id, catB.id, venueB.id, `act-c-${s}`, `act-c-ms-${s}`),
    ])
    .returning();
  return { x, cityA, cityB, catA, catB, venueA, venueB, actA, actB };
}

const q = (locale: "en" | "ms") => ({ locale, includeDrafts: false });

describe("catalogue slug resolution", () => {
  test("a slug in the page's own locale wins over the same slug in the other locale", async () => {
    const c = await clash();
    expect((await getCityHub(db, { ...q("en"), city: c.x }))?.city.id).toBe(c.cityA.id);
    expect((await getCityHub(db, { ...q("ms"), city: c.x }))?.city.id).toBe(c.cityB.id);
    expect((await getCategoryHub(db, { ...q("en"), city: c.x, category: c.x }))?.category.id).toBe(c.catA.id);
    expect((await getCategoryHub(db, { ...q("ms"), city: c.x, category: c.x }))?.category.id).toBe(c.catB.id);
    expect((await getActivityPage(db, { ...q("en"), city: c.x, category: c.x, activity: c.x }))?.id).toBe(c.actA.id);
    expect((await getActivityPage(db, { ...q("ms"), city: c.x, category: c.x, activity: c.x }))?.id).toBe(c.actB.id);
    expect((await getVenuePage(db, { ...q("en"), city: c.cityA.slugMs, venue: c.x }))?.id).toBe(c.venueA.id);
    expect((await getVenuePage(db, { ...q("ms"), city: c.cityA.slugMs, venue: c.x }))?.id).toBe(c.venueB.id);
  });

  test("a slug from the other locale finds the page and returns its canonical slugs, so the web 301s", async () => {
    const c = await clash();
    const city = await getCityHub(db, { ...q("en"), city: c.cityA.slugMs });
    expect(city?.city).toMatchObject({ id: c.cityA.id, slugs: { en: c.x, ms: c.cityA.slugMs }, photo: null });
    const cat = await getCategoryHub(db, { ...q("ms"), city: c.cityB.slugEn, category: c.catB.slugEn });
    expect(cat).toMatchObject({ city: { id: c.cityB.id, slugs: { ms: c.x } }, category: { id: c.catB.id, slugs: { ms: c.x } } });
    const act = await getActivityPage(db, { ...q("en"), city: c.cityA.slugMs, category: c.catA.slugMs, activity: c.actA.slugMs });
    expect(act).toMatchObject({ id: c.actA.id, slugs: { en: c.x, ms: c.actA.slugMs } });
    expect(await getActivityPage(db, { ...q("en"), city: c.cityB.slugEn, category: c.catA.slugEn, activity: c.actB.slugEn })).toBeNull();
  });

  test("other Categories on a Category hub are those with listed Activities in the City", async () => {
    const c = await clash();
    const hub = await getCategoryHub(db, { ...q("en"), city: c.cityA.slugEn, category: c.catA.slugEn });
    expect(hub?.activities.map((a) => a.id)).toEqual([c.actA.id]);
    expect(hub?.otherCategories.map((x) => x.id)).toEqual([c.catB.id]);
    expect((await getCityHub(db, { ...q("en"), city: c.cityA.slugEn }))?.categories.map((x) => x.id)).toEqual([c.catA.id, c.catB.id]);
    expect((await getCityHub(db, { ...q("en"), city: c.cityB.slugEn }))?.categories.map((x) => x.id)).toEqual([c.catB.id]);
  });
});
