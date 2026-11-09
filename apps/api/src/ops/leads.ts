import { createDb, LEAD_STATUSES, leads as leadsTable } from "@komugo/db";
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { fail } from "../lib";
import { requireMember, staffOnly, type Ops } from "./auth";
import { json } from "./input";

export const leads = new Hono<Ops>();

leads.use(requireMember, staffOnly);

leads.get("/", async (c) =>
  c.json({ leads: await createDb(c.env.DB).select().from(leadsTable).orderBy(desc(leadsTable.createdAt)).limit(200) }),
);

leads.patch("/:id", async (c) => {
  const { status } = await json(c);
  if (!LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) return fail(c, 400, { code: "invalid_field", field: "status" });
  const [row] = await createDb(c.env.DB)
    .update(leadsTable)
    .set({ status: status as (typeof LEAD_STATUSES)[number] })
    .where(eq(leadsTable.id, c.req.param("id")))
    .returning({ id: leadsTable.id });
  if (!row) return fail(c, 404, { code: "not_found" });
  return c.body(null, 204);
});
