import { checkouts, createDb, customers, otps } from "@komugo/db";
import { Hono } from "hono";
import { and, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { holdReply, holdStep, ownedCheckout, persistDraft } from "./checkout";
import { otpEmail, sendEmail } from "./email";
import type { Locale } from "./details";
import { DAY, emailRef, fail, HOUR, hmacHex, limited, log, logError, MIN, safeEqual, type Ctx } from "./lib";
import { endSession, rotateSession } from "./session";

const OTP_TTL = 10 * MIN;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const MAX_SENDS_PER_DAY = 10;

export const normEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const codeHash = (env: Env, email: string, code: string) => hmacHex(env.APP_SECRET, `otp:${email}:${code}`);
export const clientIp = (c: Ctx) => c.req.header("x-client-ip") ?? "unknown";
export const ipLimited = (c: Ctx) => limited(c.env.RL_IP, `otp:${clientIp(c)}`);

export async function sendOtp(
  c: Ctx,
  email: string,
  checkoutId: string | null,
  locale: Locale,
  also: BatchItem<"sqlite">[] = [],
): Promise<Response | null> {
  const db = createDb(c.env.DB);
  const now = Date.now();
  const ip = checkoutId ? null : clientIp(c);
  const [{ hour, day }] = await db
    .select({ hour: sql<number>`count(*) FILTER (WHERE ${otps.createdAt} > ${now - HOUR})`, day: count() })
    .from(otps)
    .where(
      and(
        eq(otps.email, email),
        gt(otps.createdAt, now - DAY),
        ip ? and(isNull(otps.checkoutId), eq(otps.ip, ip)) : isNotNull(otps.checkoutId),
      ),
    );
  if (hour >= MAX_SENDS_PER_HOUR || day >= MAX_SENDS_PER_DAY) return fail(c, 429, { code: "rate_limited" });

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await db.batch([
    db.insert(otps).values({
      email,
      checkoutId,
      ip,
      codeHash: await codeHash(c.env, email, code),
      createdAt: now,
      expiresAt: now + OTP_TTL,
    }),
    ...also,
  ]);
  const ref = await emailRef(email);
  try {
    await sendEmail(c.env, otpEmail(email, code, locale));
  } catch (e) {
    logError("otp_email_failed", { email: ref, error: String(e) });
    return fail(c, 503, { code: "email_failed" });
  }
  log("otp_sent", { email: ref, checkoutId });
  return null;
}

export async function consumeOtp(c: Ctx, email: string, checkoutId: string | null, code: string): Promise<Response | null> {
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `UPDATE otps SET attempts = attempts + 1
     WHERE id = (SELECT id FROM otps WHERE email = ? AND checkout_id IS ? ORDER BY created_at DESC LIMIT 1)
       AND attempts < ? AND used_at IS NULL AND expires_at > ?
     RETURNING id, code_hash, attempts`,
  )
    .bind(email, checkoutId, MAX_ATTEMPTS, now)
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!row) return fail(c, 400, { code: "otp_expired", field: "code" });
  if (!safeEqual(await codeHash(c.env, email, code), row.code_hash)) {
    const triesLeft = MAX_ATTEMPTS - row.attempts;
    return triesLeft > 0
      ? fail(c, 400, { code: "otp_invalid", field: "code", params: { triesLeft } })
      : fail(c, 400, { code: "otp_expired", field: "code" });
  }
  const used = await c.env.DB.prepare("UPDATE otps SET used_at = ? WHERE id = ? AND used_at IS NULL RETURNING id")
    .bind(now, row.id)
    .first();
  return used ? null : fail(c, 400, { code: "otp_expired", field: "code" });
}

export const auth = new Hono<{ Bindings: Env }>();

auth.post("/otp", async (c) => {
  const body = await c.req.json<{ checkoutId?: unknown; name?: unknown; email?: unknown; phone?: unknown }>();
  if (await ipLimited(c)) return fail(c, 429, { code: "rate_limited" });
  const owned = await ownedCheckout(c, String(body.checkoutId ?? ""));
  if (!owned) return fail(c, 404, { code: "not_found" });
  if (owned.checkout.customerId) return fail(c, 409, { code: "invalid_state" });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const email = normEmail(body.email);
  const phone = typeof body.phone === "string" ? body.phone.replace(/[\s-]/g, "") : "";
  const errors = [
    ...(name ? [] : [{ code: "name_required", field: "name" }]),
    ...(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [] : [{ code: "email_invalid", field: "email" }]),
    ...(!phone || /^\+?\d{8,15}$/.test(phone) ? [] : [{ code: "phone_invalid", field: "phone" }]),
  ];
  if (errors.length) return fail(c, 400, errors[0], errors);

  if (await limited(c.env.RL_OTP_EMAIL, email)) return fail(c, 429, { code: "rate_limited" });
  const db = createDb(c.env.DB);
  const contact = db
    .update(checkouts)
    .set({ contactName: name, contactEmail: email, contactPhone: phone || null, updatedAt: Date.now() })
    .where(eq(checkouts.id, owned.checkout.id));
  return (await sendOtp(c, email, owned.checkout.id, owned.checkout.locale, [contact])) ?? c.body(null, 204);
});

auth.post("/otp/verify", async (c) => {
  const body = await c.req.json<{ checkoutId?: unknown; email?: unknown; code?: unknown }>();
  if (await ipLimited(c)) return fail(c, 429, { code: "rate_limited" });
  const owned = await ownedCheckout(c, String(body.checkoutId ?? ""));
  if (!owned) return fail(c, 404, { code: "not_found" });
  const { checkout, session } = owned;
  if (checkout.customerId) return fail(c, 409, { code: "invalid_state" });
  const email = normEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || email !== checkout.contactEmail) return fail(c, 400, { code: "otp_expired", field: "code" });

  const rejected = await consumeOtp(c, email, checkout.id, code);
  if (rejected) return rejected;

  const now = Date.now();
  const db = createDb(c.env.DB);
  const [customer] = await db
    .insert(customers)
    .values({ name: checkout.contactName ?? email, email, emailVerifiedAt: now, createdAt: now })
    .onConflictDoUpdate({
      target: customers.email,
      set: { emailVerifiedAt: sql`coalesce(${customers.emailVerifiedAt}, excluded.email_verified_at)` },
    })
    .returning({ id: customers.id });
  await rotateSession(c, session, customer.id);
  log("otp_verified", { checkoutId: checkout.id, customerId: customer.id });

  if (!checkout.draft) {
    await db.update(checkouts).set({ customerId: customer.id, updatedAt: now }).where(eq(checkouts.id, checkout.id));
    return c.json({ next: "who" as const });
  }
  const ids = await persistDraft(db, checkout, customer.id, checkout.draft);
  return holdReply(c, await holdStep(c.env, (p) => c.executionCtx.waitUntil(p), checkout.id, ids));
});

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.body(null, 204);
});
