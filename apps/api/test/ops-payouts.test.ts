import { expect, test } from "vitest";
import { booked, boughtPack, customer, d1, kl, member, packOffer, rid, world, type World } from "./helpers";

const setRate = (staff: Awaited<ReturnType<typeof member>>, w: World, commissionBps: number) =>
  staff.json("PUT", `/ops/operators/${w.operatorId}/commission`, { commissionBps });

// March: one Booking at 10%. April: a Booking with an Add-on and a Pack at 20%, the March Booking cancelled,
// and a duplicate payment (not a sale) refunded.
async function sales() {
  const w = await world({ horses: 3 });
  const staff = await member("staff");
  await setRate(staff, w, 1000);
  const march = await booked(w, [{ name: "Ali" }]);
  await setRate(staff, w, 2000);
  const april = await booked(w, [{ name: "Abu" }], { addOns: [{ id: w.helmetId, qty: 1 }] });
  const offer = await packOffer(w);
  const packId = await boughtPack(w, (await customer()).id, offer.id);
  await w.b.confirmHold({ billId: `dup_${rid()}`, holdId: april.holdId, amountSen: 10500 });
  await w.b.cancelTickets({
    requestId: rid(),
    customerId: march.customerId,
    group: { bookingId: march.bookingId },
    ticketIds: march.ticketIds,
    onlyClosed: false,
    expectSen: 10000,
    expectForfeited: [],
  });
  await w.flush();
  const shift = (table: string, col: string, at: number, where: string, ...p: unknown[]) =>
    d1(`UPDATE ${table} SET ${col} = ? WHERE operator_id = ? AND ${where}`, at, w.operatorId, ...p);
  await shift("proj_payments", "received_at", kl("2025-03-31T23:30"), "booking_id = ?", march.bookingId);
  await shift("proj_payments", "received_at", kl("2025-04-01T00:30"), "booking_id IS NOT ?", march.bookingId);
  await shift("proj_packs", "created_at", kl("2025-04-10T12:00"), "id = ?", packId);
  await shift("proj_refunds", "created_at", kl("2025-04-02T12:00"), "true");
  return { w, staff, march, april, packId };
}

const mine = <T extends { operatorId: string }>(w: World, rows: T[]) => rows.filter((r) => r.operatorId === w.operatorId);

test("each sale keeps the Commission rate in force when it was paid", async () => {
  const { w, staff, march, april, packId } = await sales();
  const before = (await staff.json("GET", "/ops/payouts")).body;
  await setRate(staff, w, 5000);
  await booked(w, [{ name: "Siti" }]);
  await w.flush();

  expect(await d1("SELECT commission_bps FROM proj_tickets WHERE booking_id = ?", march.bookingId)).toEqual([{ commission_bps: 1000 }]);
  expect(await d1("SELECT commission_bps FROM proj_tickets WHERE booking_id = ?", april.bookingId)).toEqual([{ commission_bps: 2000 }]);
  expect(await d1("SELECT price_sen, commission_bps FROM proj_packs WHERE id = ?", packId)).toEqual([{ price_sen: 25000, commission_bps: 2000 }]);
  expect(mine(w, (await staff.json("GET", "/ops/payouts")).body.due)).toEqual(mine(w, before.due));
});

test("a month's Payout is sales less Commission and Refunds, counting Pack sales and only Refunds of sales", async () => {
  const { w, staff } = await sales();
  const { body } = await staff.json("GET", "/ops/payouts");
  expect(mine(w, body.due)).toEqual([
    {
      operatorId: w.operatorId,
      operatorName: "Test Stable",
      month: "2025-03",
      salesSen: 10000,
      commissionSen: 1000,
      refundsSen: 0,
      amountSen: 9000,
      paidSen: null,
      paidAt: null,
    },
    {
      operatorId: w.operatorId,
      operatorName: "Test Stable",
      month: "2025-04",
      salesSen: 35500,
      commissionSen: 7100,
      refundsSen: 10000,
      amountSen: 18400,
      paidSen: null,
      paidAt: null,
    },
  ]);
});

test("marking a Payout paid is staff-only, checks the amount and is idempotent", async () => {
  const { w, staff } = await sales();
  const url = `/ops/payouts/${w.operatorId}/2025-03/paid`;
  const own = await member("operator", w.operatorId);
  expect((await own.json("GET", "/ops/payouts")).status).toBe(403);
  expect((await own.json("POST", url, { amountSen: 9000 })).status).toBe(403);

  expect((await staff.json("POST", url, { amountSen: 8000 })).body).toEqual({ code: "amount_changed" });
  const first = await staff.json("POST", url, { amountSen: 9000 });
  expect(first).toEqual({ status: 200, body: { amountSen: 9000, paidAt: expect.any(Number) } });
  expect(await staff.json("POST", url, { amountSen: 9000 })).toEqual(first);
  expect(await d1("SELECT count(*) AS n FROM payouts WHERE operator_id = ?", w.operatorId)).toEqual([{ n: 1 }]);

  const { body } = await staff.json("GET", "/ops/payouts");
  expect(mine<{ operatorId: string; month: string }>(w, body.due).map((r) => r.month)).toEqual(["2025-04"]);
  expect(mine(w, body.paid)).toEqual([expect.objectContaining({ month: "2025-03", amountSen: 9000, paidSen: 9000, paidAt: first.body.paidAt })]);

  const current = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
  expect((await staff.json("POST", `/ops/payouts/${w.operatorId}/${current}/paid`, { amountSen: 0 })).status).toBe(404);
  expect((await staff.json("POST", `/ops/payouts/${w.operatorId}/2025-13/paid`, { amountSen: 0 })).status).toBe(400);
});
