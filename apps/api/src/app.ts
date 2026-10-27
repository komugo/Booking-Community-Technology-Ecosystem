import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HealthResponse } from "@komugo/types";

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:4321,http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

export const app = new Hono();

app.use("*", cors({ origin: origins }));

app.get("/health", (c) => c.json<HealthResponse>({ ok: true }));
