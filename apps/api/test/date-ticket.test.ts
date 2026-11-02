import { venues } from "@komugo/db";
import { klDate, WEEKDAYS } from "@komugo/types";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { devInbox } from "../src/email";
import { adult, d1, db, DAY_MS, fake, kl, member, pay, publishable, returnPath, rid, signedIn, world } from "./helpers";

const DATE = {
  nameEn: "Day pass",
  nameMs: "Pas harian",
  priceSen: 1500,
  durationMinutes: 60,
  minAge: null,
  maxAge: null,
  maxWeightKg: null,
  requiredCert: null,
  minParticipants: null,
  maxPerBooking: null,
  ticketType: "date",
  active: true,
  needs: [],
};

// A gym whose Date ticket Option takes its Venue's hours, as the Activity has none of its own.
async function gym(dailyLimit: number | null = null) {
  const w = await world({ requiresWaiver: false });
  const venueId = await publishable(w);
  await db.update(venues).set({ openingHours: [{ days: WEEKDAYS, opens: "07:00", closes: "22:00" }] }).where(eq(venues.id, venueId));
  const m = await member("staff");
  const base = `/ops/operators/${w.operatorId}`;
  const r = await m.json<{ id: string }>("POST", `${base}/options`, { ...DATE, activityId: w.activityId, dailyLimit });
  expect(r.status).toBe(201);
  await w.flush();
  const tomorrow = klDate(Date.now() + DAY_MS);
  const [slot] = await d1<{ id: string; spots: number }>(
    "SELECT id, spots FROM proj_timeslots WHERE option_id = ? AND starts_at = ?",
    r.body.id,
    kl(`${tomorrow}T07:00`),
  );
  return { ...w, m, base, venueId, dateOptionId: r.body.id, slot, tomorrow };
}

test("a Customer buys gym tickets for a date end-to-end and gets QR Tickets valid during that day's opening hours", async () => {
  const g = await gym(3);
  expect(g.slot.spots).toBe(3);
  expect(await d1("SELECT ends_at FROM proj_timeslots WHERE id = ?", g.slot.id)).toEqual([{ ends_at: kl(`${g.tomorrow}T22:00`) }]);
  const email = `${rid()}@example.com`;
  const cl = await signedIn(email);
  const post = (quantity: number) => cl.json("POST", "/checkouts", { optionId: g.dateOptionId, timeslotId: g.slot.id, quantity, addOns: [], locale: "en" });
  expect((await post(4)).body).toEqual({ code: "no_availability", params: { spots: 3 } });
  const started = await post(2);
  expect(started.body).toEqual({ id: expect.any(String), next: "who" });
  const id = started.body.id;
  expect((await cl.json("GET", `/checkouts/${id}`)).body).toMatchObject({ option: { ticketType: "date" }, endsAt: kl(`${g.tomorrow}T22:00`) });
  expect((await cl.json("PUT", `/checkouts/${id}/who`, { participants: [adult("Aisyah"), adult("Adam")] })).body).toEqual({ next: "pay" });
  const { billId } = await pay(cl, id);
  const r = await cl.json("GET", returnPath((await fake(billId, "pay"))!));
  expect(r.body.state).toBe("booked");
  const booking = await cl.json("GET", `/bookings/${r.body.bookingId}`);
  expect(booking.body.tickets).toEqual([
    expect.objectContaining({ participantName: "Aisyah", startsAt: kl(`${g.tomorrow}T07:00`), endsAt: kl(`${g.tomorrow}T22:00`) }),
    expect.objectContaining({ participantName: "Adam" }),
  ]);
  expect(devInbox.find((e) => e.to === email && e.subject.startsWith("Booking confirmed"))?.text).toMatch(/7:00.*–.*10:00/);
  await g.flush();
  expect(await d1("SELECT spots FROM proj_timeslots WHERE id = ?", g.slot.id)).toEqual([{ spots: 1 }]);
});

test("Venue hours reach its Activities' Date tickets; ops validates Ticket type and Daily limit", async () => {
  const g = await gym();
  const staff = await member("staff");
  const [v] = await db.select().from(venues).where(eq(venues.id, g.venueId));
  const photos = [{ url: "https://images.unsplash.com/photo-1", width: 1600, height: 1067, altEn: "a", altMs: "a", creditName: "a", creditUrl: "https://unsplash.com/@a", sourceUrl: "https://unsplash.com/photos/1" }];
  const saved = await staff.json("PUT", `/ops/venues/${g.venueId}`, { ...v, openingHours: [{ days: WEEKDAYS, opens: "09:00", closes: "18:00" }], photos });
  expect(saved.status).toBe(200);
  await g.flush();
  expect(await d1("SELECT starts_at, ends_at FROM proj_timeslots WHERE id = ?", g.slot.id)).toEqual([
    { starts_at: kl(`${g.tomorrow}T09:00`), ends_at: kl(`${g.tomorrow}T18:00`) },
  ]);
  const option = { ...DATE, activityId: g.activityId };
  expect((await g.m.json("POST", `${g.base}/options`, { ...option, ticketType: "timeslot", dailyLimit: 5 })).body).toMatchObject({ field: "dailyLimit" });
  expect((await g.m.json("POST", `${g.base}/options`, { ...option, bookingUnit: "court" })).body).toMatchObject({ field: "ticketType" });
  const offer = { activityId: g.activityId, nameEn: "4 visits", nameMs: "4 lawatan", sessions: 4, priceSen: 5000, validDays: 90, optionIds: [g.dateOptionId], active: true };
  expect(await g.m.json("POST", `${g.base}/pack-offers`, offer)).toEqual({ status: 409, body: { code: "invalid_state" } });
});

test("closing a date emails each Customer to choose a Refund or a move to another date", async () => {
  const g = await gym();
  const email = `${rid()}@example.com`;
  const cl = await signedIn(email);
  const { body } = await cl.json("POST", "/checkouts", { optionId: g.dateOptionId, timeslotId: g.slot.id, quantity: 1, addOns: [], locale: "ms" });
  await cl.json("PUT", `/checkouts/${body.id}/who`, { participants: [adult("Aisyah")] });
  const { billId } = await pay(cl, body.id);
  await cl.json("GET", returnPath((await fake(billId, "pay"))!));
  const own = await member("operator", g.operatorId);
  const r = await own.json("POST", `${g.base}/timeslots/${g.slot.id}/close`, { reason: "maintenance" });
  expect(r.status).toBe(200);
  const [mail] = devInbox.filter((e) => e.to === email && e.subject.startsWith("Tarikh ditutup"));
  expect(mail.text).toMatch(/7:00.*–.*10:00/);
  expect(mail.text).toContain("tukar ke tarikh lain secara percuma, atau dapatkan bayaran balik penuh");
});
