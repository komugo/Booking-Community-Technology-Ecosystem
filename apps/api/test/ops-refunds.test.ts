import { expect, test } from "vitest";
import { devInbox } from "../src/email";
import { booked, member, rid, world } from "./helpers";

async function refunds() {
  const w = await world({ horses: 3 });
  const dup = await booked(w, [{ name: "Ali" }]);
  expect(await w.b.confirmHold({ billId: `dup_${rid()}`, holdId: dup.holdId, amountSen: 10000 })).toEqual({
    status: "refund_due",
    reason: "duplicate",
  });
  const c = await booked(w, [{ name: "Abu" }], { phone: "+60111111111" });
  const r = await w.b.cancelTickets({
    requestId: rid(),
    customerId: c.customerId,
    group: { bookingId: c.bookingId },
    ticketIds: c.ticketIds,
    onlyClosed: false,
    expectSen: 10000,
    expectForfeited: [],
  });
  await w.flush();
  return { w, dup, c, cancelId: r.refund!.id };
}

test("operator Members can't see or mark Refunds", async () => {
  const { w, cancelId } = await refunds();
  const m = await member("operator", w.operatorId);
  expect((await m.json("GET", "/ops/refunds")).status).toBe(403);
  expect((await m.json("POST", `/ops/refunds/${cancelId}/refunded`, {})).status).toBe(403);
});

test("staff see due Refunds with Customer details, mark one refunded once, and the Customer is emailed once", async () => {
  const { w, dup, c, cancelId } = await refunds();
  const staff = await member("staff");
  const { body } = await staff.json("GET", "/ops/refunds");
  const mine = body.due.filter((r: { operatorName: string }) => r.operatorName === "Test Stable");
  expect(mine).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reason: "duplicate",
        amountSen: 10000,
        bookingId: null,
        billId: expect.stringMatching(/^dup_/),
        customer: { name: "Aiman Rahman", email: dup.email, phone: null },
      }),
      expect.objectContaining({
        id: cancelId,
        reason: "cancel",
        amountSen: 10000,
        bookingId: c.bookingId,
        customer: { name: "Aiman Rahman", email: c.email, phone: "+60111111111" },
      }),
    ]),
  );

  const first = await staff.json("POST", `/ops/refunds/${cancelId}/refunded`, {});
  expect(first).toEqual({ status: 200, body: { refundedAt: expect.any(Number) } });
  expect((await staff.json("POST", `/ops/refunds/${cancelId}/refunded`, {})).body).toEqual(first.body);
  expect(devInbox.filter((e) => e.to === c.email && e.subject === "Refund sent: RM 100.00")).toHaveLength(1);
  await w.flush();
  const after = (await staff.json("GET", "/ops/refunds")).body;
  expect(after.refunded).toEqual(expect.arrayContaining([expect.objectContaining({ id: cancelId, refundedAt: first.body.refundedAt })]));
  expect((await staff.json("POST", `/ops/refunds/${rid()}/refunded`, {})).status).toBe(404);
});
