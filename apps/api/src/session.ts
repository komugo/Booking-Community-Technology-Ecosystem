import { checkouts, createDb, sessions } from "@komugo/db";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { DAY, randomToken, sha256Hex, type Ctx } from "./lib";

const COOKIE = "__Host-sid";
const MAX_AGE_S = 30 * 24 * 60 * 60;

export type Session = { idHash: string; customerId: string | null };

function setCookie(c: Ctx, value: string, maxAge: number) {
  c.header("Set-Cookie", `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`, { append: true });
}

export async function readSession(c: Ctx): Promise<Session | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const [row] = await createDb(c.env.DB)
    .select({ idHash: sessions.idHash, customerId: sessions.customerId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.idHash, await sha256Hex(token)));
  return row && row.expiresAt > Date.now() ? { idHash: row.idHash, customerId: row.customerId } : null;
}

async function insertSession(c: Ctx, customerId: string | null) {
  const token = randomToken();
  const now = Date.now();
  const idHash = await sha256Hex(token);
  return {
    session: { idHash, customerId },
    insert: createDb(c.env.DB)
      .insert(sessions)
      .values({ idHash, customerId, createdAt: now, expiresAt: now + 30 * DAY }),
    commit: () => setCookie(c, token, MAX_AGE_S),
  };
}

export async function ensureSession(c: Ctx): Promise<Session> {
  const existing = await readSession(c);
  if (existing) return existing;
  const s = await insertSession(c, null);
  await s.insert;
  s.commit();
  return s.session;
}

export async function rotateSession(c: Ctx, old: Session | null, customerId: string): Promise<Session> {
  const db = createDb(c.env.DB);
  const s = await insertSession(c, customerId);
  await db.batch([
    s.insert,
    ...(old
      ? [
          db.update(checkouts).set({ sessionId: s.session.idHash }).where(eq(checkouts.sessionId, old.idHash)),
          db.delete(sessions).where(eq(sessions.idHash, old.idHash)),
        ]
      : []),
  ]);
  s.commit();
  return s.session;
}

export async function endSession(c: Ctx) {
  const s = await readSession(c);
  if (s) await createDb(c.env.DB).delete(sessions).where(eq(sessions.idHash, s.idHash));
  setCookie(c, "", 0);
}

export const owns = (s: Session | null, checkout: { sessionId: string; customerId: string | null }) =>
  !!s && (checkout.sessionId === s.idHash || (checkout.customerId !== null && checkout.customerId === s.customerId));
