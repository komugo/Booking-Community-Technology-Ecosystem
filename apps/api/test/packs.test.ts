import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { confirmBill } from "../src/billplz";
import { cron } from "../src/cron";
import { devInbox } from "../src/email";
import { client, d1, fake, held, later, packOffer, pay, returnPath, rid, signedIn, slotAt, world, type World } from "./helpers";

const mail = (to: string) => devInbox.filter((e) => e.to === to);

async function buyer(o: { active?: boolean } = {}) {
  const w = await world();
  const offer = await packOffer(w, { active: o.active ?? true });
  const email = `${rid()}@example.com`;
  const cl = await signedIn(email);
  const order = () => cl.json<{ url: string }>("POST", "/pack-orders", { offerId: offer.id, locale: "en" });
  return { w, offer, email, cl, order };
}

describe("Pack purchase", () => {
  test("signed out is 401 and an inactive offer is 409 not_bookable", async () => {
    const w = await world();
    const offer = await packOffer(w);
    expect((await client().json("POST", "/pack-orders", { offerId: offer.id })).status).toBe(401);
    const b = await buyer({ active: false });
    expect((await b.order()).body).toEqual({ code: "not_bookable" });
  });

  test("pay → callback issues the Pack once, emails it once, and the return gives the Pack and its link", async () => {
    const b = await buyer();
    const first = await b.order();
    expect(first.status).toBe(200);
    expect((await b.order()).body.url).toBe(first.body.url);
    const billId = first.body.url.split("/").pop()!;
    expect(await d1("SELECT kind, amount_sen FROM bills WHERE id = ?", billId)).toEqual([{ kind: "pack", amount_sen: 25000 }]);
    const location = await fake(billId, "pay_twice");
    const r = await b.cl.json("GET", returnPath(location!));
    expect(r.body).toEqual({ state: "pack", offerId: b.offer.id, packId: expect.any(String), k: expect.any(String) });
    expect(await d1("SELECT pack_id, emailed_at IS NOT NULL AS sent FROM pack_orders WHERE customer_id = (SELECT id FROM customers WHERE email = ?)", b.email)).toEqual([
      { pack_id: r.body.packId, sent: 1 },
    ]);
    expect(await b.w.doSql("SELECT count(*) AS n FROM packs")).toEqual([{ n: 1 }]);
    const ready = mail(b.email).filter((e) => e.subject === "Your Pack is ready: 4 rides");
    expect(ready).toHaveLength(1);
    expect(ready[0].text).toContain(`/packs/${r.body.packId}?k=${r.body.k}`);
    const page = await b.cl.json("GET", `/packs/${r.body.packId}`);
    expect(page.body).toMatchObject({ kind: "pack", id: r.body.packId, sessionsTotal: 4, sessionsUsed: 0, offer: { nameEn: "4 rides" }, canChange: true });
  });

  test("the cron reconciles a lost callback; an amount mismatch is a Pack refund email", async () => {
    const b = await buyer();
    const billId = (await b.order()).body.url.split("/").pop()!;
    await fake(billId, "return_no_callback");
    const jobs: Promise<unknown>[] = [];
    await cron(env, (p) => jobs.push(p), Date.now() + 21 * 60_000);
    expect(await d1("SELECT pack_id IS NOT NULL AS issued FROM pack_orders WHERE id = (SELECT hold_id FROM bills WHERE id = ?)", billId)).toEqual([
      { issued: 1 },
    ]);

    const c = await buyer();
    const other = (await c.order()).body.url.split("/").pop()!;
    const r = await confirmBill(env, (p) => jobs.push(p), other, 100);
    expect(r?.result).toEqual({ status: "refund_due", reason: "amount_mismatch" });
    await Promise.all(jobs);
    const [refund] = mail(c.email).filter((e) => e.subject === "Refund on its way: 4 rides");
    expect(refund.text).toContain("your Pack purchase (4 rides)");
  });
});

describe("Pack redemption at Pay", () => {
  async function checkout(w: World, addOns: { id: string; qty: number }[] = []) {
    const near = await slotAt(w, later(72));
    const h = await held({ ...w, timeslotId: near }, { addOns });
    const [{ customer_id }] = await d1<{ customer_id: string }>("SELECT customer_id FROM checkouts WHERE id = ?", h.id);
    const offer = await packOffer(w);
    const orderId = rid();
    await w.b.orderPack({ orderId, customerId: customer_id, offerId: offer.id });
    const p = await w.b.confirmPackBill({ billId: rid(), orderId, amountSen: offer.priceSen });
    if (p.status !== "paid") throw new Error("pack not paid");
    await w.flush();
    return { ...h, packId: p.packId };
  }

  test("Use Pack books Tickets, deletes the open bill, emails 'Booked with your Pack' and ends the Checkout", async () => {
    const w = await world();
    const c = await checkout(w);
    expect((await c.cl.json("GET", `/checkouts/${c.id}`)).body.packs).toEqual([
      { id: c.packId, nameEn: "4 rides", nameMs: "4 tunggangan", left: 4, expiresAt: expect.any(Number), why: null, k: expect.any(String) },
    ]);
    const { billId } = await pay(c.cl, c.id);
    const r = await c.cl.json("POST", `/checkouts/${c.id}/redeem`, { packId: c.packId });
    expect(r).toEqual({ status: 200, body: { packId: c.packId, k: expect.any(String) } });
    const view = (await c.cl.json("GET", `/checkouts/${c.id}`)).body;
    expect(view).toMatchObject({ state: "redeemed", packId: c.packId, k: r.body.k });
    expect(await d1("SELECT deleted_at IS NOT NULL AS gone FROM bills WHERE id = ?", billId)).toEqual([{ gone: 1 }]);
    expect(mail(c.email).filter((e) => e.subject === "Booked with your Pack: Trail Riding")).toHaveLength(1);
    expect((await c.cl.json("POST", `/checkouts/${c.id}/pay`)).body).toEqual({ code: "invalid_state" });
    expect((await c.cl.json("POST", `/checkouts/${c.id}/redeem`, { packId: c.packId })).body).toEqual({ code: "invalid_state" });
    expect(await w.doSql("SELECT count(*) AS n FROM tickets WHERE pack_id = ?", c.packId)).toEqual([{ n: 1 }]);
  });

  test("a Checkout with Add-ons can't use a Pack", async () => {
    const w = await world();
    const c = await checkout(w, [{ id: w.helmetId, qty: 1 }]);
    expect((await c.cl.json("GET", `/checkouts/${c.id}`)).body.packs[0].why).toBe("add_ons");
    expect((await c.cl.json("POST", `/checkouts/${c.id}/redeem`, { packId: c.packId })).body).toEqual({ code: "invalid_add_on" });
  });
});
