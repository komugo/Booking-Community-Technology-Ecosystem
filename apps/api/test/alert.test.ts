import { env } from "cloudflare:test";
import { operatorContacts, whatsappMessages } from "@komugo/db";
import { klDate } from "@komugo/types";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { listLink } from "../src/day-list";
import { devInbox } from "../src/email";
import { devDevice, devOutbox } from "../src/whatsapp";
import { booked, d1, db, fake, held, later, member, packOffer, pay, returnPath, rid, signedIn, slotAt, world, type World } from "./helpers";

const phone = () => `+6018${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function contacts(w: World) {
  const [counter, owner] = await db
    .insert(operatorContacts)
    .values([
      { operatorId: w.operatorId, name: "Siti", phone: phone(), role: "counter", locale: "en", email: `${rid()}@example.com`, createdAt: Date.now() },
      { operatorId: w.operatorId, name: "Aminah", phone: phone(), role: "owner", locale: "ms", email: `${rid()}@example.com`, createdAt: Date.now() },
    ])
    .returning();
  return { counter, owner };
}

const sent = (c: { phone: string }) => devOutbox.filter((m) => m.to === c.phone).map((m) => m.text);
const mail = (c: { email: string | null }) => devInbox.filter((e) => e.to === c.email);
const code = (id: string) => id.slice(0, 8).toUpperCase();

async function setup() {
  const w = await world({ horses: 3 });
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 1 });
  const soon = await slotAt(w, later(3));
  const twoWeeks = await slotAt(w, later(14 * 24));
  return { w, soon, twoWeeks, to: await contacts(w) };
}

async function buy(w: World, timeslotId: string) {
  const h = await held({ ...w, timeslotId });
  const { billId } = await pay(h.cl, h.id);
  return (await h.cl.json("GET", returnPath((await fake(billId, "pay"))!))).body.bookingId as string;
}

test("a booking two weeks ahead alerts every contact straight away with that day's Day list link, owners also by email", async () => {
  const { w, twoWeeks, to } = await setup();
  await buy(w, twoWeeks);
  const date = klDate(later(14 * 24));
  const [en] = sent(to.counter);
  expect(en).toContain("Test Stable: Booking alert for");
  expect(en).toContain("Booked: Ride, ");
  expect(en).toContain(`Day list, always up to date: ${await listLink(env, w.operatorId, date, to.counter)}`);
  const [ms] = sent(to.owner);
  expect(ms).toContain("Makluman tempahan untuk");
  expect(ms).toContain("Ditempah: Tunggang, ");
  expect(ms).toContain(`Senarai harian, sentiasa terkini: ${await listLink(env, w.operatorId, date, to.owner)}`);

  expect(mail(to.counter)).toEqual([]);
  const [email] = mail(to.owner);
  expect(email.subject).toMatch(/^Makluman tempahan: Test Stable, /);
  expect(email.text).toContain(`Senarai harian: ${await listLink(env, w.operatorId, date, to.owner)}`);
  expect(await db.select().from(whatsappMessages).where(eq(whatsappMessages.contactId, to.counter.id))).toMatchObject([{ template: "alert", status: "sent" }]);
});

test("cancelling on any day alerts with the Ticket codes", async () => {
  const { w, soon, twoWeeks, to } = await setup();
  const far = await booked(w, [{ name: "A" }], { timeslotId: twoWeeks });
  const near = await booked(w, [{ name: "B" }], { timeslotId: soon });
  await w.flush();
  const cancel = async (b: typeof near) => {
    const owner = await signedIn(b.email);
    const base = `/bookings/${b.bookingId}`;
    const q = (await owner.json("GET", `${base}/quote?t=${b.ticketIds[0]}`)).body;
    const forfeited = q.tickets.filter((t: { outcome: string }) => t.outcome === "forfeited").map((t: { id: string }) => t.id);
    const r = await owner.json("POST", `${base}/cancel`, { requestId: rid(), t: b.ticketIds[0], expectSen: q.refundSen, expectForfeited: forfeited });
    expect(r.status).toBe(200);
  };
  await cancel(far);
  expect(sent(to.counter)).toHaveLength(1);
  expect(sent(to.counter)[0]).toContain(`• Aiman Rahman: ${code(far.ticketIds[0])}`);
  expect(sent(to.counter)[0]).toContain(await listLink(env, w.operatorId, klDate(later(14 * 24)), to.counter));
  await cancel(near);
  const [alert] = sent(to.counter);
  expect(alert).toContain("Cancelled: Ride, ");
  expect(alert).toContain(`• Aiman Rahman: ${code(near.ticketIds[0])}`);
  expect(mail(to.owner)).toHaveLength(2);
});

test("a Pack redeemed alerts once", async () => {
  const { w, soon, to } = await setup();
  const h = await held({ ...w, timeslotId: soon });
  const [{ customer_id }] = await d1<{ customer_id: string }>("SELECT customer_id FROM checkouts WHERE id = ?", h.id);
  const offer = await packOffer(w);
  const orderId = rid();
  await w.b.orderPack({ orderId, customerId: customer_id, offerId: offer.id });
  const p = await w.b.confirmPackBill({ billId: rid(), orderId, amountSen: offer.priceSen });
  if (p.status !== "paid") throw new Error("pack not paid");
  await w.flush();
  await pay(h.cl, h.id);
  const redeem = () => h.cl.json("POST", `/checkouts/${h.id}/redeem`, { packId: p.packId });
  expect((await redeem()).status).toBe(200);
  expect(sent(to.counter)).toHaveLength(1);
  expect(sent(to.counter)[0]).toContain("Booked: Ride, ");
  await redeem();
  expect(sent(to.counter)).toHaveLength(1);
});

test("a cancel or reschedule retried with the same requestId alerts once per day", async () => {
  const { w, soon, twoWeeks, to } = await setup();
  const a = await booked(w, [{ name: "A" }], { timeslotId: soon });
  const b = await booked(w, [{ name: "B" }], { timeslotId: twoWeeks });
  await w.flush();
  const cancel = { requestId: rid(), t: a.ticketIds[0], expectSen: 0, expectForfeited: [] as string[] };
  const ca = await signedIn(a.email);
  const q = (await ca.json("GET", `/bookings/${a.bookingId}/quote?t=${a.ticketIds[0]}`)).body;
  cancel.expectSen = q.refundSen;
  cancel.expectForfeited = q.tickets.filter((t: { outcome: string }) => t.outcome === "forfeited").map((t: { id: string }) => t.id);
  expect((await ca.json("POST", `/bookings/${a.bookingId}/cancel`, cancel)).status).toBe(200);
  expect((await ca.json("POST", `/bookings/${a.bookingId}/cancel`, cancel)).status).toBe(200);
  expect(sent(to.counter)).toHaveLength(1);

  const move = { requestId: rid(), t: b.ticketIds[0], timeslotId: soon };
  const cb = await signedIn(b.email);
  const first = await cb.json("POST", `/bookings/${b.bookingId}/reschedule`, move);
  expect(first.status).toBe(200);
  expect(await cb.json("POST", `/bookings/${b.bookingId}/reschedule`, move)).toEqual(first);
  expect(sent(to.counter)).toHaveLength(3);
  expect(mail(to.owner)).toHaveLength(3);
});

test("a reschedule across two days alerts once per day, each with its own Day list link", async () => {
  const { w, twoWeeks, to } = await setup();
  const b = await booked(w, [{ name: "A" }], { timeslotId: twoWeeks });
  await w.flush();
  const owner = await signedIn(b.email);
  const target = await slotAt(w, later(15 * 24));
  expect((await owner.json("POST", `/bookings/${b.bookingId}/reschedule`, { requestId: rid(), t: b.ticketIds[0], timeslotId: target })).status).toBe(200);

  const [newDay, oldDay] = sent(to.counter);
  expect(sent(to.counter)).toHaveLength(2);
  for (const m of [newDay, oldDay]) expect(m).toContain("Moved: Ride\n• Aiman Rahman");
  const links = await Promise.all([later(14 * 24), later(15 * 24)].map((t) => listLink(env, w.operatorId, klDate(t), to.counter)));
  expect(oldDay).toContain(links[0]);
  expect(newDay).toContain(links[1]);
  expect(sent(to.owner)[0]).toContain("Dipindahkan: Tunggang");
  expect(mail(to.owner)).toHaveLength(2);
  expect(mail(to.counter)).toEqual([]);
});

test("each failed Booking alert stays in the staff banner, not only the newest", async () => {
  const { w, soon, to } = await setup();
  const staff = await member("staff");
  devDevice.connected = false;
  try {
    await buy(w, soon);
    await buy(w, soon);
  } finally {
    devDevice.connected = true;
  }
  const { body } = await staff.json<{ failed: { operatorId: string; contact: string | null; template: string }[] }>("GET", "/ops/whatsapp");
  const mine = body.failed.filter((m) => m.operatorId === w.operatorId && m.contact === to.counter.name);
  expect(mine.map((m) => m.template)).toEqual(["alert", "alert"]);
});
