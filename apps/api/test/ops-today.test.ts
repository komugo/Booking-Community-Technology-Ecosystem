import { expect, test } from "vitest";
import { booked, member, world } from "./helpers";

test("Today lists each Booking with contact, Add-ons and Participants with age, weight, horse and Waiver", async () => {
  const w = await world({ horses: 3 });
  const b = await booked(
    w,
    [
      { name: "Aisyah", birthDate: "1990-05-01", weightKg: 62 },
      { name: "Adam", birthDate: "2015-03-01", weightKg: 30, waiver: "guardian" },
      { name: "Siti", birthDate: "1985-01-15", weightKg: 70, waiver: "outdated" },
    ],
    { addOns: [{ id: w.helmetId, qty: 2 }], phone: "+60198765432" },
  );
  const m = await member("operator", w.operatorId);
  const { status, body } = await m.json("GET", `/ops/operators/${w.operatorId}/timeslots?from=2030-01-15&days=1`);
  expect(status).toBe(200);
  expect(body.timeslots).toHaveLength(1);
  const [slot] = body.timeslots;
  expect(slot).toMatchObject({
    id: w.timeslotId,
    closedAt: null,
    closedReason: null,
    spots: 0,
    option: { id: w.optionId, nameEn: "Ride", nameMs: "Tunggang", durationMinutes: 60 },
  });
  expect(slot.groups).toEqual([
    {
      bookingId: b.bookingId,
      packId: null,
      customerId: b.customerId,
      contact: { name: "Aiman Rahman", phone: "+60198765432", email: b.email },
      addOns: [{ nameEn: "Helmet", nameMs: "Topi", quantity: 2 }],
      notice: null,
      tickets: b.ticketIds.map((id) => expect.objectContaining({ id, code: id.slice(0, 8).toUpperCase(), checkedInAt: null })),
    },
  ]);
  const people = slot.groups[0].tickets.map((t: Record<string, unknown>) => [t.participant, t.waiver, t.signerName, t.resources]);
  expect(people).toEqual([
    [{ name: "Aisyah", age: 39, weightKg: 62 }, "signed", "Aiman Rahman", [expect.stringMatching(/^Horse \d$/)]],
    [{ name: "Adam", age: 14, weightKg: 30 }, "guardian", "Aiman Rahman", [expect.stringMatching(/^Horse \d$/)]],
    [{ name: "Siti", age: 45, weightKg: 70 }, "outdated", "Aiman Rahman", [expect.stringMatching(/^Horse \d$/)]],
  ]);

  expect((await m.json("GET", `/ops/operators/${w.operatorId}/timeslots?from=2030-01-15&days=15`)).body).toMatchObject({ field: "days" });
  expect((await m.json("GET", `/ops/operators/${w.operatorId}/timeslots/nope`)).status).toBe(404);
});
