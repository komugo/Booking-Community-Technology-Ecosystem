import { activities, categories, cities, getCategoryHub, getCityHub } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { d1, db, rid, world } from "./helpers";

const CATEGORIES = [
  "badminton",
  "futsal",
  "football",
  "tennis",
  "squash",
  "pickleball",
  "basketball",
  "sepak-takraw",
  "volleyball-netball",
  "gym",
  "swimming",
  "water-sports",
  "cruises-boats",
  "horse-riding",
  "climbing-adventure-parks",
  "ice-skating",
  "parks-cycling",
  "landmarks-tours",
  "farms-nature",
];

async function placeOf(activityId: string) {
  const [{ a, city, category }] = await db
    .select({ a: activities, city: cities.slugEn, category: categories.slugEn })
    .from(activities)
    .innerJoin(cities, eq(cities.id, activities.cityId))
    .innerJoin(categories, eq(categories.id, activities.categoryId))
    .where(eq(activities.id, activityId));
  return { a, city, category };
}

describe("Categories", () => {
  test("all 19 Category hubs render in EN and BM", async () => {
    const w = await world();
    const { city } = await placeOf(w.activityId);
    for (const slug of CATEGORIES) {
      const [c] = await db.select().from(categories).where(eq(categories.slugEn, slug));
      expect(c.nameMs).not.toBe("");
      const en = await getCategoryHub(db, { locale: "en", includeDrafts: false, city, category: c.slugEn });
      const ms = await getCategoryHub(db, { locale: "ms", includeDrafts: false, city, category: c.slugMs });
      expect(en?.category).toMatchObject({ name: c.nameEn, slugs: { en: c.slugEn, ms: c.slugMs } });
      expect(ms?.category).toMatchObject({ name: c.nameMs, slugs: { en: c.slugEn, ms: c.slugMs } });
    }
  });

  test("Bookable Activities rank before Info on City and Category hubs", async () => {
    const w = await world();
    const { a, city, category } = await placeOf(w.activityId);
    const s = rid();
    await db.insert(activities).values({
      ...a,
      id: `act_${s}`,
      slugEn: s,
      slugMs: `${s}-ms`,
      nameEn: "Aardvark Park",
      nameMs: "Taman Aardvark",
      listingMode: "info",
      published: false,
    });
    const q = { locale: "en" as const, includeDrafts: false, city };
    const order = [w.activityId, `act_${s}`];
    expect((await getCityHub(db, q))?.activities.map((c) => c.id)).toEqual(order);
    expect((await getCategoryHub(db, { ...q, category }))?.activities.map((c) => c.id)).toEqual(order);
  });

  test("an Activity has exactly one Category", async () => {
    const w = await world();
    await expect(d1("UPDATE activities SET category_id = NULL WHERE id = ?", w.activityId)).rejects.toThrow(/NOT NULL/);
    await expect(d1("UPDATE activities SET category_id = 'cat_nope' WHERE id = ?", w.activityId)).rejects.toThrow(/FOREIGN KEY/);
  });
});
