import { booking } from "@komugo/booking";
import { checkouts, createDb, customers, operators, projRefunds, type Db } from "@komugo/db";
import { Hono } from "hono";
import { and, asc, desc, eq, gt, isNotNull, isNull, type SQL } from "drizzle-orm";
import { sendRefundPaidEmail } from "../email";
import { DAY, fail, logError } from "../lib";
import { requireMember, staffOnly, type Ops } from "./auth";

export const refunds = new Hono<Ops>();

refunds.use(requireMember, staffOnly);

const select = (db: Db, where: SQL | undefined) =>
  db
    .select({
      refund: projRefunds,
      operatorName: operators.name,
      customer: { name: customers.name, email: customers.email, phone: customers.phone },
      contactPhone: checkouts.contactPhone,
    })
    .from(projRefunds)
    .innerJoin(operators, eq(operators.id, projRefunds.operatorId))
    .leftJoin(customers, eq(customers.id, projRefunds.customerId))
    .leftJoin(checkouts, eq(checkouts.bookingId, projRefunds.bookingId))
    .where(where);

type Row = Awaited<ReturnType<typeof select>>[number];

const view = ({ refund: r, operatorName, customer, contactPhone }: Row) => ({
  id: r.id,
  operatorName,
  amountSen: r.amountSen,
  reason: r.reason,
  createdAt: r.createdAt,
  refundedAt: r.refundedAt,
  billId: r.billId,
  bookingId: r.bookingId,
  customer: { name: customer?.name ?? null, email: customer?.email ?? null, phone: contactPhone ?? customer?.phone ?? null },
});

refunds.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const [due, refunded] = await Promise.all([
    select(db, isNull(projRefunds.refundedAt)).orderBy(asc(projRefunds.createdAt)),
    select(db, and(isNotNull(projRefunds.refundedAt), gt(projRefunds.refundedAt, Date.now() - 30 * DAY)))
      .orderBy(desc(projRefunds.refundedAt))
      .limit(100),
  ]);
  return c.json({ due: due.map(view), refunded: refunded.map(view) });
});

refunds.post("/:id/refunded", async (c) => {
  const id = c.req.param("id");
  const [row] = await createDb(c.env.DB).select().from(projRefunds).where(eq(projRefunds.id, id));
  if (!row) return fail(c, 404, { code: "not_found" });
  const { refundedAt, changed } = await booking(c.env, row.operatorId).markRefunded({ refundId: id, memberId: c.var.member.id });
  if (changed) {
    c.executionCtx.waitUntil(
      sendRefundPaidEmail(c.env, row).catch((e) => logError("refund_paid_email_failed", { refundId: id, error: String(e) })),
    );
  }
  return c.json({ refundedAt });
});
