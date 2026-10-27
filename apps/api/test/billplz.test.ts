import { env } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";
import { sign, verified } from "../src/billplz";
import { cron } from "../src/cron";
import { adult, client, d1, dispatch, fake, held, pay, resend, returnPath, world } from "./helpers";

const KEY = "S-s7b4yWpp9h7rrkNM1i3Z_g";

const callbackVector = {
  id: "zq0tm2wc",
  collection_id: "yhx5t1pp",
  paid: "true",
  state: "paid",
  amount: "100",
  paid_amount: "100",
  due_at: "2018-9-27",
  email: "tester@test.com",
  mobile: "",
  name: "TESTER",
  url: "http://www.billplz-sandbox.com/bills/zq0tm2wc",
  paid_at: "2018-09-27 15:15:09 +0800",
};

test("signatures match both Billplz doc vectors", async () => {
  expect(await sign(callbackVector, KEY)).toBe("0fe0a20b8d557eeae570377783d062a3816a9ea80f368860bacfa7ec3ca4d00e");
  expect(
    await sign({ billplzid: "zq0tm2wc", billplzpaid: "true", billplzpaid_at: "2018-09-27 15:15:09 +0800" }, KEY),
  ).toBe("4aab095fe5a39b1d534500988f9a0cb085cd1b6d5bbb55dd4e02ea6fa102b47b");
  expect(
    await verified({ ...callbackVector, x_signature: "0fe0a20b8d557eeae570377783d062a3816a9ea80f368860bacfa7ec3ca4d00e" }, KEY),
  ).toBe(true);
});

async function signedCallback(fields: Record<string, string>) {
  return new URLSearchParams({ ...fields, x_signature: await sign(fields, KEY) });
}

const postCallback = (body: URLSearchParams, e: Partial<Env> = {}) =>
  dispatch(new Request("https://api.test/billplz/callback", { method: "POST", body }), e);

async function paidFields(billId: string, amount: number) {
  return {
    ...callbackVector,
    id: billId,
    collection_id: "col_test",
    amount: String(amount),
    paid_amount: String(amount),
    transaction_status: "completed",
  };
}

const checkoutRow = async (id: string) =>
  (await d1<{ booking_id: string | null; refund_reason: string | null }>("SELECT booking_id, refund_reason FROM checkouts WHERE id = ?", id))[0];

describe("callback", () => {
  test("a tampered field or missing signature is 403 with no state change", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const good = await signedCallback(await paidFields(billId, 10000));
    const tampered = new URLSearchParams(good);
    tampered.set("paid_amount", "1");
    const missing = new URLSearchParams(good);
    missing.delete("x_signature");
    expect((await postCallback(tampered)).status).toBe(403);
    expect((await postCallback(missing)).status).toBe(403);
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: null });
    expect(await w.doSql("SELECT count(*) AS n FROM payments")).toEqual([{ n: 0 }]);
  });

  test("duplicate ×3 and concurrent ×2 callbacks make one Booking", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const body = await signedCallback(await paidFields(billId, 10000));
    const statuses = await Promise.all([postCallback(body), postCallback(body)]);
    for (let i = 0; i < 3; i++) statuses.push(await postCallback(body));
    expect(statuses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await checkoutRow(id)).booking_id).toEqual(expect.any(String));
    expect(await w.doSql("SELECT count(*) AS n FROM bookings")).toEqual([{ n: 1 }]);
    expect(await w.doSql("SELECT count(*) AS n FROM payments")).toEqual([{ n: 1 }]);
  });

  test("paid=false is 200 and changes nothing; an unknown bill is 200", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const unpaid = await signedCallback({ ...(await paidFields(billId, 10000)), paid: "false", state: "due" });
    expect((await postCallback(unpaid)).status).toBe(200);
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: null });
    expect((await postCallback(await signedCallback(await paidFields("nope", 10000)))).status).toBe(200);
  });

  test("a collection mismatch is 403", async () => {
    const res = await postCallback(await signedCallback({ ...(await paidFields("x", 1)), collection_id: "other" }));
    expect(res.status).toBe(403);
  });

  test("an amount mismatch is passed through and becomes refund_due", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const errors = vi.spyOn(console, "error");
    expect((await postCallback(await signedCallback({ ...(await paidFields(billId, 10000)), paid_amount: "9000" }))).status).toBe(200);
    expect(await checkoutRow(id)).toEqual({ booking_id: null, refund_reason: "amount_mismatch" });
    expect(errors.mock.calls.flat().join()).toContain("billplz_amount_mismatch");
  });

  test("idempotency_conflict is logged and answered 200", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    await postCallback(await signedCallback({ ...(await paidFields(billId, 10000)), paid_amount: "9000" }));
    const errors = vi.spyOn(console, "error");
    expect((await postCallback(await signedCallback(await paidFields(billId, 10000)))).status).toBe(200);
    expect(errors.mock.calls.flat().join()).toContain("billplz_idempotency_conflict");
  });

  test("a DO failure is 500, and Billplz's retry succeeds", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const body = await signedCallback(await paidFields(billId, 10000));
    const broken = {
      idFromName: (n: string) => env.BOOKING.idFromName(n),
      get: () => ({
        confirmHold: () => {
          throw new Error("boom");
        },
      }),
    } as unknown as Env["BOOKING"];
    expect((await postCallback(body, { BOOKING: broken })).status).toBe(500);
    expect((await checkoutRow(id)).booking_id).toBeNull();
    expect((await postCallback(body)).status).toBe(200);
    expect((await checkoutRow(id)).booking_id).toEqual(expect.any(String));
  });
});

describe("fake Billplz end to end", () => {
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
    expect((await postCallback(await signedCallback(await paidFields(billId, 10000)))).status).toBe(200);
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

  test("a forged redirect is 403 with no state change", async () => {
    const w = await world();
    const { cl, id } = await held(w);
    const { billId } = await pay(cl, id);
    const res = await cl.call(
      "GET",
      `/billplz/return?billplz[id]=${billId}&billplz[paid]=true&billplz[paid_at]=x&billplz[x_signature]=${"0".repeat(64)}`,
    );
    expect(res.status).toBe(403);
    expect((await checkoutRow(id)).booking_id).toBeNull();
  });
});

test("concurrent Pay creates one bill", async () => {
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
    const r = await dispatch(new Request(`https://api.test/dev/billplz/api/v3/bills/${billId}`, {
      headers: { Authorization: `Basic ${btoa("test-api-key:")}` },
    }));
    expect(r.status).toBe(404);
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
    await postCallback(await signedCallback(await paidFields(billId, 10000)), e);
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
    await postCallback(await signedCallback({ ...(await paidFields(billId, 10000)), paid_amount: "9000" }));
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
    expect(errors.mock.calls.flat().join()).toContain("billplz_refund_due");
    expect((await devMail(`refund:${first.billId}`))?.text).not.toContain("no longer available");
  });

  test("the 30-day purge keeps a Checkout whose bill Billplz never deleted", async () => {
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
