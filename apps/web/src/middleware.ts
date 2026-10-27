import { defineMiddleware } from "astro:middleware";

const PRIVATE = /^(\/ms)?\/(book|checkout|bookings)\//;
const FORM_ACTION = ["'self'", "https://www.billplz.com", "https://www.billplz-sandbox.com", ...(import.meta.env.DEV ? ["http://localhost:*"] : [])];

// Astro collapses `//` in Astro.url before routing, so read the raw request URL.
export const onRequest = defineMiddleware(async ({ request }, next) => {
  const url = new URL(request.url);
  if (url.pathname.includes("//")) {
    return new Response(null, { status: 301, headers: { Location: url.pathname.replace(/\/{2,}/g, "/") + url.search } });
  }
  // Astro's checkOrigin is off because it would reject Billplz's server-to-server callback.
  if (request.method === "POST" && url.pathname !== "/billplz/callback" && request.headers.get("Origin") !== url.origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const res = await next();
  if (PRIVATE.test(url.pathname)) {
    res.headers.set("Cache-Control", "private, no-store");
    // Not no-referrer: browsers then send `Origin: null` on form POSTs and the Origin check would reject them.
    res.headers.set("Referrer-Policy", "same-origin");
    res.headers.set("X-Robots-Tag", "noindex");
    res.headers.set(
      "Content-Security-Policy",
      `frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action ${FORM_ACTION.join(" ")}`,
    );
  }
  return res;
});
