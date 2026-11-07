import type { APIRoute } from "astro";
import { abs, PROD_HOST } from "../lib/seo";

export const GET: APIRoute = ({ site }) =>
  new Response(
    site?.hostname === PROD_HOST ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${abs(site, "/sitemap.xml")}\n` : "User-agent: *\nDisallow: /\n",
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
