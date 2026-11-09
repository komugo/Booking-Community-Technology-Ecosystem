import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const res = await env.API.fetch("https://api/digital/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-ip": request.headers.get("CF-Connecting-IP") ?? "" },
    body: request.body,
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" } });
};
