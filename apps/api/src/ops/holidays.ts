import { createDb, projOptions, publicHolidays } from "@komugo/db";
import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { validDate } from "../checkout";
import { fail } from "../lib";
import { requireMember, staffOnly, type Ops } from "./auth";
import { invalid, json, name } from "./input";
import { syncHours } from "./venues";

export const holidays = new Hono<Ops>();

holidays.use(requireMember, staffOnly);

const list = (env: Env) => createDb(env.DB).select().from(publicHolidays).orderBy(asc(publicHolidays.date));

// Every Date ticket Activity gets the new list; sold Tickets keep their price.
async function resync(env: Env) {
  const rows = await createDb(env.DB).selectDistinct({ id: projOptions.activityId }).from(projOptions).where(eq(projOptions.ticketType, "date"));
  await syncHours(env, rows.map((r) => r.id));
}

holidays.get("/", async (c) => c.json({ holidays: await list(c.env) }));

holidays.post("/", async (c) => {
  const body = await json(c);
  const errors = invalid([
    [validDate(body.date), "date"],
    [name(body.name), "name"],
  ]);
  if (errors.length) return fail(c, 400, errors[0], errors);
  const h = { date: body.date as string, name: (body.name as string).trim() };
  await createDb(c.env.DB).insert(publicHolidays).values(h).onConflictDoUpdate({ target: publicHolidays.date, set: { name: h.name } });
  await resync(c.env);
  return c.json({ holidays: await list(c.env) }, 201);
});

holidays.post("/:date/remove", async (c) => {
  await createDb(c.env.DB).delete(publicHolidays).where(eq(publicHolidays.date, c.req.param("date")));
  await resync(c.env);
  return c.json({ holidays: await list(c.env) });
});
