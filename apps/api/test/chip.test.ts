import { env } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";
import { cron } from "../src/cron";
import { fakeSignature } from "../src/dev/chip";
import { adult, client, d1, dispatch, fake, held, pay, resend, returnPath, world } from "./helpers";

const postCallback = (body: string, signature?: string | null, e: Partial<Env> = {}) =>
  dispatch(
    new Request("https://api.test/chip/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature !== null ? { "X-Signature": signature ?? "" } : {}) },
      body,
    }),
    e,
  );

const paidBody = (billId: string, amount: number, o: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: billId,
    brand_id: "brand_test",
    status: "paid",
    event_type: "purchase.paid",
    purchase: { currency: "MYR", total: 10000 },
    payment: { amount, currency: "MYR" },
    ...o,
  });

const signed = async (body: string, e: Partial<Env> = {}) => postCallback(body, await fakeSignature(body), e);

const checkoutRow = async (id: string) =>
  (await d1<{ booking_id: string | null; refund_reason: string | null }>("SELECT booking_id, refund_reason FROM checkouts WHERE id = ?", id))[0];

describe("callback", () => {
  test("a tampered body, missing or forged signature is 403 with no state change", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const good = paidBody(billId, 10000);
    const signature = await fakeSignature(good);
    expect((await postCallback(paidBody(billId, 1), signature)).status).toBe(403);
    expect((await postCallback(good, null)).status).toBe(403);
    expect((await postCallback(good, "not base64!")).status).toBe(403);
    expect((await postCallback(good, btoa("short"))).status).toBe(403);
    expect((await postCallback(good, btoa("x".repeat(256)))).status).toBe(403);
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: null });
    expect(await w.doSql("SELECT count(*) AS n FROM payments")).toEqual([{ n: 0 }]);
  });

  test("duplicate ×3 and concurrent ×2 callbacks make one Booking", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const body = paidBody(billId, 10000);
    const statuses = await Promise.all([signed(body), signed(body)]);
    for (let i = 0; i < 3; i++) statuses.push(await signed(body));
    expect(statuses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await checkoutRow(id)).booking_id).toEqual(expect.any(String));
    expect(await w.doSql("SELECT count(*) AS n FROM bookings")).toEqual([{ n: 1 }]);
    expect(await w.doSql("SELECT count(*) AS n FROM payments")).toEqual([{ n: 1 }]);
  });

  test("an unpaid status is 200 and changes nothing; an unknown CHIP purchase is 200", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    expect((await signed(paidBody(billId, 10000, { status: "error", payment: null }))).status).toBe(200);
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: null });
    expect((await signed(paidBody("nope", 10000))).status).toBe(200);
  });

  test("another brand is 403", async () => {
    expect((await signed(paidBody("x", 1, { brand_id: "other" }))).status).toBe(403);
  });

  test("an amount mismatch is passed through and becomes refund_due", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const errors = vi.spyOn(console, "error");
    expect((await signed(paidBody(billId, 9000))).status).toBe(200);
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: "amount_mismatch" });
    expect(errors.mock.calls.flat().join()).toContain("chip_amount_mismatch");
  });

  test("idempotency_conflict is logged and answered 200", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await signed(paidBody(billId, 9000));
    const errors = vi.spyOn(console, "error");
    expect((await signed(paidBody(billId, 10000))).status).toBe(200);
    expect(errors.mock.calls.flat().join()).toContain("chip_idempotency_conflict");
  });

  test("a DO failure is 500, and CHIP's retry succeeds", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const body = paidBody(billId, 10000);
    const broken = {
      idFromName: (n: string) => env.BOOKING.idFromName(n),
      get: () => ({
        confirmHold: () => {
          throw new Error("boom");
        },
      }),
    } as unknown as Env["BOOKING"];
    expect((await signed(body, { BOOKING: broken })).status).toBe(500);
    expect((await checkoutRow(id)).booking_id).toBeNull();
    expect((await signed(body)).status).toBe(200);
    expect((await checkoutRow(id)).booking_id).toEqual(expect.any(String));
  });
});

describe("fake CHIP end to end", () => {
  test("pay: callback then redirect confirms, and the return gives the Booking and its link key", async () => {
    const w = await world();
    const { cl, id } = await held(w, { quantity: 2, addOns: [] });
    const { billId } = await pay(cl, id);
    const location = await fake(billId, "pay");
    const r = await cl.json("GET", returnPath(location!));
    expect(r.body).toMatchObject({ state: "booked", checkoutId: id, bookingId: expect.any(String), k: expect.any(String) });
    const ticket = await client().json("GET", `/bookings/${r.body.bookingId}?k=${r.body.k}`);
    expect(ticket.status).toBe(200);
    expect(ticket.body.tickets).toHaveLength(2);
    expect((await client().call("GET", `/bookings/${r.body.bookingId}?k=AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });

  test("redirect first (no callback) confirms; the later callback is a no-op", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const location = await fake(billId, "return_no_callback");
    expect((await cl.json("GET", returnPath(location!))).body.state).toBe("booked");
    expect((await signed(paidBody(billId, 10000))).status).toBe(200);
    expect(await w.doSql("SELECT count(*) AS n FROM bookings")).toEqual([{ n: 1 }]);
  });

  test("callback only, pay twice, fail and pending", async () => {
    const w = await world({ horses: 3 });
    const a = await held(w);
    const billA = (await pay(a.cl, a.id)).billId;
    expect(await fake(billA, "pay_no_return")).toBeNull();
    expect((await checkoutRow(a.id)).booking_id).toEqual(expect.any(String));

    const b = await held(w);
    const billB = (await pay(b.cl, b.id)).billId;
    await fake(billB, "pay_twice");
    expect((await checkoutRow(b.id)).booking_id).toEqual(expect.any(String));

    const c = await held(w, { people: [adult("Third Rider")] });
    const billC = (await pay(c.cl, c.id)).billId;
    expect((await c.cl.json("GET", returnPath((await fake(billC, "fail"))!))).body.state).toBe("failed");
    expect((await c.cl.json("GET", returnPath((await fake(billC, "pending"))!))).body.state).toBe("pending");
    expect((await pay(c.cl, c.id)).billId).toBe(billC);
  });

  test("a return for an unpaid CHIP purchase changes nothing; an unknown Hold is 404", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    await pay(cl, id);
    const [{ hold_id }] = await d1<{ hold_id: string }>("SELECT hold_id FROM checkouts WHERE id = ?", id);
    expect((await cl.json("GET", `/chip/return?hold=${hold_id}`)).body).toEqual({ state: "failed", checkoutId: id });
    expect((await checkoutRow(id)).booking_id).toBeNull();
    expect((await cl.call("GET", "/chip/return?hold=nope")).status).toBe(404);
  });
});

test("concurrent Pay creates one CHIP purchase", async () => {
  const w = await world();
  const { cl, id } = await held(w);
  const urls = await Promise.all([pay(cl, id), pay(cl, id), pay(cl, id)]);
  expect(new Set(urls.map((u) => u.url)).size).toBe(1);
  expect(await d1("SELECT count(*) AS n FROM bills WHERE checkout_id = ? AND deleted_at IS NULL", id)).toEqual([{ n: 1 }]);
});

describe("late payment", () => {
  const expire = (w: Awaited<ReturnType<typeof world>>) =>
    w.doSql("UPDATE holds SET created_at = created_at - 3600000, expires_at = created_at - 60000");

  test("on a free Timeslot is booked", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await expire(w);
    await fake(billId, "pay");
    expect((await checkoutRow(id)).booking_id).toEqual(expect.any(String));
  });

  test("on a taken Timeslot is refund_due and emails the refund", async () => {
    const w = await world({ horses: 1 });
    const { cl, id, email } = await held(w);
    const { billId } = await pay(cl, id);
    await expire(w);
    await held(w);
    await fake(billId, "pay");
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: "unavailable" });
    const r = await cl.json("GET", `/checkouts/${id}`);
    expect(r.body.state).toBe("refund_due");
    const { devInbox } = await import("../src/email");
    expect(devInbox.find((e) => e.to === email && e.idempotencyKey === `refund:${billId}`)?.text).toContain(
      `https://web.test/book/${w.optionId}`,
    );
  });
});

describe("cron", () => {
  test("reconciles a paid bill whose callback and redirect were lost", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await fake(billId, "return_no_callback");
    await d1("UPDATE bills SET created_at = created_at - 1800000 WHERE id = ?", billId);
    await cron(env, () => {});
    expect((await checkoutRow(id)).booking_id).toEqual(expect.any(String));
  });

  test("deletes a bill whose Hold expired or was replaced", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await d1("UPDATE checkouts SET hold_expires_at = 1 WHERE id = ?", id);
    await cron(env, () => {});
    expect(await d1("SELECT deleted_at IS NOT NULL AS gone FROM bills WHERE id = ?", billId)).toEqual([{ gone: 1 }]);
    const r = await dispatch(
      new Request(`https://api.test/dev/chip/api/v1/purchases/${billId}/`, { headers: { Authorization: "Bearer test-secret-key" } }),
    );
    expect(((await r.json()) as { status: string }).status).toBe("cancelled");
  });

  test("deletes a stale bill whose CHIP purchase can no longer be cancelled", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await fake(billId, "fail");
    await d1("UPDATE checkouts SET hold_expires_at = 1 WHERE id = ?", id);
    await cron(env, () => {});
    expect(await d1("SELECT deleted_at IS NOT NULL AS gone FROM bills WHERE id = ?", billId)).toEqual([{ gone: 1 }]);
  });

  test("a re-Hold drops the previous Hold's bill", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    expect((await cl.json("POST", `/checkouts/${id}/hold`)).status).toBe(200);
    expect(await d1("SELECT deleted_at IS NOT NULL AS gone FROM bills WHERE id = ?", billId)).toEqual([{ gone: 1 }]);
    expect((await pay(cl, id)).billId).not.toBe(billId);
  });

  test("retries a failed booked email once it succeeds, sending it only once", async () => {
    const e = { EMAIL_MODE: "resend" };
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    resend.fail = 1;
    await signed(paidBody(billId, 10000), e);
    expect(await d1("SELECT emailed_at FROM checkouts WHERE id = ?", id)).toEqual([{ emailed_at: null }]);
    await d1("UPDATE checkouts SET updated_at = updated_at - 300000 WHERE id = ?", id);
    await cron({ ...env, ...e }, () => {});
    await cron({ ...env, ...e }, () => {});
    const booked = resend.calls.filter((c) => c.key === `booked:${id}`);
    expect(booked).toHaveLength(2);
    expect(await d1("SELECT emailed_at IS NOT NULL AS sent FROM checkouts WHERE id = ?", id)).toEqual([{ sent: 1 }]);
  });
});

describe("refunds and stray bills", () => {
  const devMail = async (key: string) => (await import("../src/email")).devInbox.find((e) => e.idempotencyKey === key);

  test("an underpaid bill's refund email states the paid amount and no unavailable time", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await signed(paidBody(billId, 9000));
    const mail = await devMail(`refund:${billId}`);
    expect(mail?.text).toContain("RM 90.00");
    expect(mail?.text).not.toContain("no longer available");
    expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({ state: "refund_due", refundSen: 9000 });
  });

  test("a DO failure on the redirect answers pending, not an error", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const location = (await fake(billId, "return_no_callback"))!;
    const broken = client({
      BOOKING: {
        idFromName: (n: string) => env.BOOKING.idFromName(n),
        get: () => ({
          confirmHold: () => {
            throw new Error("boom");
          },
        }),
      } as unknown as Env["BOOKING"],
    });
    broken.cookie = cl.cookie;
    expect((await broken.json("GET", returnPath(location))).body).toEqual({ state: "pending", checkoutId: id });
  });

  test("a bill paid after its Hold was replaced books the replacement", async () => {
    const w = await world({ horses: 1 });
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const location = (await fake(billId, "return_no_callback"))!;
    expect((await cl.json("POST", `/checkouts/${id}/hold`)).body).toEqual({ next: "pay" });
    expect((await cl.json("GET", returnPath(location))).body.state).toBe("booked");
    expect(await w.doSql("SELECT count(*) AS n FROM bookings")).toEqual([{ n: 1 }]);
  });

  test("a second bill paid on a booked Checkout is refunded, emailed and logged", async () => {
    const w = await world({ horses: 2 });
    const { cl, id } = await held(w);
    const first = await pay(cl, id);
    const late = (await fake(first.billId, "return_no_callback"))!;
    await cl.json("POST", `/checkouts/${id}/hold`);
    const second = await pay(cl, id);
    await fake(second.billId, "pay");
    const bookingId = (await checkoutRow(id)).booking_id;
    expect(bookingId).toEqual(expect.any(String));

    const errors = vi.spyOn(console, "error");
    expect((await cl.json("GET", returnPath(late))).body).toMatchObject({ state: "booked", bookingId });
    expect(await checkoutRow(id)).toEqual({ booking_id: bookingId, refund_reason: null });
    expect(await d1("SELECT refund_reason FROM bills WHERE id = ?", first.billId)).toEqual([{ refund_reason: "unavailable" }]);
    expect(errors.mock.calls.flat().join()).toContain("chip_refund_due");
    expect((await devMail(`refund:${first.billId}`))?.text).not.toContain("no longer available");
  });

  test("the 30-day purge keeps a Checkout whose CHIP purchase was never cancelled", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await fake(billId, "return_no_callback");
    const old = Date.now() - 31 * 86_400_000;
    await d1("UPDATE checkouts SET created_at = ?, hold_expires_at = 1 WHERE id = ?", old, id);
    await d1("UPDATE bills SET created_at = ? WHERE id = ?", old, billId);
    await cron(env, () => {});
    expect(await d1("SELECT count(*) AS n FROM checkouts WHERE id = ?", id)).toEqual([{ n: 1 }]);
    expect(await d1("SELECT deleted_at FROM bills WHERE id = ?", billId)).toEqual([{ deleted_at: null }]);
  });
});
