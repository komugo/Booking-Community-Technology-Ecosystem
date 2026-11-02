import { booking, BookingError, type ClosureReason } from "@komugo/booking";
import { checkouts, createDb, customers, linkClosures, operatorContacts, operators, projOptions } from "@komugo/db";
import { klDate } from "@komugo/types";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { validDate } from "./checkout";
import { klDay, klWhen, named, type Locale } from "./details";
import { sendAlertEmail } from "./email";
import { b64url, DAY, fail, hmac, HOUR, logError, requireJson, safeEqual, type Ctx } from "./lib";
import { REASONS, recordClosure } from "./ops/closure";
import { enrichTimeslots, ticketCode } from "./ops/enrich";
import { message } from "./whatsapp";

const dayStart = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

const sign = async (env: Env, what: string) => b64url(new Uint8Array(await hmac(env.APP_SECRET, what)).slice(0, 16));

type Contact = { id: string; locale: Locale };
const site = (env: Env, l: Locale) => `${env.PUBLIC_SITE_URL}${l === "ms" ? "/ms" : ""}`;

export const listLink = async (env: Env, operatorId: string, date: string, c: Contact) =>
  `${site(env, c.locale)}/list/${operatorId}/${date}?c=${c.id}&k=${await sign(env, `list:${operatorId}:${date}:${c.id}`)}`;

// A per-court Ticket is listed once, under its first hour, with its court and hours; a Date ticket's day has no time.
async function dayList(env: Env, operatorId: string, date: string, now: number) {
  const rows = await booking(env, operatorId).timeslots({ from: dayStart(date), to: dayStart(date) + DAY });
  const today = klDate(now) === date;
  return (await enrichTimeslots(env, operatorId, rows)).flatMap((s) => {
    const court = s.option.bookingUnit === "court";
    const groups =
      s.closedAt !== null
        ? []
        : s.groups.flatMap<{ name: string; codes: string[]; names: string[]; court: string | null; endsAt: number | null }>((g) =>
            court
              ? g.tickets
                  .filter((t) => t.timeslotId === s.id)
                  .map((t) => ({
                    name: g.contact.name,
                    codes: [t.code],
                    names: [t.participant.name],
                    court: t.resources[0] ?? null,
                    endsAt: s.startsAt + t.hours * HOUR,
                  }))
              : [{ name: g.contact.name, codes: g.tickets.map((t) => t.code), names: g.tickets.map((t) => t.participant.name), court: null, endsAt: null }],
          );
    if (court && s.groups.length && !groups.length && s.closedAt === null) return [];
    return [
      {
        id: s.id,
        startsAt: s.startsAt,
        date: s.option.ticketType === "date",
        closed: s.closedAt !== null,
        closedBy: s.closedBy,
        option: { nameEn: s.option.nameEn, nameMs: s.option.nameMs },
        groups,
        horse: s.horse,
        customers: new Set(s.groups.map((g) => g.customerId)).size,
        closable: today && s.closedAt === null && s.startsAt > now,
      },
    ];
  });
}

const CHANGE = {
  booked: { en: "Booked", ms: "Ditempah" },
  cancelled: { en: "Cancelled", ms: "Dibatalkan" },
  moved: { en: "Moved", ms: "Dipindahkan" },
} satisfies Record<string, Record<Locale, string>>;

const FROM_TO: Record<Locale, (from: string, to: string) => string> = {
  en: (from, to) => `From ${from} to ${to}`,
  ms: (from, to) => `Dari ${from} ke ${to}`,
};

// A Ticket booked into (to), cancelled from (from) or moved between two Timeslots; one alert per day affected, except leaving a closed Timeslot.
export async function bookingAlert(
  env: Env,
  operatorId: string,
  a: { customerId: string; bookingId: string | null; ticketIds: string[]; from: string | null; to: string | null },
) {
  const rows = await booking(env, operatorId).timeslots({ ids: [a.from, a.to].filter((id) => id !== null) });
  const from = rows.find((r) => r.id === a.from);
  const to = rows.find((r) => r.id === a.to);
  const dates = [...new Set([from?.closedAt === null ? from : undefined, to].flatMap((s) => (s ? [klDate(s.startsAt)] : [])))];
  if (!dates.length) return;
  const db = createDb(env.DB);
  const [contacts, [option], [buyer], [co]] = await Promise.all([
    db
      .select({ contact: operatorContacts, operator: operators.name })
      .from(operatorContacts)
      .innerJoin(operators, eq(operators.id, operatorContacts.operatorId))
      .where(eq(operatorContacts.operatorId, operatorId)),
    db
      .select({ nameEn: projOptions.nameEn, nameMs: projOptions.nameMs })
      .from(projOptions)
      .where(eq(projOptions.id, (to ?? from)!.optionId)),
    db.select({ name: customers.name }).from(customers).where(eq(customers.id, a.customerId)),
    a.bookingId ? db.select({ name: checkouts.contactName }).from(checkouts).where(eq(checkouts.bookingId, a.bookingId)) : [],
  ]);
  const who = `• ${co?.name ?? buyer?.name ?? ""}: ${a.ticketIds.map(ticketCode).join(", ")}`;
  for (const { contact, operator } of contacts) {
    const l = contact.locale;
    const opt = option ? named(option, l) : "";
    const change =
      from && to
        ? [`${CHANGE.moved[l]}: ${opt}`, who, FROM_TO[l](klWhen(from, l), klWhen(to, l))]
        : [`${CHANGE[to ? "booked" : "cancelled"][l]}: ${opt}, ${klWhen((to ?? from)!, l)}`, who];
    for (const date of dates) {
      const slots = { operator, date: klDay(dayStart(date), l), change: change.join("\n"), link: await listLink(env, operatorId, date, contact) };
      await message(env, contact, "alert", slots).catch((e) => logError("alert_whatsapp_failed", { contactId: contact.id, error: String(e) }));
      if (contact.role === "owner" && contact.email) {
        await sendAlertEmail(env, contact.email, l, slots).catch((e) => logError("alert_email_failed", { contactId: contact.id, error: String(e) }));
      }
    }
  }
}

// An Operator link names its contact, so a removed contact's links stop working.
async function linkContact(c: Ctx) {
  const { operatorId, date } = c.req.param();
  const contactId = c.req.query("c");
  const k = c.req.query("k");
  if (!validDate(date!) || !contactId || !k || !safeEqual(k, await sign(c.env, `list:${operatorId}:${date}:${contactId}`))) return null;
  const [row] = await createDb(c.env.DB)
    .select({ id: operatorContacts.id, name: operatorContacts.name, operator: operators.name })
    .from(operatorContacts)
    .innerJoin(operators, eq(operators.id, operatorContacts.operatorId))
    .where(and(eq(operatorContacts.id, contactId), eq(operatorContacts.operatorId, operatorId!)));
  return row ?? null;
}

export const lists = new Hono<{ Bindings: Env }>();

lists.onError((e, c) => {
  if (e instanceof BookingError) return fail(c, 410, { code: "link_expired" });
  throw e;
});

// Day list: valid until its day ends, no Sign-in.
lists.get("/:operatorId/:date", async (c) => {
  const { operatorId, date } = c.req.param();
  const contact = await linkContact(c);
  if (!contact) return fail(c, 404, { code: "not_found" });
  const now = Date.now();
  if (now >= dayStart(date) + DAY) return fail(c, 410, { code: "link_expired" });
  return c.json({ operator: contact.operator, date, timeslots: await dayList(c.env, operatorId, date, now) });
});

// A same-day Closure of one Timeslot (or date) on the list, until it starts.
lists.post("/:operatorId/:date", requireJson, async (c) => {
  const { operatorId, date } = c.req.param();
  const contact = await linkContact(c);
  const body = await c.req.json<{ timeslotId?: unknown; reason?: unknown }>().catch(() => ({ timeslotId: undefined, reason: undefined }));
  const slot = contact && typeof body.timeslotId === "string" ? (await dayList(c.env, operatorId, date, Date.now())).find((s) => s.id === body.timeslotId) : undefined;
  if (!contact || !slot) return fail(c, 404, { code: "not_found" });
  if (slot.closed) return fail(c, 409, { code: "already_closed" });
  if (!slot.closable) return fail(c, 410, { code: "link_expired" });
  if (!REASONS.includes(body.reason as ClosureReason) || (body.reason === "horse_unfit" && !slot.horse)) {
    return fail(c, 400, { code: "invalid_field", field: "reason" });
  }
  const closed = await recordClosure(c.env, (p) => c.executionCtx.waitUntil(p), operatorId, slot.id, body.reason as ClosureReason);
  if (!closed) return fail(c, 409, { code: "already_closed" });
  await createDb(c.env.DB)
    .insert(linkClosures)
    .values({ timeslotId: slot.id, operatorId, contactId: contact.id, contactName: contact.name, createdAt: Date.now() })
    .onConflictDoNothing();
  return c.body(null, 204);
});
