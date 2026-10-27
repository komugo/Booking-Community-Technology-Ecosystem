import { expect, test } from "vitest";
import { app } from "./app";

test("GET /health allows configured origins only", async () => {
  const env = { CORS_ORIGINS: "http://a.test, http://b.test" };
  const res = await app.request("/health", { headers: { Origin: "http://b.test" } }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get("access-control-allow-origin")).toBe("http://b.test");

  const other = await app.request("/health", { headers: { Origin: "http://evil.test" } }, env);
  expect(other.headers.get("access-control-allow-origin")).toBeNull();
});
