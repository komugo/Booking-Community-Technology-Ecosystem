import { env, runInDurableObject } from "cloudflare:test";
import { activities, categories, cities, createDb, customers, operators, participants, waivers } from "@komugo/db";
import { WAIVER } from "@komugo/types";
import {
  booking,
  BookingError,
  type AddOnPick,
  type Group,
  type OptionInput,
  type PackOfferInput,
  type ResourceInput,
  type ResourceKind,
} from "../src";

export const db = createDb(env.DB);
export const kl = (local: string) => new Date(`${local}+08:00`).getTime();
export const DAY = "2030-01-15";
export const rid = () => crypto.randomUUID();
export const HOUR = 3_600_000;
export const later = (hours: number) => Math.floor((Date.now() + hours * HOUR) / 60_000) * 60_000;

export const codes = (results: PromiseSettledResult<unknown>[]) =>
  results.map((r) =>
    r.status === "fulfilled" ? "ok" : r.reason instanceof BookingError ? r.reason.code : String(r.reason),
  );

export async function operator(freeCancelHours = 24) {
  const s = rid();
  const [op] = await db.insert(operators).values({ name: "Stable" }).returning();
  const hub = { slugEn: s, slugMs: `${s}-ms`, nameEn: "x", nameMs: "x" };
  const [city] = await db.insert(cities).values(hub).returning();
  const [category] = await db.insert(categories).values(hub).returning();
  const [activity] = await db
    .insert(activities)
    .values({ ...hub, operatorId: op.id, cityId: city.id, categoryId: category.id, descriptionEn: "x", descriptionMs: "x" })
    .returning();

  const operatorId = op.id;
  const activityId = activity.id;
  const b = booking(env, operatorId);
  const stub = env.BOOKING.get(env.BOOKING.idFromName(operatorId));
  await b.upsertActivity({ id: activityId, freeCancelHours });

  const optionInputs = new Map<string, OptionInput>();
  const resourceInputs = new Map<string, ResourceInput>();

  const sql = (query: string, ...params: SqlStorageValue[]) =>
    runInDurableObject(stub, (_, state) => state.storage.sql.exec(query, ...params).toArray());
  const count = async (query: string, ...params: SqlStorageValue[]) => Number((await sql(query, ...params))[0].n);

  const w = {
    operatorId,
    activityId,
    b,
    stub,
    sql,
    count,
    allocationCount: () => count("SELECT count(*) AS n FROM allocations"),
    async option(o: Partial<OptionInput> = {}, needs: [ResourceKind, number][] = [["horse", 1]]) {
      const input: OptionInput = {
        id: rid(),
        activityId,
        nameEn: "Ride",
        nameMs: "Tunggang",
        priceSen: 10000,
        durationMinutes: 60,
        minAge: null,
        maxAge: null,
        maxWeightKg: null,
        requiredCert: null,
        minParticipants: null,
        active: true,
        needs: needs.map(([kind, quantity]) => ({ kind, quantity })),
        ...o,
      };
      await b.upsertOption(input);
      optionInputs.set(input.id, input);
      return input.id;
    },
    async editOption(id: string, patch: Partial<OptionInput>) {
      const input = { ...optionInputs.get(id)!, ...patch };
      const r = await b.upsertOption(input);
      optionInputs.set(id, input);
      return r;
    },
    async resource(r: Partial<ResourceInput> = {}) {
      const input: ResourceInput = {
        id: rid(),
        kind: "horse",
        name: "Bella",
        active: true,
        maxSessionsPerDay: null,
        restMinutes: 0,
        maxRiderWeightKg: null,
        ...r,
      };
      await b.upsertResource(input);
      resourceInputs.set(input.id, input);
      return input.id;
    },
    async editResource(id: string, patch: Partial<ResourceInput>) {
      const input = { ...resourceInputs.get(id)!, ...patch };
      await b.upsertResource(input);
      resourceInputs.set(id, input);
    },
    async slot(optionId: string, startsAt: number) {
      const { ids } = await b.createTimeslots({ optionId, startsAt: [startsAt] });
      return ids[0];
    },
    async participant(customerId: string, p: Partial<typeof participants.$inferInsert> & { waiver?: boolean } = {}) {
      const { waiver = true, ...values } = p;
      const [row] = await db
        .insert(participants)
        .values({ customerId, name: "Aisyah", birthDate: "1990-01-01", weightKg: 60, ...values })
        .returning();
      if (waiver) {
        await db.insert(waivers).values({ participantId: row.id, operatorId, signerName: "Aiman", version: WAIVER.version });
      }
      return row.id;
    },
    hold(
      customerId: string,
      timeslotId: string,
      participantIds: string[],
      requestId: string = rid(),
      addOns: AddOnPick[] = [],
      replaces: string | null = null,
    ) {
      return b.createHold({ requestId, customerId, replaces, timeslotId, participantIds, addOns });
    },
    pay(h: { holdId: string; amountSen: number }, billId: string = rid()) {
      return b.confirmHold({ billId, holdId: h.holdId, amountSen: h.amountSen });
    },
    async book(customerId: string, timeslotId: string, participantIds: string[]) {
      const r = await b.confirmHold({ billId: rid(), ...(await w.hold(customerId, timeslotId, participantIds)) });
      if (r.status !== "paid") throw new Error(`not paid: ${r.reason}`);
      return r;
    },
    async offer(o: Partial<PackOfferInput> & { optionIds: string[] }) {
      const input: PackOfferInput = {
        id: rid(),
        activityId,
        nameEn: "4 rides",
        nameMs: "4 tunggangan",
        sessions: 4,
        priceSen: 25000,
        validDays: 30,
        active: true,
        ...o,
      };
      await b.upsertPackOffer(input);
      return input;
    },
    async buyPack(customerId: string, o: Partial<PackOfferInput> & { optionIds: string[] }) {
      const offer = await w.offer(o);
      const orderId = rid();
      await b.orderPack({ orderId, customerId, offerId: offer.id });
      const r = await b.confirmPackBill({ billId: rid(), orderId, amountSen: offer.priceSen });
      if (r.status !== "paid") throw new Error(`pack not paid: ${r.reason}`);
      return r;
    },
    async redeem(customerId: string, packId: string, timeslotId: string, participantIds: string[]) {
      const { holdId } = await w.hold(customerId, timeslotId, participantIds);
      return b.redeemPack({ requestId: rid(), customerId, packId, holdId });
    },
    quote(customerId: string, group: Group, ticketIds: string[], onlyClosed = false) {
      return b.cancelQuote({ customerId, group, ticketIds, onlyClosed });
    },
    async cancel(customerId: string, group: Group, ticketIds: string[], onlyClosed = false) {
      const q = await w.quote(customerId, group, ticketIds, onlyClosed);
      const expectForfeited = q.tickets.filter((t) => t.outcome === "forfeited").map((t) => t.id);
      return b.cancelTickets({ requestId: rid(), customerId, group, ticketIds, onlyClosed, expectSen: q.refundSen, expectForfeited });
    },
    reschedule(
      customerId: string,
      group: Group,
      ticketIds: string[],
      timeslotId: string,
      participantIds: string[],
      requestId: string = rid(),
      onlyClosed = false,
    ) {
      return b.rescheduleTickets({ requestId, customerId, group, ticketIds, timeslotId, participantIds, onlyClosed });
    },
    expireHold: (holdId: string) =>
      sql("UPDATE holds SET created_at = created_at - 120000, expires_at = created_at - 60000 WHERE id = ?", holdId),
    startSlot: (timeslotId: string, startsAt = Date.now() - 60_000) =>
      sql("UPDATE timeslots SET starts_at = ? WHERE id = ?", startsAt, timeslotId),
    async flush() {
      await runInDurableObject(stub, (instance) => instance.alarm());
      if ((await count("SELECT count(*) AS n FROM outbox")) > 0) throw new Error("outbox not drained");
    },
  };
  return w;
}

export const UNDO_V10 = ["ALTER TABLE activities DROP COLUMN requires_waiver"];

export const UNDO_V9 = ["ALTER TABLE tickets DROP COLUMN commission_bps", "ALTER TABLE packs DROP COLUMN commission_bps"];

export const UNDO_V8 = [
  "DROP TABLE closure_choices",
  "DROP TABLE pack_orders",
  "DROP TABLE pack_offers",
  "DROP INDEX refunds_booking",
  "DROP TABLE refunds",
  "ALTER TABLE packs DROP COLUMN offer_id",
  "ALTER TABLE packs DROP COLUMN option_ids",
  "ALTER TABLE tickets DROP COLUMN refund_id",
];

export const UNDO_V6 = [
  "DROP INDEX timeslots_schedule",
  "ALTER TABLE timeslots DROP COLUMN schedule_id",
  "ALTER TABLE timeslots DROP COLUMN closed_reason",
  "ALTER TABLE tickets DROP COLUMN checked_in_at",
  "ALTER TABLE activities DROP COLUMN closed_days",
  "DROP TABLE schedules",
];

export async function customer() {
  const [row] = await db.insert(customers).values({ name: "Aiman", email: `${rid()}@x.my` }).returning();
  return row.id;
}

export async function rideWorld(horse: Partial<ResourceInput> = {}, freeCancelHours = 24) {
  const w = await operator(freeCancelHours);
  const optionId = await w.option();
  const horseId = await w.resource(horse);
  const customerId = await customer();
  return { ...w, optionId, horseId, customerId };
}
