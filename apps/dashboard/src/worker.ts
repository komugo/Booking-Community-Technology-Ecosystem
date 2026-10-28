type Env = { ASSETS: { fetch: typeof fetch }; API: { fetch: typeof fetch } };

// Same-origin /api proxy through the service binding, so the API needs no CORS.
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (req.method !== "GET" && req.headers.get("Origin") !== url.origin) return new Response(null, { status: 403 });
    const forward = new Request(`https://api${url.pathname.slice(4)}${url.search}`, req);
    forward.headers.set("x-client-ip", req.headers.get("CF-Connecting-IP") ?? "");
    return env.API.fetch(forward);
  },
};
