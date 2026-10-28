import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { cron } from "../src/cron";
import { devInbox } from "../src/email";
import { adult, client, d1, db, member, otpCode, rid, start, world } from "./helpers";
import { members } from "@komugo/db";

describe("ops Sign-in", () => {
  test("an unknown email gets 204 and no email", async () => {
    const email = `${rid()}@example.com`;
    expect((await client().call("POST", "/ops/auth/otp", { email })).status).toBe(204);
    expect(devInbox.some((e) => e.to === email)).toBe(false);
  });

  test("strangers and Checkout codes can't use up a Member's Sign-in quota, and a capped Member looks unknown", async () => {
    const email = `${rid()}@example.com`;
    await db.insert(members).values({ email, name: "Nur", role: "staff" });
    const attacker = client();
    const seed = (ip: string | null, checkoutId: string | null) =>
      d1("INSERT INTO otps (id, email, checkout_id, ip, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, 'x', ?, ?)", rid(), email, checkoutId, ip, Date.now(), Date.now() + 60_000);
    for (let i = 0; i < 10; i++) await seed("1.2.3.4", null);
    for (let i = 0; i < 10; i++) await seed(null, rid());
    expect((await attacker.call("POST", "/ops/auth/otp", { email }, { "x-client-ip": "1.2.3.4" })).status).toBe(204);
    expect(devInbox.some((e) => e.to === email)).toBe(false);
    const cl = client();
    expect((await cl.call("POST", "/ops/auth/otp", { email })).status).toBe(204);
    expect((await cl.json("POST", "/ops/auth/otp/verify", { email, code: otpCode(email) })).status).toBe(200);
  });

  test("a Member signs in with a code; staff see every Operator, an operator Member only theirs", async () => {
    const a = await world();
    const b = await world();
    const email = `${rid()}@example.com`;
    await db.insert(members).values({ email, name: "Nur", role: "operator", operatorId: a.operatorId });
    const cl = client();
    expect((await cl.call("POST", "/ops/auth/otp", { email: ` ${email.toUpperCase()} ` })).status).toBe(204);
    const res = await cl.call("POST", "/ops/auth/otp/verify", { email, code: otpCode(email) });
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-ops=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
    expect(await res.json()).toEqual({ member: { email, name: "Nur", role: "operator" } });
    expect((await cl.json("GET", "/ops/me")).body).toEqual({
      member: { email, name: "Nur", role: "operator" },
      operators: [{ id: a.operatorId, name: "Test Stable" }],
    });

    const staff = await member("staff");
    const { body } = await staff.json<{ operators: { id: string }[] }>("GET", "/ops/me");
    expect(body.operators.map((o) => o.id)).toEqual(expect.arrayContaining([a.operatorId, b.operatorId]));
  });

  test("a Customer code can't sign in a Member, and a Member code can't sign in a Customer", async () => {
    const w = await world();
    const email = `${rid()}@example.com`;
    await db.insert(members).values({ email, name: "Nur", role: "staff" });
    const guest = client();
    const id = await start(guest, w);
    await guest.json("PUT", `/checkouts/${id}/who`, { participants: [adult()] });
    expect((await guest.call("POST", "/auth/otp", { checkoutId: id, name: "Nur", email })).status).toBe(204);
    expect((await client().json("POST", "/ops/auth/otp/verify", { email, code: otpCode(email) })).body).toMatchObject({
      code: "otp_expired",
    });

    const staff = await member("staff");
    const other = client();
    const id2 = await start(other, w);
    await other.json("PUT", `/checkouts/${id2}/who`, { participants: [adult()] });
    await d1("UPDATE checkouts SET contact_email = ? WHERE id = ?", staff.email, id2);
    expect(
      (await other.json("POST", "/auth/otp/verify", { checkoutId: id2, email: staff.email, code: otpCode(staff.email) })).body,
    ).toMatchObject({ code: "otp_expired" });
  });

  test("a Customer session alone, an expired session and a logged-out session are signed_out", async () => {
    const w = await world();
    const guest = client();
    await start(guest, w);
    expect(guest.cookie).toMatch(/^__Host-sid=/);
    expect(await guest.json("GET", "/ops/me")).toEqual({ status: 401, body: { code: "signed_out" } });

    const expired = await member("staff");
    await d1("UPDATE member_sessions SET expires_at = 1 WHERE member_id = (SELECT id FROM members WHERE email = ?)", expired.email);
    expect((await expired.call("GET", "/ops/me")).status).toBe(401);

    const out = await member("staff");
    const before = out.cookie;
    expect((await out.call("POST", "/ops/auth/logout")).headers.get("set-cookie")).toContain("__Host-ops=; HttpOnly");
    out.cookie = before;
    expect((await out.call("GET", "/ops/me")).status).toBe(401);
  });

  test("a non-JSON write is 415", async () => {
    const w = await world();
    const m = await member("operator", w.operatorId);
    const res = await m.call("POST", `/ops/operators/${w.operatorId}/timeslots`, undefined, { "content-type": "text/plain" });
    expect(res.status).toBe(415);
  });

  test("cron deletes only expired member sessions", async () => {
    const live = await member("staff");
    const old = await member("staff");
    const sessionOf = (email: string) =>
      d1("SELECT count(*) AS n FROM member_sessions WHERE member_id = (SELECT id FROM members WHERE email = ?)", email);
    await d1("UPDATE member_sessions SET expires_at = 1 WHERE member_id = (SELECT id FROM members WHERE email = ?)", old.email);
    await cron(env, () => {});
    expect(await sessionOf(old.email)).toEqual([{ n: 0 }]);
    expect(await sessionOf(live.email)).toEqual([{ n: 1 }]);
  });
});
