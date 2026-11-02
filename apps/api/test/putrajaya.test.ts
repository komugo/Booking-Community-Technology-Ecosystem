import { env } from "cloudflare:test";
import { activities, operators, venues } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import csv from "../../../data/putrajaya-master-list.csv?raw";
import reviewed from "../../../data/putrajaya.json";
import { build, parseHours } from "../scripts/putrajaya-build";
import { diff, EXISTING_SQL, existingFrom, insertSql, plan, type Catalogue } from "../scripts/putrajaya-load";
import { db, dispatch } from "./helpers";

const data = build(csv);
const at = (row: number) => data.activities.filter((a) => a.rows.includes(row));
const venueOf = (row: number) => data.venues.filter((v) => v.rows.includes(row));

describe("build", () => {
  test("the reviewed data file is what the importer builds from the master list", () => {
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

  test("every Activity lands Hidden with a Category, slugs unique across EN and BM", () => {
    expect(data.activities.every((a) => a.listingMode === "hidden" && a.categoryId.startsWith("cat_"))).toBe(true);
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
    expect(lines).toContain(`+ venue ven_taman_pancarona  Taman Pancarona / Taman Pancarona  presint=18  hours=MoTuWeThFrSaSu 08:00-00:00`);
    expect(await db.select().from(activities)).toEqual([]);
  });

  test("loads everything Hidden; a re-run inserts new rows only and keeps staff edits", async () => {
    const first = await load(data);
    expect(first.activities).toHaveLength(data.activities.length);
    const rows = await db.select().from(activities);
    expect(rows).toHaveLength(data.activities.length);
    expect(rows.every((a) => a.listingMode === "hidden" && !a.published)).toBe(true);
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

  test("refuses a data file with a listed Activity", () => {
    const listed = { ...data, activities: [{ ...data.activities[0], listingMode: "info" }] };
    expect(() => plan(listed, { cities: [], operators: [], venues: [], activities: [] })).toThrow("must be Hidden");
  });
});

test("dev seed refuses outside local", async () => {
  const res = await dispatch(new Request("https://api.test/dev/seed", { method: "POST" }));
  expect(res.status).toBe(404);
});
