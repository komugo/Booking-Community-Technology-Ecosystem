import { createDb, operatorContacts, operators, whatsappMessages } from "@komugo/db";
import { Hono } from "hono";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { normEmail, validEmail } from "../auth";
import { fail } from "../lib";
import { message, send } from "../whatsapp";
import { staffOnly, type Ops } from "./auth";
import { invalid, json, list as listOf, name, type Body } from "./input";

export const contacts = new Hono<Ops>();

contacts.use(staffOnly);

const ROLES = ["counter", "owner"] as const;
const LOCALES = ["ms", "en"] as const;

// Typed locally (012-345 6789) or with a country code; stored as +60123456789.
function phone(v: unknown) {
  if (typeof v !== "string") return null;
  const d = v.replace(/[\s()-]/g, "").replace(/^00/, "+");
  const n = d.startsWith("+") ? d.slice(1) : d.startsWith("0") ? `6${d}` : d;
  return /^[1-9]\d{9,14}$/.test(n) ? `+${n}` : null;
}

async function list(env: Env, operatorId: string) {
  const db = createDb(env.DB);
  const [rows, sent] = await db.batch([
    db
      .select({
        id: operatorContacts.id,
        name: operatorContacts.name,
        phone: operatorContacts.phone,
        role: operatorContacts.role,
        locale: operatorContacts.locale,
        email: operatorContacts.email,
      })
      .from(operatorContacts)
      .where(eq(operatorContacts.operatorId, operatorId))
      .orderBy(asc(operatorContacts.createdAt)),
    db
      .select({ contactId: whatsappMessages.contactId, status: whatsappMessages.status, at: whatsappMessages.createdAt })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.operatorId, operatorId), eq(whatsappMessages.template, "welcome")))
      .orderBy(desc(whatsappMessages.createdAt)),
  ]);
  return rows.map((c) => {
    const w = sent.find((m) => m.contactId === c.id);
    return { ...c, welcome: w ? { status: w.status, at: w.at } : null };
  });
}

function parse(body: Body) {
  const role = ROLES.find((r) => r === body.role);
  const email = normEmail(body.email);
  const v = {
    name: typeof body.name === "string" ? body.name.trim() : "",
    phone: phone(body.phone),
    role: role ?? "counter",
    locale: LOCALES.find((l) => l === body.locale) ?? "ms",
    email: role === "owner" ? email : null,
  };
  const errors = invalid([
    [name(body.name), "name"],
    [!!v.phone, "phone"],
    [!!role, "role"],
    [body.locale === undefined || LOCALES.some((l) => l === body.locale), "locale"],
    [role !== "owner" || validEmail(email), "email"],
  ]);
  return { v: { ...v, phone: v.phone! }, errors };
}

const duplicate = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/.test(`${e.message} ${e.cause}`);

contacts.get("/", async (c) => c.json({ contacts: await list(c.env, c.req.param("operatorId")!) }));

async function welcome(env: Env, contact: typeof operatorContacts.$inferSelect) {
  const [operator] = await createDb(env.DB).select({ name: operators.name }).from(operators).where(eq(operators.id, contact.operatorId));
  await message(env, contact, "welcome", { contact: contact.name, operator: operator.name });
}

contacts.post("/", async (c) => {
  const op = c.req.param("operatorId")!;
  const { v, errors } = parse(await json(c));
  if (errors.length) return fail(c, 400, errors[0], errors);
  let contact;
  try {
    [contact] = await createDb(c.env.DB)
      .insert(operatorContacts)
      .values({ ...v, operatorId: op, createdAt: Date.now() })
      .returning();
  } catch (e) {
    if (duplicate(e)) return fail(c, 409, { code: "contact_exists", field: "phone" });
    throw e;
  }
  await welcome(c.env, contact);
  return c.json({ contacts: await list(c.env, op) }, 201);
});

// A new number gets the Welcome again, since it hasn't saved ours yet.
contacts.put("/:id", async (c) => {
  const op = c.req.param("operatorId")!;
  const id = c.req.param("id");
  const { v, errors } = parse(await json(c));
  if (errors.length) return fail(c, 400, errors[0], errors);
  const db = createDb(c.env.DB);
  const mine = and(eq(operatorContacts.id, id), eq(operatorContacts.operatorId, op));
  const [was] = await db.select({ phone: operatorContacts.phone }).from(operatorContacts).where(mine);
  if (!was) return fail(c, 404, { code: "not_found" });
  let contact;
  try {
    [contact] = await db.update(operatorContacts).set(v).where(mine).returning();
  } catch (e) {
    if (duplicate(e)) return fail(c, 409, { code: "contact_exists", field: "phone" });
    throw e;
  }
  if (contact.phone !== was.phone) await welcome(c.env, contact);
  return c.json({ contacts: await list(c.env, op) });
});

contacts.post("/:id/remove", async (c) => {
  const op = c.req.param("operatorId")!;
  await createDb(c.env.DB)
    .delete(operatorContacts)
    .where(and(eq(operatorContacts.id, c.req.param("id")), eq(operatorContacts.operatorId, op)));
  return c.json({ contacts: await list(c.env, op) });
});

// Replies come back to WhatsApp Web, not here (ADR 0006).
contacts.post("/message", async (c) => {
  const op = c.req.param("operatorId")!;
  const body = await json(c);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const ids = listOf<string>(body.contactIds, 50, (x) => typeof x === "string") ? [...new Set(body.contactIds)] : [];
  const errors = invalid([
    [ids.length > 0, "contactIds"],
    [text.length >= 1 && text.length <= 2000, "text"],
  ]);
  if (errors.length) return fail(c, 400, errors[0], errors);
  const to = await createDb(c.env.DB)
    .select()
    .from(operatorContacts)
    .where(and(eq(operatorContacts.operatorId, op), inArray(operatorContacts.id, ids)));
  if (to.length !== ids.length) return fail(c, 404, { code: "not_found" });
  for (const contact of to) await send(c.env, contact, "staff", text);
  return c.json({ queued: to.length });
});
