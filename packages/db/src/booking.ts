import { and, count, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  activities,
  allocations,
  bookings,
  holds,
  optionResources,
  options,
  packs,
  participants,
  resources,
  tickets,
  timeslots,
  waivers,
} from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type BookingErrorCode =
  | "not_bookable"
  | "invalid_participant"
  | "requirement_not_met"
  | "waiver_missing"
  | "no_availability"
  | "hold_gone"
  | "pack_unavailable"
  | "invalid_state";

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode) {
    super(code);
  }
}

// The day cap and busy checks rely on each statement seeing rows committed after the resource lock was taken.
const inTx = <T>(db: Db, fn: (tx: Tx) => Promise<T>) => db.transaction(fn, { isolationLevel: "read committed" });

type Pick = { resourceId: string; participantId: string; block: string };

async function allocate(tx: Tx, timeslotId: string, participantIds: string[], customerId: string) {
  if (participantIds.length === 0 || new Set(participantIds).size !== participantIds.length) {
    throw new BookingError("invalid_participant");
  }

  const [slot] = await tx
    .select({
      optionId: options.id,
      operatorId: activities.operatorId,
      startsAt: timeslots.startsAt,
      priceSen: options.priceSen,
      minAge: options.minAge,
      maxAge: options.maxAge,
      maxWeightKg: options.maxWeightKg,
      requiredCert: options.requiredCert,
      bookable: sql<boolean>`${timeslots.closedAt} is null and ${timeslots.startsAt} > now()`,
    })
    .from(timeslots)
    .innerJoin(options, eq(options.id, timeslots.optionId))
    .innerJoin(activities, eq(activities.id, options.activityId))
    .where(eq(timeslots.id, timeslotId))
    .for("share", { of: timeslots });
  if (!slot?.bookable) throw new BookingError("not_bookable");

  const needs = await tx.select().from(optionResources).where(eq(optionResources.optionId, slot.optionId));
  if (needs.length === 0) throw new BookingError("not_bookable");

  const people = await tx
    .select({
      id: participants.id,
      customerId: participants.customerId,
      weightKg: participants.weightKg,
      certs: participants.certs,
      age: sql<number>`extract(year from age((${slot.startsAt.toISOString()}::timestamptz at time zone 'Asia/Kuala_Lumpur')::date, ${participants.birthDate}))::int`,
    })
    .from(participants)
    .where(inArray(participants.id, participantIds));
  if (people.length !== participantIds.length || people.some((p) => p.customerId !== customerId)) {
    throw new BookingError("invalid_participant");
  }
  for (const p of people) {
    const ok =
      (slot.minAge === null || p.age >= slot.minAge) &&
      (slot.maxAge === null || p.age <= slot.maxAge) &&
      (slot.maxWeightKg === null || (p.weightKg !== null && p.weightKg <= slot.maxWeightKg)) &&
      (slot.requiredCert === null || p.certs.includes(slot.requiredCert));
    if (!ok) throw new BookingError("requirement_not_met");
  }

  const locked = await tx
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.operatorId, slot.operatorId),
        inArray(
          resources.kind,
          needs.map((n) => n.kind),
        ),
        eq(resources.active, true),
      ),
    )
    .orderBy(resources.id)
    .for("update");
  if (locked.length === 0) throw new BookingError("no_availability");
  const ids = locked.map((r) => r.id);

  await tx.execute(sql`
    delete from holds where id in (
      select h.id from holds h
      where h.expires_at < now()
        and exists (select 1 from allocations a where a.hold_id = h.id and a.resource_id in ${ids})
      order by h.id
      for update skip locked)`);

  const [taken] = await tx.execute(sql`
    select 1 from allocations a
    left join holds h on h.id = a.hold_id
    left join tickets t on t.id = a.ticket_id
    where a.participant_id in ${participantIds} and coalesce(h.timeslot_id, t.timeslot_id) = ${timeslotId}
    limit 1`);
  if (taken) throw new BookingError("invalid_participant");

  const candidates = await tx.execute<{
    id: string;
    kind: string;
    maxRiderWeightKg: number | null;
    maxSessionsPerDay: number | null;
    block: string;
    busy: boolean;
    dayCount: number;
  }>(sql`
    select r.id, r.kind, r.max_rider_weight_kg as "maxRiderWeightKg", r.max_sessions_per_day as "maxSessionsPerDay",
      b.block::text as block,
      exists (select 1 from allocations a where a.resource_id = r.id and a.block && b.block) as busy,
      (select count(*)::int from allocations a
        where a.resource_id = r.id and a.block && d.day and lower(a.block) <@ d.day) as "dayCount"
    from timeslots t
    join options o on o.id = t.option_id
    cross join lateral (
      select date_trunc('day', t.starts_at at time zone 'Asia/Kuala_Lumpur') as kl) k
    cross join lateral (
      select tstzrange(k.kl at time zone 'Asia/Kuala_Lumpur', (k.kl + interval '1 day') at time zone 'Asia/Kuala_Lumpur') as day) d
    join resources r on r.id in ${ids}
    cross join lateral (
      select tstzrange(t.starts_at, t.starts_at + make_interval(mins => o.duration_minutes + r.rest_minutes)) as block) b
    where t.id = ${timeslotId}
    order by r.max_rider_weight_kg asc nulls last, "dayCount", r.id`);

  const free = candidates.filter(
    (c) => !c.busy && (c.maxSessionsPerDay === null || c.dayCount < c.maxSessionsPerDay),
  );
  const chosen = new Set<string>();
  const picks: Pick[] = [];
  const heaviestFirst = [...people].sort((a, b) => (b.weightKg ?? Infinity) - (a.weightKg ?? Infinity));
  for (const p of heaviestFirst) {
    for (const need of needs) {
      for (let i = 0; i < need.quantity; i++) {
        const c = free.find(
          (c) =>
            c.kind === need.kind &&
            !chosen.has(c.id) &&
            (c.maxRiderWeightKg === null || (p.weightKg !== null && p.weightKg <= c.maxRiderWeightKg)),
        );
        if (!c) {
          const weightUnknown = p.weightKg === null && free.some((c) => c.kind === need.kind && !chosen.has(c.id));
          throw new BookingError(weightUnknown ? "requirement_not_met" : "no_availability");
        }
        chosen.add(c.id);
        picks.push({ resourceId: c.id, participantId: p.id, block: c.block });
      }
    }
  }
  return { ...slot, picks };
}

async function assertWaivers(tx: Tx, operatorId: string, participantIds: string[]) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(waivers)
    .where(and(eq(waivers.operatorId, operatorId), inArray(waivers.participantId, participantIds)));
  if (n !== participantIds.length) throw new BookingError("waiver_missing");
}

export function createHold(
  db: Db,
  input: { customerId: string; timeslotId: string; participantIds: string[] },
): Promise<{ holdId: string; expiresAt: Date; amountSen: number }> {
  return inTx(db, async (tx) => {
    const slot = await allocate(tx, input.timeslotId, input.participantIds, input.customerId);
    await assertWaivers(tx, slot.operatorId, input.participantIds);
    const [hold] = await tx
      .insert(holds)
      .values({ customerId: input.customerId, timeslotId: input.timeslotId, priceSen: slot.priceSen })
      .returning();
    await tx.insert(allocations).values(slot.picks.map((p) => ({ ...p, holdId: hold.id })));
    return { holdId: hold.id, expiresAt: hold.expiresAt, amountSen: slot.priceSen * input.participantIds.length };
  });
}

export function confirmHold(db: Db, holdId: string): Promise<{ bookingId: string; ticketIds: string[] }> {
  return inTx(db, async (tx) => {
    const [ref] = await tx.select({ timeslotId: holds.timeslotId }).from(holds).where(eq(holds.id, holdId));
    if (ref) {
      await tx.select({ id: timeslots.id }).from(timeslots).where(eq(timeslots.id, ref.timeslotId)).for("share");
    }
    const [hold] = await tx
      .select({
        customerId: holds.customerId,
        timeslotId: holds.timeslotId,
        priceSen: holds.priceSen,
        live: sql<boolean>`${holds.expiresAt} > now() and ${timeslots.startsAt} > now()`,
      })
      .from(holds)
      .innerJoin(timeslots, eq(timeslots.id, holds.timeslotId))
      .where(eq(holds.id, holdId))
      .for("update", { of: holds });
    if (!hold) {
      const [booking] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.holdId, holdId));
      if (!booking) throw new BookingError("hold_gone");
      const issued = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.bookingId, booking.id));
      return { bookingId: booking.id, ticketIds: issued.map((t) => t.id) };
    }
    if (!hold.live) throw new BookingError("hold_gone");

    const held = await tx
      .select({ participantId: allocations.participantId })
      .from(allocations)
      .where(eq(allocations.holdId, holdId));
    const participantIds = [...new Set(held.map((a) => a.participantId))];

    const [booking] = await tx
      .insert(bookings)
      .values({ customerId: hold.customerId, holdId })
      .returning({ id: bookings.id });
    const issued = await tx
      .insert(tickets)
      .values(
        participantIds.map((participantId) => ({
          bookingId: booking.id,
          participantId,
          timeslotId: hold.timeslotId,
          priceSen: hold.priceSen,
        })),
      )
      .returning({ id: tickets.id, participantId: tickets.participantId });
    for (const t of issued) {
      await tx
        .update(allocations)
        .set({ ticketId: t.id, holdId: null })
        .where(and(eq(allocations.holdId, holdId), eq(allocations.participantId, t.participantId)));
    }
    await tx.delete(holds).where(eq(holds.id, holdId));
    return { bookingId: booking.id, ticketIds: issued.map((t) => t.id) };
  });
}

export function redeemPack(
  db: Db,
  input: { packId: string; timeslotId: string; participantIds: string[] },
): Promise<{ ticketIds: string[] }> {
  return inTx(db, async (tx) => {
    const [pack] = await tx.select().from(packs).where(eq(packs.id, input.packId)).for("update");
    if (!pack) throw new BookingError("pack_unavailable");
    const slot = await allocate(tx, input.timeslotId, input.participantIds, pack.customerId);
    const [{ used }] = await tx
      .select({ used: count() })
      .from(tickets)
      .where(and(eq(tickets.packId, pack.id), ne(tickets.status, "cancelled")));
    if (
      slot.operatorId !== pack.operatorId ||
      slot.startsAt > pack.expiresAt ||
      pack.sessionsTotal - used < input.participantIds.length
    ) {
      throw new BookingError("pack_unavailable");
    }
    await assertWaivers(tx, slot.operatorId, input.participantIds);
    const issued = await tx
      .insert(tickets)
      .values(
        input.participantIds.map((participantId) => ({
          packId: pack.id,
          participantId,
          timeslotId: input.timeslotId,
          priceSen: 0,
        })),
      )
      .returning({ id: tickets.id, participantId: tickets.participantId });
    const ticketOf = new Map(issued.map((t) => [t.participantId, t.id]));
    await tx.insert(allocations).values(slot.picks.map((p) => ({ ...p, ticketId: ticketOf.get(p.participantId)! })));
    return { ticketIds: issued.map((t) => t.id) };
  });
}

export function closeTimeslot(db: Db, timeslotId: string): Promise<void> {
  return inTx(db, async (tx) => {
    const [closed] = await tx
      .update(timeslots)
      .set({ closedAt: sql`now()` })
      .where(and(eq(timeslots.id, timeslotId), isNull(timeslots.closedAt), gt(timeslots.startsAt, sql`now()`)))
      .returning({ id: timeslots.id });
    if (!closed) {
      const [slot] = await tx.select({ closedAt: timeslots.closedAt }).from(timeslots).where(eq(timeslots.id, timeslotId));
      if (slot?.closedAt) return;
      throw new BookingError("invalid_state");
    }
    await tx
      .delete(allocations)
      .where(
        inArray(
          allocations.ticketId,
          tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.timeslotId, timeslotId)),
        ),
      );
    await tx.delete(holds).where(eq(holds.timeslotId, timeslotId));
  });
}

export function rescheduleTicket(db: Db, input: { ticketId: string; timeslotId: string }): Promise<void> {
  return inTx(db, async (tx) => {
    const [ticket] = await tx
      .select({
        participantId: tickets.participantId,
        customerId: participants.customerId,
        optionId: timeslots.optionId,
        awaitingChoice: sql<boolean>`${tickets.status} = 'issued' and ${timeslots.closedAt} is not null`,
      })
      .from(tickets)
      .innerJoin(timeslots, eq(timeslots.id, tickets.timeslotId))
      .innerJoin(participants, eq(participants.id, tickets.participantId))
      .where(eq(tickets.id, input.ticketId))
      .for("update", { of: tickets });
    if (!ticket?.awaitingChoice) throw new BookingError("invalid_state");
    const slot = await allocate(tx, input.timeslotId, [ticket.participantId], ticket.customerId);
    if (slot.optionId !== ticket.optionId) throw new BookingError("invalid_state");
    await tx.update(tickets).set({ timeslotId: input.timeslotId }).where(eq(tickets.id, input.ticketId));
    await tx.insert(allocations).values(slot.picks.map((p) => ({ ...p, ticketId: input.ticketId })));
  });
}

export function cancelTicket(db: Db, ticketId: string): Promise<{ status: "cancelled" | "forfeited" }> {
  return inTx(db, async (tx) => {
    const [ticket] = await tx.select({ status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId)).for("update");
    if (ticket?.status !== "issued") throw new BookingError("invalid_state");
    const [policy] = await tx
      .select({
        started: sql<boolean>`${timeslots.closedAt} is null and ${timeslots.startsAt} <= now()`,
        fullReturn: sql<boolean>`${timeslots.closedAt} is not null
          or ${timeslots.startsAt} - make_interval(hours => ${activities.freeCancelHours}) >= now()`,
      })
      .from(tickets)
      .innerJoin(timeslots, eq(timeslots.id, tickets.timeslotId))
      .innerJoin(options, eq(options.id, timeslots.optionId))
      .innerJoin(activities, eq(activities.id, options.activityId))
      .where(eq(tickets.id, ticketId))
      .for("share", { of: timeslots });
    if (policy.started) throw new BookingError("invalid_state");
    const status = policy.fullReturn ? "cancelled" : "forfeited";
    await tx.update(tickets).set({ status }).where(eq(tickets.id, ticketId));
    await tx.delete(allocations).where(eq(allocations.ticketId, ticketId));
    return { status };
  });
}
