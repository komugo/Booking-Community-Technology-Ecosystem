import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { DAY, klDayStart } from "../src/engine";
import { rid, rideWorld } from "./helpers";

async function ordered(o: { sessions?: number; priceSen?: number; validDays?: number } = {}) {
  const w = await rideWorld();
  const offer = await w.offer({ optionIds: [w.optionId], ...o });
  const orderId = rid();
  const order = await w.b.orderPack({ orderId, customerId: w.customerId, offerId: offer.id });
  const confirm = (amountSen = offer.priceSen, billId = rid()) => w.b.confirmPackBill({ billId, orderId, amountSen });
  return { ...w, offer, orderId, order, confirm };
}

test("a paid bill issues a Pack snapshotting sessions, eligible Options and expiry at the KL end of day", async () => {
  const w = await ordered({ sessions: 8, validDays: 30 });
  expect(w.order).toEqual({ amountSen: 25000, sessions: 8, validDays: 30, optionIds: [w.optionId] });
  const r = await w.confirm();
  const expiresAt = klDayStart(Date.now()) + 31 * DAY - 1;
  expect(r).toEqual({ status: "paid", packId: expect.any(String), expiresAt });
  if (r.status !== "paid") throw new Error("not paid");
  expect(await w.sql("SELECT customer_id, sessions_total, expires_at, offer_id, option_ids FROM packs")).toEqual([
    { customer_id: w.customerId, sessions_total: 8, expires_at: expiresAt, offer_id: w.offer.id, option_ids: JSON.stringify([w.optionId]) },
  ]);
  await w.flush();
  expect(await env.DB.prepare("SELECT offer_id, option_ids, sessions_used FROM proj_packs WHERE id = ?").bind(r.packId).all()).toMatchObject({
    results: [{ offer_id: w.offer.id, option_ids: JSON.stringify([w.optionId]), sessions_used: 0 }],
  });
});

test("the same bill twice returns the same Pack; a second bill for a paid order is a duplicate Refund", async () => {
  const w = await ordered();
  const billId = rid();
  const first = await w.confirm(undefined, billId);
  expect(await w.confirm(undefined, billId)).toEqual(first);
  const second = rid();
  expect(await w.confirm(undefined, second)).toEqual({ status: "refund_due", reason: "duplicate" });
  expect(await w.confirm(undefined, second)).toEqual({ status: "refund_due", reason: "duplicate" });
  expect(await w.count("SELECT count(*) AS n FROM packs")).toBe(1);
  expect(await w.sql("SELECT id, customer_id, amount_sen, reason FROM refunds")).toEqual([
    { id: `bill:${second}`, customer_id: w.customerId, amount_sen: 25000, reason: "duplicate" },
  ]);
});

test("an amount mismatch is one Refund and leaves the order payable", async () => {
  const w = await ordered();
  const billId = rid();
  expect(await w.confirm(100, billId)).toEqual({ status: "refund_due", reason: "amount_mismatch" });
  expect(await w.confirm(100, billId)).toEqual({ status: "refund_due", reason: "amount_mismatch" });
  expect(await w.sql("SELECT id, amount_sen, reason FROM refunds")).toEqual([
    { id: `bill:${billId}`, amount_sen: 100, reason: "amount_mismatch" },
  ]);
  expect(await w.confirm()).toMatchObject({ status: "paid" });
});

test("an offer edited or deactivated after the order keeps the order's terms; an inactive offer can't be ordered", async () => {
  const w = await ordered({ sessions: 4, priceSen: 25000 });
  await w.b.upsertPackOffer({ ...w.offer, sessions: 10, priceSen: 50000, active: false });
  expect(await w.confirm(25000)).toMatchObject({ status: "paid" });
  expect(await w.sql("SELECT sessions_total FROM packs")).toEqual([{ sessions_total: 4 }]);
  await expect(w.b.orderPack({ orderId: rid(), customerId: w.customerId, offerId: w.offer.id })).rejects.toMatchObject({
    code: "not_bookable",
  });
  await expect(w.b.confirmPackBill({ billId: rid(), orderId: rid(), amountSen: 100 })).rejects.toMatchObject({
    code: "invalid_state",
  });
});
