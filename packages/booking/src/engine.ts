import { ageOn, klDate, packExpiry, type Weekday } from "@komugo/types";
import { mark, markWindow } from "./outbox";
import { expand } from "./schedule";

export type BookingErrorCode =
  | "not_bookable"
  | "invalid_participant"
  | "requirement_not_met"
  | "waiver_missing"
  | "no_availability"
  | "pack_unavailable"
  | "invalid_state"
  | "idempotency_conflict"
  | "below_min_participants"
  | "too_many_holds"
  | "invalid_add_on"
  | "pack_expired"
  | "pack_used_up"
  | "window_passed"
  | "started"
  | "quote_changed";

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode) {
    super(code);
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: BookingErrorCode };
export type PaymentRefundReason = "duplicate" | "amount_mismatch" | "unavailable" | "unknown_hold";
export type RefundReason = PaymentRefundReason | "cancel" | "closure";
export type ResourceKind = "horse" | "instructor" | "belayer" | "auto_belay_lane";
export type ParticipantFacts = {
  id: string;
  customerId: string;
  birthDate: string;
  weightKg: number | null;
  certs: string[];
  waiverSigned: boolean;
};
export type ActivityInput = {
  id: string;
  freeCancelHours: number;
  bookingCutoffMinutes?: number;
  closedDays?: string[];
  requiresWaiver?: boolean;
};
export type OptionInput = {
  id: string;
  activityId: string;
  nameEn: string;
  nameMs: string;
  priceSen: number;
  durationMinutes: number;
  minAge: number | null;
  maxAge: number | null;
  maxWeightKg: number | null;
  requiredCert: string | null;
  minParticipants: number | null;
  maxPerBooking: number | null;
  active: boolean;
  needs: { kind: ResourceKind; quantity: number }[];
};
export type AddOnPick = { id: string; qty: number };
export type ViewTicket = {
  id: string;
  participantId: string;
  status: string;
  optionId: string;
  timeslotId: string;
  startsAt: number;
  closedAt: number | null;
  refundId: string | null;
  refundSen: number;
};
export type BookingView = {
  customerId: string;
  optionId: string;
  amountSen: number;
  freeCancelHours: number;
  tickets: ViewTicket[];
  closureChoices: ClosureChoice[];
  addOns: { addOnId: string; quantity: number; priceSen: number }[];
};
export type PackView = {
  customerId: string;
  offerId: string | null;
  sessionsTotal: number;
  sessionsUsed: number;
  expiresAt: number;
  optionIds: string[];
  freeCancelHours: number | null;
  tickets: ViewTicket[];
  closureChoices: ClosureChoice[];
};
export type ClosureChoice = { timeslotId: string; choice: "refund" | "reschedule"; chosenAt: number };
export type PackOfferInput = {
  id: string;
  activityId: string;
  nameEn: string;
  nameMs: string;
  sessions: number;
  priceSen: number;
  validDays: number;
  optionIds: string[];
  active: boolean;
};
export type Group = { bookingId: string } | { packId: string };
export type Outcome = "cancelled" | "forfeited";
export type Quote = {
  tickets: { id: string; outcome: Outcome; refundSen: number }[];
  refundSen: number;
  reason: "cancel" | "closure" | null;
};
export type CancelResult = Quote & { refund: { id: string; amountSen: number; reason: "cancel" | "closure" } | null };
export type PackConfirm =
  | { status: "paid"; packId: string; expiresAt: number }
  | { status: "refund_due"; reason: "duplicate" | "amount_mismatch" };
export type AddOnInput = { id: string; activityId: string; nameEn: string; nameMs: string; priceSen: number; active: boolean };
export type ResourceInput = {
  id: string;
  kind: ResourceKind;
  name: string;
  active: boolean;
  maxSessionsPerDay: number | null;
  restMinutes: number;
  maxRiderWeightKg: number | null;
};
export type ClosureReason = "weather" | "horse_unfit" | "other";
export type ScheduleInput = {
  id: string;
  activityId: string;
  optionIds: string[];
  weekdays: Weekday[];
  times: string[];
  startsOn: string;
  endsOn: string | null;
  active: boolean;
};
export type GenerateResult = { created: number; removed: number; kept: { id: string; optionId: string; startsAt: number }[] };
export type Affected = {
  id: string;
  timeslotId: string;
  customerId: string;
  participantId: string;
  bookingId: string | null;
  packId: string | null;
};
export type CheckInOutcome = "checked_in" | "already" | "not_today" | "closed" | "cancelled" | "not_found" | "ambiguous";
export type CheckInResult = {
  outcome: CheckInOutcome;
  ticket: null | {
    id: string;
    participantId: string;
    bookingId: string | null;
    timeslotId: string;
    optionId: string;
    startsAt: number;
    checkedInAt: number | null;
  };
};
export type TimeslotRow = {
  id: string;
  optionId: string;
  startsAt: number;
  closedAt: number | null;
  closedReason: string | null;
  spots: number;
  tickets: {
    id: string;
    customerId: string;
    participantId: string;
    bookingId: string | null;
    packId: string | null;
    checkedInAt: number | null;
    resources: string[];
  }[];
  addOns: { bookingId: string; addOnId: string; quantity: number }[];
};
export type Setup = {
  activities: { id: string; freeCancelHours: number; bookingCutoffMinutes: number; closedDays: string[]; requiresWaiver: boolean }[];
  options: OptionInput[];
  addOns: AddOnInput[];
  resources: ResourceInput[];
  schedules: ScheduleInput[];
  packOffers: PackOfferInput[];
};
export type ConfirmResult =
  | { status: "paid"; bookingId: string; ticketIds: string[] }
  | { status: "refund_due"; reason: PaymentRefundReason };

const MIN = 60_000;
const HOUR = 3_600_000;
export const DAY = 86_400_000;
const KL_OFFSET = 8 * HOUR;
const HOLD_MS = 15 * MIN;
const DEFAULT_MAX_PER_BOOKING = 10;
const MAX_PER_BOOKING = 50;
const MAX_ACTIVE_HOLDS = 3;

export const klDayStart = (t: number) => Math.floor((t + KL_OFFSET) / DAY) * DAY - KL_OFFSET;
type Slot = { id: string; option_id: string; starts_at: number; closed_at: number | null };
type Option = {
  id: string;
  activity_id: string;
  price_sen: number;
  duration_minutes: number;
  min_age: number | null;
  max_age: number | null;
  max_weight_kg: number | null;
  required_cert: string | null;
  min_participants: number | null;
  max_per_booking: number | null;
  active: number;
  booking_cutoff_minutes: number;
  requires_waiver: number;
};
type Need = { kind: string; quantity: number };
type Candidate = {
  id: string;
  kind: string;
  max_rider_weight_kg: number | null;
  block_start: number;
  block_end: number;
  day_count: number;
};
type Pick = { resourceId: string; participantId: string; blockStart: number; blockEnd: number };
type Hold = {
  id: string;
  customer_id: string;
  timeslot_id: string;
  price_sen: number;
  amount_sen: number | null;
  status: string;
};

const first = <T extends Record<string, SqlStorageValue>>(c: SqlStorageCursor<T>): T | undefined => c.toArray()[0];
const ids = (xs: string[]) => JSON.stringify(xs);

function loadSlot(sql: SqlStorage, id: string) {
  return first(sql.exec<Slot>("SELECT id, option_id, starts_at, closed_at FROM timeslots WHERE id = ?", id));
}

function loadOption(sql: SqlStorage, id: string) {
  return sql
    .exec<Option>(
      `SELECT id, activity_id, price_sen, duration_minutes, min_age, max_age, max_weight_kg, required_cert,
         min_participants, max_per_booking, active,
         (SELECT booking_cutoff_minutes FROM activities WHERE id = options.activity_id) AS booking_cutoff_minutes,
         (SELECT requires_waiver FROM activities WHERE id = options.activity_id) AS requires_waiver
       FROM options WHERE id = ?`,
      id,
    )
    .one();
}

const loadNeeds = (sql: SqlStorage, optionId: string) =>
  sql.exec<Need>("SELECT kind, quantity FROM option_resources WHERE option_id = ? ORDER BY kind", optionId).toArray();

function freeCandidates(sql: SqlStorage, slot: Slot, option: Option, kinds: string[]): Candidate[] {
  const day = klDayStart(slot.starts_at);
  const resources = sql
    .exec<{
      id: string;
      kind: string;
      max_sessions_per_day: number | null;
      rest_minutes: number;
      max_rider_weight_kg: number | null;
    }>(
      `SELECT id, kind, max_sessions_per_day, rest_minutes, max_rider_weight_kg FROM resources
       WHERE active = 1 AND kind IN (SELECT value FROM json_each(?))`,
      ids(kinds),
    )
    .toArray();
  const byResource = new Map<string, { block_start: number; block_end: number }[]>();
  for (const a of sql.exec<{ resource_id: string; block_start: number; block_end: number }>(
    `SELECT resource_id, block_start, block_end FROM allocations
     WHERE resource_id IN (SELECT value FROM json_each(?)) AND block_start >= ? AND block_start < ?`,
    ids(resources.map((r) => r.id)),
    day - DAY,
    day + 2 * DAY,
  )) {
    byResource.set(a.resource_id, [...(byResource.get(a.resource_id) ?? []), a]);
  }
  return resources
    .flatMap((r) => {
      const blockStart = slot.starts_at;
      const blockEnd = blockStart + (option.duration_minutes + r.rest_minutes) * MIN;
      const mine = byResource.get(r.id) ?? [];
      const busy = mine.some((a) => a.block_start < blockEnd && blockStart < a.block_end);
      const dayCount = mine.filter((a) => a.block_start >= day && a.block_start < day + DAY).length;
      if (busy || (r.max_sessions_per_day !== null && dayCount >= r.max_sessions_per_day)) return [];
      return [
        {
          id: r.id,
          kind: r.kind,
          max_rider_weight_kg: r.max_rider_weight_kg,
          block_start: blockStart,
          block_end: blockEnd,
          day_count: dayCount,
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.max_rider_weight_kg ?? Infinity) - (b.max_rider_weight_kg ?? Infinity) ||
        a.day_count - b.day_count ||
        (a.id < b.id ? -1 : 1),
    );
}

function allocate(
  sql: SqlStorage,
  now: number,
  slotId: string,
  people: ParticipantFacts[],
  customerId: string,
  except: string[] = [],
) {
  if (
    people.length === 0 ||
    new Set(people.map((p) => p.id)).size !== people.length ||
    people.some((p) => p.customerId !== customerId)
  ) {
    throw new BookingError("invalid_participant");
  }

  const slot = loadSlot(sql, slotId);
  if (!slot || slot.closed_at !== null) throw new BookingError("not_bookable");
  const option = loadOption(sql, slot.option_id);
  const needs = loadNeeds(sql, option.id);
  if (!option.active || needs.length === 0 || slot.starts_at - option.booking_cutoff_minutes * MIN <= now) {
    throw new BookingError("not_bookable");
  }

  const date = klDate(slot.starts_at);
  for (const p of people) {
    const age = ageOn(p.birthDate, date);
    const ok =
      (option.min_age === null || age >= option.min_age) &&
      (option.max_age === null || age <= option.max_age) &&
      (option.max_weight_kg === null || (p.weightKg !== null && p.weightKg <= option.max_weight_kg)) &&
      (option.required_cert === null || p.certs.includes(option.required_cert));
    if (!ok) throw new BookingError("requirement_not_met");
  }

  const taken = sql
    .exec(
      `WITH busy AS (
         SELECT hp.participant_id, h.timeslot_id FROM hold_participants hp JOIN holds h ON h.id = hp.hold_id
         WHERE h.status = 'active'
         UNION ALL
         SELECT participant_id, timeslot_id FROM tickets
         WHERE status = 'issued' AND id NOT IN (SELECT value FROM json_each(?4))
       )
       SELECT 1 FROM busy b
       JOIN timeslots s ON s.id = b.timeslot_id
       JOIN options o ON o.id = s.option_id
       WHERE b.participant_id IN (SELECT value FROM json_each(?1))
         AND s.closed_at IS NULL
         AND s.starts_at < ?3 AND s.starts_at + o.duration_minutes * ${MIN} > ?2
       LIMIT 1`,
      ids(people.map((p) => p.id)),
      slot.starts_at,
      slot.starts_at + option.duration_minutes * MIN,
      ids(except),
    )
    .toArray();
  if (taken.length) throw new BookingError("invalid_participant");

  const free = freeCandidates(
    sql,
    slot,
    option,
    needs.map((n) => n.kind),
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
            (c.max_rider_weight_kg === null || (p.weightKg !== null && p.weightKg <= c.max_rider_weight_kg)),
        );
        if (!c) {
          const weightUnknown = p.weightKg === null && free.some((c) => c.kind === need.kind && !chosen.has(c.id));
          throw new BookingError(weightUnknown ? "requirement_not_met" : "no_availability");
        }
        chosen.add(c.id);
        picks.push({ resourceId: c.id, participantId: p.id, blockStart: c.block_start, blockEnd: c.block_end });
      }
    }
  }
  return { slot, option, picks };
}

function insertAllocations(sql: SqlStorage, picks: Pick[], owner: { holdId: string } | Map<string, string>) {
  for (const p of picks) {
    sql.exec(
      `INSERT INTO allocations (id, resource_id, participant_id, hold_id, ticket_id, block_start, block_end)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      p.resourceId,
      p.participantId,
      owner instanceof Map ? null : owner.holdId,
      owner instanceof Map ? owner.get(p.participantId)! : null,
      p.blockStart,
      p.blockEnd,
    );
  }
}

function insertTickets(
  sql: SqlStorage,
  now: number,
  t: { customerId: string; bookingId: string | null; packId: string | null; timeslotId: string; priceSen: number },
  participantIds: string[],
) {
  const ticketOf = new Map(participantIds.map((p) => [p, crypto.randomUUID()]));
  for (const [participantId, id] of ticketOf) {
    sql.exec(
      `INSERT INTO tickets (id, customer_id, booking_id, pack_id, participant_id, timeslot_id, price_sen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      t.customerId,
      t.bookingId,
      t.packId,
      participantId,
      t.timeslotId,
      t.priceSen,
      now,
    );
  }
  mark(sql, "ticket", [...ticketOf.values()]);
  return ticketOf;
}

function releaseHold(sql: SqlStorage, holdId: string, status: "expired" | "released") {
  sql.exec("UPDATE holds SET status = ? WHERE id = ? AND status = 'active'", status, holdId);
  sql.exec("DELETE FROM allocations WHERE hold_id = ?", holdId);
}

export function expireDue(sql: SqlStorage, now: number) {
  const due = sql
    .exec<{ id: string; starts_at: number }>(
      `SELECT h.id, t.starts_at FROM holds h JOIN timeslots t ON t.id = h.timeslot_id
       WHERE h.status = 'active' AND h.expires_at <= ?`,
      now,
    )
    .toArray();
  for (const h of due) {
    releaseHold(sql, h.id, "expired");
    markWindow(sql, now, h.starts_at);
  }
}

export function spots(sql: SqlStorage, now: number, slotId: string) {
  const slot = loadSlot(sql, slotId);
  if (!slot || slot.closed_at !== null || slot.starts_at <= now) return 0;
  const option = loadOption(sql, slot.option_id);
  const needs = loadNeeds(sql, option.id);
  if (!option.active || needs.length === 0) return 0;
  const free = freeCandidates(
    sql,
    slot,
    option,
    needs.map((n) => n.kind),
  );
  return Math.min(...needs.map((n) => Math.floor(free.filter((c) => c.kind === n.kind).length / n.quantity)));
}

export type Idempotency = { requestId: string; method: string; fingerprint: unknown[] };

export function replay(sql: SqlStorage, idem: Idempotency): unknown {
  const prior = first(
    sql.exec<{ method: string; fingerprint: string; response: string }>(
      "SELECT method, fingerprint, response FROM requests WHERE request_id = ?",
      idem.requestId,
    ),
  );
  if (!prior) return undefined;
  if (prior.method !== idem.method || prior.fingerprint !== JSON.stringify(idem.fingerprint)) {
    throw new BookingError("idempotency_conflict");
  }
  return JSON.parse(prior.response);
}

export function record(sql: SqlStorage, idem: Idempotency, value: unknown, now: number) {
  sql.exec(
    "INSERT INTO requests (request_id, method, fingerprint, response, created_at) VALUES (?, ?, ?, ?, ?)",
    idem.requestId,
    idem.method,
    JSON.stringify(idem.fingerprint),
    JSON.stringify(value ?? null),
    now,
  );
}

const closedDaysOf = (sql: SqlStorage, activityId: string) =>
  first(sql.exec<{ closed_days: string }>("SELECT closed_days FROM activities WHERE id = ?", activityId))?.closed_days;

export function upsertActivity(sql: SqlStorage, now: number, a: ActivityInput) {
  const before = closedDaysOf(sql, a.id);
  sql.exec(
    `INSERT INTO activities (id, free_cancel_hours, booking_cutoff_minutes, closed_days, requires_waiver)
     VALUES (?1, ?2, coalesce(?3, 60), coalesce(?4, '[]'), coalesce(?5, 1))
     ON CONFLICT(id) DO UPDATE SET free_cancel_hours = excluded.free_cancel_hours,
       booking_cutoff_minutes = coalesce(?3, booking_cutoff_minutes), closed_days = coalesce(?4, closed_days),
       requires_waiver = coalesce(?5, requires_waiver)`,
    a.id,
    a.freeCancelHours,
    a.bookingCutoffMinutes ?? null,
    a.closedDays ? JSON.stringify(a.closedDays) : null,
    a.requiresWaiver === undefined ? null : Number(a.requiresWaiver),
  );
  mark(sql, "activity", [a.id]);
  return before !== undefined && before !== closedDaysOf(sql, a.id) ? generate(sql, now, a.id) : null;
}

export function upsertSchedule(sql: SqlStorage, now: number, s: ScheduleInput) {
  const existing = first(sql.exec<{ activity_id: string }>("SELECT activity_id FROM schedules WHERE id = ?", s.id));
  const options = new Set(
    sql
      .exec<{ id: string }>("SELECT id FROM options WHERE activity_id = ?", s.activityId)
      .toArray()
      .map((o) => o.id),
  );
  if (
    !first(sql.exec("SELECT 1 FROM activities WHERE id = ?", s.activityId)) ||
    (existing && existing.activity_id !== s.activityId) ||
    s.optionIds.some((o) => !options.has(o))
  ) {
    throw new BookingError("invalid_state");
  }
  sql.exec(
    `INSERT INTO schedules (id, activity_id, option_ids, weekdays, times, starts_on, ends_on, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET option_ids = excluded.option_ids, weekdays = excluded.weekdays, times = excluded.times,
       starts_on = excluded.starts_on, ends_on = excluded.ends_on, active = excluded.active`,
    s.id,
    s.activityId,
    ids([...new Set(s.optionIds)]),
    JSON.stringify([...new Set(s.weekdays)]),
    ids([...new Set(s.times)].sort()),
    s.startsOn,
    s.endsOn,
    s.active ? 1 : 0,
  );
  return generate(sql, now, s.activityId);
}

const REOPEN = `ON CONFLICT(option_id, starts_at) DO UPDATE SET closed_at = NULL, closed_reason = NULL,
  schedule_id = excluded.schedule_id WHERE timeslots.closed_reason = 'schedule'`;

// Timeslots no Schedule wants any more are closed as 'schedule' (never deleted, so proj_* stays consistent);
// only those are reopened, so a one-off or a Closure is never undone here.
export function generate(sql: SqlStorage, now: number, activityId: string | null): GenerateResult {
  const created: string[] = [];
  const removed: string[] = [];
  const kept: GenerateResult["kept"] = [];
  const activities = sql
    .exec<{ id: string; closed_days: string }>("SELECT id, closed_days FROM activities WHERE ?1 IS NULL OR id = ?1", activityId)
    .toArray();
  for (const a of activities) {
    const closed = JSON.parse(a.closed_days) as string[];
    const active = new Set(
      sql
        .exec<{ id: string }>("SELECT id FROM options WHERE activity_id = ? AND active = 1", a.id)
        .toArray()
        .map((o) => o.id),
    );
    const want = new Map<string, { optionId: string; startsAt: number; scheduleId: string }>();
    for (const s of sql.exec<{
      id: string;
      option_ids: string;
      weekdays: string;
      times: string;
      starts_on: string;
      ends_on: string | null;
    }>("SELECT * FROM schedules WHERE activity_id = ? AND active = 1 ORDER BY rowid", a.id)) {
      const optionIds = (JSON.parse(s.option_ids) as string[]).filter((o) => active.has(o));
      const rule = { weekdays: JSON.parse(s.weekdays), times: JSON.parse(s.times), startsOn: s.starts_on, endsOn: s.ends_on };
      for (const startsAt of expand(rule, closed, now)) {
        for (const optionId of optionIds) {
          const key = `${optionId}|${startsAt}`;
          if (!want.has(key)) want.set(key, { optionId, startsAt, scheduleId: s.id });
        }
      }
    }
    const stale = sql
      .exec<{ id: string; option_id: string; starts_at: number; busy: number }>(
        `SELECT s.id, s.option_id, s.starts_at,
           EXISTS (SELECT 1 FROM tickets WHERE timeslot_id = s.id AND status = 'issued')
           OR EXISTS (SELECT 1 FROM holds WHERE timeslot_id = s.id AND status = 'active') AS busy
         FROM timeslots s WHERE s.schedule_id IN (SELECT id FROM schedules WHERE activity_id = ?)
           AND s.starts_at > ? AND s.closed_at IS NULL`,
        a.id,
        now,
      )
      .toArray()
      .filter((s) => !want.has(`${s.option_id}|${s.starts_at}`));
    for (const s of stale) {
      if (s.busy) {
        kept.push({ id: s.id, optionId: s.option_id, startsAt: s.starts_at });
      } else {
        sql.exec("UPDATE timeslots SET closed_at = ?, closed_reason = 'schedule' WHERE id = ?", now, s.id);
        removed.push(s.id);
      }
    }
    for (const w of want.values()) {
      const row = first(
        sql.exec<{ id: string }>(
          `INSERT INTO timeslots (id, option_id, starts_at, schedule_id) VALUES (?, ?, ?, ?) ${REOPEN} RETURNING id`,
          crypto.randomUUID(),
          w.optionId,
          w.startsAt,
          w.scheduleId,
        ),
      );
      if (row) created.push(row.id);
    }
  }
  mark(sql, "timeslot", [...created, ...removed]);
  return { created: created.length, removed: removed.length, kept };
}

const openFutureSlots = (sql: SqlStorage, now: number, optionId: string | null) =>
  sql
    .exec<{ id: string }>(
      "SELECT id FROM timeslots WHERE closed_at IS NULL AND starts_at > ?1 AND (?2 IS NULL OR option_id = ?2)",
      now,
      optionId,
    )
    .toArray()
    .map((r) => r.id);

// Stored blocks are fixed at allocation time, so lengthening them under live Allocations would let sessions overlap.
function hasLiveAllocations(sql: SqlStorage, now: number, by: "option" | "resource", id: string) {
  const query =
    by === "resource"
      ? "SELECT 1 FROM allocations WHERE resource_id = ?2 AND block_end > ?1 LIMIT 1"
      : `SELECT 1 FROM allocations a
         LEFT JOIN holds h ON h.id = a.hold_id
         LEFT JOIN tickets t ON t.id = a.ticket_id
         JOIN timeslots s ON s.id = coalesce(h.timeslot_id, t.timeslot_id)
         WHERE s.option_id = ?2 AND a.block_end > ?1 LIMIT 1`;
  return sql.exec(query, now, id).toArray().length > 0;
}

export function upsertOption(sql: SqlStorage, now: number, o: OptionInput) {
  const existing = first(
    sql.exec<{ activity_id: string; duration_minutes: number; active: number }>(
      "SELECT activity_id, duration_minutes, active FROM options WHERE id = ?",
      o.id,
    ),
  );
  if (existing && existing.activity_id !== o.activityId) throw new BookingError("invalid_state");
  if (existing && o.durationMinutes > existing.duration_minutes && hasLiveAllocations(sql, now, "option", o.id)) {
    throw new BookingError("invalid_state");
  }
  if (!first(sql.exec("SELECT 1 FROM activities WHERE id = ?", o.activityId))) throw new BookingError("invalid_state");
  sql.exec(
    `INSERT INTO options (id, activity_id, name_en, name_ms, price_sen, duration_minutes, min_age, max_age,
       max_weight_kg, required_cert, min_participants, max_per_booking, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name_en = excluded.name_en, name_ms = excluded.name_ms,
       price_sen = excluded.price_sen, duration_minutes = excluded.duration_minutes, min_age = excluded.min_age,
       max_age = excluded.max_age, max_weight_kg = excluded.max_weight_kg, required_cert = excluded.required_cert,
       min_participants = excluded.min_participants, max_per_booking = excluded.max_per_booking, active = excluded.active`,
    o.id,
    o.activityId,
    o.nameEn,
    o.nameMs,
    o.priceSen,
    o.durationMinutes,
    o.minAge,
    o.maxAge,
    o.maxWeightKg,
    o.requiredCert,
    o.minParticipants,
    o.maxPerBooking,
    o.active ? 1 : 0,
  );
  sql.exec("DELETE FROM option_resources WHERE option_id = ?", o.id);
  for (const n of o.needs) {
    sql.exec("INSERT INTO option_resources (option_id, kind, quantity) VALUES (?, ?, ?)", o.id, n.kind, n.quantity);
  }
  mark(sql, "option", [o.id]);
  mark(sql, "timeslot", openFutureSlots(sql, now, o.id));
  return existing && existing.active !== (o.active ? 1 : 0) ? generate(sql, now, o.activityId) : null;
}

export function upsertAddOn(sql: SqlStorage, a: AddOnInput) {
  if (!first(sql.exec("SELECT 1 FROM activities WHERE id = ?", a.activityId))) throw new BookingError("invalid_state");
  sql.exec(
    `INSERT INTO add_ons (id, activity_id, name_en, name_ms, price_sen, active) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET activity_id = excluded.activity_id, name_en = excluded.name_en,
       name_ms = excluded.name_ms, price_sen = excluded.price_sen, active = excluded.active`,
    a.id,
    a.activityId,
    a.nameEn,
    a.nameMs,
    a.priceSen,
    a.active ? 1 : 0,
  );
  mark(sql, "add_on", [a.id]);
  return null;
}

export function upsertResource(sql: SqlStorage, now: number, r: ResourceInput) {
  const existing = first(
    sql.exec<{ kind: string; rest_minutes: number }>("SELECT kind, rest_minutes FROM resources WHERE id = ?", r.id),
  );
  if (existing && existing.kind !== r.kind) throw new BookingError("invalid_state");
  if (existing && r.restMinutes > existing.rest_minutes && hasLiveAllocations(sql, now, "resource", r.id)) {
    throw new BookingError("invalid_state");
  }
  sql.exec(
    `INSERT INTO resources (id, kind, name, active, max_sessions_per_day, rest_minutes, max_rider_weight_kg)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active,
       max_sessions_per_day = excluded.max_sessions_per_day, rest_minutes = excluded.rest_minutes,
       max_rider_weight_kg = excluded.max_rider_weight_kg`,
    r.id,
    r.kind,
    r.name,
    r.active ? 1 : 0,
    r.maxSessionsPerDay,
    r.restMinutes,
    r.maxRiderWeightKg,
  );
  mark(sql, "timeslot", openFutureSlots(sql, now, null));
  return null;
}

export function createTimeslots(sql: SqlStorage, now: number, i: { optionId: string; startsAt: number[] }) {
  if (!first(sql.exec("SELECT 1 FROM options WHERE id = ?", i.optionId)) || i.startsAt.some((t) => t <= now)) {
    throw new BookingError("invalid_state");
  }
  const result = i.startsAt.map((t) => {
    sql.exec(
      `INSERT INTO timeslots (id, option_id, starts_at) VALUES (?, ?, ?) ${REOPEN}`,
      crypto.randomUUID(),
      i.optionId,
      t,
    );
    return sql
      .exec<{ id: string }>("SELECT id FROM timeslots WHERE option_id = ? AND starts_at = ?", i.optionId, t)
      .one().id;
  });
  mark(sql, "timeslot", result);
  return { ids: result };
}

// Idempotent by state: closing an already closed Timeslot writes nothing and returns the current affected list.
export function closeTimeslot(sql: SqlStorage, now: number, timeslotId: string, reason: ClosureReason) {
  const slot = loadSlot(sql, timeslotId);
  if (!slot) throw new BookingError("invalid_state");
  if (slot.closed_at === null) {
    if (slot.starts_at <= now) throw new BookingError("invalid_state");
    sql.exec("UPDATE timeslots SET closed_at = ?, closed_reason = ? WHERE id = ?", now, reason, timeslotId);
    sql.exec("DELETE FROM allocations WHERE ticket_id IN (SELECT id FROM tickets WHERE timeslot_id = ?)", timeslotId);
    for (const h of sql
      .exec<{ id: string }>("SELECT id FROM holds WHERE timeslot_id = ? AND status = 'active'", timeslotId)
      .toArray()) {
      releaseHold(sql, h.id, "released");
    }
    mark(sql, "timeslot", [timeslotId]);
    mark(
      sql,
      "ticket",
      sql
        .exec<{ id: string }>("SELECT id FROM tickets WHERE timeslot_id = ?", timeslotId)
        .toArray()
        .map((t) => t.id),
    );
    markWindow(sql, now, slot.starts_at);
  }
  const affected = sql
    .exec<{
      id: string;
      customer_id: string;
      participant_id: string;
      booking_id: string | null;
      pack_id: string | null;
    }>(
      `SELECT id, customer_id, participant_id, booking_id, pack_id FROM tickets
       WHERE timeslot_id = ? AND status = 'issued' ORDER BY rowid`,
      timeslotId,
    )
    .toArray()
    .map(
      (t): Affected => ({
        id: t.id,
        timeslotId,
        customerId: t.customer_id,
        participantId: t.participant_id,
        bookingId: t.booking_id,
        packId: t.pack_id,
      }),
    );
  return { affected };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// code is a Ticket id (the QR) or its first 8 hex chars (typed by hand).
export function checkIn(sql: SqlStorage, now: number, code: string): CheckInResult {
  const c = code.trim().toLowerCase();
  const select = `SELECT t.id, t.status, t.participant_id, t.booking_id, t.timeslot_id, t.checked_in_at,
      s.option_id, s.starts_at, s.closed_at
    FROM tickets t JOIN timeslots s ON s.id = t.timeslot_id`;
  type Row = {
    id: string;
    status: string;
    participant_id: string;
    booking_id: string | null;
    timeslot_id: string;
    checked_in_at: number | null;
    option_id: string;
    starts_at: number;
    closed_at: number | null;
  };
  let rows: Row[] = UUID.test(c)
    ? sql.exec<Row>(`${select} WHERE t.id = ?`, c).toArray()
    : /^[0-9a-f]{8}$/.test(c)
      ? sql.exec<Row>(`${select} WHERE t.id > ?1 || '-' AND t.id < ?1 || '.'`, c).toArray()
      : [];
  if (rows.length === 0) return { outcome: "not_found", ticket: null };
  const today = klDayStart(now);
  if (rows.length > 1) rows = rows.filter((r) => r.status === "issued" && klDayStart(r.starts_at) === today);
  if (rows.length !== 1) return { outcome: "ambiguous", ticket: null };
  const t = rows[0];
  const ticket = (checkedInAt: number | null) => ({
    id: t.id,
    participantId: t.participant_id,
    bookingId: t.booking_id,
    timeslotId: t.timeslot_id,
    optionId: t.option_id,
    startsAt: t.starts_at,
    checkedInAt,
  });
  const outcome: CheckInOutcome | null =
    t.status !== "issued"
      ? "cancelled"
      : t.closed_at !== null
        ? "closed"
        : klDayStart(t.starts_at) !== today
          ? "not_today"
          : t.checked_in_at !== null
            ? "already"
            : null;
  if (outcome) return { outcome, ticket: ticket(t.checked_in_at) };
  sql.exec("UPDATE tickets SET checked_in_at = ? WHERE id = ? AND checked_in_at IS NULL", now, t.id);
  return { outcome: "checked_in", ticket: ticket(now) };
}

// Includes unexpired Packs with sessions left, which can only be redeemed while the Activity is Bookable.
export const hasFutureBookings = (sql: SqlStorage, now: number, activityId: string) =>
  !!first(
    sql.exec(
      `SELECT 1 FROM timeslots s JOIN options o ON o.id = s.option_id
       WHERE o.activity_id = ?1 AND s.starts_at > ?2
         AND (EXISTS (SELECT 1 FROM tickets WHERE timeslot_id = s.id AND status = 'issued')
           OR EXISTS (SELECT 1 FROM holds WHERE timeslot_id = s.id AND status = 'active'))
       UNION ALL
       SELECT 1 FROM packs p
       WHERE p.expires_at > ?2
         AND EXISTS (SELECT 1 FROM json_each(p.option_ids) j JOIN options o ON o.id = j.value WHERE o.activity_id = ?1)
         AND p.sessions_total > (SELECT count(*) FROM tickets WHERE pack_id = p.id AND status <> 'cancelled')
       LIMIT 1`,
      activityId,
      now,
    ),
  );

export function setup(sql: SqlStorage): Setup {
  const needs = new Map<string, OptionInput["needs"]>();
  for (const n of sql.exec<{ option_id: string; kind: ResourceKind; quantity: number }>(
    "SELECT option_id, kind, quantity FROM option_resources ORDER BY kind",
  )) {
    needs.set(n.option_id, [...(needs.get(n.option_id) ?? []), { kind: n.kind, quantity: n.quantity }]);
  }
  return {
    activities: sql
      .exec<{ id: string; free_cancel_hours: number; booking_cutoff_minutes: number; closed_days: string; requires_waiver: number }>(
        "SELECT id, free_cancel_hours, booking_cutoff_minutes, closed_days, requires_waiver FROM activities ORDER BY rowid",
      )
      .toArray()
      .map((a) => ({
        id: a.id,
        freeCancelHours: a.free_cancel_hours,
        bookingCutoffMinutes: a.booking_cutoff_minutes,
        closedDays: JSON.parse(a.closed_days),
        requiresWaiver: !!a.requires_waiver,
      })),
    options: sql
      .exec<{
        id: string;
        activity_id: string;
        name_en: string;
        name_ms: string;
        price_sen: number;
        duration_minutes: number;
        min_age: number | null;
        max_age: number | null;
        max_weight_kg: number | null;
        required_cert: string | null;
        min_participants: number | null;
        max_per_booking: number | null;
        active: number;
      }>("SELECT * FROM options ORDER BY rowid")
      .toArray()
      .map((o) => ({
        id: o.id,
        activityId: o.activity_id,
        nameEn: o.name_en,
        nameMs: o.name_ms,
        priceSen: o.price_sen,
        durationMinutes: o.duration_minutes,
        minAge: o.min_age,
        maxAge: o.max_age,
        maxWeightKg: o.max_weight_kg,
        requiredCert: o.required_cert,
        minParticipants: o.min_participants,
        maxPerBooking: o.max_per_booking,
        active: o.active === 1,
        needs: needs.get(o.id) ?? [],
      })),
    addOns: sql
      .exec<{ id: string; activity_id: string; name_en: string; name_ms: string; price_sen: number; active: number }>(
        "SELECT * FROM add_ons ORDER BY rowid",
      )
      .toArray()
      .map((a) => ({
        id: a.id,
        activityId: a.activity_id,
        nameEn: a.name_en,
        nameMs: a.name_ms,
        priceSen: a.price_sen,
        active: a.active === 1,
      })),
    resources: sql
      .exec<{
        id: string;
        kind: ResourceKind;
        name: string;
        active: number;
        max_sessions_per_day: number | null;
        rest_minutes: number;
        max_rider_weight_kg: number | null;
      }>("SELECT * FROM resources ORDER BY rowid")
      .toArray()
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        active: r.active === 1,
        maxSessionsPerDay: r.max_sessions_per_day,
        restMinutes: r.rest_minutes,
        maxRiderWeightKg: r.max_rider_weight_kg,
      })),
    schedules: sql
      .exec<{
        id: string;
        activity_id: string;
        option_ids: string;
        weekdays: string;
        times: string;
        starts_on: string;
        ends_on: string | null;
        active: number;
      }>("SELECT * FROM schedules ORDER BY rowid")
      .toArray()
      .map((s) => ({
        id: s.id,
        activityId: s.activity_id,
        optionIds: JSON.parse(s.option_ids),
        weekdays: JSON.parse(s.weekdays),
        times: JSON.parse(s.times),
        startsOn: s.starts_on,
        endsOn: s.ends_on,
        active: s.active === 1,
      })),
    packOffers: sql
      .exec<{
        id: string;
        activity_id: string;
        name_en: string;
        name_ms: string;
        sessions: number;
        price_sen: number;
        valid_days: number;
        option_ids: string;
        active: number;
      }>("SELECT * FROM pack_offers ORDER BY rowid")
      .toArray()
      .map((o) => ({
        id: o.id,
        activityId: o.activity_id,
        nameEn: o.name_en,
        nameMs: o.name_ms,
        sessions: o.sessions,
        priceSen: o.price_sen,
        validDays: o.valid_days,
        optionIds: JSON.parse(o.option_ids),
        active: o.active === 1,
      })),
  };
}

export function timeslots(sql: SqlStorage, now: number, q: { from: number; to: number } | { ids: string[] }): TimeslotRow[] {
  if ("from" in q && !(q.to > q.from && q.to - q.from <= 14 * DAY)) throw new BookingError("invalid_state");
  const slots = sql
    .exec<{
      id: string;
      option_id: string;
      starts_at: number;
      closed_at: number | null;
      closed_reason: string | null;
    }>(
      "from" in q
        ? `SELECT id, option_id, starts_at, closed_at, closed_reason FROM timeslots
           WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at, option_id`
        : `SELECT id, option_id, starts_at, closed_at, closed_reason FROM timeslots
           WHERE id IN (SELECT value FROM json_each(?)) ORDER BY starts_at, option_id`,
      ...("from" in q ? [q.from, q.to] : [ids(q.ids)]),
    )
    .toArray();
  const tickets = sql
    .exec<{
      id: string;
      timeslot_id: string;
      customer_id: string;
      participant_id: string;
      booking_id: string | null;
      pack_id: string | null;
      checked_in_at: number | null;
    }>(
      `SELECT id, timeslot_id, customer_id, participant_id, booking_id, pack_id, checked_in_at FROM tickets
       WHERE timeslot_id IN (SELECT value FROM json_each(?)) AND status = 'issued' ORDER BY rowid`,
      ids(slots.map((s) => s.id)),
    )
    .toArray();
  const resources = new Map<string, string[]>();
  for (const r of sql.exec<{ ticket_id: string; name: string }>(
    `SELECT a.ticket_id, r.name FROM allocations a JOIN resources r ON r.id = a.resource_id
     WHERE a.ticket_id IN (SELECT value FROM json_each(?)) ORDER BY r.kind, r.name`,
    ids(tickets.map((t) => t.id)),
  )) {
    resources.set(r.ticket_id, [...(resources.get(r.ticket_id) ?? []), r.name]);
  }
  const addOns = sql
    .exec<{ booking_id: string; add_on_id: string; quantity: number }>(
      `SELECT b.id AS booking_id, ha.add_on_id, ha.quantity FROM bookings b JOIN hold_add_ons ha ON ha.hold_id = b.hold_id
       WHERE b.id IN (SELECT value FROM json_each(?)) ORDER BY ha.add_on_id`,
      ids([...new Set(tickets.flatMap((t) => t.booking_id ?? []))]),
    )
    .toArray();
  return slots.map((s) => {
    const mine = tickets.filter((t) => t.timeslot_id === s.id);
    const bookings = new Set(mine.map((t) => t.booking_id));
    return {
      id: s.id,
      optionId: s.option_id,
      startsAt: s.starts_at,
      closedAt: s.closed_at,
      closedReason: s.closed_reason,
      spots: spots(sql, now, s.id),
      tickets: mine.map((t) => ({
        id: t.id,
        customerId: t.customer_id,
        participantId: t.participant_id,
        bookingId: t.booking_id,
        packId: t.pack_id,
        checkedInAt: t.checked_in_at,
        resources: resources.get(t.id) ?? [],
      })),
      addOns: addOns
        .filter((a) => bookings.has(a.booking_id))
        .map((a) => ({ bookingId: a.booking_id, addOnId: a.add_on_id, quantity: a.quantity })),
    };
  });
}

// Releases the Checkout's previous Hold and any of the Customer's Holds that would clash with the new one.
function supersede(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; replaces: string | null; timeslotId: string; participantIds: string[] },
) {
  const slot = loadSlot(sql, i.timeslotId);
  const end = slot ? slot.starts_at + loadOption(sql, slot.option_id).duration_minutes * MIN : 0;
  const prior = sql
    .exec<{ id: string; starts_at: number }>(
      `SELECT h.id, t.starts_at FROM holds h
       JOIN timeslots t ON t.id = h.timeslot_id
       JOIN options o ON o.id = t.option_id
       WHERE h.status = 'active' AND h.customer_id = ?1 AND (h.id = ?2 OR (
         t.starts_at < ?5 AND t.starts_at + o.duration_minutes * ${MIN} > ?4 AND EXISTS (
           SELECT 1 FROM hold_participants hp
           WHERE hp.hold_id = h.id AND hp.participant_id IN (SELECT value FROM json_each(?3)))))`,
      i.customerId,
      i.replaces,
      ids(i.participantIds),
      slot?.starts_at ?? 0,
      end,
    )
    .toArray();
  for (const h of prior) {
    releaseHold(sql, h.id, "released");
    markWindow(sql, now, h.starts_at);
  }
  return prior.map((h) => h.id);
}

function priceAddOns(sql: SqlStorage, option: Option, n: number, picks: AddOnPick[]) {
  if (new Set(picks.map((a) => a.id)).size !== picks.length) throw new BookingError("invalid_add_on");
  return picks.map((a) => {
    const row = first(
      sql.exec<{ activity_id: string; price_sen: number; active: number }>(
        "SELECT activity_id, price_sen, active FROM add_ons WHERE id = ?",
        a.id,
      ),
    );
    if (!row || !row.active || row.activity_id !== option.activity_id || !Number.isInteger(a.qty) || a.qty < 1 || a.qty > n) {
      throw new BookingError("invalid_add_on");
    }
    return { id: a.id, qty: a.qty, priceSen: row.price_sen };
  });
}

export function createHold(
  sql: SqlStorage,
  now: number,
  i: {
    customerId: string;
    replaces: string | null;
    timeslotId: string;
    participants: ParticipantFacts[];
    addOns: AddOnPick[];
  },
) {
  const n = i.participants.length;
  const released = supersede(sql, now, { ...i, participantIds: i.participants.map((p) => p.id) });
  const { slot, option, picks } = allocate(sql, now, i.timeslotId, i.participants, i.customerId);
  if (n < (option.min_participants ?? 1)) throw new BookingError("below_min_participants");
  const max = option.max_per_booking ?? DEFAULT_MAX_PER_BOOKING;
  if (n > max) throw new BookingError("invalid_participant");
  const addOns = priceAddOns(sql, option, n, i.addOns);
  const { active } = sql
    .exec<{ active: number }>("SELECT count(*) AS active FROM holds WHERE customer_id = ? AND status = 'active'", i.customerId)
    .one();
  const { people } = sql
    .exec<{ people: number }>(
      `SELECT count(*) AS people FROM hold_participants hp JOIN holds h ON h.id = hp.hold_id
       WHERE h.customer_id = ? AND h.timeslot_id = ? AND h.status = 'active'`,
      i.customerId,
      slot.id,
    )
    .one();
  if (active >= MAX_ACTIVE_HOLDS || people + n > max) throw new BookingError("too_many_holds");
  if (option.requires_waiver && i.participants.some((p) => !p.waiverSigned)) throw new BookingError("waiver_missing");
  const holdId = crypto.randomUUID();
  const expiresAt = now + HOLD_MS;
  const amountSen = option.price_sen * n + addOns.reduce((sum, a) => sum + a.qty * a.priceSen, 0);
  sql.exec(
    `INSERT INTO holds (id, customer_id, timeslot_id, price_sen, amount_sen, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    holdId,
    i.customerId,
    slot.id,
    option.price_sen,
    amountSen,
    now,
    expiresAt,
  );
  for (const p of i.participants) {
    sql.exec(
      "INSERT INTO hold_participants (hold_id, participant_id, birth_date, weight_kg, certs) VALUES (?, ?, ?, ?, ?)",
      holdId,
      p.id,
      p.birthDate,
      p.weightKg,
      JSON.stringify(p.certs),
    );
  }
  for (const a of addOns) {
    sql.exec(
      "INSERT INTO hold_add_ons (hold_id, add_on_id, quantity, price_sen) VALUES (?, ?, ?, ?)",
      holdId,
      a.id,
      a.qty,
      a.priceSen,
    );
  }
  insertAllocations(sql, picks, { holdId });
  markWindow(sql, now, slot.starts_at);
  return { holdId, expiresAt, amountSen, addOns, released };
}

function bookingOutcome(sql: SqlStorage, bookingId: string): ConfirmResult {
  const ticketIds = sql
    .exec<{ id: string }>("SELECT id FROM tickets WHERE booking_id = ? ORDER BY rowid", bookingId)
    .toArray()
    .map((t) => t.id);
  return { status: "paid", bookingId, ticketIds };
}

// The Hold's Allocations move to the new Tickets, so nothing is re-allocated.
function ticketsFromHold(sql: SqlStorage, now: number, hold: Hold, owner: Group, priceSen: number) {
  const participantIds = sql
    .exec<{ participant_id: string }>("SELECT participant_id FROM hold_participants WHERE hold_id = ? ORDER BY rowid", hold.id)
    .toArray()
    .map((p) => p.participant_id);
  const ticketOf = insertTickets(
    sql,
    now,
    {
      customerId: hold.customer_id,
      bookingId: "bookingId" in owner ? owner.bookingId : null,
      packId: "packId" in owner ? owner.packId : null,
      timeslotId: hold.timeslot_id,
      priceSen,
    },
    participantIds,
  );
  for (const [participantId, ticketId] of ticketOf) {
    sql.exec(
      "UPDATE allocations SET ticket_id = ?, hold_id = NULL WHERE hold_id = ? AND participant_id = ?",
      ticketId,
      hold.id,
      participantId,
    );
  }
  return ticketOf;
}

// A Hold that replaced the paid one for the same people, Timeslot and amount takes the payment.
function successor(sql: SqlStorage, hold: Hold, participantIds: string[], amountSen: number) {
  const want = [...participantIds].sort().join();
  return sql
    .exec<Hold>(
      `SELECT id, customer_id, timeslot_id, price_sen, amount_sen, status FROM holds
       WHERE customer_id = ? AND timeslot_id = ? AND status = 'active' AND id <> ?`,
      hold.customer_id,
      hold.timeslot_id,
      hold.id,
    )
    .toArray()
    .find((h) => {
      const theirs = sql
        .exec<{ participant_id: string }>("SELECT participant_id FROM hold_participants WHERE hold_id = ?", h.id)
        .toArray()
        .map((p) => p.participant_id);
      return (h.amount_sen ?? h.price_sen * theirs.length) === amountSen && theirs.sort().join() === want;
    });
}

function settle(sql: SqlStorage, now: number, i: { holdId: string; amountSen: number }): ConfirmResult {
  const refund = (reason: PaymentRefundReason): ConfirmResult => ({ status: "refund_due", reason });
  const hold = first(
    sql.exec<Hold>("SELECT id, customer_id, timeslot_id, price_sen, amount_sen, status FROM holds WHERE id = ?", i.holdId),
  );
  if (!hold) return refund("unknown_hold");
  const people = sql
    .exec<{ participant_id: string; birth_date: string; weight_kg: number | null; certs: string }>(
      "SELECT participant_id, birth_date, weight_kg, certs FROM hold_participants WHERE hold_id = ? ORDER BY rowid",
      hold.id,
    )
    .toArray();
  if (i.amountSen !== (hold.amount_sen ?? hold.price_sen * people.length)) return refund("amount_mismatch");
  if (hold.status === "confirmed") return refund("duplicate");

  const slot = loadSlot(sql, hold.timeslot_id)!;
  const participantIds = people.map((p) => p.participant_id);
  const live = hold.status === "active" ? hold : successor(sql, hold, participantIds, i.amountSen);
  const bookingId = crypto.randomUUID();
  let confirmed = hold.id;

  if (live && slot.closed_at === null && slot.starts_at > now) {
    confirmed = live.id;
    sql.exec("INSERT INTO bookings (id, customer_id, hold_id, created_at) VALUES (?, ?, ?, ?)", bookingId, live.customer_id, live.id, now);
    ticketsFromHold(sql, now, live, { bookingId }, live.price_sen);
  } else {
    if (hold.status === "active") {
      releaseHold(sql, hold.id, "released");
      markWindow(sql, now, slot.starts_at);
    }
    let picks: Pick[];
    try {
      const facts = people.map((p) => ({
        id: p.participant_id,
        customerId: hold.customer_id,
        birthDate: p.birth_date,
        weightKg: p.weight_kg,
        certs: JSON.parse(p.certs) as string[],
        waiverSigned: true,
      }));
      picks = allocate(sql, now, slot.id, facts, hold.customer_id).picks;
    } catch (e) {
      if (e instanceof BookingError) return refund("unavailable");
      throw e;
    }
    sql.exec("INSERT INTO bookings (id, customer_id, hold_id, created_at) VALUES (?, ?, ?, ?)", bookingId, hold.customer_id, hold.id, now);
    insertAllocations(sql, picks, insertTickets(
        sql,
        now,
        { customerId: hold.customer_id, bookingId, packId: null, timeslotId: hold.timeslot_id, priceSen: hold.price_sen },
        participantIds,
      ));
  }
  const updated = sql.exec("UPDATE holds SET status = 'confirmed' WHERE id = ? AND status <> 'confirmed' RETURNING id", confirmed);
  if (updated.toArray().length !== 1) throw new Error("hold_confirm_conflict");
  markWindow(sql, now, slot.starts_at);
  return bookingOutcome(sql, bookingId);
}

export function confirmHold(
  sql: SqlStorage,
  now: number,
  i: { billId: string; holdId: string; amountSen: number; commissionBps: number | null },
) {
  const prior = first(
    sql.exec<{ hold_id: string; amount_sen: number; booking_id: string | null; refund_reason: PaymentRefundReason | null }>(
      "SELECT hold_id, amount_sen, booking_id, refund_reason FROM payments WHERE bill_id = ?",
      i.billId,
    ),
  );
  if (prior) {
    if (prior.hold_id !== i.holdId || prior.amount_sen !== i.amountSen) throw new BookingError("idempotency_conflict");
    return prior.booking_id
      ? bookingOutcome(sql, prior.booking_id)
      : ({ status: "refund_due", reason: prior.refund_reason! } as ConfirmResult);
  }
  const result = settle(sql, now, i);
  if (result.status === "paid") sql.exec("UPDATE tickets SET commission_bps = ? WHERE booking_id = ?", i.commissionBps, result.bookingId);
  sql.exec(
    `INSERT INTO payments (bill_id, hold_id, amount_sen, received_at, status, refund_reason, booking_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    i.billId,
    i.holdId,
    i.amountSen,
    now,
    result.status,
    result.status === "refund_due" ? result.reason : null,
    result.status === "paid" ? result.bookingId : null,
  );
  mark(sql, "payment", [i.billId]);
  if (result.status === "refund_due") {
    const hold = first(sql.exec<{ customer_id: string }>("SELECT customer_id FROM holds WHERE id = ?", i.holdId));
    billRefund(sql, now, { billId: i.billId, customerId: hold?.customer_id ?? null, amountSen: i.amountSen, reason: result.reason });
  }
  return result;
}

function billRefund(
  sql: SqlStorage,
  now: number,
  r: { billId: string; customerId: string | null; amountSen: number; reason: PaymentRefundReason },
) {
  if (r.amountSen <= 0) return;
  sql.exec(
    `INSERT INTO refunds (id, customer_id, bill_id, amount_sen, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    `bill:${r.billId}`,
    r.customerId,
    r.billId,
    r.amountSen,
    r.reason,
    now,
  );
  mark(sql, "refund", [`bill:${r.billId}`]);
}

const inWindow = (hours: number, startsAt: number, now: number) => hours > 0 && now <= startsAt - hours * HOUR;
const owner = (g: Group) => ("bookingId" in g ? { col: "booking_id", id: g.bookingId } : { col: "pack_id", id: g.packId });
const sorted = (xs: string[]) => JSON.stringify([...xs].sort());

export function upsertPackOffer(sql: SqlStorage, o: PackOfferInput) {
  const existing = first(sql.exec<{ activity_id: string }>("SELECT activity_id FROM pack_offers WHERE id = ?", o.id));
  const optionIds = [...new Set(o.optionIds)];
  const own = new Set(
    sql
      .exec<{ id: string }>("SELECT id FROM options WHERE activity_id = ?", o.activityId)
      .toArray()
      .map((x) => x.id),
  );
  if (
    !first(sql.exec("SELECT 1 FROM activities WHERE id = ?", o.activityId)) ||
    (existing && existing.activity_id !== o.activityId) ||
    optionIds.length === 0 ||
    optionIds.some((id) => !own.has(id))
  ) {
    throw new BookingError("invalid_state");
  }
  sql.exec(
    `INSERT INTO pack_offers (id, activity_id, name_en, name_ms, sessions, price_sen, valid_days, option_ids, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name_en = excluded.name_en, name_ms = excluded.name_ms, sessions = excluded.sessions,
       price_sen = excluded.price_sen, valid_days = excluded.valid_days, option_ids = excluded.option_ids,
       active = excluded.active`,
    o.id,
    o.activityId,
    o.nameEn,
    o.nameMs,
    o.sessions,
    o.priceSen,
    o.validDays,
    ids(optionIds),
    o.active ? 1 : 0,
  );
  mark(sql, "pack_offer", [o.id]);
  return null;
}

// The order snapshots the offer, so a later edit or deactivation never changes what was bought.
export function orderPack(sql: SqlStorage, now: number, i: { orderId: string; customerId: string; offerId: string }) {
  const offer = first(
    sql.exec<{ price_sen: number; sessions: number; valid_days: number; option_ids: string; active: number }>(
      "SELECT price_sen, sessions, valid_days, option_ids, active FROM pack_offers WHERE id = ?",
      i.offerId,
    ),
  );
  if (!offer || !offer.active) throw new BookingError("not_bookable");
  sql.exec(
    `INSERT INTO pack_orders (id, customer_id, offer_id, price_sen, sessions, valid_days, option_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    i.orderId,
    i.customerId,
    i.offerId,
    offer.price_sen,
    offer.sessions,
    offer.valid_days,
    offer.option_ids,
    now,
  );
  return {
    amountSen: offer.price_sen,
    sessions: offer.sessions,
    validDays: offer.valid_days,
    optionIds: JSON.parse(offer.option_ids) as string[],
  };
}

// Idempotent by state: a bill already seen returns its stored outcome.
export function confirmPackBill(
  sql: SqlStorage,
  now: number,
  i: { billId: string; orderId: string; amountSen: number; commissionBps: number | null },
): PackConfirm {
  const refunded = first(sql.exec<{ reason: "duplicate" | "amount_mismatch" }>("SELECT reason FROM refunds WHERE id = ?", `bill:${i.billId}`));
  if (refunded) return { status: "refund_due", reason: refunded.reason };
  const order = first(
    sql.exec<{
      customer_id: string;
      offer_id: string;
      price_sen: number;
      sessions: number;
      valid_days: number;
      option_ids: string;
      bill_id: string | null;
      pack_id: string | null;
    }>("SELECT * FROM pack_orders WHERE id = ?", i.orderId),
  );
  if (!order) throw new BookingError("invalid_state");
  if (order.bill_id === i.billId) {
    const { expires_at } = sql.exec<{ expires_at: number }>("SELECT expires_at FROM packs WHERE id = ?", order.pack_id).one();
    return { status: "paid", packId: order.pack_id!, expiresAt: expires_at };
  }
  const reason = i.amountSen !== order.price_sen ? "amount_mismatch" : order.bill_id ? "duplicate" : null;
  if (reason) {
    billRefund(sql, now, { billId: i.billId, customerId: order.customer_id, amountSen: i.amountSen, reason });
    return { status: "refund_due", reason };
  }
  const packId = crypto.randomUUID();
  const expiresAt = packExpiry(now, order.valid_days);
  sql.exec(
    `INSERT INTO packs (id, customer_id, sessions_total, expires_at, created_at, offer_id, option_ids, commission_bps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    packId,
    order.customer_id,
    order.sessions,
    expiresAt,
    now,
    order.offer_id,
    order.option_ids,
    i.commissionBps,
  );
  sql.exec("UPDATE pack_orders SET bill_id = ?, pack_id = ? WHERE id = ?", i.billId, packId, i.orderId);
  mark(sql, "pack", [packId]);
  return { status: "paid", packId, expiresAt };
}

// Consumes the Checkout's Hold: Requirements, Waivers and party size were checked when it was made.
export function redeemPack(sql: SqlStorage, now: number, i: { customerId: string; packId: string; holdId: string }) {
  const hold = first(
    sql.exec<Hold>("SELECT id, customer_id, timeslot_id, price_sen, amount_sen, status FROM holds WHERE id = ?", i.holdId),
  );
  if (!hold || hold.status !== "active" || hold.customer_id !== i.customerId) throw new BookingError("invalid_state");
  if (first(sql.exec("SELECT 1 FROM hold_add_ons WHERE hold_id = ?", hold.id))) throw new BookingError("invalid_add_on");
  const slot = loadSlot(sql, hold.timeslot_id)!;
  if (slot.starts_at <= now) throw new BookingError("not_bookable");
  const pack = first(
    sql.exec<{ customer_id: string; sessions_total: number; expires_at: number; option_ids: string }>(
      "SELECT customer_id, sessions_total, expires_at, option_ids FROM packs WHERE id = ?",
      i.packId,
    ),
  );
  if (!pack || pack.customer_id !== i.customerId || !(JSON.parse(pack.option_ids) as string[]).includes(slot.option_id)) {
    throw new BookingError("pack_unavailable");
  }
  if (slot.starts_at > pack.expires_at) throw new BookingError("pack_expired");
  const { used } = sql
    .exec<{ used: number }>("SELECT count(*) AS used FROM tickets WHERE pack_id = ? AND status <> 'cancelled'", i.packId)
    .one();
  const { n } = sql.exec<{ n: number }>("SELECT count(*) AS n FROM hold_participants WHERE hold_id = ?", hold.id).one();
  if (pack.sessions_total - used < n) throw new BookingError("pack_used_up");
  const ticketOf = ticketsFromHold(sql, now, hold, { packId: i.packId }, 0);
  sql.exec("UPDATE holds SET status = 'confirmed' WHERE id = ?", hold.id);
  mark(sql, "pack", [i.packId]);
  markWindow(sql, now, slot.starts_at);
  return { ticketIds: [...ticketOf.values()] };
}

type GroupTicket = {
  id: string;
  booking_id: string | null;
  pack_id: string | null;
  participant_id: string;
  price_sen: number;
  timeslot_id: string;
  option_id: string;
  starts_at: number;
  closed_at: number | null;
  free_cancel_hours: number;
  checked_in_at: number | null;
};

function groupTickets(sql: SqlStorage, customerId: string, group: Group, ticketIds: string[]) {
  const o = owner(group);
  const rows = sql
    .exec<GroupTicket & { status: string; customer_id: string }>(
      `SELECT t.id, t.status, t.customer_id, t.booking_id, t.pack_id, t.participant_id, t.price_sen, t.timeslot_id,
         s.option_id, s.starts_at, s.closed_at, a.free_cancel_hours, t.checked_in_at
       FROM tickets t
       JOIN timeslots s ON s.id = t.timeslot_id
       JOIN options op ON op.id = s.option_id
       JOIN activities a ON a.id = op.activity_id
       WHERE t.id IN (SELECT value FROM json_each(?)) ORDER BY t.rowid`,
      ids(ticketIds),
    )
    .toArray();
  if (
    ticketIds.length < 1 ||
    ticketIds.length > MAX_PER_BOOKING ||
    new Set(ticketIds).size !== ticketIds.length ||
    rows.length !== ticketIds.length ||
    rows.some((t) => t.status !== "issued" || t.customer_id !== customerId || t[o.col as "booking_id" | "pack_id"] !== o.id)
  ) {
    throw new BookingError("invalid_state");
  }
  return rows;
}

// The Closure choice covers every issued Ticket the group has on that closed Timeslot, once.
function wholeClosedGroup(sql: SqlStorage, group: Group, rows: GroupTicket[]) {
  const o = owner(group);
  const { n } = sql
    .exec<{ n: number }>(`SELECT count(*) AS n FROM tickets WHERE ${o.col} = ? AND timeslot_id = ? AND status = 'issued'`, o.id, rows[0].timeslot_id)
    .one();
  if (n !== rows.length || rows.some((t) => t.timeslot_id !== rows[0].timeslot_id)) throw new BookingError("invalid_state");
}

function choose(sql: SqlStorage, now: number, group: Group, timeslotId: string, choice: "refund" | "reschedule") {
  const id = `${timeslotId}:${owner(group).id}`;
  sql.exec(
    "INSERT INTO closure_choices (id, timeslot_id, group_id, choice, chosen_at) VALUES (?, ?, ?, ?, ?)",
    id,
    timeslotId,
    owner(group).id,
    choice,
    now,
  );
  mark(sql, "closure_choice", [id]);
}

const started = (t: GroupTicket, now: number) => t.starts_at <= now || t.checked_in_at !== null;

// Each Ticket's fixed share of the Booking's Add-ons; the first A % n Tickets carry the extra sen.
function addOnShares(sql: SqlStorage, bookingId: string) {
  const { a } = sql
    .exec<{ a: number }>(
      `SELECT coalesce(sum(ha.quantity * ha.price_sen), 0) AS a FROM bookings b
       JOIN hold_add_ons ha ON ha.hold_id = b.hold_id WHERE b.id = ?`,
      bookingId,
    )
    .one();
  const all = sql
    .exec<{ id: string }>("SELECT id FROM tickets WHERE booking_id = ? ORDER BY rowid", bookingId)
    .toArray();
  return new Map(all.map((t, i) => [t.id, Math.floor(a / all.length) + (i < a % all.length ? 1 : 0)]));
}

function quote(sql: SqlStorage, now: number, customerId: string, group: Group, ticketIds: string[], onlyClosed: boolean) {
  const rows = groupTickets(sql, customerId, group, ticketIds);
  const closed = rows[0].closed_at !== null;
  if (rows.some((t) => (t.closed_at !== null) !== closed) || (onlyClosed && !closed)) throw new BookingError("invalid_state");
  if (closed) wholeClosedGroup(sql, group, rows);
  else if (rows.some((t) => started(t, now))) throw new BookingError("started");
  const shares = "bookingId" in group ? addOnShares(sql, group.bookingId) : new Map<string, number>();
  const tickets = rows.map((t) => {
    const outcome: Outcome = closed || inWindow(t.free_cancel_hours, t.starts_at, now) ? "cancelled" : "forfeited";
    return { id: t.id, outcome, refundSen: outcome === "cancelled" && t.booking_id ? t.price_sen + shares.get(t.id)! : 0 };
  });
  const refundSen = tickets.reduce((sum, t) => sum + t.refundSen, 0);
  const q: Quote = { tickets, refundSen, reason: closed ? "closure" : refundSen > 0 ? "cancel" : null };
  return { q, rows };
}

export function cancelQuote(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; group: Group; ticketIds: string[]; onlyClosed: boolean },
): Quote {
  return quote(sql, now, i.customerId, i.group, i.ticketIds, i.onlyClosed).q;
}

export function cancelTickets(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; group: Group; ticketIds: string[]; onlyClosed: boolean; expectSen: number; expectForfeited: string[] },
): CancelResult {
  const { q, rows } = quote(sql, now, i.customerId, i.group, i.ticketIds, i.onlyClosed);
  const forfeited = q.tickets.filter((t) => t.outcome === "forfeited").map((t) => t.id);
  if (q.refundSen !== i.expectSen || sorted(forfeited) !== sorted(i.expectForfeited)) throw new BookingError("quote_changed");
  for (const t of q.tickets) sql.exec("UPDATE tickets SET status = ? WHERE id = ?", t.outcome, t.id);
  sql.exec("DELETE FROM allocations WHERE ticket_id IN (SELECT value FROM json_each(?))", ids(i.ticketIds));
  let refund: CancelResult["refund"] = null;
  if (q.refundSen > 0 && "bookingId" in i.group) {
    const bookingId = i.group.bookingId;
    const paid = first(
      sql.exec<{ bill_id: string; amount_sen: number }>(
        "SELECT bill_id, amount_sen FROM payments WHERE booking_id = ? AND status = 'paid'",
        bookingId,
      ),
    );
    refund = { id: crypto.randomUUID(), amountSen: q.refundSen, reason: q.reason! };
    sql.exec(
      `INSERT INTO refunds (id, customer_id, bill_id, booking_id, amount_sen, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      refund.id,
      i.customerId,
      paid?.bill_id ?? null,
      bookingId,
      refund.amountSen,
      refund.reason,
      now,
    );
    sql.exec(
      "UPDATE tickets SET refund_id = ? WHERE id IN (SELECT value FROM json_each(?))",
      refund.id,
      ids(q.tickets.filter((t) => t.refundSen > 0).map((t) => t.id)),
    );
    const { total } = sql
      .exec<{ total: number }>(
        "SELECT sum(amount_sen) AS total FROM refunds WHERE booking_id = ? AND reason IN ('cancel','closure')",
        bookingId,
      )
      .one();
    if (total > (paid?.amount_sen ?? 0)) throw new Error("refund_exceeds_payment");
    mark(sql, "refund", [refund.id]);
  }
  if (q.reason === "closure") choose(sql, now, i.group, rows[0].timeslot_id, "refund");
  mark(sql, "ticket", i.ticketIds);
  if ("packId" in i.group) mark(sql, "pack", [i.group.packId]);
  for (const startsAt of new Set(rows.filter((t) => t.closed_at === null).map((t) => t.starts_at))) markWindow(sql, now, startsAt);
  return { ...q, refund };
}

// Same Tickets (QR unchanged), same Option and price, Resources re-allocated on the new Timeslot.
export function rescheduleTickets(
  sql: SqlStorage,
  now: number,
  i: {
    customerId: string;
    group: Group;
    ticketIds: string[];
    timeslotId: string;
    participants: ParticipantFacts[];
    onlyClosed: boolean;
  },
) {
  const rows = groupTickets(sql, i.customerId, i.group, i.ticketIds);
  const current = rows[0];
  const target = loadSlot(sql, i.timeslotId);
  if (
    rows.some((t) => t.timeslot_id !== current.timeslot_id) ||
    !target ||
    target.id === current.timeslot_id ||
    target.option_id !== current.option_id ||
    sorted(i.participants.map((p) => p.id)) !== sorted(rows.map((t) => t.participant_id))
  ) {
    throw new BookingError("invalid_state");
  }
  const open = current.closed_at === null;
  if (open) {
    if (i.onlyClosed) throw new BookingError("invalid_state");
    if (rows.some((t) => started(t, now))) throw new BookingError("started");
    if (!inWindow(current.free_cancel_hours, current.starts_at, now)) throw new BookingError("window_passed");
    if (current.pack_id) {
      const pack = sql.exec<{ expires_at: number }>("SELECT expires_at FROM packs WHERE id = ?", current.pack_id).one();
      if (target.starts_at > pack.expires_at) throw new BookingError("pack_expired");
    }
  } else {
    wholeClosedGroup(sql, i.group, rows);
    choose(sql, now, i.group, current.timeslot_id, "reschedule");
  }
  sql.exec("DELETE FROM allocations WHERE ticket_id IN (SELECT value FROM json_each(?))", ids(i.ticketIds));
  const { picks } = allocate(sql, now, target.id, i.participants, i.customerId, i.ticketIds);
  sql.exec("UPDATE tickets SET timeslot_id = ? WHERE id IN (SELECT value FROM json_each(?))", target.id, ids(i.ticketIds));
  insertAllocations(sql, picks, new Map(rows.map((t) => [t.participant_id, t.id])));
  mark(sql, "ticket", i.ticketIds);
  markWindow(sql, now, target.starts_at);
  if (open) markWindow(sql, now, current.starts_at);
  return { timeslotId: target.id, startsAt: target.starts_at };
}

function viewTickets(sql: SqlStorage, group: Group, shares: Map<string, number>): ViewTicket[] {
  const o = owner(group);
  return sql
    .exec<{
      id: string;
      participant_id: string;
      status: string;
      option_id: string;
      timeslot_id: string;
      starts_at: number;
      closed_at: number | null;
      price_sen: number;
      refund_id: string | null;
    }>(
      `SELECT t.id, t.participant_id, t.status, s.option_id, t.timeslot_id, s.starts_at, s.closed_at, t.price_sen, t.refund_id
       FROM tickets t JOIN timeslots s ON s.id = t.timeslot_id
       WHERE t.${o.col} = ? ORDER BY ${o.col === "pack_id" ? "s.starts_at, " : ""}t.rowid`,
      o.id,
    )
    .toArray()
    .map((t) => ({
      id: t.id,
      participantId: t.participant_id,
      status: t.status,
      optionId: t.option_id,
      timeslotId: t.timeslot_id,
      startsAt: t.starts_at,
      closedAt: t.closed_at,
      refundId: t.refund_id,
      refundSen: t.refund_id ? t.price_sen + (shares.get(t.id) ?? 0) : 0,
    }));
}

const closureChoices = (sql: SqlStorage, groupId: string) =>
  sql
    .exec<ClosureChoice>("SELECT timeslot_id AS timeslotId, choice, chosen_at AS chosenAt FROM closure_choices WHERE group_id = ?", groupId)
    .toArray();

const freeCancelHoursOf = (sql: SqlStorage, optionId: string) =>
  first(
    sql.exec<{ h: number }>(
      "SELECT a.free_cancel_hours AS h FROM options o JOIN activities a ON a.id = o.activity_id WHERE o.id = ?",
      optionId,
    ),
  )?.h ?? null;

export function bookingView(sql: SqlStorage, bookingId: string): BookingView {
  const b = first(
    sql.exec<{ customer_id: string; hold_id: string; option_id: string; amount_sen: number }>(
      `SELECT b.customer_id, b.hold_id, t.option_id,
         coalesce(h.amount_sen, h.price_sen * (SELECT count(*) FROM hold_participants WHERE hold_id = h.id)) AS amount_sen
       FROM bookings b JOIN holds h ON h.id = b.hold_id JOIN timeslots t ON t.id = h.timeslot_id
       WHERE b.id = ?`,
      bookingId,
    ),
  );
  if (!b) throw new BookingError("invalid_state");
  return {
    customerId: b.customer_id,
    optionId: b.option_id,
    amountSen: b.amount_sen,
    freeCancelHours: freeCancelHoursOf(sql, b.option_id)!,
    tickets: viewTickets(sql, { bookingId }, addOnShares(sql, bookingId)),
    closureChoices: closureChoices(sql, bookingId),
    addOns: sql
      .exec<{ add_on_id: string; quantity: number; price_sen: number }>(
        "SELECT add_on_id, quantity, price_sen FROM hold_add_ons WHERE hold_id = ? ORDER BY add_on_id",
        b.hold_id,
      )
      .toArray()
      .map((a) => ({ addOnId: a.add_on_id, quantity: a.quantity, priceSen: a.price_sen })),
  };
}

export function packView(sql: SqlStorage, packId: string): PackView {
  const p = first(
    sql.exec<{ customer_id: string; offer_id: string | null; sessions_total: number; expires_at: number; option_ids: string }>(
      "SELECT customer_id, offer_id, sessions_total, expires_at, option_ids FROM packs WHERE id = ?",
      packId,
    ),
  );
  if (!p) throw new BookingError("invalid_state");
  const optionIds = JSON.parse(p.option_ids) as string[];
  const { used } = sql
    .exec<{ used: number }>("SELECT count(*) AS used FROM tickets WHERE pack_id = ? AND status <> 'cancelled'", packId)
    .one();
  return {
    customerId: p.customer_id,
    offerId: p.offer_id,
    sessionsTotal: p.sessions_total,
    sessionsUsed: used,
    expiresAt: p.expires_at,
    optionIds,
    freeCancelHours: optionIds.length ? freeCancelHoursOf(sql, optionIds[0]) : null,
    tickets: viewTickets(sql, { packId }, new Map()),
    closureChoices: closureChoices(sql, packId),
  };
}

// Idempotent by state: a second mark returns the first refundedAt.
export function markRefunded(sql: SqlStorage, now: number, i: { refundId: string; memberId: string }) {
  const done = first(
    sql.exec<{ refunded_at: number }>(
      "UPDATE refunds SET refunded_at = ?, refunded_by = ? WHERE id = ? AND refunded_at IS NULL RETURNING refunded_at",
      now,
      i.memberId,
      i.refundId,
    ),
  );
  if (done) {
    mark(sql, "refund", [i.refundId]);
    return { refundedAt: done.refunded_at, changed: true };
  }
  const prior = first(sql.exec<{ refunded_at: number }>("SELECT refunded_at FROM refunds WHERE id = ?", i.refundId));
  if (!prior) throw new BookingError("invalid_state");
  return { refundedAt: prior.refunded_at, changed: false };
}
