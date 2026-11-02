import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const POST: APIRoute = ({ request }) =>
  env.API.fetch("https://api/chip/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": request.headers.get("X-Signature") ?? "" },
    body: request.body,
  });
