import { operatorContacts, whatsappMessages } from "@komugo/db";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { devOutbox } from "../src/whatsapp";
import { booked, d1, db, kl, member, rid, world } from "./helpers";

const phone = () => `+6019${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const sent = (c: { phone: string }) => devOutbox.filter((m) => m.to === c.phone).map((m) => m.text);

test("marking a Payout paid sends one Payout notice to each owner in their language, never to counter contacts", async () => {
  const w = await world();
  const staff = await member("staff");
  await staff.json("PUT", `/ops/operators/${w.operatorId}/commission`, { commissionBps: 1000 });
  const b = await booked(w, [{ name: "Ali" }]);
  await w.flush();
  await d1("UPDATE proj_payments SET received_at = ? WHERE booking_id = ?", kl("2025-03-15T12:00"), b.bookingId);
  const [counter, ownerEn, ownerMs] = await db
    .insert(operatorContacts)
    .values([
      { operatorId: w.operatorId, name: "Siti", phone: phone(), role: "counter", locale: "en", createdAt: Date.now() },
      { operatorId: w.operatorId, name: "Ahmad", phone: phone(), role: "owner", locale: "en", createdAt: Date.now() },
      { operatorId: w.operatorId, name: "Aminah", phone: phone(), role: "owner", locale: "ms", createdAt: Date.now() },
    ])
    .returning();

  const url = `/ops/payouts/${w.operatorId}/2025-03/paid`;
  expect((await staff.json("POST", url, { amountSen: 9000 })).status).toBe(200);
  expect((await staff.json("POST", url, { amountSen: 9000 })).status).toBe(200);

  expect(sent(counter)).toEqual([]);
  expect(sent(ownerEn)).toEqual(["Test Stable: Payout for March 2025\n\nSales: RM 100.00\nCommission: RM 10.00\nRefunds: RM 0.00\nAmount paid: RM 90.00"]);
  expect(sent(ownerMs)).toEqual([
    "Test Stable: Bayaran pengendali untuk Mac 2025\n\nJualan: RM 100.00\nKomisen: RM 10.00\nBayaran balik: RM 0.00\nAmaun dibayar: RM 90.00",
  ]);
  expect(await db.select().from(whatsappMessages).where(eq(whatsappMessages.contactId, ownerEn.id))).toMatchObject([{ template: "payout", status: "sent" }]);
});

test("a Payout notice shows what was carried from a negative month", async () => {
  const w = await world({ horses: 2 });
  const staff = await member("staff");
  await staff.json("PUT", `/ops/operators/${w.operatorId}/commission`, { commissionBps: 1000 });
  const cancelled = await booked(w, [{ name: "Ali" }]);
  await booked(w, [{ name: "Abu" }]);
  await w.b.cancelTickets({
    requestId: rid(),
    customerId: cancelled.customerId,
    group: { bookingId: cancelled.bookingId },
    ticketIds: cancelled.ticketIds,
    onlyClosed: false,
    expectSen: 10000,
    expectForfeited: [],
  });
  await w.flush();
  await d1("UPDATE proj_payments SET received_at = ? WHERE operator_id = ?", kl("2025-03-15T12:00"), w.operatorId);
  await d1("UPDATE proj_refunds SET created_at = ? WHERE operator_id = ?", kl("2025-02-15T12:00"), w.operatorId);
  const [owner] = await db
    .insert(operatorContacts)
    .values({ operatorId: w.operatorId, name: "Ahmad", phone: phone(), role: "owner", locale: "en", createdAt: Date.now() })
    .returning();

  expect((await staff.json("POST", `/ops/payouts/${w.operatorId}/2025-03/paid`, { amountSen: 9000 })).status).toBe(200);
  expect(sent(owner)).toEqual([
    "Test Stable: Payout for March 2025\n\nSales: RM 200.00\nCommission: RM 20.00\nRefunds: RM 0.00\nCarried from last month: RM -90.00\nAmount paid: RM 90.00",
  ]);
});
