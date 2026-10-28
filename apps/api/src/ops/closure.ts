import { booking, type ClosureReason } from "@komugo/booking";
import { closureNotices, createDb } from "@komugo/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import { sendClosureEmail } from "../email";
import { groupRef } from "./enrich";
import { each, logError, MIN, type WaitUntil } from "../lib";

export async function recordClosure(env: Env, waitUntil: WaitUntil, operatorId: string, timeslotId: string, reason: ClosureReason) {
  const { affected } = await booking(env, operatorId).closeTimeslot(timeslotId, reason);
  const groups = new Map(affected.map((t) => [groupRef(t), t]));
  const db = createDb(env.DB);
  const now = Date.now();
  const rows = [...groups].map(([ref, t]) =>
    db
      .insert(closureNotices)
      .values({ timeslotId, ref, customerId: t.customerId, bookingId: t.bookingId, packId: t.packId, reason, createdAt: now })
      .onConflictDoNothing(),
  );
  if (rows.length) await db.batch(rows as [(typeof rows)[number], ...typeof rows]);
  waitUntil(
    sendClosureNotices(env, timeslotId).catch((e) => logError("closure_notices_failed", { timeslotId, error: String(e) })),
  );
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
