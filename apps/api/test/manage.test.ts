import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { cron } from "../src/cron";
import { devInbox } from "../src/email";
import { groupLink } from "../src/manage";
import { booked, client, d1, DAY_MS, later, member, rid, signedIn, SLOT_AT, slotAt, world } from "./helpers";

async function mine(o: { people?: number } = {}) {
  const w = await world({ horses: 3 });
  const b = await booked(w, Array.from({ length: o.people ?? 1 }, (_, i) => ({ name: `Rider ${i}` })), {
    addOns: o.people ? [{ id: w.helmetId, qty: 1 }] : [],
  });
  await w.flush();
  const owner = await signedIn(b.email);
  const k = await groupLink(env, "booking", b.bookingId);
  const base = `/bookings/${b.bookingId}`;
  return { w, b, owner, k, base };
}

const close = async (w: Awaited<ReturnType<typeof world>>, timeslotId = w.timeslotId) => {
  const m = await member("operator", w.operatorId);
  await m.json("POST", `/ops/operators/${w.operatorId}/timeslots/${timeslotId}/close`, { reason: "weather" });
};

describe("access", () => {
  test("owner session, another Customer, the k link and a wrong-kind k", async () => {
    const { b, owner, k, base } = await mine();
    const t = b.ticketIds[0];
    expect((await owner.json("GET", base)).body).toMatchObject({
      kind: "booking",
      id: b.bookingId,
      canChange: true,
      k,
      freeCancelHours: 24,
      tickets: [{ status: "issued", startsAt: SLOT_AT, closedAt: null, refundSen: 0, participantName: "Rider 0" }],
      closure: [],
    });
    expect((await (await signedIn(`${rid()}@example.com`)).json("GET", base)).status).toBe(404);
    expect((await client().json("GET", `${base}?k=${k}`)).body).toMatchObject({ canChange: false });
    expect((await client().json("GET", `${base}?k=${await groupLink(env, "pack", b.bookingId)}`)).status).toBe(404);
    const viaLink = await client().json("POST", `${base}/cancel`, { requestId: rid(), t, expectSen: 10000, expectForfeited: [], k });
    expect(viaLink).toEqual({ status: 401, body: { code: "sign_in_required" } });
    expect((await client().json("GET", `${base}/quote?t=${t}&k=${k}`)).status).toBe(401);
    const form = await owner.call("POST", `${base}/cancel`, new URLSearchParams({ t }));
    expect(form.status).toBe(415);
    expect((await owner.json("POST", `${base}/cancel`, { requestId: "x", t })).body).toMatchObject({ field: "requestId" });
  });
});

describe("cancel and reschedule", () => {
  test("quote then cancel refunds the Ticket plus its Add-on share and emails the Refund once", async () => {
    const { w, b, owner, base } = await mine({ people: 2 });
    const q = (await owner.json("GET", `${base}/quote?t=${b.ticketIds[0]}`)).body;
    expect(q).toEqual({ tickets: [{ id: b.ticketIds[0], outcome: "cancelled", refundSen: 10250 }], refundSen: 10250, reason: "cancel" });
    const r = await owner.json("POST", `${base}/cancel`, { requestId: rid(), t: b.ticketIds[0], expectSen: 10250, expectForfeited: [] });
    expect(r.body).toMatchObject({ refundSen: 10250, refund: { amountSen: 10250, reason: "cancel" } });
    const stale = await owner.json("POST", `${base}/cancel`, { requestId: rid(), t: b.ticketIds[1], expectSen: 1, expectForfeited: [] });
    expect(stale.body).toEqual({ code: "quote_changed" });
    await w.flush();
    await cron(env, () => {}, Date.now() + 3 * 60_000);
    const due = devInbox.filter((e) => e.to === b.email && e.subject === "Refund on its way: RM 102.50");
    expect(due).toHaveLength(1);
    expect(due[0].text).toContain("We cancelled Rider 0 for Trail Riding – Ride");
    expect(due[0].text).toContain("within 7 working days");
    expect((await owner.json("GET", base)).body.tickets.map((t: { status: string; refundSen: number }) => [t.status, t.refundSen])).toEqual([
      ["cancelled", 10250],
      ["issued", 0],
    ]);
  });

  test("the owner reschedules to a listed Timeslot", async () => {
    const { w, b, owner, base } = await mine();
    const t = b.ticketIds[0];
    const at = later(72);
    const next = await slotAt(w, at);
    await slotAt(w, SLOT_AT + DAY_MS);
    const { body } = await owner.json("GET", `${base}/slots?t=${t}`);
    expect(body).toEqual({ ticketIds: [t], slots: [{ id: next, startsAt: at, spots: 3 }] });
    const r = await owner.json("POST", `${base}/reschedule`, { requestId: rid(), t, timeslotId: next });
    expect(r).toEqual({ status: 200, body: { timeslotId: next, startsAt: at } });
  });

  test("after the free-cancel window the slots list is window_passed", async () => {
    const { w, b, owner, base } = await mine();
    const t = b.ticketIds[0];
    const soon = later(2);
    const r = await owner.json("POST", `${base}/reschedule`, { requestId: rid(), t, timeslotId: await slotAt(w, soon) });
    expect(r.status).toBe(200);
    expect(await owner.json("GET", `${base}/slots?t=${t}`)).toEqual({ status: 409, body: { code: "window_passed" } });
  });
});

describe("Closure choice", () => {
  test("the k link chooses a refund for the closed Tickets, and a second choice is refused", async () => {
    const { w, b, k, base } = await mine();
    await close(w);
    const anon = client();
    const t = `closed:${w.timeslotId}`;
    expect((await anon.json("GET", `${base}/quote?t=${t}&k=${k}`)).body).toMatchObject({ refundSen: 10000, reason: "closure" });
    const r = await anon.json("POST", `${base}/cancel`, { requestId: rid(), t, expectSen: 10000, expectForfeited: [], k });
    expect(r.body).toMatchObject({ refund: { amountSen: 10000, reason: "closure" } });
    expect((await anon.json("GET", `${base}?k=${k}`)).body.closure).toEqual([
      { timeslotId: w.timeslotId, reason: "weather", choice: "refund", chosenAt: expect.any(Number) },
    ]);
    const next = await slotAt(w, SLOT_AT + DAY_MS);
    const again = await anon.json("POST", `${base}/reschedule`, { requestId: rid(), t, timeslotId: next, k });
    expect(again).toEqual({ status: 409, body: { code: "invalid_state" } });
    await w.flush();
    expect(await d1("SELECT choice FROM closure_notices WHERE ref = ?", b.bookingId)).toEqual([{ choice: "refund" }]);
  });

  test("the k link reschedules closed Tickets and records the choice", async () => {
    const { w, b, k, base } = await mine();
    await close(w);
    const next = await slotAt(w, SLOT_AT + DAY_MS);
    const r = await client().json("POST", `${base}/reschedule`, { requestId: rid(), t: `closed:${w.timeslotId}`, timeslotId: next, k });
    expect(r.body).toEqual({ timeslotId: next, startsAt: SLOT_AT + DAY_MS });
    await w.flush();
    expect(await d1("SELECT choice FROM closure_notices WHERE ref = ?", b.bookingId)).toEqual([{ choice: "reschedule" }]);
  });
});
