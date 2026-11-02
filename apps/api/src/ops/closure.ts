import { booking, type ClosureReason } from "@komugo/booking";
import { closureNotices, createDb } from "@komugo/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import { sendClosureEmail } from "../email";
import { groupRef } from "./enrich";
import { each, logError, MIN, type WaitUntil } from "../lib";

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
      .onConflictDoNothing(),
  );
  if (rows.length) await db.batch(rows as [(typeof rows)[number], ...typeof rows]);
  for (const id of new Set([timeslotId, ...affected.map((t) => t.timeslotId)])) {
    waitUntil(sendClosureNotices(env, id).catch((e) => logError("closure_notices_failed", { timeslotId: id, error: String(e) })));
  }
  return closed;
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
