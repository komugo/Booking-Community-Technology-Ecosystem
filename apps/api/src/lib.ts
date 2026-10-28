import type { Context } from "hono";

export type Ctx = Context<{ Bindings: Env }>;
export type ApiError = { code: string; field?: string; params?: Record<string, string | number> };
export type WaitUntil = (p: Promise<unknown>) => void;

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const fail = (c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 415 | 429 | 502 | 503, e: ApiError, errors?: ApiError[]) =>
  c.json({ ...e, ...(errors && errors.length > 1 ? { errors } : {}) }, status);

const enc = new TextEncoder();

export const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

export const sha256Hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export async function hmac(key: string, message: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(message));
}

export const hmacHex = async (key: string, message: string) => hex(await hmac(key, message));

export function safeEqual(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}

export const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...data }));
export const logError = (event: string, data: Record<string, unknown> = {}) =>
  console.error(JSON.stringify({ event, ...data }));

export async function each<T>(rows: T[], event: string, fn: (row: T) => Promise<unknown>) {
  for (const r of rows) {
    try {
      await fn(r);
    } catch (e) {
      logError(event, { row: r, error: String(e) });
    }
  }
}

export const emailRef = async (email: string) => (await sha256Hex(email)).slice(0, 12);

export const limited = async (rl: RateLimit, key: string) => !(await rl.limit({ key })).success;
