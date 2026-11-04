import { env } from "cloudflare:test";
import { activities, operators, photos, venues } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import csv from "../../../data/putrajaya-master-list.csv?raw";
import ppj from "../../../data/ppj-sport.json";
import reviewed from "../../../data/putrajaya.json";
import launchFile from "../../../data/putrajaya-launch.json";
import { build, parseHours } from "../scripts/putrajaya-build";
import { launch, type Launch } from "../scripts/putrajaya-launch";
import { diff, EXISTING_SQL, existingFrom, insertSql, plan, type Catalogue } from "../scripts/putrajaya-load";
import { fill, parseSport, report, type Facility } from "../scripts/putrajaya-ppj";
import sport from "./fixtures/ppj-sport.html?raw";
import { db, dispatch } from "./helpers";

const data = launch(fill(build(csv), ppj as Facility[]), launchFile as Launch);
const at = (row: number) => data.activities.filter((a) => a.rows.includes(row));
const venueOf = (row: number) => data.venues.filter((v) => v.rows.includes(row));

describe("build", () => {
  test("the reviewed data file is what the importer builds from the master list, saved PPJ facts and the launch batch", () => {
    expect(reviewed).toEqual(data);
  });

  test("merges duplicate Venues and Activities", () => {
    expect(venueOf(49)).toEqual(venueOf(50));
    expect(venueOf(49)[0]).toMatchObject({ nameMs: "Taman Pancarona", rows: [49, 50, 51, 52, 53, 54, 75] });
    expect(venueOf(7)[0]).toMatchObject({ nameEn: "Putrajaya Lake Club", nameMs: "Kelab Tasik Putrajaya", rows: [7, 86] });
    expect(at(21)).toHaveLength(1);
    expect(at(21)[0].rows).toEqual([21, 87]);
    expect(at(74)[0]).toMatchObject({ rows: [74, 114], nameEn: "China–Malaysia Friendship Garden" });
    expect(venueOf(114)[0].presint).toBe(4);
  });

  test("one Operator per real entity; unknown ones flagged", () => {
    const marina = data.operators.filter((o) => o.name.startsWith("Marina Putrajaya"));
    expect(marina).toEqual([expect.objectContaining({ id: "op_marina_putrajaya", rows: [1, 2, 3, 4, 5, 6] })]);
    expect(at(14)[0]).toMatchObject({ operatorId: "op_flyboard_malaysia", venueId: venueOf(6)[0].id });
    const equestrian = data.operators.find((o) => o.id === at(21)[0].operatorId);
    expect(equestrian).toMatchObject({ unknown: true });
    expect(at(21)[0].howToBook).toBe("unknown");
  });

  test("only the launch batch lands Info; the rest Hidden, all with a Category, slugs unique across EN and BM", () => {
    const info = data.activities.filter((a) => a.listingMode === "info").map((a) => a.id);
    expect(info.sort()).toEqual(Object.keys(launchFile.activities).sort());
    expect(data.activities.every((a) => ["hidden", "info"].includes(a.listingMode) && a.categoryId.startsWith("cat_"))).toBe(true);
    const slugs = data.activities.flatMap((a) => (a.slugEn === a.slugMs ? [a.slugEn] : [a.slugEn, a.slugMs]));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(at(25)[0]).toMatchObject({ slugEn: "kompleks-kejiranan-presint-8-badminton", slugMs: "kompleks-kejiranan-presint-8-badminton" });
  });

  test("maps Booking Method, price and hours; Verify and — become empty", () => {
    expect(at(65)[0]).toMatchObject({ howToBook: "walk_in", priceNoteEn: "Free", priceNoteMs: "Percuma" });
    expect(at(46)[0]).toMatchObject({ howToBook: "external", priceNoteEn: "RM20–RM70 per hour", priceNoteMs: "RM20–RM70 sejam" });
    expect(at(1)[0]).toMatchObject({ priceNoteEn: null, openingHours: [] });
    expect(venueOf(21)[0].phone).toBeNull();
    expect(parseHours("12pm–8pm weekdays; 10am–8pm weekends")).toEqual([
      { days: ["Mo", "Tu", "We", "Th", "Fr"], opens: "12:00", closes: "20:00" },
      { days: ["Sa", "Su"], opens: "10:00", closes: "20:00" },
    ]);
    expect(parseHours("8am–12am")?.[0]).toMatchObject({ opens: "08:00", closes: "00:00" });
    expect(parseHours("Session-based")).toBeNull();
  });

  test("excludes N/A, restricted and retail rows with a reason", () => {
    expect(data.excluded.map((e) => e.row)).toEqual([92, 93, 96, 97, 110, 111, 112, 115, 116, 117]);
    expect(data.excluded.every((e) => e.reason)).toBe(true);
  });
});

describe("PPJ scrape", () => {
  const facilities = parseSport(sport);
  const activity = (c: Catalogue, id: string) => c.activities.find((a) => a.id === id);

  test("parses names, rates and courts from the public sport page only", () => {
    expect(facilities).toEqual([
      { id: 2, name: "Badminton", location: "Presint 8", rate: { rm: 8, per: "hour" }, courts: 4 },
      { id: 3, name: "Ping Pong", location: "Presint 8", rate: { rm: 4, per: "hour" }, courts: 3 },
      { id: 58, name: "Padang Bola Sepak (Pancarona)", location: "Taman Pancarona", rate: { rm: 140, per: "session" }, courts: null },
      { id: 62, name: "Padang Bola Jaring (Pancarona)", location: "Taman Pancarona", rate: { rm: 0, per: "hour" }, courts: 2 },
      { id: 102, name: "Padang Bola Sepak", location: "Padang Bola Sepak Presint 5", rate: null, courts: null },
    ]);
  });

  test("refuses a page whose cards and facility list disagree", () => {
    expect(() => parseSport(sport.replace(">Ping Pong<", ">Tenis<"))).toThrow("PPJ page changed");
    expect(() => parseSport("<html></html>")).toThrow("facility list not found");
  });

  test("fills only empty fields and leaves master-list values alone", () => {
    const base = build(csv);
    const filled = fill(base, facilities);
    expect(activity(filled, "act_kompleks_kejiranan_presint_8_badminton")).toMatchObject({ priceNoteEn: "RM8 per hour", priceNoteMs: "RM8 sejam" });
    expect(activity(filled, "act_taman_pancarona_football")).toEqual(activity(base, "act_taman_pancarona_football"));
    expect(activity(filled, "act_taman_pancarona_netball")).toEqual(activity(base, "act_taman_pancarona_netball"));
    const touched = filled.activities.filter((a, i) => a !== base.activities[i]).map((a) => a.id);
    expect(touched).toEqual(["act_kompleks_kejiranan_presint_8_badminton"]);
    expect({ ...filled, activities: [] }).toEqual({ ...base, activities: [] });
  });

  test("an RM0 rate is never filled as free", () => {
    const base = build(csv);
    const unpriced = { ...base, activities: base.activities.map((a) => (a.id === "act_taman_pancarona_netball" ? { ...a, priceNoteEn: null, priceNoteMs: null } : a)) };
    expect(activity(fill(unpriced, facilities), "act_taman_pancarona_netball")).toMatchObject({ priceNoteEn: null, priceNoteMs: null });
  });

  test("a re-run is idempotent and the report says what changed", () => {
    const base = build(csv);
    const filled = fill(base, facilities);
    expect(fill(filled, facilities)).toEqual(filled);
    const first = report(facilities, base, filled);
    expect(first).toContain("PPJ facilities: 5, 3 matched");
    expect(first).toContain("Changed: 1");
    expect(first).toContain("~ activity act_kompleks_kejiranan_presint_8_badminton  price=RM8 per hour / RM8 sejam  (was -)");
    expect(first).toContain("? ppj 3  Ping Pong, Presint 8  rate=RM4/hour  courts=3  (no Activity)");
    expect(first).toContain("? ppj 62  Padang Bola Jaring (Pancarona), Taman Pancarona  rate=RM0/hour  (not filled: confirm the price with PPJ)");
    expect(first.some((l) => l.startsWith("!"))).toBe(false);
    expect(report(facilities, { ...base, activities: [] }, filled)).toContain("Changed: 0");
    expect(report(facilities, filled, fill(filled, facilities))).toContain("Changed: 0");
  });
});

async function existing() {
  return existingFrom(await Promise.all(EXISTING_SQL.map(async (q) => (await env.DB.prepare(q).all()).results)));
}

async function load(catalogue: Catalogue) {
  const p = plan(catalogue, await existing());
  const sql = insertSql(p);
  if (sql.length) await env.DB.batch(sql.map((s) => env.DB.prepare(s)));
  return p;
}

describe("import", () => {
  test("dry run lists the new rows", async () => {
    const lines = diff(plan(data, await existing()));
    expect(lines).toContain(`Activities: ${data.activities.length} new, 0 kept`);
    expect(lines).toContain(`+ venue ven_taman_pancarona  Taman Pancarona / Taman Pancarona  presint=18  pin=-,-  hours=MoTuWeThFrSaSu 08:00-00:00`);
    expect(await db.select().from(activities)).toEqual([]);
  });

  test("loads the launch batch as Info with pin, copy and photo, the rest Hidden; a re-run inserts new rows only and keeps staff edits", async () => {
    const first = await load(data);
    expect(first.activities).toHaveLength(data.activities.length);
    const rows = await db.select().from(activities);
    expect(rows).toHaveLength(data.activities.length);
    expect(rows.every((a) => !a.published)).toBe(true);
    const info = rows.filter((a) => a.listingMode === "info");
    expect(info).toHaveLength(Object.keys(launchFile.activities).length);
    expect(rows.filter((a) => a.listingMode !== "info").every((a) => a.listingMode === "hidden")).toBe(true);
    const cruise = "act_cruise_tasik_putrajaya_sightseeing_cruise";
    expect(info.find((a) => a.id === cruise)?.descriptionMs).toBeTruthy();
    const [pin] = await db.select().from(venues).where(eq(venues.id, "ven_cruise_tasik_putrajaya"));
    expect(pin).toMatchObject({ lat: 2.9339371, lng: 101.6903597, postalCode: "62000" });
    const shots = await db.select().from(photos);
    expect(shots.map((p) => p.activityId).sort()).toEqual(info.map((a) => a.id).sort());
    expect(shots.every((p) => p.url.startsWith("https://images.unsplash.com/photo-"))).toBe(true);
    const unknown = (await db.select().from(operators).where(eq(operators.unknown, true))).map((o) => o.id).sort();
    expect(unknown).toEqual(data.operators.filter((o) => o.unknown).map((o) => o.id).sort());

    const pancarona = "ven_taman_pancarona";
    await db.update(venues).set({ phone: "03-1111 2222", lat: 2.9, lng: 101.7 }).where(eq(venues.id, pancarona));
    const edited = data.activities[0].id;
    await db.update(activities).set({ nameEn: "Edited by staff", descriptionEn: "Staff copy" }).where(eq(activities.id, edited));

    const added = { ...data.activities[1], id: "act_new", slugEn: "new-en", slugMs: "new-ms" };
    const clash = { ...data.activities[1], id: "act_clash", slugEn: "fresh", slugMs: data.activities[2].slugMs };
    const again = await load({ ...data, activities: [...data.activities, added, clash] });
    expect(again).toMatchObject({ city: null, operators: [], venues: [], activities: [added] });
    expect(again.kept).toEqual({ operators: data.operators.length, venues: data.venues.length, activities: data.activities.length });
    expect(again.skipped).toEqual([{ id: "act_clash", reason: expect.stringContaining("already taken") }]);

    const [v] = await db.select().from(venues).where(eq(venues.id, pancarona));
    expect(v).toMatchObject({ phone: "03-1111 2222", lat: 2.9 });
    const [a] = await db.select().from(activities).where(eq(activities.id, edited));
    expect(a).toMatchObject({ nameEn: "Edited by staff", descriptionEn: "Staff copy" });
    expect(await db.select().from(activities)).toHaveLength(data.activities.length + 1);
  });

  test("refuses an Info Activity that can't leave Hidden, and any Bookable one", () => {
    const none = { cities: [], operators: [], venues: [], activities: [] };
    const hidden = data.activities.find((a) => a.listingMode === "hidden" && !data.operators.find((o) => o.id === a.operatorId)?.unknown)!;
    const unknown = data.activities.find((a) => data.operators.find((o) => o.id === a.operatorId)?.unknown)!;
    const ready = data.activities.find((a) => a.listingMode === "info")!;
    const as = (a: Catalogue["activities"][number]) => ({ ...data, activities: [a] });
    expect(() => plan(as({ ...hidden, listingMode: "info" }), none)).toThrow("missing mapPin, descriptionEn, descriptionMs, photo");
    expect(() => plan(as({ ...unknown, ...ready, id: unknown.id, operatorId: unknown.operatorId }), none)).toThrow("unknown Operator");
    expect(() => plan(as({ ...ready, listingMode: "bookable" }), none)).toThrow("Hidden or Info");
    expect(plan(as(ready), none).activities).toHaveLength(1);
  });
});

test("dev seed refuses outside local", async () => {
  const res = await dispatch(new Request("https://api.test/dev/seed", { method: "POST" }));
  expect(res.status).toBe(404);
});
