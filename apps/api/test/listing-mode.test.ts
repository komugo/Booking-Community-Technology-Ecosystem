import { env } from "cloudflare:test";
import { activities, getActivityPage, getCityHub, listSitemapEntries, operators, photos, venues } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { booked, boughtPack, client, customer, d1, db, held, member, packOffer, pay, rid, signedIn, world } from "./helpers";

const mode = async (w: { operatorId: string; activityId: string }, listingMode: string) =>
  (await member("staff")).json("PUT", `/ops/operators/${w.operatorId}/activities/${w.activityId}/listing-mode`, { listingMode });

async function slugsOf(activityId: string) {
  const [row] = await d1<{ city: string; category: string; activity: string }>(
    "SELECT c.slug_en AS city, g.slug_en AS category, a.slug_en AS activity FROM activities a JOIN cities c ON c.id = a.city_id JOIN categories g ON g.id = a.category_id WHERE a.id = ?",
    activityId,
  );
  return row;
}

describe("Listing mode", () => {
  test("only an Activity of a signed-up Operator can be Bookable", async () => {
    const w = await world({ listingMode: "hidden", signedUp: false });
    expect(await mode(w, "bookable")).toEqual({ status: 409, body: { code: "not_signed_up", field: "listingMode" } });
    expect(await mode(w, "info")).toEqual({ status: 200, body: { listingMode: "info" } });
    await db.update(operators).set({ signedUp: true }).where(eq(operators.id, w.operatorId));
    expect(await mode(w, "bookable")).toEqual({ status: 200, body: { listingMode: "bookable" } });
  });

  test("an Activity with future Tickets cannot leave Bookable", async () => {
    const w = await world();
    await booked(w);
    expect(await mode(w, "info")).toEqual({ status: 409, body: { code: "has_future_tickets", field: "listingMode" } });
    expect(await mode(w, "hidden")).toMatchObject({ status: 409 });
    expect(await mode(w, "bookable")).toEqual({ status: 200, body: { listingMode: "bookable" } });

    const free = await world();
    expect(await mode(free, "info")).toEqual({ status: 200, body: { listingMode: "info" } });
    expect(await d1("SELECT listing_mode, published FROM activities WHERE id = ?", free.activityId)).toEqual([{ listing_mode: "info", published: 0 }]);
  });

  test("an unpaid Hold keeps an Activity Bookable; a Hold made after the switch cannot be paid", async () => {
    const w = await world();
    await held(w);
    expect(await mode(w, "hidden")).toEqual({ status: 409, body: { code: "has_future_tickets", field: "listingMode" } });
    expect(await d1("SELECT listing_mode, published FROM activities WHERE id = ?", w.activityId)).toEqual([{ listing_mode: "bookable", published: 1 }]);

    const late = await world();
    const { cl, id } = await held(late);
    await db.update(activities).set({ listingMode: "info" }).where(eq(activities.id, late.activityId));
    expect(await cl.json("POST", `/checkouts/${id}/pay`)).toEqual({ status: 409, body: { code: "not_bookable" } });
  });

  test("an unused Pack or a bill still open keeps an Activity Bookable", async () => {
    const w = await world();
    await boughtPack(w, (await customer()).id, (await packOffer(w)).id);
    expect(await mode(w, "info")).toEqual({ status: 409, body: { code: "has_future_tickets", field: "listingMode" } });

    const p = await world();
    const offer = await packOffer(p);
    const cl = await signedIn(`${rid()}@example.com`);
    expect((await cl.json("POST", "/pack-orders", { offerId: offer.id, locale: "en" })).status).toBe(200);
    expect(await mode(p, "info")).toMatchObject({ status: 409 });
    await d1("UPDATE bills SET deleted_at = 1 WHERE checkout_id IN (SELECT id FROM pack_orders WHERE offer_id = ?)", offer.id);
    expect(await mode(p, "info")).toEqual({ status: 200, body: { listingMode: "info" } });
  });

  test("a Bookable Activity sells nothing while its Operator has no Commission", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const offer = await packOffer(w);
    await db.update(operators).set({ commissionBps: null }).where(eq(operators.id, w.operatorId));
    expect(await cl.json("POST", `/checkouts/${id}/pay`)).toEqual({ status: 409, body: { code: "not_bookable" } });
    expect(await cl.json("POST", "/pack-orders", { offerId: offer.id, locale: "en" })).toEqual({ status: 409, body: { code: "not_bookable" } });
    const body = { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 1, addOns: [], locale: "en" };
    expect(await client().json("POST", "/checkouts", body)).toEqual({ status: 409, body: { code: "not_bookable" } });
    await (await member("staff")).json("PUT", `/ops/operators/${w.operatorId}/commission`, { commissionBps: 1000 });
    expect((await pay(cl, id)).billId).toBeTruthy();
  });

  test("rejects an unknown mode", async () => {
    const w = await world();
    expect(await mode(w, "draft")).toEqual({ status: 400, body: { code: "invalid_field", field: "listingMode" } });
  });

  test("checkout refuses an Info Activity", async () => {
    const w = await world({ listingMode: "info" });
    const body = { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 1, addOns: [], locale: "en" };
    expect(await client().json("POST", "/checkouts", body)).toEqual({ status: 409, body: { code: "not_bookable" } });
  });

  test("backfill makes published Activities Bookable, others Hidden, and signs up only their Operators", async () => {
    const live = await world({ listingMode: "hidden", signedUp: false });
    const draft = await world({ listingMode: "hidden", signedUp: false });
    await db.update(activities).set({ published: true }).where(eq(activities.id, live.activityId));
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0007_"))!;
    for (const q of migration.queries.filter((q) => q.includes("UPDATE `"))) await env.DB.prepare(q).run();
    const rows = await d1("SELECT id, listing_mode FROM activities WHERE id IN (?, ?) ORDER BY id = ?", live.activityId, draft.activityId, draft.activityId);
    expect(rows).toEqual([
      { id: live.activityId, listing_mode: "bookable" },
      { id: draft.activityId, listing_mode: "hidden" },
    ]);
    expect(await d1("SELECT signed_up FROM operators WHERE id = ?", live.operatorId)).toEqual([{ signed_up: 1 }]);
    expect(await d1("SELECT signed_up FROM operators WHERE id = ?", draft.operatorId)).toEqual([{ signed_up: 0 }]);
  });
});

describe("Venue and Info page", () => {
  test("one Venue hosts Activities of two Operators; Info falls back to the Venue's hours and photos", async () => {
    const ppj = await world({ listingMode: "info" });
    const club = await world();
    const [city] = await d1<{ city_id: string }>("SELECT city_id FROM activities WHERE id = ?", ppj.activityId);
    const venueHours = [{ days: ["Mo" as const], opens: "08:00", closes: "22:00" }];
    const [venue] = await db
      .insert(venues)
      .values({ cityId: city.city_id, nameEn: "Kompleks Sukan Presint 9", nameMs: "Kompleks Sukan Presint 9", presint: 9, lat: 2.9, lng: 101.7, phone: "03-8888 0000", openingHours: venueHours })
      .returning();
    await db.update(activities).set({ venueId: venue.id }).where(eq(activities.id, ppj.activityId));
    await db.update(activities).set({ venueId: venue.id, openingHours: [{ days: ["Tu"], opens: "09:00", closes: "17:00" }] }).where(eq(activities.id, club.activityId));
    await db.update(activities).set({ howToBook: "external", bookUrl: "https://ppj.example/book", priceNoteEn: "RM10 per hour" }).where(eq(activities.id, ppj.activityId));
    await db.insert(photos).values({ id: rid(), venueId: venue.id, url: "https://x/y.jpg", width: 1, height: 1, altEn: "a", altMs: "a", creditName: "c", creditUrl: "u", sourceUrl: "s" });

    const q = { locale: "en" as const, includeDrafts: false };
    const info = (await getActivityPage(db, { ...q, ...(await slugsOf(ppj.activityId)) }))!;
    expect(info).toMatchObject({
      listingMode: "info",
      howToBook: "external",
      bookUrl: "https://ppj.example/book",
      priceNote: "RM10 per hour",
      venue: { name: "Kompleks Sukan Presint 9", presint: 9 },
      lat: 2.9,
      phone: "03-8888 0000",
      openingHours: venueHours,
    });
    expect(info.photos).toHaveLength(1);
    const bookable = (await getActivityPage(db, { ...q, ...(await slugsOf(club.activityId)) }))!;
    expect(bookable).toMatchObject({ listingMode: "bookable", venue: { name: "Kompleks Sukan Presint 9" }, openingHours: [{ days: ["Tu"] }] });
    expect(await d1("SELECT DISTINCT operator_id FROM activities WHERE venue_id = ?", venue.id)).toHaveLength(2);
  });

  test("Hidden Activities stay out of the catalogue, Info ones are listed", async () => {
    const info = await world({ listingMode: "info" });
    const hidden = await world({ listingMode: "hidden" });
    const q = { locale: "en" as const, includeDrafts: false };
    expect(await getActivityPage(db, { ...q, ...(await slugsOf(hidden.activityId)) })).toBeNull();
    const s = await slugsOf(info.activityId);
    expect(await getCityHub(db, { ...q, city: s.city })).toMatchObject({ indexable: true, activities: [{ id: info.activityId, listingMode: "info" }] });
    const urls = (await listSitemapEntries(db)).flatMap((e) => (e.activity ? [e.activity.en] : []));
    expect(urls).toContain(s.activity);
    expect(urls).not.toContain((await slugsOf(hidden.activityId)).activity);
  });
});
