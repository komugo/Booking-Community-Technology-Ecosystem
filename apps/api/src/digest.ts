import { booking } from "@komugo/booking";
import { createDb, operatorContacts, operators } from "@komugo/db";
import { isClosedDay, klDate } from "@komugo/types";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { validDate } from "./checkout";
import { klDay, named, type Locale } from "./details";
import { b64url, DAY, each, fail, hmac, HOUR, safeEqual } from "./lib";
import { enrichTimeslots } from "./ops/enrich";
import { message } from "./whatsapp";

// 21:00 KL.
export const DIGEST = "0 13 * * *";

const dayStart = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

const sign = async (env: Env, operatorId: string, date: string) =>
  b64url(new Uint8Array(await hmac(env.APP_SECRET, `list:${operatorId}:${date}`)).slice(0, 16));

export const listLink = async (env: Env, operatorId: string, date: string, l: Locale) =>
  `${env.PUBLIC_SITE_URL}${l === "ms" ? "/ms" : ""}/list/${operatorId}/${date}?k=${await sign(env, operatorId, date)}`;

async function dayList(env: Env, operatorId: string, date: string) {
  const rows = await booking(env, operatorId).timeslots({ from: dayStart(date), to: dayStart(date) + DAY });
  return (await enrichTimeslots(env, operatorId, rows)).map((s) => ({
    id: s.id,
    startsAt: s.startsAt,
    closed: s.closedAt !== null,
    option: { nameEn: s.option.nameEn, nameMs: s.option.nameMs },
    groups: s.closedAt !== null ? [] : s.groups.map((g) => ({ name: g.contact.name, codes: g.tickets.map((t) => t.code) })),
  }));
}

const hhmm = (t: number) => new Date(t + 8 * HOUR).toISOString().slice(11, 16);

const NONE: Record<Locale, string> = { en: "No bookings tomorrow.", ms: "Tiada tempahan esok." };

function lines(slots: Awaited<ReturnType<typeof dayList>>, l: Locale) {
  const booked = slots.filter((s) => s.groups.length);
  if (!booked.length) return NONE[l];
  return booked.map((s) => [`${hhmm(s.startsAt)} ${named(s.option, l)}`, ...s.groups.map((g) => `• ${g.name}: ${g.codes.join(", ")}`)].join("\n")).join("\n\n");
}

// Sent to every contact even when tomorrow is empty, except on a day that is a Closed day for all the Operator's Activities.
export async function sendDigests(env: Env, now: number) {
  const date = klDate(now + DAY);
  const db = createDb(env.DB);
  const contacts = await db
    .select({ contact: operatorContacts, operator: operators.name })
    .from(operatorContacts)
    .innerJoin(operators, eq(operators.id, operatorContacts.operatorId));
  const ids = [...new Set(contacts.map((c) => c.contact.operatorId))];
  await each(ids, "cron_digest_failed", async (operatorId) => {
    const [slots, setup] = await Promise.all([dayList(env, operatorId, date), booking(env, operatorId).setup()]);
    const closed = setup.activities.length > 0 && setup.activities.every((a) => isClosedDay(date, a.closedDays));
    if (closed && !slots.some((s) => s.groups.length)) return;
    for (const { contact, operator } of contacts.filter((c) => c.contact.operatorId === operatorId)) {
      await message(env, contact, "digest", {
        operator,
        date: klDay(dayStart(date), contact.locale),
        tickets: lines(slots, contact.locale),
        link: await listLink(env, operatorId, date, contact.locale),
      });
    }
  });
}

export const lists = new Hono<{ Bindings: Env }>();

// today's list: valid until its day ends, no Sign-in.
lists.get("/:operatorId/:date", async (c) => {
  const { operatorId, date } = c.req.param();
  const k = c.req.query("k");
  if (!validDate(date) || !k || !safeEqual(k, await sign(c.env, operatorId, date))) return fail(c, 404, { code: "not_found" });
  if (Date.now() >= dayStart(date) + DAY) return fail(c, 410, { code: "link_expired" });
  const [o] = await createDb(c.env.DB).select({ name: operators.name }).from(operators).where(eq(operators.id, operatorId));
  if (!o) return fail(c, 404, { code: "not_found" });
  return c.json({ operator: o.name, date, timeslots: await dayList(c.env, operatorId, date) });
});
