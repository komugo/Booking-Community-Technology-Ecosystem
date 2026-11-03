import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { sendRefund } from "../src/chip";
import { devInbox } from "../src/email";
import { booked, d1, dispatch, fake, held, member, pay, rid, signedIn, world, type World } from "./helpers";

const refundable = async (billId: string) => {
  const res = await dispatch(
    new Request(`https://api.test/dev/chip/api/v1/purchases/${billId}/`, {
      headers: { Authorization: "Bearer test-secret-key" },
    }),
  );
  return ((await res.json()) as { refundable_amount: number }).refundable_amount;
};

const sent = (email: string) => devInbox.filter((e) => e.to === email && e.subject.startsWith("Refund sent"));

async function cancelOne(w: World, o: { refunds?: "refuse" | "lost" } = {}) {
  const b = await booked(w, [{ name: "Rider 0" }, { name: "Rider 1" }], {
    addOns: [{ id: w.helmetId, qty: 1 }],
    ...o,
  });
  await w.flush();
  const owner = await signedIn(b.email);
  const r = await owner.json("POST", `/bookings/${b.bookingId}/cancel`, {
    requestId: rid(),
    t: b.ticketIds[0],
    expectSen: 10250,
    expectForfeited: [],
  });
  expect(r.status).toBe(200);
  await w.flush();
  return { b, refundId: r.body.refund.id as string };
}

const refundRow = async (w: World, id: string) => (await w.doSql("SELECT refunded_at, refunded_by FROM refunds WHERE id = ?", id))[0];

test("cancelling one Ticket of a multi-Ticket Booking refunds just its share through CHIP and marks it sent", async () => {
  const w = await world({ horses: 3 });
  const { b, refundId } = await cancelOne(w);
  expect(await refundable(b.billId)).toBe(20500 - 10250);
  expect(await refundRow(w, refundId)).toEqual({
    refunded_at: expect.any(Number),
    refunded_by: "chip",
  });
  expect(sent(b.email).map((e) => e.subject)).toEqual(["Refund sent: RM 102.50"]);
  const staff = await member("staff");
  const { body } = await staff.json("GET", "/ops/refunds");
  expect(body.due.find((r: { id: string }) => r.id === refundId)).toBeUndefined();
  expect(body.refunded.find((r: { id: string }) => r.id === refundId)).toMatchObject({ chip: { state: "sent", error: null } });
});

test("a CHIP refusal leaves the Refund due with the error, retrying stays safe, and staff can still pay by hand", async () => {
  const w = await world({ horses: 3 });
  const { b, refundId } = await cancelOne(w, { refunds: "refuse" });
  expect(await refundable(b.billId)).toBe(20500);
  expect(await refundRow(w, refundId)).toEqual({
    refunded_at: null,
    refunded_by: null,
  });
  const staff = await member("staff");
  const due = async () => (await staff.json("GET", "/ops/refunds")).body.due.find((r: { id: string }) => r.id === refundId);
  expect(await due()).toMatchObject({
    chip: {
      state: "failed",
      error: expect.stringContaining("purchase_refund_error"),
    },
  });
  expect((await staff.json("POST", `/ops/refunds/${refundId}/send`, {})).body).toEqual({ status: "failed" });
  expect(await due()).toMatchObject({ chip: { state: "failed" } });
  expect(sent(b.email)).toHaveLength(0);
  expect((await staff.json("POST", `/ops/refunds/${refundId}/refunded`, {})).status).toBe(200);
  expect(sent(b.email)).toHaveLength(1);
  expect((await staff.json("POST", `/ops/refunds/${refundId}/send`, {})).body).toEqual({ status: "already_refunded" });
  expect(await refundable(b.billId)).toBe(20500);
});

test("a Refund due before CHIP refunds is sent from Refunds to pay, and double or concurrent triggers refund once", async () => {
  const w = await world({ horses: 3 });
  const b = await booked(w, [{ name: "Rider 0" }]);
  const r = await w.b.cancelTickets({
    requestId: rid(),
    customerId: b.customerId,
    group: { bookingId: b.bookingId },
    ticketIds: b.ticketIds,
    onlyClosed: false,
    expectSen: 10000,
    expectForfeited: [],
  });
  const refundId = r.refund!.id;
  await w.flush();
  const staff = await member("staff");
  expect((await staff.json("GET", "/ops/refunds")).body.due.find((x: { id: string }) => x.id === refundId)).toMatchObject({ chip: null });

  const results = await Promise.all([
    staff.json("POST", `/ops/refunds/${refundId}/send`, {}),
    staff.json("POST", `/ops/refunds/${refundId}/send`, {}),
    sendRefund(env, w.operatorId, refundId),
    sendRefund(env, w.operatorId, refundId),
  ]);
  expect(results.map((x) => (typeof x === "string" ? x : x.body.status))).toContain("sent");
  expect(await refundable(b.billId)).toBe(0);
  expect(await sendRefund(env, w.operatorId, refundId)).toBe("already_refunded");
  expect((await staff.json("POST", `/ops/refunds/${refundId}/send`, {})).body).toEqual({ status: "already_refunded" });
  expect(await refundable(b.billId)).toBe(0);
  expect(sent(b.email)).toHaveLength(1);
  expect(await d1("SELECT error FROM refund_sends WHERE refund_id = ?", refundId)).toEqual([{ error: null }]);
});

test("a refund_due Payment is refunded in full through CHIP", async () => {
  const w = await world({ horses: 1 });
  const { cl, id, email } = await held(w);
  const { billId } = await pay(cl, id);
  await w.doSql("UPDATE holds SET created_at = created_at - 3600000, expires_at = created_at - 60000");
  await held(w);
  await fake(billId, "pay");
  expect((await cl.json("GET", `/checkouts/${id}`)).body.state).toBe("refund_due");
  expect(await refundable(billId)).toBe(0);
  expect(await refundRow(w, `bill:${billId}`)).toEqual({
    refunded_at: expect.any(Number),
    refunded_by: "chip",
  });
  expect(sent(email)).toHaveLength(1);
});

test("a hand payment and a CHIP send block each other", async () => {
  const w = await world({ horses: 3 });
  const { b, refundId } = await cancelOne(w, { refunds: "refuse" });
  const staff = await member("staff");
  await d1("UPDATE refund_sends SET error = NULL, claimed_at = ? WHERE refund_id = ?", Date.now(), refundId);
  const marked = await staff.json("POST", `/ops/refunds/${refundId}/refunded`, {});
  expect(marked.status).toBe(409);
  expect(marked.body.code).toBe("refund_sending");
  expect(await refundRow(w, refundId)).toEqual({
    refunded_at: null,
    refunded_by: null,
  });

  await d1("UPDATE refund_sends SET error = 'refused' WHERE refund_id = ?", refundId);
  expect((await staff.json("POST", `/ops/refunds/${refundId}/refunded`, {})).status).toBe(200);
  expect(await sendRefund(env, w.operatorId, refundId)).toBe("already_refunded");
  expect(await refundable(b.billId)).toBe(20500);
});

test("a send whose answer was lost is never retried and staff resolve it by hand once stale", async () => {
  const w = await world({ horses: 3 });
  const { b, refundId } = await cancelOne(w, { refunds: "lost" });
  expect(await refundable(b.billId)).toBe(20500 - 10250);
  expect(await refundRow(w, refundId)).toEqual({
    refunded_at: null,
    refunded_by: null,
  });
  const staff = await member("staff");
  const due = async () => (await staff.json("GET", "/ops/refunds")).body.due.find((r: { id: string }) => r.id === refundId);
  expect(await due()).toMatchObject({
    chip: { state: "sending", error: null },
  });
  expect((await staff.json("POST", `/ops/refunds/${refundId}/send`, {})).body).toEqual({ status: "sending" });
  expect((await staff.json("POST", `/ops/refunds/${refundId}/refunded`, {})).status).toBe(409);
  expect(await refundable(b.billId)).toBe(20500 - 10250);

  await d1("UPDATE refund_sends SET claimed_at = claimed_at - 600000 WHERE refund_id = ?", refundId);
  expect(await due()).toMatchObject({ chip: { state: "unknown" } });
  expect((await staff.json("POST", `/ops/refunds/${refundId}/send`, {})).body).toEqual({ status: "sending" });
  expect((await staff.json("POST", `/ops/refunds/${refundId}/refunded`, {})).status).toBe(200);
  expect(await refundable(b.billId)).toBe(20500 - 10250);
});
