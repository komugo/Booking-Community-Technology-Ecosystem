import { booking, BookingError, type ConfirmResult } from "@komugo/booking";
import { bills, checkouts, createDb } from "@komugo/db";
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { sendBookedEmail, sendRefundEmail } from "./email";
import { fail, hmacHex, log, logError, safeEqual, type WaitUntil } from "./lib";
import { bookingLink } from "./manage";
import { confirmPackOrder, packReturn } from "./packs";
import { owns, readSession } from "./session";

type Fields = Record<string, string>;
export type Bill = { id: string; url: string; paid: boolean; paid_amount: number; state: string };

const ci = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export const sign = (fields: Fields, key: string) =>
  hmacHex(
    key,
    Object.entries(fields)
      .filter(([k]) => k !== "x_signature")
      .map(([k, v]) => k + v)
      .sort(ci)
      .join("|"),
  );

export async function verified(fields: Fields, key: string) {
  const s = fields.x_signature;
  return !!s && safeEqual(s, await sign(fields, key));
}

export function redirectFields(params: URLSearchParams): Fields {
  const out: Fields = {};
  for (const [k, v] of params) {
    const m = /^billplz\[(\w+)\]$/.exec(k);
    if (m) out[m[1] === "x_signature" ? "x_signature" : `billplz${m[1]}`] = v;
  }
  return out;
}

const api = (env: Env, method: string, path: string, body?: Fields) =>
  fetch(`${env.BILLPLZ_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${env.BILLPLZ_API_KEY}:`)}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
  });

export async function createBill(env: Env, fields: Fields): Promise<Bill> {
  const res = await api(env, "POST", "/bills", fields);
  if (!res.ok) throw new Error(`billplz_create_${res.status}`);
  return res.json();
}

export async function getBill(env: Env, id: string): Promise<Bill | null> {
  const res = await api(env, "GET", `/bills/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`billplz_get_${res.status}`);
  return res.json();
}

export async function deleteBill(env: Env, id: string) {
  const res = await api(env, "DELETE", `/bills/${encodeURIComponent(id)}`);
  return res.ok || res.status === 404;
}

export type CheckoutState = "draft" | "held" | "expired" | "booked" | "redeemed" | "refund_due";
export type BillRow = typeof bills.$inferSelect;

export const checkoutState = (
  c: { bookingId: string | null; packId: string | null; refundReason: string | null; holdId: string | null; holdExpiresAt: number | null },
  now = Date.now(),
): CheckoutState =>
  c.bookingId
    ? "booked"
    : c.packId
      ? "redeemed"
      : c.refundReason
        ? "refund_due"
        : !c.holdId
          ? "draft"
          : c.holdExpiresAt! > now
            ? "held"
            : "expired";

export async function confirmBill(env: Env, waitUntil: WaitUntil, billId: string, amountSen: number) {
  const [bill] = await createDb(env.DB).select().from(bills).where(eq(bills.id, billId));
  if (!bill) {
    log("billplz_unknown_bill", { billId });
    return null;
  }
  return bill.kind === "pack" ? confirmPackOrder(env, waitUntil, bill, amountSen) : confirmBooking(env, waitUntil, bill, amountSen);
}

async function confirmBooking(env: Env, waitUntil: WaitUntil, bill: BillRow, amountSen: number) {
  const db = createDb(env.DB);
  const billId = bill.id;
  const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, bill.checkoutId));
  if (!checkout) {
    log("billplz_unknown_bill", { billId });
    return null;
  }
  const checkoutId = checkout.id;
  if (amountSen !== bill.amountSen) logError("billplz_amount_mismatch", { billId, checkoutId });
  let result: ConfirmResult | null = null;
  try {
    result = await booking(env, checkout.operatorId).confirmHold({ billId, holdId: bill.holdId, amountSen });
  } catch (e) {
    if (!(e instanceof BookingError && e.code === "idempotency_conflict")) throw e;
    logError("billplz_idempotency_conflict", { billId, checkoutId });
  }
  if (result) {
    const now = Date.now();
    const paid = db
      .update(bills)
      .set({
        paidAt: now,
        paidAmountSen: amountSen,
        refundReason: result.status === "refund_due" ? result.reason : null,
      })
      .where(and(eq(bills.id, billId), isNull(bills.paidAt)));
    if (result.status === "paid") {
      if (checkout.bookingId && checkout.bookingId !== result.bookingId) {
        logError("duplicate_booking", { billId, checkoutId, bookingId: result.bookingId });
      }
      await db.batch([
        paid,
        db
          .update(checkouts)
          .set({ bookingId: result.bookingId, emailedAt: null, updatedAt: now })
          .where(and(eq(checkouts.id, checkoutId), isNull(checkouts.bookingId))),
      ]);
      waitUntil(sendBookedEmail(env, checkoutId).catch((e) => logError("checkout_email_failed", { checkoutId, error: String(e) })));
    } else {
      // Only the current Hold's refund ends the Checkout; a stray bill's refund leaves it bookable.
      const ends = !checkout.bookingId && !checkout.packId && bill.holdId === checkout.holdId;
      await db.batch([
        paid,
        db
          .update(checkouts)
          .set({ refundReason: result.reason, updatedAt: now })
          .where(
            and(
              eq(checkouts.id, checkoutId),
              eq(checkouts.holdId, bill.holdId),
              isNull(checkouts.bookingId),
              isNull(checkouts.packId),
              isNull(checkouts.refundReason),
            ),
          ),
      ]);
      (ends ? log : logError)("billplz_refund_due", { billId, checkoutId, reason: result.reason });
      waitUntil(sendRefundEmail(env, billId).catch((e) => logError("refund_email_failed", { billId, error: String(e) })));
    }
    log("billplz_confirmed", { billId, checkoutId, status: result.status });
  }
  const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
  return { checkout: c, result };
}

export const billplz = new Hono<{ Bindings: Env }>();

billplz.post("/callback", async (c) => {
  const fields = Object.fromEntries(
    Object.entries(await c.req.parseBody()).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  if (!(await verified(fields, c.env.BILLPLZ_X_SIGNATURE_KEY))) {
    log("billplz_bad_signature", { kind: "callback" });
    return fail(c, 403, { code: "bad_signature" });
  }
  if (fields.collection_id !== c.env.BILLPLZ_COLLECTION_ID) return fail(c, 403, { code: "bad_collection" });
  if (fields.paid !== "true") return c.text("OK");
  try {
    await confirmBill(c.env, (p) => c.executionCtx.waitUntil(p), fields.id, Number(fields.paid_amount));
  } catch (e) {
    logError("billplz_callback_failed", { billId: fields.id, error: String(e) });
    return c.text("retry", 500);
  }
  return c.text("OK");
});

billplz.get("/return", async (c) => {
  const fields = redirectFields(new URL(c.req.url).searchParams);
  if (!(await verified(fields, c.env.BILLPLZ_X_SIGNATURE_KEY))) {
    log("billplz_bad_signature", { kind: "redirect" });
    return fail(c, 403, { code: "bad_signature" });
  }
  const db = createDb(c.env.DB);
  const billId = fields.billplzid;
  const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
  if (!bill) {
    log("billplz_unknown_bill", { billId });
    return fail(c, 404, { code: "not_found" });
  }
  if (bill.kind === "pack") return packReturn(c, bill, fields);
  let checkout;
  let state: CheckoutState | "pending" | "failed";
  if (fields.billplzpaid === "true") {
    try {
      const r = (await confirmBooking(c.env, (p) => c.executionCtx.waitUntil(p), bill, bill.amountSen))!;
      checkout = r.checkout;
      const s = checkoutState(checkout);
      state = s === "booked" ? s : r.result?.status === "refund_due" || s === "refund_due" ? "refund_due" : "pending";
    } catch (e) {
      logError("billplz_return_failed", { billId, error: String(e) });
      return c.json({ state: "pending", checkoutId: bill.checkoutId });
    }
  } else {
    [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, bill.checkoutId));
    const s = checkoutState(checkout);
    state = s === "booked" || s === "refund_due" ? s : fields.billplztransaction_status === "pending" ? "pending" : "failed";
  }
  const mine = owns(await readSession(c), checkout);
  return c.json({
    state,
    checkoutId: checkout.id,
    ...(checkout.bookingId ? { bookingId: checkout.bookingId } : {}),
    ...(checkout.bookingId && mine ? { k: await bookingLink(c.env, checkout.bookingId) } : {}),
  });
});
