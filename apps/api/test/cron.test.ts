import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { cron } from "../src/cron";
import { world } from "./helpers";

test("the 03:00 KL cron generates Timeslots for every Schedule", async () => {
  const w = await world();
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  await w.doSql(
    `INSERT INTO schedules (id, activity_id, option_ids, weekdays, times, starts_on, ends_on, active)
     VALUES ('sch', ?, ?, '["Mo","Tu","We","Th","Fr","Sa","Su"]', '["23:59"]', ?, NULL, 1)`,
    w.activityId,
    JSON.stringify([w.optionId]),
    today,
  );
  await cron(env, () => {}, Date.now(), "*/5 * * * *");
  expect(await w.doSql("SELECT count(*) AS n FROM timeslots WHERE schedule_id = 'sch'")).toEqual([{ n: 0 }]);
  await cron(env, () => {}, Date.now(), "0 19 * * *");
  const [{ n }] = (await w.doSql("SELECT count(*) AS n FROM timeslots WHERE schedule_id = 'sch'")) as { n: number }[];
  expect(n).toBeGreaterThanOrEqual(60);
});
