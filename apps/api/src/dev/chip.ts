import { Hono } from "hono";

type FakePurchase = {
  id: string;
  brand_id: string;
  status: string;
  total: number;
  success_callback: string;
  success_redirect: string;
  failure_redirect: string;
};

const purchases = new Map<string, FakePurchase>();

let keys: Promise<CryptoKeyPair> | null = null;
const keyPair = () =>
  (keys ??= crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>);

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export const fakeSignature = async (body: string) =>
  b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", (await keyPair()).privateKey, new TextEncoder().encode(body)));

export const fakeChip = new Hono<{ Bindings: Env }>();

fakeChip.use("*", async (c, next) => {
  if (c.env.DEV_SEED !== "1" || !c.env.CHIP_BASE.includes("/dev/chip/")) return c.notFound();
  await next();
});

fakeChip.use("/api/v1/*", async (c, next) => {
  if (c.req.header("Authorization") !== `Bearer ${c.env.CHIP_SECRET_KEY}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

const json = (env: Env, p: FakePurchase) => ({
  id: p.id,
  brand_id: p.brand_id,
  status: p.status,
  checkout_url: `${env.CHIP_BASE.replace(/\/api\/v1$/, "")}/p/${p.id}`,
  purchase: { currency: "MYR", total: p.total },
  payment: p.status === "paid" ? { amount: p.total, currency: "MYR" } : null,
});

fakeChip.get("/api/v1/public_key/", async (c) => {
  const spki = b64((await crypto.subtle.exportKey("spki", (await keyPair()).publicKey)) as ArrayBuffer);
  return c.json(`-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----\n`);
});

fakeChip.post("/api/v1/purchases/", async (c) => {
  const b = await c.req.json<{
    brand_id: string;
    purchase: { products: { price: number }[] };
    success_callback: string;
    success_redirect: string;
    failure_redirect: string;
  }>();
  if (b.brand_id !== c.env.CHIP_BRAND_ID) return c.json({ brand_id: ["invalid"] }, 400);
  const p: FakePurchase = {
    id: crypto.randomUUID(),
    brand_id: b.brand_id,
    status: "created",
    total: b.purchase.products.reduce((s, x) => s + x.price, 0),
    success_callback: b.success_callback,
    success_redirect: b.success_redirect,
    failure_redirect: b.failure_redirect,
  };
  purchases.set(p.id, p);
  return c.json(json(c.env, p), 201);
});

fakeChip.get("/api/v1/purchases/:id/", (c) => {
  const p = purchases.get(c.req.param("id"));
  return p ? c.json(json(c.env, p)) : c.json({ error: "not_found" }, 404);
});

fakeChip.post("/api/v1/purchases/:id/cancel/", (c) => {
  const p = purchases.get(c.req.param("id"));
  if (!p) return c.json({ error: "not_found" }, 404);
  if (!["created", "pending_execute"].includes(p.status)) return c.json({ error: "purchase_not_payable" }, 400);
  p.status = "cancelled";
  return c.json(json(c.env, p));
});

const ACTIONS = {
  pay: "Pay",
  fail: "Fail",
  pending: "Pending",
  pay_no_return: "Pay without return",
  return_no_callback: "Return without callback",
  pay_twice: "Pay twice",
} as const;

fakeChip.get("/p/:id", (c) => {
  const p = purchases.get(c.req.param("id"));
  if (!p) return c.text("Unknown purchase", 404);
  const buttons = Object.entries(ACTIONS)
    .map(([a, label]) => `<button name="action" value="${a}">${label}</button>`)
    .join("");
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>Fake CHIP</title>
<body style="font:16px system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem">
<h1>Fake CHIP</h1><p>Purchase ${p.id} · RM ${(p.total / 100).toFixed(2)} · ${p.status}</p>
<form method="post" style="display:grid;gap:.5rem">${buttons}</form></body>`);
});

async function callback(env: Env, p: FakePurchase) {
  const body = JSON.stringify({ ...json(env, p), event_type: "purchase.paid" });
  await fetch(p.success_callback, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": await fakeSignature(body) },
    body,
  });
}

fakeChip.post("/p/:id", async (c) => {
  const p = purchases.get(c.req.param("id"));
  if (!p) return c.text("Unknown purchase", 404);
  const action = String((await c.req.parseBody()).action) as keyof typeof ACTIONS;
  p.status = action === "fail" ? "error" : action === "pending" ? "pending_execute" : "paid";
  if (action === "pay" || action === "pay_no_return") await callback(c.env, p);
  if (action === "pay_twice") await Promise.all([callback(c.env, p), callback(c.env, p)]);
  if (action === "pay_no_return") return c.text("Paid. Close this tab.");
  return c.redirect(action === "fail" ? p.failure_redirect : p.success_redirect, 303);
});
