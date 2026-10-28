import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { migrate } from "../src/migrations";
import { DAY, kl, rid, rideWorld, UNDO_V8 } from "./helpers";

async function duplicate() {
  const w = await rideWorld();
  const h = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [await w.participant(w.customerId)]);
  await w.pay(h);
  const billId = rid();
  expect(await w.pay(h, billId)).toEqual({ status: "refund_due", reason: "duplicate" });
  return { ...w, billId };
}

test("a refund_due Payment gets a bill Refund row, projected to proj_refunds", async () => {
  const w = await duplicate();
  expect(await w.sql("SELECT id, customer_id, bill_id, booking_id, amount_sen, reason, refunded_at FROM refunds")).toEqual([
    { id: `bill:${w.billId}`, customer_id: w.customerId, bill_id: w.billId, booking_id: null, amount_sen: 10000, reason: "duplicate", refunded_at: null },
  ]);
  await w.flush();
  expect(await env.DB.prepare("SELECT operator_id, amount_sen, reason FROM proj_refunds WHERE id = ?").bind(`bill:${w.billId}`).all()).toMatchObject({
    results: [{ operator_id: w.operatorId, amount_sen: 10000, reason: "duplicate" }],
  });
});

test("markRefunded is idempotent by state; an unknown Refund is invalid_state", async () => {
  const w = await duplicate();
  const refundId = `bill:${w.billId}`;
  const first = await w.b.markRefunded({ refundId, memberId: "m1" });
  expect(first).toEqual({ refundedAt: expect.any(Number), changed: true });
  expect(await w.b.markRefunded({ refundId, memberId: "m2" })).toEqual({ refundedAt: first.refundedAt, changed: false });
  expect(await w.sql("SELECT refunded_by FROM refunds")).toEqual([{ refunded_by: "m1" }]);
  await expect(w.b.markRefunded({ refundId: rid(), memberId: "m1" })).rejects.toMatchObject({ code: "invalid_state" });
});

test("migration 8 backfills a Refund for each refund_due Payment and re-projects Packs and Refunds", async () => {
  const w = await duplicate();
  await runInDurableObject(w.stub, (_, s) => {
    const sql = s.storage.sql;
    for (const q of UNDO_V8) sql.exec(q);
    sql.exec("UPDATE meta SET schema_version = 7");
    sql.exec("DELETE FROM outbox");
    migrate(s.storage);
    expect(sql.exec("SELECT id, amount_sen, reason FROM refunds").toArray()).toEqual([
      { id: `bill:${w.billId}`, amount_sen: 10000, reason: "duplicate" },
    ]);
    expect(sql.exec("SELECT entity, entity_id FROM outbox").toArray()).toEqual([{ entity: "refund", entity_id: `bill:${w.billId}` }]);
  });
});
