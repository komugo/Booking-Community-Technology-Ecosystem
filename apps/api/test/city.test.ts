import { activities, categories, cities, getCityHub, operators, slugify, venues, venueSlugs, type CityFilters, type ListingMode, type Setting } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { db, member, rid, world } from "./helpers";

async function place() {
  const s = rid();
  const [city] = await db.insert(cities).values({ slugEn: `c-${s}`, slugMs: `c-${s}-ms`, nameEn: "City", nameMs: "Bandar" }).returning();
  const [badminton] = await db.select().from(categories).where(eq(categories.slugEn, "badminton"));
  const [operator] = await db.insert(operators).values({ name: "PPJ", signedUp: true, commissionBps: 1000 }).returning();
  const venue = async (nameEn: string, presint: number, pin = true) => {
    const names = { nameEn, nameMs: `${nameEn} BM` };
    const slugs = await venueSlugs(db, city.id, names);
    const [v] = await db
      .insert(venues)
      .values({ cityId: city.id, ...names, slugEn: slugs.en, slugMs: slugs.ms, presint, ...(pin ? { lat: 2.9 + presint / 1000, lng: 101.7 } : {}) })
      .returning();
    return v;
  };
  const activity = async (venueId: string, nameEn: string, listingMode: ListingMode, free: boolean, setting: Setting | null) => {
    const [row] = await db
      .insert(activities)
      .values({
        operatorId: operator.id,
        cityId: city.id,
        categoryId: badminton.id,
        venueId,
        slugEn: `${s}-${slugify(nameEn)}`,
        slugMs: `${s}-${slugify(nameEn)}-ms`,
        nameEn,
        nameMs: `${nameEn} BM`,
        descriptionEn: "x",
        descriptionMs: "x",
        listingMode,
        free,
        setting,
      })
      .returning();
    return row.id;
  };
  return { city, venue, activity };
}

const none: CityFilters = { bookable: false, free: false, setting: null, presint: null };

describe("Putrajaya page filters and map", () => {
  test("each filter narrows the Activities; the map pins every non-Hidden Venue once", async () => {
    const p = await place();
    const hall = await p.venue("Hall", 9);
    const park = await p.venue("Park", 2);
    const unpinned = await p.venue("Unpinned", 9, false);
    const court = await p.activity(hall.id, "Court", "bookable", false, "indoor");
    const squash = await p.activity(hall.id, "Squash", "info", false, "indoor");
    const walk = await p.activity(park.id, "Walk", "info", true, "outdoor");
    await p.activity(unpinned.id, "Hidden", "hidden", true, null);
    const ids = async (filters: Partial<CityFilters>, locale: "en" | "ms" = "en") =>
      (await getCityHub(db, { locale, includeDrafts: false, city: p.city.slugEn, filters: { ...none, ...filters } }))!;

    const all = await ids({});
    expect(all.activities.map((a) => a.id)).toEqual([court, squash, walk]);
    expect(all.presints).toEqual([2, 9]);
    expect(all.venues).toEqual([
      { id: hall.id, slugs: { en: hall.slugEn, ms: hall.slugMs }, name: "Hall", lat: hall.lat, lng: hall.lng },
      { id: park.id, slugs: { en: park.slugEn, ms: park.slugMs }, name: "Park", lat: park.lat, lng: park.lng },
    ]);
    expect((await ids({}, "ms")).venues.map((v) => v.name)).toEqual(["Hall BM", "Park BM"]);

    expect((await ids({ bookable: true })).activities.map((a) => a.id)).toEqual([court]);
    expect((await ids({ free: true })).activities.map((a) => a.id)).toEqual([walk]);
    expect((await ids({ setting: "indoor" })).activities.map((a) => a.id)).toEqual([court, squash]);
    expect((await ids({ setting: "outdoor" })).activities.map((a) => a.id)).toEqual([walk]);
    const p2 = await ids({ presint: 2 });
    expect(p2.activities.map((a) => a.id)).toEqual([walk]);
    expect(p2.venues.map((v) => v.id)).toEqual([park.id]);
    expect(p2.presints).toEqual([2, 9]);
    expect((await ids({ bookable: true, free: true })).activities).toEqual([]);
  });

  test("staff set Free and Indoor/Outdoor on an Activity's copy", async () => {
    const w = await world();
    const staff = await member("staff");
    const url = `/ops/operators/${w.operatorId}/activities/${w.activityId}/copy`;
    const copy = { descriptionEn: "x", descriptionMs: "x", venueId: null, free: true, setting: "outdoor", photos: [] };
    expect((await staff.json("PUT", url, { ...copy, setting: "rooftop" })).body).toMatchObject({ code: "invalid_field", field: "setting" });
    expect((await staff.json("PUT", url, { ...copy, free: "yes" })).body).toMatchObject({ code: "invalid_field", field: "free" });
    expect((await staff.json("PUT", url, copy)).status).toBe(204);
    const { body: setup } = await staff.json<{ catalogue: unknown[] }>("GET", `/ops/operators/${w.operatorId}/setup`);
    expect(setup.catalogue).toEqual([expect.objectContaining({ id: w.activityId, free: true, setting: "outdoor" })]);
  });
});
