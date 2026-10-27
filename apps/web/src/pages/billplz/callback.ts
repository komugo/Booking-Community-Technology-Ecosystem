import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const POST: APIRoute = ({ request }) =>
  env.API.fetch("https://api/billplz/callback", {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/x-www-form-urlencoded" },
    body: request.body,
  });
