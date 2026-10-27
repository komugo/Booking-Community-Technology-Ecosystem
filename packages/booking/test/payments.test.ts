import { expect, test } from "vitest";
import { DAY, kl, rid, rideWorld } from "./helpers";

async function held() {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  return { ...w, ts, h };
}

test("a duplicate callback returns the stored outcome", async () => {
  const w = await held();
  const billId = rid();
  const first = await w.pay(w.h, billId);
  expect(first).toMatchObject({ status: "paid" });
  expect(await w.pay(w.h, billId)).toEqual(first);
  expect(await w.count("SELECT count(*) AS n FROM payments WHERE bill_id = ?", billId)).toBe(1);
});

test("a second bill for a confirmed Hold is refund_due/duplicate", async () => {
  const w = await held();
  await w.pay(w.h);
  const second = rid();
  expect(await w.pay(w.h, second)).toEqual({ status: "refund_due", reason: "duplicate" });
  expect(await w.pay(w.h, second)).toEqual({ status: "refund_due", reason: "duplicate" });
  expect(await w.sql("SELECT status, refund_reason FROM payments WHERE bill_id = ?", second)).toEqual([
    { status: "refund_due", refund_reason: "duplicate" },
  ]);
});

test("an amount mismatch is refund_due and leaves the Hold active", async () => {
  const w = await held();
  expect(await w.pay({ ...w.h, amountSen: w.h.amountSen - 1 })).toEqual({
    status: "refund_due",
    reason: "amount_mismatch",
  });
  expect(await w.sql("SELECT status FROM holds")).toEqual([{ status: "active" }]);
  expect(await w.pay(w.h)).toMatchObject({ status: "paid" });
});

test("a late payment on a free Timeslot is paid; on a taken one it is refund_due/unavailable", async () => {
  const free = await held();
  await free.expireHold(free.h.holdId);
  expect(await free.pay(free.h)).toMatchObject({ status: "paid" });

  const taken = await held();
  await taken.expireHold(taken.h.holdId);
  await taken.hold(taken.customerId, taken.ts, [await taken.participant(taken.customerId)]);
  expect(await taken.pay(taken.h)).toEqual({ status: "refund_due", reason: "unavailable" });
});

test("a payment after a Closure is refund_due/unavailable", async () => {
  const w = await held();
  await w.b.closeTimeslot(w.ts);
  expect(await w.pay(w.h)).toEqual({ status: "refund_due", reason: "unavailable" });
});

test("a payment for an unknown Hold is recorded as refund_due/unknown_hold", async () => {
  const w = await held();
  const billId = rid();
  expect(await w.pay({ holdId: rid(), amountSen: 5000 }, billId)).toEqual({
    status: "refund_due",
    reason: "unknown_hold",
  });
  expect(await w.count("SELECT count(*) AS n FROM payments WHERE bill_id = ?", billId)).toBe(1);
});

test("a reused bill_id with another Hold or amount is idempotency_conflict and leaves that Hold untouched", async () => {
  const w = await held();
  const other = await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T12:00`)), [
    await w.participant(w.customerId),
  ]);
  const billId = rid();
  await w.pay(w.h, billId);
  await expect(w.pay(other, billId)).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(w.pay({ ...w.h, amountSen: w.h.amountSen + 1 }, billId)).rejects.toMatchObject({
    code: "idempotency_conflict",
  });
  expect(await w.sql("SELECT status FROM holds WHERE id = ?", other.holdId)).toEqual([{ status: "active" }]);
  expect(await w.count("SELECT count(*) AS n FROM payments")).toBe(1);
});
