import { createDb, payouts as payoutsTable } from "@komugo/db";
import { klDate } from "@komugo/types";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { fail } from "../lib";
import { requireMember, staffOnly, type Ops } from "./auth";

export const payouts = new Hono<Ops>();

payouts.use(requireMember, staffOnly);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const klMonth = (col: string) => `strftime('%Y-%m', (${col} + 28800000) / 1000, 'unixepoch')`;
const cut = (sen: string, bps: string) => `(${sen} * coalesce(${bps}, 0) + 5000) / 10000`;

type PayoutRow = {
  operatorId: string;
  operatorName: string;
  month: string;
  salesSen: number;
  commissionSen: number;
  refundsSen: number;
  carriedSen: number;
  amountSen: number;
  paidSen: number | null;
  paidAt: number | null;
};

// A sale counts in the KL month it was paid, a Refund in the month it fell due and gives back its Commission.
// Refunds of payments that never became a sale (duplicate, amount mismatch, ...) aren't the Operator's.
// A negative month is carried into the Operator's next month instead of being paid.
async function months(env: Env, operatorId?: string): Promise<PayoutRow[]> {
  const { results } = await env.DB.prepare(
    `WITH rates AS (SELECT booking_id, max(commission_bps) AS bps FROM proj_tickets WHERE booking_id IS NOT NULL GROUP BY booking_id)
     SELECT s.operator_id AS operatorId, o.name AS operatorName, s.month,
       sum(s.sales) AS salesSen, sum(s.commission) AS commissionSen, sum(s.refunds) AS refundsSen,
       p.amount_sen AS paidSen, p.paid_at AS paidAt
     FROM (
       SELECT p.operator_id, ${klMonth("p.received_at")} AS month, p.amount_sen AS sales, ${cut("p.amount_sen", "t.bps")} AS commission,
         0 AS refunds
       FROM proj_payments p
       LEFT JOIN rates t ON t.booking_id = p.booking_id
       WHERE p.status = 'paid'
       UNION ALL
       SELECT operator_id, ${klMonth("created_at")}, price_sen, ${cut("price_sen", "commission_bps")}, 0
       FROM proj_packs WHERE price_sen IS NOT NULL
       UNION ALL
       SELECT r.operator_id, ${klMonth("r.created_at")}, 0, -${cut("r.amount_sen", "t.bps")}, r.amount_sen
       FROM proj_refunds r
       LEFT JOIN rates t ON t.booking_id = r.booking_id
       WHERE r.reason IN ('cancel', 'closure')
     ) s
     JOIN operators o ON o.id = s.operator_id
     LEFT JOIN payouts p ON p.operator_id = s.operator_id AND p.month = s.month
     WHERE s.month < ?1 AND (?2 IS NULL OR s.operator_id = ?2)
     GROUP BY s.operator_id, s.month
     ORDER BY s.operator_id, s.month`,
  )
    .bind(klDate(Date.now()).slice(0, 7), operatorId ?? null)
    .all<Omit<PayoutRow, "amountSen" | "carriedSen">>();
  const carry = new Map<string, number>();
  return results
    .map((r) => {
      const carriedSen = carry.get(r.operatorId) ?? 0;
      const amountSen = r.salesSen - r.commissionSen - r.refundsSen + carriedSen;
      carry.set(r.operatorId, Math.min(amountSen, 0));
      return { ...r, carriedSen, amountSen };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.operatorName.localeCompare(b.operatorName));
}

payouts.get("/", async (c) => {
  const rows = await months(c.env);
  return c.json({
    due: rows.filter((r) => r.paidAt === null && r.amountSen >= 0),
    carried: rows.filter((r) => r.paidAt === null && r.amountSen < 0),
    // A month whose sales changed after it was paid comes first, so staff settle the difference by hand.
    paid: rows
      .filter((r) => r.paidAt !== null)
      .sort((a, b) => Number(b.paidSen !== b.amountSen) - Number(a.paidSen !== a.amountSen) || b.paidAt! - a.paidAt!)
      .slice(0, 100),
  });
});

// Idempotent: once a month is paid, marking it again returns the first record.
payouts.post("/:operatorId/:month/paid", async (c) => {
  const { operatorId, month } = c.req.param();
  if (!MONTH.test(month)) return fail(c, 400, { code: "invalid_field", field: "month" });
  const body = await c.req.json<{ amountSen?: unknown }>().catch(() => ({}) as { amountSen?: unknown });
  if (!Number.isInteger(body.amountSen)) return fail(c, 400, { code: "invalid_field", field: "amountSen" });
  const row = (await months(c.env, operatorId)).find((r) => r.month === month);
  if (!row) return fail(c, 404, { code: "not_found" });
  if (row.paidAt === null && row.amountSen < 0) return fail(c, 409, { code: "carried_forward" });
  const db = createDb(c.env.DB);
  if (row.paidAt === null) {
    if (body.amountSen !== row.amountSen) return fail(c, 409, { code: "amount_changed" });
    await db
      .insert(payoutsTable)
      .values({ operatorId, month, amountSen: row.amountSen, paidAt: Date.now(), paidBy: c.var.member.id })
      .onConflictDoNothing();
  }
  const [paid] = await db
    .select({ amountSen: payoutsTable.amountSen, paidAt: payoutsTable.paidAt })
    .from(payoutsTable)
    .where(and(eq(payoutsTable.operatorId, operatorId), eq(payoutsTable.month, month)));
  return c.json(paid);
});
