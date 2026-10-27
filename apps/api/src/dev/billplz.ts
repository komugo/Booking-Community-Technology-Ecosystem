import { Hono } from "hono";
import { sign } from "../billplz";

type FakeBill = Record<string, string> & { id: string; callback_url: string; redirect_url: string };

const bills = new Map<string, FakeBill>();

export const fakeBillplz = new Hono<{ Bindings: Env }>();

fakeBillplz.use("*", async (c, next) => {
  if (c.env.DEV_SEED !== "1" || !c.env.BILLPLZ_BASE.includes("/dev/billplz/")) return c.notFound();
  await next();
});

fakeBillplz.use("/api/v3/*", async (c, next) => {
  if (c.req.header("Authorization") !== `Basic ${btoa(`${c.env.BILLPLZ_API_KEY}:`)}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

const json = (b: FakeBill) => {
  const { callback_url, redirect_url, ...rest } = b;
  return {
    ...rest,
    callback_url,
    redirect_url,
    paid: b.paid === "true",
    amount: Number(b.amount),
    paid_amount: Number(b.paid_amount),
  };
};

fakeBillplz.post("/api/v3/bills", async (c) => {
  const f = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const bill: FakeBill = {
    id,
    collection_id: f.collection_id,
    paid: "false",
    state: "due",
    amount: f.amount,
    paid_amount: "0",
    due_at: new Date().toISOString().slice(0, 10),
    email: f.email,
    mobile: "",
    name: f.name,
    url: `${c.env.BILLPLZ_BASE.replace(/\/api\/v3$/, "")}/bills/${id}`,
    paid_at: "",
    description: f.description,
    reference_1_label: f.reference_1_label,
    reference_1: f.reference_1,
    callback_url: f.callback_url,
    redirect_url: f.redirect_url,
  };
  bills.set(id, bill);
  return c.json(json(bill));
});

fakeBillplz.get("/api/v3/bills/:id", (c) => {
  const b = bills.get(c.req.param("id"));
  return b ? c.json(json(b)) : c.json({ error: "not_found" }, 404);
});

fakeBillplz.delete("/api/v3/bills/:id", (c) => {
  const b = bills.get(c.req.param("id"));
  if (!b) return c.json({ error: "not_found" }, 404);
  if (b.paid === "true") return c.json({ error: "paid" }, 422);
  bills.delete(b.id);
  return c.json({});
});

const ACTIONS = {
  pay: "Pay",
  fail: "Fail",
  pending: "Pending",
  pay_no_return: "Pay without return",
  return_no_callback: "Return without callback",
  pay_twice: "Pay twice",
} as const;

fakeBillplz.get("/bills/:id", (c) => {
  const b = bills.get(c.req.param("id"));
  if (!b) return c.text("Unknown bill", 404);
  const buttons = Object.entries(ACTIONS)
    .map(([a, label]) => `<button name="action" value="${a}">${label}</button>`)
    .join("");
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>Fake Billplz</title>
<body style="font:16px system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem">
<h1>Fake Billplz</h1><p>Bill ${b.id} · RM ${(Number(b.amount) / 100).toFixed(2)} · ${b.state}</p>
<form method="post" style="display:grid;gap:.5rem">${buttons}</form></body>`);
});

async function signed(env: Env, fields: Record<string, string>) {
  return { ...fields, x_signature: await sign(fields, env.BILLPLZ_X_SIGNATURE_KEY) };
}

async function callback(env: Env, b: FakeBill, status: string) {
  const fields = await signed(env, {
    id: b.id,
    collection_id: b.collection_id,
    paid: b.paid,
    state: b.state,
    amount: b.amount,
    paid_amount: b.paid_amount,
    due_at: b.due_at,
    email: b.email,
    mobile: b.mobile,
    name: b.name,
    url: b.url,
    paid_at: b.paid_at,
    transaction_id: `tx_${b.id}`,
    transaction_status: status,
  });
  await fetch(b.callback_url, { method: "POST", body: new URLSearchParams(fields) });
}

async function returnUrl(env: Env, b: FakeBill, status: string) {
  const fields = await signed(env, {
    billplzid: b.id,
    billplzpaid: b.paid,
    billplzpaid_at: b.paid_at,
    billplztransaction_id: `tx_${b.id}`,
    billplztransaction_status: status,
  });
  const q = new URLSearchParams(
    Object.entries(fields).map(([k, v]) => [k === "x_signature" ? "billplz[x_signature]" : `billplz[${k.slice(7)}]`, v]),
  );
  return `${b.redirect_url}?${q}`;
}

fakeBillplz.post("/bills/:id", async (c) => {
  const b = bills.get(c.req.param("id"));
  if (!b) return c.text("Unknown bill", 404);
  const action = String((await c.req.parseBody()).action) as keyof typeof ACTIONS;
  const paying = action === "pay" || action === "pay_no_return" || action === "return_no_callback" || action === "pay_twice";
  if (paying) Object.assign(b, { paid: "true", state: "paid", paid_amount: b.amount, paid_at: new Date().toISOString() });
  const status = paying ? "completed" : action === "pending" ? "pending" : "failed";
  if (action === "pay" || action === "pay_no_return" || action === "fail") await callback(c.env, b, status);
  if (action === "pay_twice") await Promise.all([callback(c.env, b, status), callback(c.env, b, status)]);
  if (action === "pay_no_return") return c.text("Paid. Close this tab.");
  return c.redirect(await returnUrl(c.env, b, status), 303);
});
