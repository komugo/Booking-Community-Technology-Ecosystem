import { booking } from "@komugo/booking";
import { createDb, members, memberSessions, operators } from "@komugo/db";
import { Hono, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { and, asc, eq, gt } from "drizzle-orm";
import { clientIp, consumeOtp, ipLimited, normEmail, sendOtp } from "../auth";
import { DAY, emailRef, fail, limited, log, randomToken, requireJson, sha256Hex, type Ctx } from "../lib";

const COOKIE = "__Host-ops";
const MAX_AGE_S = 30 * 24 * 60 * 60;

export type Member = { id: string; email: string; name: string; role: "staff" | "operator"; operatorId: string | null };
export type Ops = { Bindings: Env };

declare module "hono" {
  interface ContextVariableMap {
    member: Member;
    b: ReturnType<typeof booking>;
  }
}

const setCookie = (c: Ctx, value: string, maxAge: number) =>
  c.header("Set-Cookie", `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);

const view = (m: Member) => ({ email: m.email, name: m.name, role: m.role });

const memberCols = {
  id: members.id,
  email: members.email,
  name: members.name,
  role: members.role,
  operatorId: members.operatorId,
};

export const requireMember: MiddlewareHandler<Ops> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  const [member] = token
    ? await createDb(c.env.DB)
        .select(memberCols)
        .from(memberSessions)
        .innerJoin(members, eq(members.id, memberSessions.memberId))
        .where(and(eq(memberSessions.idHash, await sha256Hex(token)), gt(memberSessions.expiresAt, Date.now())))
    : [];
  if (!member) return fail(c, 401, { code: "signed_out" });
  c.set("member", member);
  return requireJson(c, next);
};

export const forOperator: MiddlewareHandler<Ops> = async (c, next) => {
  const operatorId = c.req.param("operatorId") ?? "";
  const m = c.var.member;
  const allowed =
    m.role === "staff"
      ? (await createDb(c.env.DB).select({ id: operators.id }).from(operators).where(eq(operators.id, operatorId))).length > 0
      : m.operatorId === operatorId;
  if (!allowed) return fail(c, 404, { code: "not_found" });
  c.set("b", booking(c.env, operatorId));
  await next();
};

export const staffOnly: MiddlewareHandler<Ops> = async (c, next) => {
  if (c.var.member.role !== "staff") return fail(c, 403, { code: "forbidden" });
  await next();
};

export const ops = new Hono<Ops>();

ops.post("/auth/otp", async (c) => {
  const body = await c.req.json<{ email?: unknown; locale?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  if (await ipLimited(c)) return fail(c, 429, { code: "rate_limited" });
  const email = normEmail(body.email);
  if (!email || email.length > 254) return fail(c, 400, { code: "email_invalid", field: "email" });
  if (await limited(c.env.RL_OTP_EMAIL, `ops:${email}:${clientIp(c)}`)) return fail(c, 429, { code: "rate_limited" });
  const [member] = await createDb(c.env.DB).select({ id: members.id }).from(members).where(eq(members.email, email));
  if (!member) {
    log("ops_otp_unknown", { email: await emailRef(email) });
    return c.body(null, 204);
  }
  const res = await sendOtp(c, email, null, body.locale === "ms" ? "ms" : "en");
  if (res?.status !== 429) return res ?? c.body(null, 204);
  log("ops_otp_capped", { email: await emailRef(email) });
  return c.body(null, 204);
});

ops.post("/auth/otp/verify", async (c) => {
  const body = await c.req.json<{ email?: unknown; code?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  if (await ipLimited(c)) return fail(c, 429, { code: "rate_limited" });
  const email = normEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const db = createDb(c.env.DB);
  const [member] = await db.select(memberCols).from(members).where(eq(members.email, email));
  if (!member) return fail(c, 400, { code: "otp_expired", field: "code" });
  const rejected = await consumeOtp(c, email, null, code);
  if (rejected) return rejected;
  const token = randomToken();
  const now = Date.now();
  await db.insert(memberSessions).values({ idHash: await sha256Hex(token), memberId: member.id, createdAt: now, expiresAt: now + 30 * DAY });
  setCookie(c, token, MAX_AGE_S);
  log("ops_signed_in", { memberId: member.id });
  return c.json({ member: view(member) });
});

ops.post("/auth/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await createDb(c.env.DB).delete(memberSessions).where(eq(memberSessions.idHash, await sha256Hex(token)));
  setCookie(c, "", 0);
  return c.body(null, 204);
});

ops.get("/me", requireMember, async (c) => {
  const m = c.var.member;
  const q = createDb(c.env.DB).select({ id: operators.id, name: operators.name }).from(operators);
  const list = await (m.role === "staff" ? q : q.where(eq(operators.id, m.operatorId ?? ""))).orderBy(asc(operators.name));
  return c.json({ member: view(m), operators: list });
});
