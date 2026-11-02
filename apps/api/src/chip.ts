import { booking, BookingError, type ConfirmResult } from "@komugo/booking";
import { bills, checkouts, createDb } from "@komugo/db";
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { bookingAlert } from "./day-list";
import { sendBookedEmail, sendRefundEmail } from "./email";
import { fail, log, logError, type WaitUntil } from "./lib";
import { bookingLink } from "./manage";
import { confirmPackOrder, packReturn } from "./packs";
import { owns, readSession } from "./session";

export type Purchase = {
  id: string;
  checkout_url: string;
  status: string;
  brand_id: string;
  purchase: { total: number };
  payment: { amount: number } | null;
};

const PAID = new Set(["paid", "cleared", "settled"]);
const PENDING = new Set(["pending_execute", "pending_charge", "pending_capture"]);

export const paidSen = (p: Purchase) => (PAID.has(p.status) ? (p.payment?.amount ?? p.purchase.total) : null);
export const pending = (p: Purchase | null) => !!p && PENDING.has(p.status);

const api = (env: Env, method: string, path: string, body?: unknown) =>
  fetch(`${env.CHIP_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.CHIP_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

export async function createPurchase(
  env: Env,
  o: { email: string; name: string; product: string; amountSen: number; reference: string; holdId: string; locale: "en" | "ms" },
): Promise<Purchase> {
  const back = `${env.PUBLIC_SITE_URL}${o.locale === "ms" ? "/ms" : ""}/checkout/return?hold=${encodeURIComponent(o.holdId)}`;
  const res = await api(env, "POST", "/purchases/", {
    brand_id: env.CHIP_BRAND_ID,
    client: { email: o.email, full_name: o.name.slice(0, 128) },
    purchase: { currency: "MYR", products: [{ name: o.product.slice(0, 256), price: o.amountSen }] },
    reference: o.reference,
    success_callback: `${env.PUBLIC_SITE_URL}/chip/callback`,
    success_redirect: back,
    failure_redirect: back,
  });
  if (!res.ok) throw new Error(`chip_create_${res.status}`);
  return res.json();
}

export async function getPurchase(env: Env, id: string): Promise<Purchase | null> {
  const res = await api(env, "GET", `/purchases/${encodeURIComponent(id)}/`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`chip_get_${res.status}`);
  return res.json();
}

export async function cancelPurchase(env: Env, id: string) {
  const res = await api(env, "POST", `/purchases/${encodeURIComponent(id)}/cancel/`);
  if (res.ok || res.status === 404) return true;
  const p = await getPurchase(env, id);
  return !p || (paidSen(p) === null && !pending(p));
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

let publicKey: Promise<CryptoKey> | null = null;
let fetchedAt = 0;

// Re-fetched hourly so a rotated CHIP key stops failing callbacks without an isolate restart.
function chipKey(env: Env) {
  if (!publicKey || Date.now() - fetchedAt > 3_600_000) {
    fetchedAt = Date.now();
    publicKey = api(env, "GET", "/public_key/").then(async (res) => {
      if (!res.ok) throw new Error(`chip_public_key_${res.status}`);
      const pem = await res.json<string>();
      const der = bytes(pem.replace(/-----[^-]+-----|\s/g, ""));
      return crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    });
  }
  return publicKey.catch((e) => {
    publicKey = null;
    throw e;
  });
}

export async function verified(env: Env, body: string, signature: string | undefined) {
  if (!signature) return false;
  let sig;
  try {
    sig = bytes(signature);
  } catch {
    return false;
  }
  const key = await chipKey(env);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(body)).catch(() => false);
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
    log("chip_unknown_bill", { billId });
    return null;
  }
  return bill.kind === "pack" ? confirmPackOrder(env, waitUntil, bill, amountSen) : confirmBooking(env, waitUntil, bill, amountSen);
}

async function confirmBooking(env: Env, waitUntil: WaitUntil, bill: BillRow, amountSen: number) {
  const db = createDb(env.DB);
  const billId = bill.id;
  const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, bill.checkoutId));
  if (!checkout) {
    log("chip_unknown_bill", { billId });
    return null;
  }
  const checkoutId = checkout.id;
  if (amountSen !== bill.amountSen) logError("chip_amount_mismatch", { billId, checkoutId });
  let result: ConfirmResult | null = null;
  try {
    result = await booking(env, checkout.operatorId).confirmHold({ billId, holdId: bill.holdId, amountSen });
  } catch (e) {
    if (!(e instanceof BookingError && e.code === "idempotency_conflict")) throw e;
    logError("chip_idempotency_conflict", { billId, checkoutId });
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
      const [, first] = await db.batch([
        paid,
        db
          .update(checkouts)
          .set({ bookingId: result.bookingId, emailedAt: null, updatedAt: now })
          .where(and(eq(checkouts.id, checkoutId), isNull(checkouts.bookingId)))
          .returning({ id: checkouts.id }),
      ]);
      waitUntil(sendBookedEmail(env, checkoutId).catch((e) => logError("checkout_email_failed", { checkoutId, error: String(e) })));
      if (first.length) {
        const alert = { customerId: checkout.customerId!, bookingId: result.bookingId, ticketIds: result.ticketIds, from: null, to: checkout.timeslotId };
        waitUntil(bookingAlert(env, checkout.operatorId, alert).catch((e) => logError("booking_alert_failed", { checkoutId, error: String(e) })));
      }
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
      (ends ? log : logError)("chip_refund_due", { billId, checkoutId, reason: result.reason });
      waitUntil(sendRefundEmail(env, billId).catch((e) => logError("refund_email_failed", { billId, error: String(e) })));
    }
    log("chip_confirmed", { billId, checkoutId, status: result.status });
  }
  const [c] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
  return { checkout: c, result };
}

export const chip = new Hono<{ Bindings: Env }>();

chip.post("/callback", async (c) => {
  const body = await c.req.text();
  if (!(await verified(c.env, body, c.req.header("X-Signature")))) {
    log("chip_bad_signature");
    return fail(c, 403, { code: "bad_signature" });
  }
  const p: Purchase = JSON.parse(body);
  if (p.brand_id !== c.env.CHIP_BRAND_ID) return fail(c, 403, { code: "bad_brand" });
  const sen = paidSen(p);
  if (sen === null) return c.text("OK");
  try {
    await confirmBill(c.env, (w) => c.executionCtx.waitUntil(w), p.id, sen);
  } catch (e) {
    logError("chip_callback_failed", { billId: p.id, error: String(e) });
    return c.text("retry", 500);
  }
  return c.text("OK");
});

// CHIP's redirect carries nothing signed, so the Payment's status comes from CHIP itself.
chip.get("/return", async (c) => {
  const db = createDb(c.env.DB);
  const holdId = c.req.query("hold") ?? "";
  const [bill] = await db.select().from(bills).where(eq(bills.holdId, holdId));
  if (!bill) {
    log("chip_unknown_bill", { holdId });
    return fail(c, 404, { code: "not_found" });
  }
  if (bill.kind === "pack") return packReturn(c, bill);
  let checkout;
  let state: CheckoutState | "pending" | "failed";
  try {
    const p = await getPurchase(c.env, bill.id);
    const sen = p && paidSen(p);
    if (sen !== null) {
      const r = (await confirmBooking(c.env, (w) => c.executionCtx.waitUntil(w), bill, sen))!;
      checkout = r.checkout;
      const s = checkoutState(checkout);
      state = s === "booked" ? s : r.result?.status === "refund_due" || s === "refund_due" ? "refund_due" : "pending";
    } else {
      [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, bill.checkoutId));
      const s = checkoutState(checkout);
      state = s === "booked" || s === "refund_due" ? s : pending(p) ? "pending" : "failed";
    }
  } catch (e) {
    logError("chip_return_failed", { billId: bill.id, error: String(e) });
    return c.json({ state: "pending", checkoutId: bill.checkoutId });
  }
  const mine = owns(await readSession(c), checkout);
  return c.json({
    state,
    checkoutId: checkout.id,
    ...(checkout.bookingId ? { bookingId: checkout.bookingId } : {}),
    ...(checkout.bookingId && mine ? { k: await bookingLink(c.env, checkout.bookingId) } : {}),
  });
});
