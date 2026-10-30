import type { ApiError, Ctx } from "../lib";

export type Body = Record<string, unknown>;

export const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
export const intOrNull = (v: unknown, min: number, max: number) => v === null || int(v, min, max);
export const name = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 200;
export const bool = (v: unknown): v is boolean => typeof v === "boolean";
export const list = <T>(v: unknown, max: number, ok: (x: unknown) => boolean): v is T[] => Array.isArray(v) && v.length <= max && v.every(ok);

export function invalid(checks: [boolean, string][]): ApiError[] {
  return checks.filter(([ok]) => !ok).map(([, field]) => ({ code: "invalid_field", field }));
}

export const json = (c: Ctx) => c.req.json<Body>().catch((): Body => ({}));
