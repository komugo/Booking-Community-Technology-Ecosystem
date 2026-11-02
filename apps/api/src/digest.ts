import { booking, BookingError, type ClosureReason } from "@komugo/booking";
import { checkouts, createDb, customers, linkClosures, operatorContacts, operators, projOptions } from "@komugo/db";
import { isClosedDay, klDate } from "@komugo/types";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { validDate } from "./checkout";
import { klDay, klWhen, named, type Locale } from "./details";
import { sendAlertEmail } from "./email";
import { b64url, DAY, each, fail, hmac, HOUR, logError, requireJson, safeEqual, type Ctx } from "./lib";
import { REASONS, recordClosure } from "./ops/closure";
import { enrichTimeslots, ticketCode } from "./ops/enrich";
import { message } from "./whatsapp";

// 21:00 KL.
export const DIGEST = "0 13 * * *";

const dayStart = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

const sign = async (env: Env, what: string) => b64url(new Uint8Array(await hmac(env.APP_SECRET, what)).slice(0, 16));

type Contact = { id: string; locale: Locale };
const site = (env: Env, l: Locale) => `${env.PUBLIC_SITE_URL}${l === "ms" ? "/ms" : ""}`;

export const listLink = async (env: Env, operatorId: string, date: string, c: Contact) =>
  `${site(env, c.locale)}/list/${operatorId}/${date}?c=${c.id}&k=${await sign(env, `list:${operatorId}:${date}:${c.id}`)}`;

const closeK = (env: Env, operatorId: string, timeslotId: string, contactId: string) => sign(env, `close:${operatorId}:${timeslotId}:${contactId}`);

export const closeLink = async (env: Env, operatorId: string, timeslotId: string, c: Contact) =>
  `${site(env, c.locale)}/close/${operatorId}/${timeslotId}?c=${c.id}&k=${await closeK(env, operatorId, timeslotId, c.id)}`;

async function dayList(env: Env, operatorId: string, date: string) {
  const rows = await booking(env, operatorId).timeslots({ from: dayStart(date), to: dayStart(date) + DAY });
  return (await enrichTimeslots(env, operatorId, rows)).map((s) => ({
    id: s.id,
    startsAt: s.startsAt,
    closed: s.closedAt !== null,
    closedBy: s.closedBy,
    option: { nameEn: s.option.nameEn, nameMs: s.option.nameMs },
    groups: s.closedAt !== null ? [] : s.groups.map((g) => ({ name: g.contact.name, codes: g.tickets.map((t) => t.code) })),
  }));
}

const hhmm = (t: number) => new Date(t + 8 * HOUR).toISOString().slice(11, 16);

const NONE: Record<Locale, string> = { en: "No bookings tomorrow.", ms: "Tiada tempahan esok." };
const CLOSE: Record<Locale, string> = { en: "Close this time", ms: "Tutup masa ini" };

async function lines(env: Env, operatorId: string, slots: Awaited<ReturnType<typeof dayList>>, c: Contact) {
  const booked = slots.filter((s) => s.groups.length);
  if (!booked.length) return NONE[c.locale];
  const blocks = await Promise.all(
    booked.map(async (s) =>
      [
        `${hhmm(s.startsAt)} ${named(s.option, c.locale)}`,
        ...s.groups.map((g) => `• ${g.name}: ${g.codes.join(", ")}`),
        `${CLOSE[c.locale]}: ${await closeLink(env, operatorId, s.id, c)}`,
      ].join("\n"),
    ),
  );
  return blocks.join("\n\n");
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
        tickets: await lines(env, operatorId, slots, contact),
        link: await listLink(env, operatorId, date, contact),
      });
    }
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

// A Ticket booked into (to), cancelled from (from) or moved between two Timeslots; alerts go out for each day whose Digest already went out, except leaving a closed Timeslot.
export async function bookingAlert(
  env: Env,
  operatorId: string,
  a: { customerId: string; bookingId: string | null; ticketIds: string[]; from: string | null; to: string | null },
) {
  const now = Date.now();
  const rows = await booking(env, operatorId).timeslots({ ids: [a.from, a.to].filter((id) => id !== null) });
  const from = rows.find((r) => r.id === a.from);
  const to = rows.find((r) => r.id === a.to);
  const days = [from?.closedAt === null ? from : undefined, to].flatMap((s) => (s ? [klDate(s.startsAt)] : []));
  const dates = [...new Set(days)].filter((d) => now >= dayStart(d) - 3 * HOUR);
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
async function linkContact(c: Ctx, what: string) {
  const { operatorId } = c.req.param();
  const contactId = c.req.query("c");
  const k = c.req.query("k");
  if (!contactId || !k || !safeEqual(k, await sign(c.env, `${what}:${contactId}`))) return null;
  const [row] = await createDb(c.env.DB)
    .select({ id: operatorContacts.id, name: operatorContacts.name, operator: operators.name })
    .from(operatorContacts)
    .innerJoin(operators, eq(operators.id, operatorContacts.operatorId))
    .where(and(eq(operatorContacts.id, contactId), eq(operatorContacts.operatorId, operatorId!)));
  return row ?? null;
}

export const lists = new Hono<{ Bindings: Env }>();

// today's list: valid until its day ends, no Sign-in.
lists.get("/:operatorId/:date", async (c) => {
  const { operatorId, date } = c.req.param();
  const contact = validDate(date) ? await linkContact(c, `list:${operatorId}:${date}`) : null;
  if (!contact) return fail(c, 404, { code: "not_found" });
  const now = Date.now();
  if (now >= dayStart(date) + DAY) return fail(c, 410, { code: "link_expired" });
  const slots = await dayList(c.env, operatorId, date);
  const timeslots = await Promise.all(
    slots.map(async (s) => ({ ...s, closeK: s.closed || s.startsAt <= now ? null : await closeK(c.env, operatorId, s.id, contact.id) })),
  );
  return c.json({ operator: contact.operator, date, timeslots });
});

export const closes = new Hono<{ Bindings: Env }>();

closes.onError((e, c) => {
  if (e instanceof BookingError) return fail(c, 410, { code: "link_expired" });
  throw e;
});

async function closable(c: Ctx) {
  const { operatorId, timeslotId } = c.req.param();
  const contact = await linkContact(c, `close:${operatorId}:${timeslotId}`);
  const rows = contact ? await booking(c.env, operatorId!).timeslots({ ids: [timeslotId!] }) : [];
  if (!contact || !rows.length) return null;
  const [slot] = await enrichTimeslots(c.env, operatorId!, rows);
  return { contact, slot };
}

// close: one Closure of one Timeslot (or date), usable once, until it starts.
closes.get("/:operatorId/:timeslotId", async (c) => {
  const x = await closable(c);
  if (!x) return fail(c, 404, { code: "not_found" });
  const { contact, slot } = x;
  if (slot.closedAt === null && slot.startsAt <= Date.now()) return fail(c, 410, { code: "link_expired" });
  return c.json({
    operator: contact.operator,
    timeslot: {
      id: slot.id,
      startsAt: slot.startsAt,
      horse: slot.horse,
      option: { nameEn: slot.option.nameEn, nameMs: slot.option.nameMs },
      closedAt: slot.closedAt,
      closedBy: slot.closedBy,
    },
    customers: new Set(slot.groups.map((g) => g.customerId)).size,
  });
});

closes.post("/:operatorId/:timeslotId", requireJson, async (c) => {
  const x = await closable(c);
  if (!x) return fail(c, 404, { code: "not_found" });
  const { contact, slot } = x;
  const body = await c.req.json<{ reason?: unknown }>().catch(() => ({ reason: undefined }));
  if (slot.closedAt !== null) return fail(c, 409, { code: "already_closed" });
  if (slot.startsAt <= Date.now()) return fail(c, 410, { code: "link_expired" });
  if (!REASONS.includes(body.reason as ClosureReason) || (body.reason === "horse_unfit" && !slot.horse)) {
    return fail(c, 400, { code: "invalid_field", field: "reason" });
  }
  const { operatorId } = c.req.param();
  const closed = await recordClosure(c.env, (p) => c.executionCtx.waitUntil(p), operatorId!, slot.id, body.reason as ClosureReason);
  if (!closed) return fail(c, 409, { code: "already_closed" });
  await createDb(c.env.DB)
    .insert(linkClosures)
    .values({ timeslotId: slot.id, operatorId: operatorId!, contactId: contact.id, contactName: contact.name, createdAt: Date.now() })
    .onConflictDoNothing();
  return c.body(null, 204);
});
