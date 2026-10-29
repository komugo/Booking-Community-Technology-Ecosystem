import { WEEKDAYS } from "@komugo/types";
import { expect, test } from "vitest";
import { DAY, kl, rid, rideWorld } from "./helpers";

const H = 3_600_000;

test("timeslots lists a range or ids with issued Tickets, horse names, Add-ons per Booking and spots", async () => {
  const w = await rideWorld({ name: "Bayu" });
  await w.resource({ name: "Kilat" });
  const helmet = rid();
  await w.b.upsertAddOn({ id: helmet, activityId: w.activityId, nameEn: "Helmet", nameMs: "Topi", priceSen: 500, active: true });
  const nine = await w.slot(w.optionId, kl(`${DAY}T09:00`));
  const eleven = await w.slot(w.optionId, kl(`${DAY}T11:00`));
  const tomorrow = await w.slot(w.optionId, kl("2030-01-16T09:00"));
  const people = [await w.participant(w.customerId, { weightKg: 85 }), await w.participant(w.customerId)];
  const h = await w.hold(w.customerId, nine, people, rid(), [{ id: helmet, qty: 2 }]);
  const paid = await w.pay(h);
  if (paid.status !== "paid") throw new Error("not paid");
  await w.cancel(w.customerId, { bookingId: paid.bookingId }, [paid.ticketIds[1]]);

  const day = await w.b.timeslots({ from: kl(`${DAY}T00:00`), to: kl(`${DAY}T00:00`) + 24 * H });
  expect(day.map((s) => s.id)).toEqual([nine, eleven]);
  expect(day[0]).toEqual({
    id: nine,
    optionId: w.optionId,
    startsAt: kl(`${DAY}T09:00`),
    closedAt: null,
    closedReason: null,
    spots: 1,
    tickets: [
      {
        id: paid.ticketIds[0],
        customerId: w.customerId,
        participantId: people[0],
        bookingId: paid.bookingId,
        packId: null,
        checkedInAt: null,
        resources: [expect.stringMatching(/Bayu|Kilat/)],
      },
    ],
    addOns: [{ bookingId: paid.bookingId, addOnId: helmet, quantity: 2 }],
  });
  expect(day[1]).toMatchObject({ spots: 2, tickets: [], addOns: [] });

  await w.b.closeTimeslot(nine, "weather");
  await w.reschedule(w.customerId, { bookingId: paid.bookingId }, [paid.ticketIds[0]], tomorrow, [people[0]]);
  const [moved, closed] = await w.b.timeslots({ ids: [tomorrow, nine] }).then((r) => [r[1], r[0]]);
  expect(closed).toMatchObject({ id: nine, closedReason: "weather", spots: 0, tickets: [], addOns: [] });
  expect(moved).toMatchObject({
    id: tomorrow,
    tickets: [{ id: paid.ticketIds[0] }],
    addOns: [{ bookingId: paid.bookingId, addOnId: helmet, quantity: 2 }],
  });

  await expect(w.b.timeslots({ from: 0, to: 15 * 24 * H })).rejects.toMatchObject({ code: "invalid_state" });
});

test("setup round-trips Activities with Closed days, Options, Add-ons, Resources and Schedules", async () => {
  const w = await rideWorld({ name: "Bayu", maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 90 });
  await w.b.upsertActivity({ id: w.activityId, freeCancelHours: 12, bookingCutoffMinutes: 30, closedDays: ["Mo#1", "Mo#3"] });
  const addOn = { id: rid(), activityId: w.activityId, nameEn: "Helmet", nameMs: "Topi", priceSen: 500, active: true };
  await w.b.upsertAddOn(addOn);
  const schedule = {
    id: rid(),
    activityId: w.activityId,
    optionIds: [w.optionId],
    weekdays: WEEKDAYS,
    times: ["11:00", "09:00", "09:00"],
    startsOn: "2030-01-01",
    endsOn: null,
    priceSen: null,
    active: true,
  };
  await w.b.upsertSchedule(schedule);
  const s = await w.b.setup();
  expect(s.activities).toEqual([
    { id: w.activityId, freeCancelHours: 12, bookingCutoffMinutes: 30, closedDays: ["Mo#1", "Mo#3"] },
  ]);
  expect(s.options).toEqual([expect.objectContaining({ id: w.optionId, active: true, needs: [{ kind: "horse", quantity: 1 }] })]);
  expect(s.addOns).toEqual([addOn]);
  expect(s.resources).toEqual([
    { id: w.horseId, kind: "horse", name: "Bayu", active: true, maxSessionsPerDay: 6, restMinutes: 15, maxRiderWeightKg: 90 },
  ]);
  expect(s.schedules).toEqual([{ ...schedule, times: ["09:00", "11:00"] }]);
});
