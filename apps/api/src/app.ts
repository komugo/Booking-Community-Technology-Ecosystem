import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HealthResponse } from "@komugo/types";

export const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({ origin: (origin, c) => (c.env.CORS_ORIGINS.split(",").map((o: string) => o.trim()).includes(origin) ? origin : null) }),
);

app.get("/health", (c) => c.json<HealthResponse>({ ok: true }));
