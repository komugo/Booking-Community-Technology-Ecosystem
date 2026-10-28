import { Hono } from "hono";
import type { HealthResponse } from "@komugo/types";
import { auth } from "./auth";
import { billplz } from "./billplz";
import { bookings } from "./bookings";
import { checkout } from "./checkout";
import { fakeBillplz } from "./dev/billplz";
import { fixture } from "./dev/fixture";
import { devInbox } from "./email";
import { forOperator, ops, requireMember } from "./ops/auth";
import { routes } from "./ops/routes";
import { seed } from "./seed";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json<HealthResponse>({ ok: true }));

app.route("/checkouts", checkout);
app.route("/auth", auth);
app.route("/billplz", billplz);
app.route("/bookings", bookings);
app.route("/dev/billplz", fakeBillplz);

ops.use("/operators/:operatorId/*", requireMember, forOperator);
ops.route("/operators/:operatorId", routes);
app.route("/ops", ops);

app.get("/dev/emails", (c) => (c.env.DEV_SEED === "1" ? c.json(devInbox) : c.notFound()));

app.post("/dev/seed", async (c) => (c.env.DEV_SEED === "1" ? c.json(await seed(c.env)) : c.notFound()));

app.post("/dev/fixture", async (c) => (c.env.DEV_SEED === "1" ? c.json(await fixture(c.env, await c.req.json().catch(() => ({})))) : c.notFound()));
