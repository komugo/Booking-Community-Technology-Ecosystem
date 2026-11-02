import type { APIRoute } from "astro";
import { listSitemapEntries, type Slugs } from "@komugo/db";
import { db } from "../lib/db";
import { path, VENUE } from "../lib/i18n";
import { abs } from "../lib/seo";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export const GET: APIRoute = async ({ site }) => {
  const entries = await listSitemapEntries(db);
  const pages: Slugs[][] = [
    [],
    ...entries.map((e) => (e.venue ? [e.city, VENUE, e.venue] : [e.city, e.category, e.activity].filter((x): x is Slugs => x !== undefined))),
  ];
  const urls = pages.flatMap((parts) => {
    const en = abs(site, path("en", ...parts.map((p) => p.en)));
    const ms = abs(site, path("ms", ...parts.map((p) => p.ms)));
    const links = [`en`, `ms`, `x-default`]
      .map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(l === "ms" ? ms : en)}"/>`)
      .join("");
    return [en, ms].map((loc) => `<url><loc>${esc(loc)}</loc>${links}</url>`);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
