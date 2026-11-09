import type { APIRoute } from "astro";
import { alternates } from "../content/i18n";
import { ROUTES } from "../lib/routes";
import { abs } from "../lib/seo";

export const GET: APIRoute = ({ site }) => {
  const urls = ROUTES.flatMap((p) => {
    const alt = alternates(p);
    const en = abs(site, alt.en);
    const ms = abs(site, alt.ms);
    const links = `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="ms" href="${ms}"/><xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
    return [en, ms].map((loc) => `<url><loc>${loc}</loc>${links}</url>`);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
