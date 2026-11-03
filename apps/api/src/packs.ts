import { booking, BookingError } from "@komugo/booking";
import { activities, bills, createDb, customers, operators, packOrders, projPackOffers } from "@komugo/db";
import { Hono } from "hono";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createPurchase, getPurchase, paidSen, pending, refundLater, type BillRow, type Purchase } from "./chip";
import { named } from "./details";
import { sendPackEmail, sendRefundEmail } from "./email";
import { DAY, fail, limited, log, logError, requireJson, type Ctx, type WaitUntil } from "./lib";
import { groupLink } from "./manage";
import { readSession } from "./session";

export const packs = new Hono<{ Bindings: Env }>();

packs.post("/", requireJson, async (c) => {
  const body = await c.req.json<{ offerId?: unknown; locale?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const session = await readSession(c);
  if (!session?.customerId) return fail(c, 401, { code: "signed_out" });
  if (await limited(c.env.RL_CHECKOUT, session.idHash)) return fail(c, 429, { code: "rate_limited" });
  const db = createDb(c.env.DB);
  const offerId = String(body.offerId ?? "");
  const [row] = await db
    .select({
      offer: projPackOffers,
      activity: { nameEn: activities.nameEn, nameMs: activities.nameMs, listingMode: activities.listingMode },
      commissionBps: operators.commissionBps,
    })
    .from(projPackOffers)
    .innerJoin(activities, eq(activities.id, projPackOffers.activityId))
    .innerJoin(operators, eq(operators.id, activities.operatorId))
    .where(eq(projPackOffers.id, offerId));
  if (!row || !row.offer.active || ((row.activity.listingMode !== "bookable" || row.commissionBps === null) && c.env.BOOK_DRAFTS !== "1")) {
    return fail(c, 409, { code: "not_bookable" });
  }
  const customerId = session.customerId;
  const now = Date.now();
  const [open] = await db
    .select({ url: bills.url })
    .from(packOrders)
    .innerJoin(bills, eq(bills.holdId, packOrders.id))
    .where(
      and(
        eq(packOrders.customerId, customerId),
        eq(packOrders.offerId, offerId),
        gt(packOrders.createdAt, now - DAY),
        isNull(bills.paidAt),
        isNull(bills.deletedAt),
      ),
    )
    .orderBy(desc(packOrders.createdAt))
    .limit(1);
  if (open) return c.json({ url: open.url });

  const { offer, activity } = row;
  const l = body.locale === "ms" ? "ms" : "en";
  const orderId = crypto.randomUUID();
  let amountSen: number;
  try {
    ({ amountSen } = await booking(c.env, offer.operatorId).orderPack({ orderId, customerId, offerId }));
  } catch (e) {
    if (e instanceof BookingError) return fail(c, 409, { code: e.code });
    throw e;
  }
  const [customer] = await db.select({ name: customers.name, email: customers.email }).from(customers).where(eq(customers.id, customerId));
  if (!customer?.email) return fail(c, 409, { code: "invalid_state" });
  await db.insert(packOrders).values({ id: orderId, customerId, operatorId: offer.operatorId, offerId, amountSen, locale: l, createdAt: now });
  let bill;
  try {
    bill = await createPurchase(c.env, {
      email: customer.email,
      name: customer.name,
      product: `Komugo · ${named(offer, l)} – ${named(activity, l)}`,
      amountSen,
      reference: orderId,
      holdId: orderId,
      locale: l,
    });
  } catch (e) {
    logError("chip_create_failed", { orderId, error: String(e) });
    return fail(c, 502, { code: "payment_unavailable" });
  }
  await db.insert(bills).values({ id: bill.id, kind: "pack", checkoutId: orderId, holdId: orderId, amountSen, url: bill.checkout_url, createdAt: Date.now() });
  return c.json({ url: bill.checkout_url });
});

export async function confirmPackOrder(env: Env, waitUntil: WaitUntil, bill: BillRow, amountSen: number) {
  const db = createDb(env.DB);
  const [order] = await db.select().from(packOrders).where(eq(packOrders.id, bill.checkoutId));
  if (!order) {
    log("chip_unknown_bill", { billId: bill.id });
    return null;
  }
  const result = await booking(env, order.operatorId).confirmPackBill({ billId: bill.id, orderId: order.id, amountSen });
  const paid = db
    .update(bills)
    .set({ paidAt: Date.now(), paidAmountSen: amountSen, refundReason: result.status === "refund_due" ? result.reason : null })
    .where(and(eq(bills.id, bill.id), isNull(bills.paidAt)));
  if (result.status === "paid") {
    const [, issued] = await db.batch([
      paid,
      db
        .update(packOrders)
        .set({ packId: result.packId })
        .where(and(eq(packOrders.id, order.id), isNull(packOrders.packId)))
        .returning({ id: packOrders.id }),
    ]);
    if (issued.length) {
      waitUntil(sendPackEmail(env, order.id).catch((e) => logError("pack_email_failed", { orderId: order.id, error: String(e) })));
    }
  } else {
    await paid;
    logError("chip_refund_due", { billId: bill.id, orderId: order.id, reason: result.reason });
    waitUntil(sendRefundEmail(env, bill.id).catch((e) => logError("refund_email_failed", { billId: bill.id, error: String(e) })));
    refundLater(env, waitUntil, order.operatorId, `bill:${bill.id}`);
  }
  log("chip_confirmed", { billId: bill.id, orderId: order.id, status: result.status });
  return { order, result };
}

export async function packReturn(c: Ctx, bill: BillRow) {
  let p: Purchase | null | undefined;
  let sen: number | null = null;
  try {
    p = await getPurchase(c.env, bill.id);
    sen = p && paidSen(p);
    if (sen !== null) await confirmPackOrder(c.env, (w) => c.executionCtx.waitUntil(w), bill, sen);
  } catch (e) {
    logError("chip_return_failed", { billId: bill.id, error: String(e) });
  }
  const db = createDb(c.env.DB);
  const [[order], [now]] = await Promise.all([
    db.select().from(packOrders).where(eq(packOrders.id, bill.checkoutId)),
    db.select().from(bills).where(eq(bills.id, bill.id)),
  ]);
  const state = now.refundReason
    ? "refund_due"
    : now.paidAt && order.packId
      ? "pack"
      : p === undefined || sen !== null || pending(p)
        ? "pending"
        : "failed";
  const mine = (await readSession(c))?.customerId === order.customerId;
  return c.json({
    state,
    offerId: order.offerId,
    ...(state === "pack" ? { packId: order.packId, ...(mine ? { k: await groupLink(c.env, "pack", order.packId!) } : {}) } : {}),
  });
}
