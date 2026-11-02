import { activities, createDb, interests, operators } from "@komugo/db";
import { Hono } from "hono";
import { asc, desc, eq, sql } from "drizzle-orm";
import { requireMember, staffOnly, type Ops } from "./auth";

export const interestCounts = new Hono<Ops>();

interestCounts.use(requireMember, staffOnly);

interestCounts.get("/", async (c) => {
  const count = sql<number>`count(*) FILTER (WHERE ${interests.unsubscribedAt} IS NULL)`;
  const rows = await createDb(c.env.DB)
    .select({
      activityId: activities.id,
      nameEn: activities.nameEn,
      nameMs: activities.nameMs,
      listingMode: activities.listingMode,
      operatorId: operators.id,
      operatorName: operators.name,
      count,
      notified: sql<number>`count(*) FILTER (WHERE ${interests.unsubscribedAt} IS NULL AND ${interests.emailedAt} IS NOT NULL)`,
    })
    .from(interests)
    .innerJoin(activities, eq(activities.id, interests.activityId))
    .innerJoin(operators, eq(operators.id, activities.operatorId))
    .groupBy(activities.id)
    .having(sql`${count} > 0`)
    .orderBy(asc(operators.name), desc(count));
  return c.json({ activities: rows });
});
