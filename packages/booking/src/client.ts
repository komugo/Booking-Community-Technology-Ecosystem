import { createDb, participants, waivers } from "@komugo/db";
import { WAIVER } from "@komugo/types";
import { and, eq, inArray } from "drizzle-orm";
import {
  BookingError,
  type ActivityInput,
  type AddOnInput,
  type AddOnPick,
  type ClosureReason,
  type Group,
  type OptionInput,
  type PackOfferInput,
  type ParticipantFacts,
  type ResourceInput,
  type Result,
  type ScheduleInput,
} from "./engine";

async function loadFacts(env: Env, operatorId: string, ids: string[]): Promise<ParticipantFacts[]> {
  if (ids.length === 0) return [];
  const db = createDb(env.DB);
  const [people, signed] = await db.batch([
    db.select().from(participants).where(inArray(participants.id, ids)),
    db
      .select({ participantId: waivers.participantId })
      .from(waivers)
      .where(
        and(eq(waivers.operatorId, operatorId), eq(waivers.version, WAIVER.version), inArray(waivers.participantId, ids)),
      ),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const waived = new Set(signed.map((w) => w.participantId));
  return ids.map((id) => {
    const p = byId.get(id);
    if (!p) throw new BookingError("invalid_participant");
    return {
      id,
      customerId: p.customerId,
      birthDate: p.birthDate,
      weightKg: p.weightKg,
      certs: p.certs,
      waiverSigned: waived.has(id),
    };
  });
}

export function booking(env: Env, operatorId: string) {
  const op = operatorId;
  const stub = () => env.BOOKING.get(env.BOOKING.idFromName(op), { locationHint: "apac" });

  // A stub that threw may be broken, so the retry gets a fresh one.
  async function call<T>(rpc: (s: ReturnType<typeof stub>) => Promise<Result<T>>): Promise<T> {
    let r: Result<T>;
    try {
      r = await rpc(stub());
    } catch (e) {
      const err = e as { retryable?: boolean; overloaded?: boolean };
      if (!err.retryable || err.overloaded) throw e;
      r = await rpc(stub());
    }
    if (!r.ok) throw new BookingError(r.error);
    return r.value;
  }

  return {
    upsertActivity: (a: ActivityInput) => call((s) => s.upsertActivity(op, a)),
    upsertOption: (o: OptionInput) => call((s) => s.upsertOption(op, o)),
    upsertAddOn: (a: AddOnInput) => call((s) => s.upsertAddOn(op, a)),
    upsertResource: (r: ResourceInput) => call((s) => s.upsertResource(op, r)),
    createTimeslots: (i: { optionId: string; startsAt: number[] }) => call((s) => s.createTimeslots(op, i)),
    upsertSchedule: (sch: ScheduleInput) => call((s) => s.upsertSchedule(op, sch)),
    generateTimeslots: () => call((s) => s.generateTimeslots(op)),
    closeTimeslot: (timeslotId: string, reason: ClosureReason) => call((s) => s.closeTimeslot(op, timeslotId, reason)),
    checkIn: (i: { requestId: string; code: string }) => call((s) => s.checkIn(op, i)),
    setup: () => call((s) => s.setup(op)),
    timeslots: (q: { from: number; to: number } | { ids: string[] }) => call((s) => s.timeslots(op, q)),
    confirmHold: (i: { billId: string; holdId: string; amountSen: number }) => call((s) => s.confirmHold(op, i)),
    upsertPackOffer: (o: PackOfferInput) => call((s) => s.upsertPackOffer(op, o)),
    orderPack: (i: { orderId: string; customerId: string; offerId: string }) => call((s) => s.orderPack(op, i)),
    confirmPackBill: (i: { billId: string; orderId: string; amountSen: number }) => call((s) => s.confirmPackBill(op, i)),
    redeemPack: (i: { requestId: string; customerId: string; packId: string; holdId: string }) =>
      call((s) => s.redeemPack(op, i)),
    cancelQuote: (i: { customerId: string; group: Group; ticketIds: string[]; onlyClosed: boolean }) =>
      call((s) => s.cancelQuote(op, i)),
    cancelTickets: (i: {
      requestId: string;
      customerId: string;
      group: Group;
      ticketIds: string[];
      onlyClosed: boolean;
      expectSen: number;
      expectForfeited: string[];
    }) => call((s) => s.cancelTickets(op, i)),
    packView: (packId: string) => call((s) => s.packView(op, packId)),
    markRefunded: (i: { refundId: string; memberId: string }) => call((s) => s.markRefunded(op, i)),
    async createHold({
      participantIds,
      ...i
    }: {
      requestId: string;
      customerId: string;
      replaces: string | null;
      timeslotId: string;
      participantIds: string[];
      addOns: AddOnPick[];
    }) {
      const people = await loadFacts(env, op, participantIds);
      return call((s) => s.createHold(op, { ...i, participants: people }));
    },
    bookingView: (bookingId: string) => call((s) => s.bookingView(op, bookingId)),
    async rescheduleTickets({
      participantIds,
      ...i
    }: {
      requestId: string;
      customerId: string;
      group: Group;
      ticketIds: string[];
      timeslotId: string;
      participantIds: string[];
      onlyClosed: boolean;
    }) {
      const people = await loadFacts(env, op, participantIds);
      return call((s) => s.rescheduleTickets(op, { ...i, participants: people }));
    },
  };
}
