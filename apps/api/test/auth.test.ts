import { describe, expect, test } from "vitest";
import { adult, client, d1, otpCode, resend, rid, start, world } from "./helpers";

async function guest() {
  const w = await world();
  const cl = client();
  const id = await start(cl, w);
  expect((await cl.json("PUT", `/checkouts/${id}/who`, { participants: [adult()] })).status).toBe(200);
  return { w, cl, id, email: `${rid()}@example.com` };
}

const send = (g: Awaited<ReturnType<typeof guest>>, email = g.email) =>
  g.cl.call("POST", "/auth/otp", { checkoutId: g.id, name: "Aiman", email, phone: "+60 12-345 6789" });
const verify = (g: Awaited<ReturnType<typeof guest>>, code: string) =>
  g.cl.json("POST", "/auth/otp/verify", { checkoutId: g.id, email: g.email, code });

describe("OTP", () => {
  test("send is 204 for any email, new or known", async () => {
    const known = await guest();
    await d1("INSERT INTO customers (id, name, email) VALUES (?, 'Known', ?)", rid(), known.email);
    expect((await send(known)).status).toBe(204);
    const fresh = await guest();
    expect((await send(fresh)).status).toBe(204);
  });

  test("a second send within 60 s and the sixth in an hour are rate_limited", async () => {
    const g = await guest();
    expect((await send(g)).status).toBe(204);
    expect(await (await send(g)).json()).toEqual({ code: "rate_limited" });

    const h = await guest();
    for (let i = 0; i < 5; i++) {
      await d1("INSERT INTO otps (id, email, code_hash, created_at, expires_at) VALUES (?, ?, 'x', ?, ?)", rid(), h.email, Date.now(), Date.now());
    }
    expect((await send(h)).status).toBe(429);
  });

  test("the eleventh send in a day is rate_limited", async () => {
    const g = await guest();
    for (let i = 0; i < 10; i++) {
      const at = Date.now() - 2 * 3_600_000;
      await d1("INSERT INTO otps (id, email, code_hash, created_at, expires_at) VALUES (?, ?, 'x', ?, ?)", rid(), g.email, at, at);
    }
    expect((await send(g)).status).toBe(429);
  });

  test("a code sent from another Checkout neither replaces nor unlocks this one", async () => {
    const g = await guest();
    await send(g);
    const attacker = await guest();
    await d1(
      "INSERT INTO otps (id, email, checkout_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, 'x', ?, ?)",
      rid(),
      g.email,
      attacker.id,
      Date.now() + 1000,
      Date.now() + 600_000,
    );
    expect((await verify(g, otpCode(g.email))).status).toBe(200);
  });

  test("a failed send is 503 email_failed", async () => {
    const g = await guest();
    const failing = client({ EMAIL_MODE: "resend" });
    failing.cookie = g.cl.cookie;
    resend.fail = 1;
    expect(await failing.json("POST", "/auth/otp", { checkoutId: g.id, name: "Aiman", email: g.email })).toEqual({
      status: 503,
      body: { code: "email_failed" },
    });
  });

  test("an expired code is otp_expired", async () => {
    const g = await guest();
    await send(g);
    await d1("UPDATE otps SET expires_at = 1 WHERE email = ?", g.email);
    expect((await verify(g, otpCode(g.email))).body).toMatchObject({ code: "otp_expired" });
  });

  test("five wrong tries burn the code", async () => {
    const g = await guest();
    await send(g);
    const left = [];
    for (let i = 0; i < 5; i++) left.push((await verify(g, "000000")).body);
    expect(left.map((b) => b.params?.triesLeft ?? b.code)).toEqual([4, 3, 2, 1, "otp_expired"]);
    expect((await verify(g, otpCode(g.email))).body).toMatchObject({ code: "otp_expired" });
  });

  test("a code is single use under a race", async () => {
    const g = await guest();
    await send(g);
    const code = otpCode(g.email);
    const results = await Promise.all([verify(g, code), verify(g, code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
});

describe("session", () => {
  test("cookie flags, rotation on verify, and logout", async () => {
    const w = await world();
    const cl = client();
    const res = await cl.call("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 1, addOns: [] });
    expect(res.headers.get("set-cookie")).toMatch(
      /^__Host-sid=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/,
    );
    const { id } = (await res.json()) as { id: string };
    await cl.json("PUT", `/checkouts/${id}/who`, { participants: [adult()] });
    const email = `${rid()}@example.com`;
    await cl.call("POST", "/auth/otp", { checkoutId: id, name: "Aiman", email });
    const before = cl.cookie;
    const v = await cl.json("POST", "/auth/otp/verify", { checkoutId: id, email, code: otpCode(email) });
    expect(v).toEqual({ status: 200, body: { next: "pay" } });
    expect(cl.cookie).not.toBe(before);

    const stale = client();
    stale.cookie = before;
    expect((await stale.call("GET", `/checkouts/${id}`)).status).toBe(404);
    expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({ signedIn: true, state: "held" });

    expect((await cl.call("POST", "/auth/logout")).headers.get("set-cookie")).toContain("Max-Age=0");
    expect(cl.cookie).toBe("");
    expect((await cl.call("GET", `/checkouts/${id}`)).status).toBe(404);
  });

  test("another session gets 404 for a Checkout it does not own", async () => {
    const g = await guest();
    const other = client();
    await start(other, g.w);
    expect((await other.call("GET", `/checkouts/${g.id}`)).status).toBe(404);
    expect((await other.call("PUT", `/checkouts/${g.id}/who`, { participants: [adult()] })).status).toBe(404);
    expect((await other.call("POST", `/checkouts/${g.id}/pay`)).status).toBe(404);
  });
});
