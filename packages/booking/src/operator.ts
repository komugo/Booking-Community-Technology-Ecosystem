import { DurableObject } from "cloudflare:workers";
import * as engine from "./engine";
import {
  BookingError,
  DAY,
  type ActivityInput,
  type AddOnInput,
  type AddOnPick,
  type ClosureReason,
  type Group,
  type Idempotency,
  type OptionInput,
  type PackOfferInput,
  type ParticipantFacts,
  type ResourceInput,
  type Result,
  type ScheduleInput,
} from "./engine";
import { migrate } from "./migrations";
import { drain, DrainError, knownQueued, outboxBacklog } from "./outbox";
import { tx, type NotPromise } from "./tx";

export class OperatorBooking extends DurableObject<Env> {
  #retryAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage);
      await this.#schedule();
    });
  }

  upsertActivity(op: string, a: ActivityInput) {
    return this.#mutate(op, null, (sql, now) => engine.upsertActivity(sql, now, a));
  }

  upsertOption(op: string, o: OptionInput) {
    return this.#mutate(op, null, (sql, now) => engine.upsertOption(sql, now, o));
  }

  upsertAddOn(op: string, a: AddOnInput) {
    return this.#mutate(op, null, (sql) => engine.upsertAddOn(sql, a));
  }

  upsertResource(op: string, r: ResourceInput) {
    return this.#mutate(op, null, (sql, now) => engine.upsertResource(sql, now, r));
  }

  createTimeslots(op: string, i: { optionId: string; startsAt: number[] }) {
    return this.#mutate(op, null, (sql, now) => engine.createTimeslots(sql, now, i));
  }

  upsertSchedule(op: string, s: ScheduleInput) {
    return this.#mutate(op, null, (sql, now) => engine.upsertSchedule(sql, now, s));
  }

  generateTimeslots(op: string) {
    return this.#mutate(op, null, (sql, now) => engine.generate(sql, now, null));
  }

  closeTimeslot(op: string, timeslotId: string, reason: ClosureReason) {
    return this.#mutate(op, null, (sql, now) => engine.closeTimeslot(sql, now, timeslotId, reason));
  }

  checkIn(op: string, i: { requestId: string; code: string }) {
    const idem = { requestId: i.requestId, method: "checkIn", fingerprint: [i.code.trim().toLowerCase()] };
    return this.#mutate(op, idem, (sql, now) => engine.checkIn(sql, now, i.code));
  }

  setup(op: string) {
    return this.#read(op, (sql) => engine.setup(sql));
  }

  timeslots(op: string, q: { from: number; to: number } | { ids: string[] }) {
    return this.#read(op, (sql, now) => engine.timeslots(sql, now, q));
  }

  upsertPackOffer(op: string, o: PackOfferInput) {
    return this.#mutate(op, null, (sql) => engine.upsertPackOffer(sql, o));
  }

  orderPack(op: string, i: { orderId: string; customerId: string; offerId: string }) {
    const idem = { requestId: i.orderId, method: "orderPack", fingerprint: [i.customerId, i.offerId] };
    return this.#mutate(op, idem, (sql, now) => engine.orderPack(sql, now, i));
  }

  confirmPackBill(op: string, i: { billId: string; orderId: string; amountSen: number }) {
    return this.#mutate(op, null, (sql, now) => engine.confirmPackBill(sql, now, i));
  }

  createHold(
    op: string,
    i: {
      requestId: string;
      customerId: string;
      replaces: string | null;
      timeslotId: string;
      participants: ParticipantFacts[];
      addOns: AddOnPick[];
    },
  ) {
    const idem = {
      requestId: i.requestId,
      method: "createHold",
      fingerprint: [
        i.customerId,
        i.replaces,
        i.timeslotId,
        i.participants.map((p) => p.id),
        [...i.addOns].sort((a, b) => (a.id < b.id ? -1 : 1)).map((a) => [a.id, a.qty]),
      ],
    };
    return this.#mutate(op, idem, (sql, now) => engine.createHold(sql, now, i));
  }

  bookingView(op: string, bookingId: string) {
    return this.#read(op, (sql) => engine.bookingView(sql, bookingId));
  }

  confirmHold(op: string, i: { billId: string; holdId: string; amountSen: number }) {
    return this.#mutate(op, null, (sql, now) => engine.confirmHold(sql, now, i));
  }

  redeemPack(op: string, i: { requestId: string; customerId: string; packId: string; holdId: string }) {
    const idem = { requestId: i.requestId, method: "redeemPack", fingerprint: [i.customerId, i.packId, i.holdId] };
    return this.#mutate(op, idem, (sql, now) => engine.redeemPack(sql, now, i));
  }

  cancelQuote(op: string, i: { customerId: string; group: Group; ticketIds: string[]; onlyClosed: boolean }) {
    return this.#read(op, (sql, now) => engine.cancelQuote(sql, now, i));
  }

  cancelTickets(
    op: string,
    i: {
      requestId: string;
      customerId: string;
      group: Group;
      ticketIds: string[];
      onlyClosed: boolean;
      expectSen: number;
      expectForfeited: string[];
    },
  ) {
    const idem = {
      requestId: i.requestId,
      method: "cancelTickets",
      fingerprint: [i.customerId, i.group, [...i.ticketIds].sort(), i.onlyClosed, i.expectSen, [...i.expectForfeited].sort()],
    };
    return this.#mutate(op, idem, (sql, now) => engine.cancelTickets(sql, now, i));
  }

  rescheduleTickets(
    op: string,
    i: {
      requestId: string;
      customerId: string;
      group: Group;
      ticketIds: string[];
      timeslotId: string;
      participants: ParticipantFacts[];
      onlyClosed: boolean;
    },
  ) {
    const idem = {
      requestId: i.requestId,
      method: "rescheduleTickets",
      fingerprint: [i.customerId, i.group, [...i.ticketIds].sort(), i.timeslotId],
    };
    return this.#mutate(op, idem, (sql, now) => engine.rescheduleTickets(sql, now, i));
  }

  packView(op: string, packId: string) {
    return this.#read(op, (sql) => engine.packView(sql, packId));
  }

  markRefunded(op: string, i: { refundId: string; memberId: string }) {
    return this.#mutate(op, null, (sql, now) => engine.markRefunded(sql, now, i));
  }

  async alarm() {
    const sql = this.ctx.storage.sql;
    let op: string | null = null;
    try {
      op = sql.exec<{ operator_id: string | null }>("SELECT operator_id FROM meta").one().operator_id;
      const now = Date.now();
      tx(this.ctx.storage, () => {
        engine.expireDue(sql, now);
        sql.exec("DELETE FROM requests WHERE created_at < ?", now - 7 * DAY);
      });
      if (op) await drain(this.ctx.storage, op, this.env.DB);
      this.#retryAt = 0;
      const backlog = outboxBacklog(sql);
      if (backlog.unknown) console.warn(JSON.stringify({ event: "outbox_unknown_entity", operatorId: op, ...backlog }));
    } catch (e) {
      this.#retryAt = Date.now() + 30_000;
      console.error(
        JSON.stringify({
          event: "booking_alarm_failed",
          operatorId: op,
          error: String(e),
          rejected: e instanceof DrainError ? e.keys : undefined,
          ...outboxBacklog(sql),
        }),
      );
    }
    await this.#schedule();
  }

  #read<T>(op: string, fn: (sql: SqlStorage, now: number) => T): Result<T> {
    if (!this.env.BOOKING.idFromName(op).equals(this.ctx.id)) throw new Error("wrong_operator");
    try {
      return { ok: true, value: fn(this.ctx.storage.sql, Date.now()) };
    } catch (e) {
      if (e instanceof BookingError) return { ok: false, error: e.code };
      throw e;
    }
  }

  async #mutate<T>(
    op: string,
    idem: Idempotency | null,
    fn: (sql: SqlStorage, now: number) => NotPromise<T>,
  ): Promise<Result<T>> {
    if (!this.env.BOOKING.idFromName(op).equals(this.ctx.id)) throw new Error("wrong_operator");
    const now = Date.now();
    try {
      const value = tx<T>(this.ctx.storage, () => {
        const sql = this.ctx.storage.sql;
        sql.exec("UPDATE meta SET operator_id = ? WHERE operator_id IS NULL", op);
        engine.expireDue(sql, now);
        if (idem) {
          const prior = engine.replay(sql, idem);
          if (prior !== undefined) return prior as NotPromise<T>;
        }
        const v = fn(sql, now);
        if (idem) engine.record(sql, idem, v, now);
        return v;
      });
      return { ok: true, value };
    } catch (e) {
      if (e instanceof BookingError) return { ok: false, error: e.code };
      throw e;
    } finally {
      await this.#schedule();
    }
  }

  async #schedule() {
    const sql = this.ctx.storage.sql;
    const { expiry } = sql
      .exec<{ expiry: number | null }>("SELECT min(expires_at) AS expiry FROM holds WHERE status = 'active'")
      .one();
    const next = Math.max(Math.min(expiry ?? Infinity, knownQueued(sql) ? Date.now() : Infinity), this.#retryAt);
    const current = await this.ctx.storage.getAlarm();
    if (next === Infinity) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
    } else if (current === null || next < current) {
      await this.ctx.storage.setAlarm(next);
    }
  }
}
