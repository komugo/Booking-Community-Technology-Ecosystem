import { defineMiddleware } from "astro:middleware";

// Astro collapses `//` in Astro.url before routing, so read the raw request URL.
export const onRequest = defineMiddleware(({ request }, next) => {
  const { pathname, search } = new URL(request.url);
  if (!pathname.includes("//")) return next();
  return new Response(null, { status: 301, headers: { Location: pathname.replace(/\/{2,}/g, "/") + search } });
});
