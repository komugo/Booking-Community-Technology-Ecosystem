import { describe, expect, test } from "vitest";
import { codes, customer, DAY, kl, operator, rid, rideWorld } from "./helpers";

describe("concurrency", () => {
  test("20 concurrent holds on the last free horse: exactly one wins", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const people = await Promise.all(Array.from({ length: 20 }, () => w.participant(w.customerId)));
    const c = codes(await Promise.allSettled(people.map((p) => w.hold(w.customerId, ts, [p]))));
    expect(c.filter((x) => x === "ok")).toHaveLength(1);
    expect(c.filter((x) => x === "no_availability")).toHaveLength(19);
    expect(await w.allocationCount()).toBe(1);
  });

  test("day cap holds under 10 concurrent holds on separate slots", async () => {
    const w = await rideWorld({ maxSessionsPerDay: 2 });
    const p = await w.participant(w.customerId);
    await w.book(w.customerId, await w.slot(w.optionId, kl(`${DAY}T07:00`)), [p]);
    const slots = await Promise.all(
      Array.from({ length: 10 }, (_, i) => w.slot(w.optionId, kl(`${DAY}T${String(8 + i).padStart(2, "0")}:00`))),
    );
    const people = await Promise.all(slots.map(() => w.participant(w.customerId)));
    const c = codes(await Promise.allSettled(slots.map((ts, i) => w.hold(w.customerId, ts, [people[i]]))));
    expect(c.filter((x) => x === "ok")).toHaveLength(1);
    expect(await w.allocationCount()).toBe(2);
  });

  test("a Pack session cannot be double-redeemed concurrently", async () => {
    const w = await rideWorld();
    for (let i = 0; i < 4; i++) await w.resource();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const { packId } = await w.pack(w.customerId, 1, kl("2030-12-31T00:00"));
    const people = await Promise.all(Array.from({ length: 5 }, () => w.participant(w.customerId)));
    const c = codes(await Promise.allSettled(people.map((p) => w.redeem(w.customerId, packId, ts, [p]))));
    expect(c.filter((x) => x === "ok")).toHaveLength(1);
    expect(c.filter((x) => x === "pack_unavailable")).toHaveLength(4);
  });

  test("confirm then Closure: Tickets stay issued awaiting the Customer's choice, no allocations", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    expect(await w.pay(h)).toMatchObject({ status: "paid" });
    await w.b.closeTimeslot(ts, "weather");
    expect(await w.allocationCount()).toBe(0);
    expect(await w.sql("SELECT status FROM tickets")).toEqual([{ status: "issued" }]);
  });

  test("Closure then confirm: refund_due/unavailable, no allocations", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    await w.b.closeTimeslot(ts, "weather");
    expect(await w.pay(h)).toEqual({ status: "refund_due", reason: "unavailable" });
    expect(await w.allocationCount()).toBe(0);
  });

  test("Reschedule then cancel applies the Cancellation Policy of the new Timeslot", async () => {
    const w = await rideWorld();
    const closed = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const soon = await w.slot(w.optionId, Date.now() + 2 * 3600_000);
    const p = await w.participant(w.customerId);
    const {
      ticketIds: [ticketId],
    } = await w.book(w.customerId, closed, [p]);
    await w.b.closeTimeslot(closed, "weather");
    await w.reschedule(w.customerId, ticketId, soon, p);
    expect(await w.cancel(w.customerId, ticketId)).toEqual({ status: "forfeited" });
  });

  test("cancel then Reschedule: cancelled, and the Reschedule is invalid_state", async () => {
    const w = await rideWorld();
    const closed = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const soon = await w.slot(w.optionId, Date.now() + 2 * 3600_000);
    const p = await w.participant(w.customerId);
    const {
      ticketIds: [ticketId],
    } = await w.book(w.customerId, closed, [p]);
    await w.b.closeTimeslot(closed, "weather");
    expect(await w.cancel(w.customerId, ticketId)).toEqual({ status: "cancelled" });
    await expect(w.reschedule(w.customerId, ticketId, soon, p)).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("concurrent confirms with one billId return the same Booking; a second bill is a duplicate", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    const billId = rid();
    const results = await Promise.all(Array.from({ length: 5 }, () => w.pay(h, billId)));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toMatchObject({ status: "paid" });
    expect(await w.count("SELECT count(*) AS n FROM bookings")).toBe(1);
    expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(1);
    expect(await w.pay(h)).toEqual({ status: "refund_due", reason: "duplicate" });
  });
});

test("last slot across overlapping Options: holds and Pack redemptions race, exactly one wins", async () => {
  const w = await rideWorld();
  const optionB = await w.option();
  const a = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const b = await w.slot(optionB, kl(`${DAY}T09:30`));
  const { packId } = await w.pack(w.customerId, 1, kl("2030-12-31T00:00"));
  const people = await Promise.all(Array.from({ length: 25 }, () => w.participant(w.customerId)));
  const c = codes(
    await Promise.allSettled([
      ...people.slice(0, 10).map((p) => w.hold(w.customerId, a, [p])),
      ...people.slice(10, 20).map((p) => w.hold(w.customerId, b, [p])),
      ...people.slice(20).map((p) => w.redeem(w.customerId, packId, a, [p])),
    ]),
  );
  expect(c.filter((x) => x === "ok")).toHaveLength(1);
  expect(c.filter((x) => x !== "ok" && x !== "no_availability" && x !== "pack_unavailable")).toEqual([]);
  expect(await w.allocationCount()).toBe(1);
  const active = await w.count("SELECT count(*) AS n FROM holds WHERE status = 'active'");
  const issued = await w.count("SELECT count(*) AS n FROM tickets WHERE status = 'issued'");
  expect(active + issued).toBe(1);
});

test("the overlap trigger rejects an overlapping raw insert and allows an adjacent one", async () => {
  const w = await rideWorld();
  const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
  const copy = (start: string, end: string) =>
    w.sql(
      `INSERT INTO allocations (id, resource_id, participant_id, hold_id, ticket_id, block_start, block_end)
       SELECT ?, resource_id, participant_id, hold_id, ticket_id, ${start}, ${end} FROM allocations LIMIT 1`,
      rid(),
    );
  await expect(copy("block_start", "block_end")).rejects.toThrow(/allocations_no_overlap/);
  await copy("block_end", "block_end + 10");
  expect(await w.allocationCount()).toBe(2);
});

describe("welfare rules", () => {
  test("rest gap blocks back-to-back use in both directions", async () => {
    const w = await rideWorld({ restMinutes: 30 });
    const p = await w.participant(w.customerId);
    await w.book(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p]);
    for (const t of ["08:00", "10:00"]) {
      await expect(w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T${t}`)), [p])).rejects.toMatchObject({
        code: "no_availability",
      });
    }
    await w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T10:30`)), [p]);
  });

  test("max sessions/day counts the Kuala Lumpur day, not the UTC day", async () => {
    const w = await rideWorld({ maxSessionsPerDay: 1 });
    const p = await w.participant(w.customerId);
    await w.book(w.customerId, await w.slot(w.optionId, kl(`${DAY}T08:00`)), [p]);
    await expect(w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T23:00`)), [p])).rejects.toMatchObject({
      code: "no_availability",
    });
    await w.hold(w.customerId, await w.slot(w.optionId, kl("2030-01-16T00:30")), [p]);
  });

  test("rider weight picks the tightest horse, heaviest rider first", async () => {
    const w = await operator();
    const optionId = await w.option();
    const h80 = await w.resource({ maxRiderWeightKg: 80 });
    const h100 = await w.resource({ maxRiderWeightKg: 100 });
    const customerId = await customer();
    const heavy = await w.participant(customerId, { weightKg: 90 });
    const tooHeavy = await w.participant(customerId, { weightKg: 110 });
    const light = await w.participant(customerId, { weightKg: 70 });
    const ts1 = await w.slot(optionId, kl(`${DAY}T09:00`));
    const ts2 = await w.slot(optionId, kl(`${DAY}T11:00`));

    await w.hold(customerId, ts1, [heavy]);
    expect(await w.sql("SELECT resource_id FROM allocations")).toEqual([{ resource_id: h100 }]);
    await expect(w.hold(customerId, ts2, [tooHeavy])).rejects.toMatchObject({ code: "no_availability" });

    await w.hold(customerId, ts2, [light, heavy]);
    const picked = await w.sql(
      "SELECT participant_id, resource_id FROM allocations WHERE block_start = ?",
      kl(`${DAY}T11:00`),
    );
    expect(Object.fromEntries(picked.map((r) => [r.participant_id, r.resource_id]))).toEqual({
      [heavy]: h100,
      [light]: h80,
    });
  });
});

test("multi-resource Option is atomic when one Resource is busy", async () => {
  const w = await operator();
  const lesson = await w.option({}, [
    ["horse", 1],
    ["instructor", 1],
  ]);
  const instructorOnly = await w.option({}, [["instructor", 1]]);
  await w.resource();
  await w.resource({ kind: "instructor", name: "Faiz" });
  const customerId = await customer();
  const p = await w.participant(customerId);
  const q = await w.participant(customerId);
  await w.hold(customerId, await w.slot(instructorOnly, kl(`${DAY}T09:00`)), [p]);
  await expect(w.hold(customerId, await w.slot(lesson, kl(`${DAY}T09:00`)), [q])).rejects.toMatchObject({
    code: "no_availability",
  });
  expect(await w.allocationCount()).toBe(1);
});

describe("holds", () => {
  test("a swept expired Hold whose Timeslot was then taken is refund_due/unavailable", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const old = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    await w.expireHold(old.holdId);
    await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    expect(await w.pay(old)).toEqual({ status: "refund_due", reason: "unavailable" });
  });

  test("an expired Hold with a free horse is paid with a fresh allocation", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    await w.expireHold(h.holdId);
    const r = await w.pay(h);
    expect(r).toMatchObject({ status: "paid", ticketIds: [expect.any(String)] });
    const ticketId = r.status === "paid" ? r.ticketIds[0] : "";
    expect(await w.sql("SELECT hold_id, ticket_id FROM allocations")).toEqual([{ hold_id: null, ticket_id: ticketId }]);
    expect(await w.sql("SELECT status FROM holds")).toEqual([{ status: "confirmed" }]);
  });

  test("a Hold whose Timeslot has started is refund_due/unavailable with no Tickets", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T12:00`));
    const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    await w.startSlot(ts);
    expect(await w.pay(h)).toEqual({ status: "refund_due", reason: "unavailable" });
    expect(await w.count("SELECT count(*) AS n FROM tickets")).toBe(0);
    expect(await w.allocationCount()).toBe(0);
  });

  test("confirm keeps the Hold price and moves allocations to the Tickets", async () => {
    const w = await rideWorld();
    await w.resource();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const people = [await w.participant(w.customerId), await w.participant(w.customerId)];
    const h = await w.hold(w.customerId, ts, people);
    expect(h.amountSen).toBe(20000);
    await w.editOption(w.optionId, { priceSen: 99900 });
    const r = await w.pay(h);
    expect(r).toMatchObject({ status: "paid", ticketIds: [expect.any(String), expect.any(String)] });
    const rows = await w.sql(
      `SELECT t.price_sen AS price, t.participant_id AS tp, a.participant_id AS ap, a.hold_id AS h
       FROM tickets t JOIN allocations a ON a.ticket_id = t.id`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ price: 10000, tp: row.ap, h: null });
    expect(await w.sql("SELECT status FROM holds")).toEqual([{ status: "confirmed" }]);
  });

  test("a Closure during a Hold makes confirm refund_due/unavailable", async () => {
    const w = await rideWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const h = await w.hold(w.customerId, ts, [await w.participant(w.customerId)]);
    await w.b.closeTimeslot(ts, "weather");
    expect(await w.pay(h)).toEqual({ status: "refund_due", reason: "unavailable" });
    expect(await w.allocationCount()).toBe(0);
  });
});

describe("gating", () => {
  test("Requirements", async () => {
    const w = await operator();
    const optionId = await w.option({ minAge: 12, maxWeightKg: 90, requiredCert: "level1" });
    await w.resource();
    const customerId = await customer();
    const ts = await w.slot(optionId, kl(`${DAY}T09:00`));
    const ok = { certs: ["level1"] };
    const cases = [
      await w.participant(customerId, { ...ok, birthDate: "2018-01-16" }),
      await w.participant(customerId, { ...ok, weightKg: 95 }),
      await w.participant(customerId, { ...ok, weightKg: null }),
      await w.participant(customerId),
    ];
    for (const p of cases) {
      await expect(w.hold(customerId, ts, [p])).rejects.toMatchObject({ code: "requirement_not_met" });
    }
    await w.hold(customerId, ts, [await w.participant(customerId, { ...ok, birthDate: "2018-01-15" })]);
  });

  test("unknown weight on an Option where every free horse has a weight cap is requirement_not_met", async () => {
    const w = await rideWorld({ maxRiderWeightKg: 100 });
    const p = await w.participant(w.customerId, { weightKg: null });
    await expect(w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p])).rejects.toMatchObject({
      code: "requirement_not_met",
    });
  });

  test("Participants must be known, unique, the Customer's own, and not already ticketed on the Timeslot", async () => {
    const w = await rideWorld();
    await w.resource();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const p = await w.participant(w.customerId);
    const stranger = await w.participant(await customer());
    for (const ids of [[p, p], [stranger], [], [rid()]]) {
      await expect(w.hold(w.customerId, ts, ids)).rejects.toMatchObject({ code: "invalid_participant" });
    }
    await w.book(w.customerId, ts, [p]);
    await expect(w.hold(w.customerId, ts, [p])).rejects.toMatchObject({ code: "invalid_participant" });
  });

  test("a Participant can't be in overlapping Timeslots of different Options, but can back-to-back", async () => {
    const w = await rideWorld();
    await w.resource();
    await w.resource();
    const lesson = await w.option({ durationMinutes: 45 });
    const p = await w.participant(w.customerId);
    await w.book(w.customerId, await w.slot(w.optionId, kl(`${DAY}T10:00`)), [p]);
    await expect(w.hold(w.customerId, await w.slot(lesson, kl(`${DAY}T10:15`)), [p])).rejects.toMatchObject({
      code: "invalid_participant",
    });
    await expect(w.hold(w.customerId, await w.slot(lesson, kl(`${DAY}T09:15`)), [p])).resolves.toBeDefined();
    await expect(w.hold(w.customerId, await w.slot(lesson, kl(`${DAY}T11:00`)), [p])).resolves.toBeDefined();
  });

  test("Waiver is required before a Hold and at Pack redemption", async () => {
    const w = await rideWorld();
    const p = await w.participant(w.customerId, { waiver: false });
    await expect(w.hold(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p])).rejects.toMatchObject({
      code: "waiver_missing",
    });
    expect(await w.count("SELECT count(*) AS n FROM holds")).toBe(0);
    const { packId } = await w.pack(w.customerId, 5, kl("2030-12-31T00:00"));
    await expect(
      w.redeem(w.customerId, packId, await w.slot(w.optionId, kl(`${DAY}T12:00`)), [p]),
    ).rejects.toMatchObject({ code: "waiver_missing" });
  });

  test("closed, past, and Resource-less Timeslots are not bookable", async () => {
    const w = await rideWorld();
    const p = await w.participant(w.customerId);
    const closed = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    await w.b.closeTimeslot(closed, "weather");
    const past = await w.slot(w.optionId, kl(`${DAY}T10:00`));
    await w.startSlot(past, kl("2020-01-01T09:00"));
    const bare = await w.slot(await w.option({}, []), kl(`${DAY}T09:00`));
    for (const ts of [closed, past, bare]) {
      await expect(w.hold(w.customerId, ts, [p])).rejects.toMatchObject({ code: "not_bookable" });
    }
  });
});

describe("Closure, cancel and Packs", () => {
  async function packWorld(expiresAt = kl("2030-12-31T00:00")) {
    const w = await rideWorld();
    const { packId } = await w.pack(w.customerId, 2, expiresAt);
    const p = await w.participant(w.customerId);
    const redeem = (timeslotId: string) => w.redeem(w.customerId, packId, timeslotId, [p]);
    const used = () => w.count("SELECT count(*) AS n FROM tickets WHERE pack_id = ? AND status <> 'cancelled'", packId);
    return { ...w, packId, p, redeem, used };
  }

  test("Closure frees Resources; Refund returns the Pack session", async () => {
    const w = await packWorld();
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const {
      ticketIds: [ticketId],
    } = await w.redeem(ts);
    expect(await w.used()).toBe(1);
    await w.b.closeTimeslot(ts, "weather");
    expect(await w.allocationCount()).toBe(0);
    const other = await w.option();
    await w.hold(w.customerId, await w.slot(other, kl(`${DAY}T09:00`)), [await w.participant(w.customerId)]);
    expect(await w.cancel(w.customerId, ticketId)).toEqual({ status: "cancelled" });
    expect(await w.used()).toBe(0);
  });

  test("Reschedule only from a closed Timeslot, same Option, ignoring Pack expiry", async () => {
    const w = await packWorld(kl(`${DAY}T12:00`));
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const later = await w.slot(w.optionId, kl("2030-02-01T09:00"));
    const otherOption = await w.slot(await w.option(), kl("2030-02-01T12:00"));
    const {
      ticketIds: [ticketId],
    } = await w.redeem(ts);
    await expect(w.reschedule(w.customerId, ticketId, later, w.p)).rejects.toMatchObject({ code: "invalid_state" });
    await w.b.closeTimeslot(ts, "weather");
    await expect(w.reschedule(w.customerId, ticketId, otherOption, w.p)).rejects.toMatchObject({
      code: "invalid_state",
    });
    await w.reschedule(w.customerId, ticketId, later, w.p);
    expect(await w.sql("SELECT timeslot_id, status FROM tickets")).toEqual([{ timeslot_id: later, status: "issued" }]);
    expect(await w.sql("SELECT ticket_id FROM allocations")).toEqual([{ ticket_id: ticketId }]);
    await expect(w.reschedule(w.customerId, ticketId, later, w.p)).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("Cancellation Policy: in window cancelled, late forfeited and the Pack session stays used", async () => {
    const w = await packWorld();
    const p2 = await w.participant(w.customerId);
    const early = await w.book(w.customerId, await w.slot(w.optionId, kl(`${DAY}T09:00`)), [p2]);
    expect(await w.cancel(w.customerId, early.ticketIds[0])).toEqual({ status: "cancelled" });
    await expect(w.cancel(w.customerId, early.ticketIds[0])).rejects.toMatchObject({ code: "invalid_state" });

    const soon = await w.slot(w.optionId, Date.now() + 2 * 3600_000);
    const {
      ticketIds: [late],
    } = await w.redeem(soon);
    expect(await w.cancel(w.customerId, late)).toEqual({ status: "forfeited" });
    expect(await w.used()).toBe(1);
    expect(await w.allocationCount()).toBe(0);
  });

  test("a started Timeslot can be neither cancelled nor closed, so its Welfare Rule usage stays", async () => {
    const w = await rideWorld({ maxSessionsPerDay: 1 });
    const p = await w.participant(w.customerId);
    const ts = await w.slot(w.optionId, kl(`${DAY}T09:00`));
    const {
      ticketIds: [ticketId],
    } = await w.book(w.customerId, ts, [p]);
    await w.startSlot(ts);
    await expect(w.cancel(w.customerId, ticketId)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(w.b.closeTimeslot(ts, "weather")).rejects.toMatchObject({ code: "invalid_state" });
    expect(await w.allocationCount()).toBe(1);
  });

  test("Pack expiry and another Operator's Timeslot are pack_unavailable", async () => {
    const w = await packWorld(kl(`${DAY}T00:00`));
    await expect(w.redeem(await w.slot(w.optionId, kl(`${DAY}T09:00`)))).rejects.toMatchObject({
      code: "pack_unavailable",
    });
    const other = await operator();
    await other.resource();
    const foreign = await other.slot(await other.option(), kl("2029-06-01T09:00"));
    await expect(w.redeem(foreign)).rejects.toMatchObject({ code: "pack_unavailable" });
  });
});
