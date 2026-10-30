import { activities, createDb, interests as interestsTable } from "@komugo/db";
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { clientIp, normEmail, validEmail } from "./auth";
import { b64url, fail, hmac, limited, requireJson, safeEqual, type Ctx } from "./lib";

export const interestLink = async (env: Env, id: string) => b64url(new Uint8Array(await hmac(env.APP_SECRET, `interest:${id}`)).slice(0, 16));

export const interests = new Hono<{ Bindings: Env }>();

type Body = { activityId?: unknown; email?: unknown; locale?: unknown; k?: unknown };

interests.post("/", requireJson, async (c) => {
  if (await limited(c.env.RL_IP, `interest:${clientIp(c)}`)) return fail(c, 429, { code: "rate_limited" });
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const email = normEmail(body.email);
  if (!validEmail(email)) return fail(c, 400, { code: "email_invalid", field: "email" });
  const locale = body.locale === "ms" ? "ms" : "en";
  const db = createDb(c.env.DB);
  const [a] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, String(body.activityId)), eq(activities.listingMode, "info")));
  if (!a) return fail(c, 404, { code: "not_found" });
  await db
    .insert(interestsTable)
    .values({ activityId: a.id, email, locale, createdAt: Date.now() })
    .onConflictDoUpdate({ target: [interestsTable.activityId, interestsTable.email], set: { locale, unsubscribedAt: null } });
  return c.body(null, 204);
});

async function linked(c: Ctx, k: unknown) {
  const id = c.req.param("id")!;
  if (typeof k !== "string" || !safeEqual(k, await interestLink(c.env, id))) return null;
  const [row] = await createDb(c.env.DB)
    .select({ unsubscribedAt: interestsTable.unsubscribedAt, activity: { nameEn: activities.nameEn, nameMs: activities.nameMs } })
    .from(interestsTable)
    .innerJoin(activities, eq(activities.id, interestsTable.activityId))
    .where(eq(interestsTable.id, id));
  return row ?? null;
}

interests.get("/:id", async (c) => {
  const row = await linked(c, c.req.query("k"));
  if (!row) return fail(c, 404, { code: "not_found" });
  return c.json({ activity: row.activity, unsubscribed: row.unsubscribedAt !== null });
});

interests.post("/:id/unsubscribe", requireJson, async (c) => {
  const body = await c.req.json<Body>().catch((): Body => ({}));
  if (!(await linked(c, body.k))) return fail(c, 404, { code: "not_found" });
  await createDb(c.env.DB)
    .update(interestsTable)
    .set({ unsubscribedAt: Date.now() })
    .where(and(eq(interestsTable.id, c.req.param("id")), isNull(interestsTable.unsubscribedAt)));
  return c.body(null, 204);
});
