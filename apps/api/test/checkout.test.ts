import { describe, expect, test, vi } from "vitest";
import { adult, client, d1, fake, held, pay, returnPath, rid, signIn, SLOT_AT, start, world, type World } from "./helpers";

describe("POST /checkouts", () => {
  test("BOOK_DRAFTS gates unpublished Activities", async () => {
    const w = await world({ published: false });
    const body = { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 1, addOns: [], locale: "en" };
    expect((await client().json("POST", "/checkouts", body)).body).toEqual({ code: "not_bookable" });
    expect((await client({ BOOK_DRAFTS: "1" }).json("POST", "/checkouts", body)).status).toBe(201);
  });

  test("checks the group minimum, the Timeslot's Option, spots and Add-ons", async () => {
    const w = await world({ option: { minParticipants: 2 } });
    const cl = client();
    const post = (o: object) =>
      cl.json("POST", "/checkouts", { optionId: w.optionId, timeslotId: w.timeslotId, quantity: 2, addOns: [], ...o });
    expect((await post({ quantity: 1 })).body).toEqual({ code: "below_min_participants", field: "quantity", params: { min: 2 } });
    expect((await post({ quantity: 3 })).body).toMatchObject({ code: "no_availability" });
    expect((await post({ timeslotId: rid() })).body).toEqual({ code: "not_bookable" });
    expect((await post({ addOns: [{ id: w.helmetId, qty: 3 }] })).body).toMatchObject({ code: "invalid_add_on" });
    expect((await post({ addOns: [{ id: rid(), qty: 1 }] })).body).toMatchObject({ code: "invalid_add_on" });
    expect((await post({ addOns: [{ id: w.helmetId, qty: 2 }] })).status).toBe(201);
  });
});

describe("Participants and Waivers", () => {
  const who = async (people: unknown[], quantity = people.length) => {
    const w = await world({ horses: 3 });
    const cl = client();
    const id = await start(cl, w, quantity);
    return cl.json("PUT", `/checkouts/${id}/who`, { participants: people });
  };

  test("a minor needs a guardian tick and name", async () => {
    const kid = { name: "Adam", birthDate: "2016-03-01", weightKg: 30, waiver: { accepted: true } };
    expect((await who([kid])).body).toMatchObject({ code: "waiver_missing", field: "participants.0.waiver", params: { name: "Adam" } });
    expect((await who([{ ...kid, waiver: { accepted: true, guardian: true } }])).body).toMatchObject({
      code: "waiver_missing",
      field: "participants.0.guardianName",
    });
    expect((await who([{ ...kid, waiver: { accepted: true, guardian: true, guardianName: "Siti" } }])).body).toEqual({
      next: "contact",
    });
  });

  test("an Activity that doesn't require a Waiver books with no Waiver step", async () => {
    const w = await world({ requiresWaiver: false });
    const cl = client();
    const id = await start(cl, w);
    expect((await cl.json("GET", `/checkouts/${id}`)).body.waiver).toBeNull();
    const kid = { name: "No Signer", birthDate: "2016-03-01", weightKg: 30 };
    expect((await cl.json("PUT", `/checkouts/${id}/who`, { participants: [kid] })).body).toEqual({ next: "contact" });
    expect((await signIn(cl, id, `${rid()}@example.com`)).body).toEqual({ next: "pay" });
    expect(await d1("SELECT count(*) AS n FROM waivers JOIN participants p ON p.id = participant_id WHERE p.name = 'No Signer'")).toEqual([{ n: 0 }]);
  });

  test("Requirements are pre-checked against the Timeslot date", async () => {
    const young = { ...adult("Tiny"), birthDate: "2025-01-01", waiver: { accepted: true, guardian: true, guardianName: "Mum" } };
    expect((await who([young])).body).toMatchObject({ code: "requirement_not_met", params: { rule: "min_age", value: 7 } });
    expect((await who([adult("Big", { weightKg: 120 })])).body).toMatchObject({
      code: "requirement_not_met",
      field: "participants.0.weightKg",
      params: { rule: "max_weight", value: 90 },
    });
    expect((await who([adult("NoWeight", { weightKg: undefined })])).body).toMatchObject({ code: "weight_invalid" });
    expect((await who([adult(), adult()])).body).toMatchObject({ code: "invalid_participant" });
    expect((await who([adult()], 2)).body).toMatchObject({ code: "invalid_participant", field: "participants" });
    const both = await who([{ ...adult(""), birthDate: "bad" }]);
    expect(both.body.errors).toHaveLength(2);
  });
});

describe("Checkout states", () => {
  test("draft → held with Add-ons priced → expired → held again → booked", async () => {
    const w = await world();
    const cl = client();
    const id = await start(cl, w, 2, [{ id: w.helmetId, qty: 1 }]);
    expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({ state: "draft", estimatedSen: 20500 });
    await cl.json("PUT", `/checkouts/${id}/who`, { participants: [adult("A One"), adult("B Two")] });
    await signIn(cl, id, `${rid()}@example.com`);
    const held1 = (await cl.json("GET", `/checkouts/${id}`)).body;
    expect(held1).toMatchObject({ state: "held", amountSen: 20500, participants: [{ name: "A One" }, { name: "B Two" }] });

    await d1("UPDATE checkouts SET hold_expires_at = ? WHERE id = ?", Date.now() + 30_000, id);
    expect((await cl.json("POST", `/checkouts/${id}/pay`)).body).toEqual({ code: "hold_expired" });
    await d1("UPDATE checkouts SET hold_expires_at = 1 WHERE id = ?", id);
    expect((await cl.json("GET", `/checkouts/${id}`)).body.state).toBe("expired");
    expect((await cl.json("POST", `/checkouts/${id}/hold`)).body).toEqual({ next: "pay" });
    expect(await w.doSql("SELECT status FROM holds ORDER BY created_at")).toEqual([{ status: "released" }, { status: "active" }]);

    const { billId } = await pay(cl, id);
    const r = await cl.json("GET", returnPath((await fake(billId, "pay"))!));
    expect(r.body.state).toBe("booked");
    const ticket = await cl.json("GET", `/bookings/${r.body.bookingId}`);
    expect(ticket.body).toMatchObject({ amountSen: 20500, addOns: [{ addOnId: w.helmetId, quantity: 1, nameEn: "Helmet" }] });
    expect((await cl.json("POST", `/checkouts/${id}/hold`)).body).toEqual({ code: "invalid_state" });
  });

  test("a returning signed-in Customer skips OTP, sees saved Participants, and can resubmit", async () => {
    const w = await world({ horses: 3 });
    const { cl } = await held(w, { people: [adult("Saved Rider")] });
    const id = await start(cl, w);
    const view = (await cl.json("GET", `/checkouts/${id}`)).body;
    expect(view.signedIn).toBe(true);
    expect(view.savedParticipants).toEqual([expect.objectContaining({ name: "Saved Rider", waiverSignedAt: expect.any(Number) })]);
    const again = { ...adult("saved rider "), waiver: undefined };
    expect((await cl.json("PUT", `/checkouts/${id}/who`, { participants: [again] })).body).toEqual({ next: "pay" });
    expect((await cl.json("PUT", `/checkouts/${id}/who`, { participants: [again] })).body).toEqual({ next: "pay" });
    expect(await d1("SELECT count(*) AS n FROM participants WHERE name = 'Saved Rider'")).toEqual([{ n: 1 }]);
  });

  test("the last spot races: one Checkout gets no_availability at Hold", async () => {
    const w = await world({ horses: 1 });
    const [a, b] = [client(), client()];
    const ids = [await start(a, w), await start(b, w)];
    await a.json("PUT", `/checkouts/${ids[0]}/who`, { participants: [adult("Racer A")] });
    await b.json("PUT", `/checkouts/${ids[1]}/who`, { participants: [adult("Racer B")] });
    const results = await Promise.all([signIn(a, ids[0], `${rid()}@x.my`), signIn(b, ids[1], `${rid()}@x.my`)]);
    expect(results.map((r) => r.body.next ?? r.body.code).sort()).toEqual(["no_availability", "pay"]);
  });
});

test("logs carry no PII", async () => {
  const spies = (["log", "error", "warn", "info"] as const).map((m) => vi.spyOn(console, m));
  const w = await world();
  const { cl, id, email } = await held(w, { people: [adult("Nurul Pii")] });
  const { billId } = await pay(cl, id);
  await cl.json("GET", returnPath((await fake(billId, "pay"))!));
  const lines = spies
    .flatMap((s) => s.mock.calls)
    .map((args) => args.map(String).join(" "))
    .filter((l) => !l.includes('"event":"dev_email"'));
  expect(lines.some((l) => l.includes("otp_sent"))).toBe(true);
  for (const l of lines) {
    expect(l).not.toContain(email);
    expect(l).not.toContain("Nurul");
    expect(l).not.toContain("Aiman");
  }
});

test("BOOK_DRAFTS is enforced again at Hold", async () => {
  const w = await world({ published: false });
  const cl = client({ BOOK_DRAFTS: "1" });
  const id = await start(cl, w);
  await cl.json("PUT", `/checkouts/${id}/who`, { participants: [adult()] });
  await signIn(cl, id, `${rid()}@example.com`);
  const prod = client();
  prod.cookie = cl.cookie;
  expect((await prod.json("POST", `/checkouts/${id}/hold`)).body).toEqual({ code: "not_bookable" });
});

const DAY = 86_400_000;

async function laneWorld() {
  const w = await world({ option: { maxWeightKg: null, minAge: null, needs: [{ kind: "auto_belay_lane", quantity: 1 }] } });
  for (let i = 0; i < 3; i++) {
    await w.b.upsertResource({
      id: `lane${i}_${w.operatorId}`,
      kind: "auto_belay_lane",
      name: `Lane ${i}`,
      active: true,
      maxSessionsPerDay: null,
      restMinutes: 0,
      maxRiderWeightKg: null,
    });
  }
  await w.flush();
  return w;
}

const checkoutFor = async (cl: ReturnType<typeof client>, w: World, timeslotId = w.timeslotId, quantity = 1) =>
  (await cl.json<{ id: string }>("POST", "/checkouts", { optionId: w.optionId, timeslotId, quantity, addOns: [], locale: "en" })).body.id;

describe("returning Customers", () => {
  test("re-book a saved Participant on an Option that asks no weight or cert, signed in and on a new device", async () => {
    const w = await laneWorld();
    const climber = { name: "Lane Climber", birthDate: "1990-05-01", waiver: { accepted: true } };
    const { cl, email } = await held(w, { people: [climber] });
    const again = await start(cl, w);
    expect((await cl.json("PUT", `/checkouts/${again}/who`, { participants: [climber] })).body).toEqual({ next: "pay" });
    expect((await cl.json("PUT", `/checkouts/${again}/who`, { participants: [climber] })).body).toEqual({ next: "pay" });

    const device = client({ RL_OTP_EMAIL: { limit: async () => ({ success: true }) } as RateLimit });
    const fresh = await start(device, w);
    expect((await device.json("PUT", `/checkouts/${fresh}/who`, { participants: [climber] })).body).toEqual({ next: "contact" });
    expect((await signIn(device, fresh, email)).body).toEqual({ next: "pay" });
    expect((await device.json("GET", `/checkouts/${fresh}`)).body).toMatchObject({ state: "held", participants: [{ name: "Lane Climber" }] });
    expect(await d1("SELECT count(*) AS n FROM participants WHERE name = 'Lane Climber'")).toEqual([{ n: 1 }]);
  });
});

describe("another Checkout's Hold", () => {
  test("for another day leaves the first Checkout held; a clashing one expires it and drops its bill", async () => {
    const w = await world({ horses: 3 });
    const pat = adult("Pat Rider");
    const { cl, id: first } = await held(w, { people: [pat] });
    const { billId } = await pay(cl, first);
    const {
      ids: [later],
    } = await w.b.createTimeslots({ optionId: w.optionId, startsAt: [SLOT_AT + 10 * DAY] });
    await w.flush();

    const other = await checkoutFor(cl, w, later);
    expect((await cl.json("PUT", `/checkouts/${other}/who`, { participants: [pat] })).body).toEqual({ next: "pay" });
    expect((await cl.json("GET", `/checkouts/${first}`)).body.state).toBe("held");
    expect(await d1("SELECT deleted_at FROM bills WHERE id = ?", billId)).toEqual([{ deleted_at: null }]);

    const clash = await start(cl, w);
    expect((await cl.json("PUT", `/checkouts/${clash}/who`, { participants: [pat] })).body).toEqual({ next: "pay" });
    expect((await cl.json("GET", `/checkouts/${first}`)).body.state).toBe("expired");
    expect(await d1("SELECT deleted_at IS NOT NULL AS gone FROM bills WHERE id = ?", billId)).toEqual([{ gone: 1 }]);
  });
});

test("re-Holds per Checkout are capped", async () => {
  const w = await world();
  const { cl, id } = await held(w);
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await cl.json("POST", `/checkouts/${id}/hold`)).body.next ?? "");
  expect(codes.slice(0, 7).every((c) => c === "pay")).toBe(true);
  expect((await cl.json("POST", `/checkouts/${id}/hold`)).body).toEqual({ code: "too_many_holds" });
});

test("a signed-in who whose Hold fails keeps the held Participants and Hold", async () => {
  const w = await world({ option: { maxWeightKg: null } });
  const { cl, id } = await held(w, { people: [adult("Kept Rider")] });
  const before = (await cl.json("GET", `/checkouts/${id}`)).body;
  const r = await cl.json("PUT", `/checkouts/${id}/who`, { participants: [adult("Heavy Rider", { weightKg: 120 })] });
  expect(r.body).toEqual({ code: "no_availability" });
  expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({
    state: "held",
    amountSen: before.amountSen,
    participants: [{ name: "Kept Rider" }],
  });
});

test("Participants are listed in the order entered and the review uses the Hold's prices", async () => {
  const w = await world();
  const { cl, id } = await held(w, { quantity: 2, people: [adult("Zed Rider"), adult("Abe Rider")], addOns: [{ id: w.helmetId, qty: 1 }] });
  await w.b.upsertAddOn({ id: w.helmetId, activityId: w.activityId, nameEn: "Helmet", nameMs: "Topi", priceSen: 900, active: true });
  await w.flush();
  const view = (await cl.json("GET", `/checkouts/${id}`)).body;
  expect(view.participants.map((p: { name: string }) => p.name)).toEqual(["Zed Rider", "Abe Rider"]);
  expect(view).toMatchObject({ amountSen: 20500, addOns: [{ id: w.helmetId, qty: 1, priceSen: 500 }] });
});

test("an invalid POST /checkouts creates no session", async () => {
  const w = await world();
  const sessions = async () => (await d1<{ n: number }>("SELECT count(*) AS n FROM sessions"))[0].n;
  const before = await sessions();
  const res = await client().call("POST", "/checkouts", { optionId: w.optionId, timeslotId: rid(), quantity: 1 });
  expect(res.status).toBe(409);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await sessions()).toBe(before);
});
