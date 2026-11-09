import { Hono } from "hono";
import type { HealthResponse } from "@komugo/types";
import { auth } from "./auth";
import { checkout } from "./checkout";
import { chip } from "./chip";
import { fakeChip } from "./dev/chip";
import { fixture } from "./dev/fixture";
import { digital } from "./digital";
import { lists } from "./day-list";
import { devInbox } from "./email";
import { interests } from "./interests";
import { manage } from "./manage";
import { me } from "./me";
import { forOperator, ops, requireMember } from "./ops/auth";
import { contacts } from "./ops/contacts";
import { holidays } from "./ops/holidays";
import { interestCounts } from "./ops/interests";
import { leads } from "./ops/leads";
import { payouts } from "./ops/payouts";
import { refunds } from "./ops/refunds";
import { routes } from "./ops/routes";
import { venues } from "./ops/venues";
import { whatsapp } from "./ops/whatsapp";
import { packs } from "./packs";
import { seed } from "./seed";
import { devDevice, devOutbox } from "./whatsapp";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json<HealthResponse>({ ok: true }));

app.route("/checkouts", checkout);
app.route("/auth", auth);
app.route("/chip", chip);
app.route("/bookings", manage("booking"));
app.route("/packs", manage("pack"));
app.route("/pack-orders", packs);
app.route("/me", me);
app.route("/interests", interests);
app.route("/lists", lists);
app.route("/digital", digital);
app.route("/dev/chip", fakeChip);

ops.use("/operators/:operatorId/*", requireMember, forOperator);
ops.route("/operators/:operatorId", routes);
ops.route("/operators/:operatorId/contacts", contacts);
ops.route("/refunds", refunds);
ops.route("/payouts", payouts);
ops.route("/venues", venues);
ops.route("/interests", interestCounts);
ops.route("/leads", leads);
ops.route("/holidays", holidays);
ops.route("/whatsapp", whatsapp);
app.route("/ops", ops);

app.get("/dev/emails", (c) => (c.env.DEV_SEED === "1" ? c.json(devInbox) : c.notFound()));
app.get("/dev/whatsapp", (c) => (c.env.DEV_SEED === "1" ? c.json(devOutbox) : c.notFound()));
app.post("/dev/whatsapp/device", async (c) => {
  if (c.env.DEV_SEED !== "1") return c.notFound();
  devDevice.connected = (await c.req.json<{ connected?: unknown }>()).connected === true;
  return c.json(devDevice);
});

// The seed overwrites its rows, so it never runs against a deployed D1.
const local = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);

app.post("/dev/seed", async (c) => (c.env.DEV_SEED === "1" && local(c.req.url) ? c.json(await seed(c.env)) : c.notFound()));

app.post("/dev/fixture", async (c) =>
  c.env.DEV_SEED === "1"
    ? c.json(await fixture(c.env, (p) => c.executionCtx.waitUntil(p), await c.req.json().catch(() => ({}))))
    : c.notFound(),
);
