import { createDb, operatorContacts, operators, whatsappMessages } from "@komugo/db";
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { fail } from "../lib";
import { current, retry, sender } from "../whatsapp";
import { requireMember, staffOnly, type Ops } from "./auth";

export const whatsapp = new Hono<Ops>();

whatsapp.use(requireMember, staffOnly);

async function state(env: Env) {
  const [connected, failed] = await Promise.all([
    sender(env).connected(),
    createDb(env.DB)
      .select({
        id: whatsappMessages.id,
        operatorId: whatsappMessages.operatorId,
        operator: operators.name,
        contact: operatorContacts.name,
        phone: whatsappMessages.phone,
        template: whatsappMessages.template,
        error: whatsappMessages.error,
        at: whatsappMessages.createdAt,
      })
      .from(whatsappMessages)
      .innerJoin(operators, eq(operators.id, whatsappMessages.operatorId))
      .leftJoin(operatorContacts, eq(operatorContacts.id, whatsappMessages.contactId))
      .where(and(eq(whatsappMessages.status, "failed"), current))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(50),
  ]);
  return { connected: connected !== false, failed };
}

whatsapp.get("/", async (c) => c.json(await state(c.env)));

whatsapp.post("/:id/retry", async (c) => {
  if (!(await retry(c.env, c.req.param("id")))) return fail(c, 404, { code: "not_found" });
  return c.json({ queued: true });
});
