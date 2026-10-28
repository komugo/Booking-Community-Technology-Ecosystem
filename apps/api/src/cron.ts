import { booking } from "@komugo/booking";
import { bills, checkouts, createDb, memberSessions, operators, otps, sessions } from "@komugo/db";
import { and, between, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { confirmBill, deleteBill, getBill } from "./billplz";
import { sendBookedEmail, sendRefundEmail } from "./email";
import { DAY, each, HOUR, MIN, type WaitUntil } from "./lib";
import { sendClosureNotices } from "./ops/closure";

export const DAILY = "0 19 * * *";

const BATCH = 20;

export async function cron(env: Env, waitUntil: WaitUntil, now = Date.now(), schedule = "*/5 * * * *") {
  const db = createDb(env.DB);

  // 03:00 KL: keep every Schedule's Timeslots 60 days ahead. The 5-minute trigger also fires now and does the rest.
  if (schedule === DAILY) {
    const all = await db.select({ id: operators.id }).from(operators);
    await each(all, "cron_generate_failed", ({ id }) => booking(env, id).generateTimeslots());
    return;
  }

  const unsettled = await db
    .select({ id: bills.id })
    .from(bills)
    .where(and(isNull(bills.paidAt), isNull(bills.deletedAt), between(bills.createdAt, now - 72 * HOUR, now - 20 * MIN)))
    .orderBy(bills.createdAt)
    .limit(BATCH);
  await each(unsettled, "cron_reconcile_failed", async ({ id }) => {
    const bill = await getBill(env, id);
    if (bill?.paid) await confirmBill(env, waitUntil, id, bill.paid_amount);
  });

  const stale = await db
    .select({ id: bills.id })
    .from(bills)
    .innerJoin(checkouts, eq(checkouts.id, bills.checkoutId))
    .where(
      and(
        isNull(bills.paidAt),
        isNull(bills.deletedAt),
        or(
          ne(bills.holdId, sql`coalesce(${checkouts.holdId}, '')`),
          lt(checkouts.holdExpiresAt, now),
          isNotNull(checkouts.bookingId),
          isNotNull(checkouts.refundReason),
        ),
      ),
    )
    .limit(BATCH);
  await each(stale, "cron_bill_delete_failed", async ({ id }) => {
    if (await deleteBill(env, id)) await db.update(bills).set({ deletedAt: now }).where(eq(bills.id, id));
  });

  const unsent = await db
    .select({ id: checkouts.id })
    .from(checkouts)
    .where(and(isNotNull(checkouts.bookingId), isNull(checkouts.emailedAt), lt(checkouts.updatedAt, now - 2 * MIN)))
    .limit(BATCH);
  await each(unsent, "cron_email_failed", ({ id }) => sendBookedEmail(env, id));

  const refunds = await db
    .select({ id: bills.id })
    .from(bills)
    .where(and(isNotNull(bills.refundReason), isNull(bills.emailedAt), lt(bills.paidAt, now - 2 * MIN)))
    .limit(BATCH);
  await each(refunds, "cron_refund_email_failed", ({ id }) => sendRefundEmail(env, id));

  await sendClosureNotices(env, null, now);

  const live = db
    .select({ id: bills.checkoutId })
    .from(bills)
    .where(or(isNull(bills.deletedAt), isNotNull(bills.paidAt)));
  const abandoned = db
    .select({ id: checkouts.id })
    .from(checkouts)
    .where(
      and(
        isNull(checkouts.bookingId),
        isNull(checkouts.refundReason),
        lt(checkouts.createdAt, now - 30 * DAY),
        notInArray(checkouts.id, live),
      ),
    );
  await db.batch([
    db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, now), and(isNull(sessions.customerId), lt(sessions.createdAt, now - DAY)))),
    db.delete(otps).where(lt(otps.createdAt, now - DAY)),
    db.delete(memberSessions).where(lt(memberSessions.expiresAt, now)),
    db
      .update(checkouts)
      .set({ draft: null, contactName: null, contactEmail: null, contactPhone: null })
      .where(
        and(
          isNull(checkouts.customerId),
          lt(checkouts.createdAt, now - DAY),
          or(isNotNull(checkouts.draft), isNotNull(checkouts.contactEmail)),
        ),
      ),
    db.delete(bills).where(inArray(bills.checkoutId, abandoned)),
    db.delete(checkouts).where(inArray(checkouts.id, abandoned)),
  ]);
}
