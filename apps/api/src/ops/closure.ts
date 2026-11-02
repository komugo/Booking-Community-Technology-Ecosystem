import { booking, type ClosureReason } from "@komugo/booking";
import { closureNotices, createDb, operatorContacts, operators, projOptions } from "@komugo/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import { klWhen, named, type Locale } from "../details";
import { sendClosureEmail } from "../email";
import { groupRef } from "./enrich";
import { each, logError, MIN, type WaitUntil } from "../lib";
import { message } from "../whatsapp";

export const REASONS: ClosureReason[] = ["weather", "maintenance", "event", "horse_unfit", "other"];

export async function recordClosure(env: Env, waitUntil: WaitUntil, operatorId: string, timeslotId: string, reason: ClosureReason) {
  const { affected, closed } = await booking(env, operatorId).closeTimeslot(timeslotId, reason);
  // A per-court Ticket's notice is on its first hour, so closing more of its hours still sends one.
  const groups = new Map(affected.map((t) => [groupRef(t), t]));
  const db = createDb(env.DB);
  const now = Date.now();
  const rows = [...groups].map(([ref, t]) =>
    db
      .insert(closureNotices)
      .values({ timeslotId: t.timeslotId, ref, customerId: t.customerId, bookingId: t.bookingId, packId: t.packId, reason, createdAt: now })
      .onConflictDoNothing()
      .returning({ customerId: closureNotices.customerId }),
  );
  const inserted = rows.length ? await db.batch(rows as [(typeof rows)[number], ...typeof rows]) : [];
  for (const id of new Set([timeslotId, ...affected.map((t) => t.timeslotId)])) {
    waitUntil(sendClosureNotices(env, id).catch((e) => logError("closure_notices_failed", { timeslotId: id, error: String(e) })));
  }
  if (closed) {
    const customers = new Set(inserted.flat().map((r) => r.customerId)).size;
    waitUntil(closureDone(env, operatorId, timeslotId, reason, customers).catch((e) => logError("closure_done_failed", { timeslotId, error: String(e) })));
  }
  return closed;
}

const REASON: Record<Locale, Record<ClosureReason, string>> = {
  en: { weather: "Weather", maintenance: "Maintenance", event: "Event", horse_unfit: "Horse unfit", other: "Other" },
  ms: { weather: "Cuaca", maintenance: "Penyelenggaraan", event: "Acara", horse_unfit: "Kuda tidak sihat", other: "Lain-lain" },
};

async function closureDone(env: Env, operatorId: string, timeslotId: string, reason: ClosureReason, customers: number) {
  const [slot] = await booking(env, operatorId).timeslots({ ids: [timeslotId] });
  const db = createDb(env.DB);
  const [contacts, [option]] = await Promise.all([
    db
      .select({ contact: operatorContacts, operator: operators.name })
      .from(operatorContacts)
      .innerJoin(operators, eq(operators.id, operatorContacts.operatorId))
      .where(eq(operatorContacts.operatorId, operatorId)),
    db.select({ nameEn: projOptions.nameEn, nameMs: projOptions.nameMs }).from(projOptions).where(eq(projOptions.id, slot.optionId)),
  ]);
  for (const { contact, operator } of contacts) {
    const l = contact.locale;
    const slots = { operator, option: option ? named(option, l) : "", when: klWhen(slot, l), reason: REASON[l][reason], customers: String(customers) };
    await message(env, contact, "closure", slots).catch((e) => logError("closure_done_whatsapp_failed", { contactId: contact.id, error: String(e) }));
  }
}

export async function sendClosureNotices(env: Env, timeslotId: string | null, now = Date.now()) {
  const unsent = await createDb(env.DB)
    .select({ timeslotId: closureNotices.timeslotId, ref: closureNotices.ref })
    .from(closureNotices)
    .where(
      and(
        isNull(closureNotices.emailedAt),
        timeslotId ? eq(closureNotices.timeslotId, timeslotId) : lt(closureNotices.createdAt, now - 2 * MIN),
      ),
    )
    .limit(20);
  await each(unsent, "closure_email_failed", (r) => sendClosureEmail(env, r.timeslotId, r.ref));
}
