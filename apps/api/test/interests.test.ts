import { env } from "cloudflare:test";
import { activities } from "@komugo/db";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { cron } from "../src/cron";
import { devInbox } from "../src/email";
import { client, d1, db, member, resend, rid, world, type World } from "./helpers";

const notify = (w: { activityId: string }, email: string, locale = "en") =>
  client().json("POST", "/interests", { activityId: w.activityId, email, locale });

const bookable = (w: World) => db.update(activities).set({ listingMode: "bookable", published: true }).where(eq(activities.id, w.activityId));

const mails = (email: string) => devInbox.filter((e) => e.to === email);

describe("Interest", () => {
  test("email-only sign-up on an Info Activity, deduped per Activity", async () => {
    const w = await world({ listingMode: "info" });
    const other = await world({ listingMode: "info" });
    const email = `${rid()}@example.com`;
    expect(await notify(w, email)).toEqual({ status: 204, body: null });
    expect(await notify(w, ` ${email.toUpperCase()} `, "ms")).toEqual({ status: 204, body: null });
    expect(await notify(other, email)).toEqual({ status: 204, body: null });
    expect(await d1("SELECT activity_id, email, locale FROM interests WHERE email = ? ORDER BY activity_id = ?", email, other.activityId)).toEqual([
      { activity_id: w.activityId, email, locale: "ms" },
      { activity_id: other.activityId, email, locale: "en" },
    ]);

    expect(await notify(w, "not-an-email")).toEqual({ status: 400, body: { code: "email_invalid", field: "email" } });
    expect(await notify(await world(), email)).toEqual({ status: 404, body: { code: "not_found" } });
    expect(await notify({ activityId: "nope" }, email)).toEqual({ status: 404, body: { code: "not_found" } });
  });

  test("emailed once, only after the Activity is Bookable with something on sale", async () => {
    const w = await world({ listingMode: "info", commissionBps: null });
    const email = `${rid()}@example.com`;
    await notify(w, email, "ms");
    const run = () => cron(env, () => {});

    await run();
    await bookable(w);
    await run();
    expect(mails(email)).toHaveLength(0);

    await d1("UPDATE operators SET commission_bps = 1000 WHERE id = ?", w.operatorId);
    await d1("UPDATE proj_timeslots SET closed_at = 1 WHERE id = ?", w.timeslotId);
    await run();
    expect(mails(email)).toHaveLength(0);

    await d1("UPDATE proj_timeslots SET closed_at = NULL WHERE id = ?", w.timeslotId);
    await run();
    await run();
    const sent = mails(email);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Kini boleh ditempah: Tunggang Denai");
    expect(sent[0].text).toMatch(/https:\/\/web\.test\/ms\/[^/]+-ms\/[^/]+-ms\/[^/]+-ms\n/);
    expect(sent[0].text).toMatch(/Berhenti melanggan: https:\/\/web\.test\/ms\/unsubscribe\/[^?]+\?k=/);
  });

  test("a failed send is marked and goes behind unsent Interests", async () => {
    const w = await world({ listingMode: "info" });
    const bad = `${rid()}@example.com`;
    await notify(w, bad);
    await bookable(w);
    resend.fail = 1000;
    await cron({ ...env, EMAIL_MODE: "resend" }, () => {});
    resend.fail = 0;
    expect(await d1("SELECT failed_at IS NOT NULL AS failed, emailed_at FROM interests WHERE email = ?", bad)).toEqual([{ failed: 1, emailed_at: null }]);

    for (let i = 0; i < 20; i++) {
      await d1("INSERT INTO interests (id, activity_id, email, locale, created_at, failed_at) VALUES (?, ?, ?, 'en', 1, 1)", rid(), w.activityId, `${rid()}@example.com`);
    }
    const fresh = `${rid()}@example.com`;
    await d1("INSERT INTO interests (id, activity_id, email, locale, created_at) VALUES (?, ?, ?, 'en', ?)", rid(), w.activityId, fresh, Date.now());
    await cron(env, () => {});
    expect(mails(fresh)).toHaveLength(1);
  });

  test("unsubscribe stops the email and drops out of the counts", async () => {
    const w = await world({ listingMode: "info" });
    const [a, b] = [`${rid()}@example.com`, `${rid()}@example.com`];
    await notify(w, a);
    await notify(w, b);
    const [row] = await d1<{ id: string }>("SELECT id FROM interests WHERE email = ?", a);
    await bookable(w);
    await cron(env, () => {});
    const link = new URL(/Unsubscribe: (\S+)/.exec(mails(a)[0].text)![1]);
    const id = link.pathname.split("/").pop()!;
    const k = link.searchParams.get("k");
    expect(id).toBe(row.id);

    const cl = client();
    expect(await cl.json("GET", `/interests/${id}?k=wrong`)).toEqual({ status: 404, body: { code: "not_found" } });
    expect(await cl.json("POST", `/interests/${id}/unsubscribe`, { k: "wrong" })).toEqual({ status: 404, body: { code: "not_found" } });
    expect(await cl.json("GET", `/interests/${id}?k=${k}`)).toEqual({
      status: 200,
      body: { activity: { nameEn: "Trail Riding", nameMs: "Tunggang Denai" }, unsubscribed: false },
    });
    expect(await cl.json("POST", `/interests/${id}/unsubscribe`, { k })).toEqual({ status: 204, body: null });
    expect(await cl.json("GET", `/interests/${id}?k=${k}`)).toMatchObject({ body: { unsubscribed: true } });

    const staff = await member("staff");
    expect((await staff.json("GET", "/ops/interests")).body.activities.find((r: { activityId: string }) => r.activityId === w.activityId)).toMatchObject({
      count: 1,
      notified: 1,
    });

    const quiet = await world({ listingMode: "info" });
    const c = `${rid()}@example.com`;
    await notify(quiet, c);
    await d1("UPDATE interests SET unsubscribed_at = 1 WHERE email = ?", c);
    await bookable(quiet);
    await cron(env, () => {});
    expect(mails(c)).toHaveLength(0);
  });

  test("staff see counts per Activity and Operator", async () => {
    const w = await world({ listingMode: "info" });
    const other = await world({ listingMode: "info" });
    for (let i = 0; i < 3; i++) await notify(w, `${rid()}@example.com`);
    await notify(other, `${rid()}@example.com`);

    const staff = await member("staff");
    const { status, body } = await staff.json("GET", "/ops/interests");
    expect(status).toBe(200);
    const mine = body.activities.filter((r: { operatorId: string }) => [w.operatorId, other.operatorId].includes(r.operatorId));
    expect(mine).toEqual(
      expect.arrayContaining([
        { activityId: w.activityId, nameEn: "Trail Riding", nameMs: "Tunggang Denai", listingMode: "info", operatorId: w.operatorId, operatorName: "Test Stable", count: 3, notified: 0 },
        expect.objectContaining({ activityId: other.activityId, count: 1 }),
      ]),
    );

    const op = await member("operator", w.operatorId);
    expect((await op.json("GET", "/ops/interests")).status).toBe(403);
  });
});
