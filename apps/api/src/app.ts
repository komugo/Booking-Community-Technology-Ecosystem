import { Hono } from "hono";
import type { HealthResponse } from "@komugo/types";
import { auth } from "./auth";
import { billplz } from "./billplz";
import { checkout } from "./checkout";
import { fakeBillplz } from "./dev/billplz";
import { fixture } from "./dev/fixture";
import { devInbox } from "./email";
import { manage } from "./manage";
import { me } from "./me";
import { forOperator, ops, requireMember } from "./ops/auth";
import { payouts } from "./ops/payouts";
import { refunds } from "./ops/refunds";
import { routes } from "./ops/routes";
import { packs } from "./packs";
import { seed } from "./seed";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json<HealthResponse>({ ok: true }));

app.route("/checkouts", checkout);
app.route("/auth", auth);
app.route("/billplz", billplz);
app.route("/bookings", manage("booking"));
app.route("/packs", manage("pack"));
app.route("/pack-orders", packs);
app.route("/me", me);
app.route("/dev/billplz", fakeBillplz);

ops.use("/operators/:operatorId/*", requireMember, forOperator);
ops.route("/operators/:operatorId", routes);
ops.route("/refunds", refunds);
ops.route("/payouts", payouts);
app.route("/ops", ops);

app.get("/dev/emails", (c) => (c.env.DEV_SEED === "1" ? c.json(devInbox) : c.notFound()));

app.post("/dev/seed", async (c) => (c.env.DEV_SEED === "1" ? c.json(await seed(c.env)) : c.notFound()));

app.post("/dev/fixture", async (c) =>
  c.env.DEV_SEED === "1"
    ? c.json(await fixture(c.env, (p) => c.executionCtx.waitUntil(p), await c.req.json().catch(() => ({}))))
    : c.notFound(),
);
