import type { Locale } from "@komugo/db";
import type { ApiError } from "./api";
import { errorText } from "./i18n";

export type Problems = { summary: { text: string; href?: string }[]; fields: Map<string, string> };

export function problems(l: Locale, errors: ApiError[]): Problems {
  const fields = new Map<string, string>();
  const summary = errors.map((e) => {
    const text = errorText(l, e);
    if (e.field && !fields.has(e.field)) fields.set(e.field, text);
    return { text, href: e.field ? `#${e.field}` : undefined };
  });
  return { summary, fields };
}

export const invalid = (p: Problems, id: string) =>
  p.fields.has(id) ? { "aria-invalid": "true" as const, "aria-describedby": `${id}-error` } : {};

export const codeFrom = (url: URL): ApiError[] => {
  const e = url.searchParams.get("e");
  return e && /^[a-z_]{1,40}$/.test(e) ? [{ code: e }] : [];
};
