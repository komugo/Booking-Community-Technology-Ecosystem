import { photos } from "@komugo/db";
import { describe, expect, test } from "vitest";
import { d1, db, member, publishable, unsplash, world } from "./helpers";

const venue = (cityId: string) => ({
  cityId,
  nameEn: " Putrajaya Sports Complex ",
  nameMs: "Kompleks Sukan Putrajaya",
  streetAddress: "Jalan P9",
  postalCode: "62250",
  presint: 9,
  phone: null,
  lat: 2.9264,
  lng: 101.6964,
  openingHours: [{ days: ["Mo", "Tu"], opens: "08:00", closes: "22:00" }],
  photos: [unsplash(1), unsplash(2)],
});

const cityOf = async (activityId: string) => (await d1<{ city_id: string }>("SELECT city_id FROM activities WHERE id = ?", activityId))[0].city_id;

describe("Venues", () => {
  test("staff create and edit a Venue with a map pin, hours and photos", async () => {
    const w = await world();
    const staff = await member("staff");
    const body = venue(await cityOf(w.activityId));
    const created = await staff.json<{ id: string }>("POST", "/ops/venues", body);
    expect(created.status).toBe(201);
    expect((await staff.json("PUT", `/ops/venues/${created.body.id}`, { ...body, lat: 2.95, lng: 101.7, photos: [unsplash(3)] })).status).toBe(200);

    const { body: list } = await staff.json("GET", "/ops/venues");
    expect(list.venues.find((v: { id: string }) => v.id === created.body.id)).toEqual({
      ...body,
      id: created.body.id,
      nameEn: "Putrajaya Sports Complex",
      lat: 2.95,
      lng: 101.7,
      photos: [unsplash(3)],
    });
    expect(list.cities).toContainEqual(expect.objectContaining({ id: body.cityId }));
    expect((await staff.json("PUT", "/ops/venues/missing", body)).status).toBe(404);
  });

  test("rejects a half pin, bad hours and photos that aren't Unsplash", async () => {
    const w = await world();
    const staff = await member("staff");
    const body = venue(await cityOf(w.activityId));
    const post = (patch: object) => staff.json("POST", "/ops/venues", { ...body, ...patch });
    expect((await post({ lng: null })).body).toEqual({ code: "invalid_field", field: "lat" });
    expect((await post({ lat: 91 })).body).toEqual({ code: "invalid_field", field: "lat" });
    expect((await post({ openingHours: [{ days: [], opens: "08:00", closes: "22:00" }] })).body).toEqual({ code: "invalid_field", field: "openingHours" });
    expect((await post({ openingHours: [{ days: ["Mo"], opens: "8am", closes: "22:00" }] })).body).toEqual({ code: "invalid_field", field: "openingHours" });
    expect((await post({ photos: [{ ...unsplash(), url: "https://example.com/a.jpg" }] })).body).toEqual({ code: "invalid_field", field: "photos" });
    expect((await post({ presint: 21 })).body).toEqual({ code: "invalid_field", field: "presint" });
    expect((await post({ cityId: "nowhere" })).body).toEqual({ code: "invalid_field", field: "cityId" });
    expect((await post({ lat: null, lng: null })).status).toBe(201);
  });

  test("Operator Members cannot list, create or edit Venues, nor move their Activity to another Venue", async () => {
    const w = await world({ listingMode: "hidden" });
    const own = await member("operator", w.operatorId);
    const staff = await member("staff");
    const body = venue(await cityOf(w.activityId));
    const { id } = (await staff.json<{ id: string }>("POST", "/ops/venues", body)).body;
    expect((await own.json("GET", "/ops/venues")).status).toBe(403);
    expect((await own.json("POST", "/ops/venues", body)).status).toBe(403);
    expect((await own.json("PUT", `/ops/venues/${id}`, body)).status).toBe(403);

    const url = `/ops/operators/${w.operatorId}/activities/${w.activityId}/copy`;
    const copy = { descriptionEn: "Ride the trails", descriptionMs: "Tunggang denai", venueId: id, photos: [unsplash()] };
    expect((await own.json("PUT", url, copy)).body).toEqual({ code: "forbidden", field: "venueId" });
    expect((await staff.json("PUT", url, copy)).status).toBe(204);
    expect((await own.json("PUT", url, { ...copy, descriptionEn: "Ride the jungle trails" })).status).toBe(204);
    const { body: setup } = await own.json("GET", `/ops/operators/${w.operatorId}/setup`);
    expect(setup.catalogue).toEqual([
      expect.objectContaining({ id: w.activityId, descriptionEn: "Ride the jungle trails", descriptionMs: "Tunggang denai", venueId: id, photos: [unsplash()] }),
    ]);
  });

  test("a Venue can't move to another City while it hosts an Activity there", async () => {
    const w = await world();
    const other = await world();
    const venueId = await publishable(w);
    const staff = await member("staff");
    const body = venue(await cityOf(other.activityId));
    expect((await staff.json("PUT", `/ops/venues/${venueId}`, body)).body).toEqual({ code: "invalid_field", field: "cityId" });
    await d1("UPDATE activities SET venue_id = NULL WHERE id = ?", w.activityId);
    expect((await staff.json("PUT", `/ops/venues/${venueId}`, body)).status).toBe(200);
  });
});

describe("Publish bar", () => {
  const mode = async (w: { operatorId: string; activityId: string }, listingMode: string) =>
    (await member("staff")).json("PUT", `/ops/operators/${w.operatorId}/activities/${w.activityId}/listing-mode`, { listingMode });

  test("an Activity leaves Hidden only with a pinned Venue, EN/BM description and a photo", async () => {
    const w = await world({ listingMode: "hidden" });
    await d1("UPDATE activities SET description_ms = ' ' WHERE id = ?", w.activityId);
    expect(await mode(w, "info")).toEqual({
      status: 409,
      body: { code: "publish_bar", field: "listingMode", params: { missing: "venue,descriptionMs,photo" } },
    });
    const venueId = await publishable(w);
    await d1("UPDATE venues SET lat = NULL, lng = NULL WHERE id = ?", venueId);
    expect((await mode(w, "bookable")).body).toEqual({ code: "publish_bar", field: "listingMode", params: { missing: "mapPin,descriptionMs" } });
    await d1("UPDATE venues SET lat = 2.9, lng = 101.7 WHERE id = ?", venueId);
    await d1("UPDATE activities SET description_ms = 'Tunggang' WHERE id = ?", w.activityId);
    expect(await mode(w, "bookable")).toEqual({ status: 200, body: { listingMode: "bookable" } });
    expect(await mode(w, "hidden")).toEqual({ status: 200, body: { listingMode: "hidden" } });
  });

  test("a listed Activity can't lose its photo or its Venue's pin", async () => {
    const w = await world({ listingMode: "info" });
    const venueId = await publishable(w);
    const staff = await member("staff");
    const url = `/ops/operators/${w.operatorId}/activities/${w.activityId}/copy`;
    expect((await staff.json("PUT", url, { descriptionEn: "x", descriptionMs: "x", venueId, photos: [] })).body).toEqual({
      code: "publish_bar",
      params: { missing: "photo" },
    });
    const body = { ...venue(await cityOf(w.activityId)), lat: null, lng: null };
    expect((await staff.json("PUT", `/ops/venues/${venueId}`, body)).body).toEqual({ code: "publish_bar", field: "lat", params: { missing: "mapPin" } });
    expect(await d1("SELECT count(*) AS n FROM photos WHERE activity_id = ?", w.activityId)).toEqual([{ n: 1 }]);
  });

  test("an Operator still edits copy of a listed Activity that had gaps before the publish bar", async () => {
    const w = await world({ listingMode: "bookable" });
    await db.insert(photos).values({ ...unsplash(), activityId: w.activityId });
    const own = await member("operator", w.operatorId);
    const url = `/ops/operators/${w.operatorId}/activities/${w.activityId}/copy`;
    const copy = { descriptionEn: "Ride the trails", descriptionMs: "Tunggang denai", venueId: null, photos: [unsplash()] };
    expect((await own.json("PUT", url, copy)).status).toBe(204);
    expect((await own.json("PUT", url, { ...copy, photos: [] })).body).toEqual({ code: "publish_bar", params: { missing: "photo" } });
  });
});
