import { mark, markWindow } from "./outbox";

export type BookingErrorCode =
  | "not_bookable"
  | "invalid_participant"
  | "requirement_not_met"
  | "waiver_missing"
  | "no_availability"
  | "pack_unavailable"
  | "invalid_state"
  | "idempotency_conflict";

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode) {
    super(code);
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: BookingErrorCode };
export type RefundReason = "duplicate" | "amount_mismatch" | "unavailable" | "unknown_hold";
export type ResourceKind = "horse" | "instructor" | "belayer" | "auto_belay_lane";
export type ParticipantFacts = {
  id: string;
  customerId: string;
  birthDate: string;
  weightKg: number | null;
  certs: string[];
  waiverSigned: boolean;
};
export type ActivityInput = { id: string; freeCancelHours: number };
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
  active: boolean;
  needs: { kind: ResourceKind; quantity: number }[];
};
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
export type ConfirmResult =
  | { status: "paid"; bookingId: string; ticketIds: string[] }
  | { status: "refund_due"; reason: RefundReason };

const MIN = 60_000;
const HOUR = 3_600_000;
export const DAY = 86_400_000;
const KL_OFFSET = 8 * HOUR;
const HOLD_MS = 15 * MIN;

export const klDayStart = (t: number) => Math.floor((t + KL_OFFSET) / DAY) * DAY - KL_OFFSET;
const klDate = (t: number) => new Date(t + KL_OFFSET).toISOString().slice(0, 10);

function ageOn(birthDate: string, date: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

type Slot = { id: string; option_id: string; starts_at: number; closed_at: number | null };
type Option = {
  id: string;
  price_sen: number;
  duration_minutes: number;
  min_age: number | null;
  max_age: number | null;
  max_weight_kg: number | null;
  required_cert: string | null;
  active: number;
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
type Hold = { id: string; customer_id: string; timeslot_id: string; price_sen: number; status: string };

const first = <T extends Record<string, SqlStorageValue>>(c: SqlStorageCursor<T>): T | undefined => c.toArray()[0];
const ids = (xs: string[]) => JSON.stringify(xs);

function loadSlot(sql: SqlStorage, id: string) {
  return first(sql.exec<Slot>("SELECT id, option_id, starts_at, closed_at FROM timeslots WHERE id = ?", id));
}

function loadOption(sql: SqlStorage, id: string) {
  return sql
    .exec<Option>(
      `SELECT id, price_sen, duration_minutes, min_age, max_age, max_weight_kg, required_cert, active
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

function allocate(sql: SqlStorage, now: number, slotId: string, people: ParticipantFacts[], customerId: string) {
  if (
    people.length === 0 ||
    new Set(people.map((p) => p.id)).size !== people.length ||
    people.some((p) => p.customerId !== customerId)
  ) {
    throw new BookingError("invalid_participant");
  }

  const slot = loadSlot(sql, slotId);
  if (!slot || slot.closed_at !== null || slot.starts_at <= now) throw new BookingError("not_bookable");
  const option = loadOption(sql, slot.option_id);
  const needs = loadNeeds(sql, option.id);
  if (!option.active || needs.length === 0) throw new BookingError("not_bookable");

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
         SELECT participant_id, timeslot_id FROM tickets WHERE status = 'issued'
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

export function upsertActivity(sql: SqlStorage, a: ActivityInput) {
  sql.exec(
    `INSERT INTO activities (id, free_cancel_hours) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET free_cancel_hours = excluded.free_cancel_hours`,
    a.id,
    a.freeCancelHours,
  );
  mark(sql, "activity", [a.id]);
  return null;
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
    sql.exec<{ activity_id: string; duration_minutes: number }>(
      "SELECT activity_id, duration_minutes FROM options WHERE id = ?",
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
       max_weight_kg, required_cert, min_participants, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name_en = excluded.name_en, name_ms = excluded.name_ms,
       price_sen = excluded.price_sen, duration_minutes = excluded.duration_minutes, min_age = excluded.min_age,
       max_age = excluded.max_age, max_weight_kg = excluded.max_weight_kg, required_cert = excluded.required_cert,
       min_participants = excluded.min_participants, active = excluded.active`,
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
    o.active ? 1 : 0,
  );
  sql.exec("DELETE FROM option_resources WHERE option_id = ?", o.id);
  for (const n of o.needs) {
    sql.exec("INSERT INTO option_resources (option_id, kind, quantity) VALUES (?, ?, ?)", o.id, n.kind, n.quantity);
  }
  mark(sql, "option", [o.id]);
  mark(sql, "timeslot", openFutureSlots(sql, now, o.id));
  return null;
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
      "INSERT INTO timeslots (id, option_id, starts_at) VALUES (?, ?, ?) ON CONFLICT(option_id, starts_at) DO NOTHING",
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

export function closeTimeslot(sql: SqlStorage, now: number, timeslotId: string) {
  const slot = loadSlot(sql, timeslotId);
  if (!slot) throw new BookingError("invalid_state");
  if (slot.closed_at !== null) return null;
  if (slot.starts_at <= now) throw new BookingError("invalid_state");
  sql.exec("UPDATE timeslots SET closed_at = ? WHERE id = ?", now, timeslotId);
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
  return null;
}

export function issuePack(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; sessionsTotal: number; expiresAt: number },
) {
  const packId = crypto.randomUUID();
  sql.exec(
    "INSERT INTO packs (id, customer_id, sessions_total, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    packId,
    i.customerId,
    i.sessionsTotal,
    i.expiresAt,
    now,
  );
  mark(sql, "pack", [packId]);
  return { packId };
}

export function createHold(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; timeslotId: string; participants: ParticipantFacts[] },
) {
  const { slot, option, picks } = allocate(sql, now, i.timeslotId, i.participants, i.customerId);
  if (i.participants.some((p) => !p.waiverSigned)) throw new BookingError("waiver_missing");
  const holdId = crypto.randomUUID();
  const expiresAt = now + HOLD_MS;
  sql.exec(
    "INSERT INTO holds (id, customer_id, timeslot_id, price_sen, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    holdId,
    i.customerId,
    slot.id,
    option.price_sen,
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
  insertAllocations(sql, picks, { holdId });
  markWindow(sql, now, slot.starts_at);
  return { holdId, expiresAt, amountSen: option.price_sen * i.participants.length };
}

function bookingOutcome(sql: SqlStorage, bookingId: string): ConfirmResult {
  const ticketIds = sql
    .exec<{ id: string }>("SELECT id FROM tickets WHERE booking_id = ? ORDER BY rowid", bookingId)
    .toArray()
    .map((t) => t.id);
  return { status: "paid", bookingId, ticketIds };
}

function settle(sql: SqlStorage, now: number, i: { holdId: string; amountSen: number }): ConfirmResult {
  const refund = (reason: RefundReason): ConfirmResult => ({ status: "refund_due", reason });
  const hold = first(
    sql.exec<Hold>("SELECT id, customer_id, timeslot_id, price_sen, status FROM holds WHERE id = ?", i.holdId),
  );
  if (!hold) return refund("unknown_hold");
  const people = sql
    .exec<{ participant_id: string; birth_date: string; weight_kg: number | null; certs: string }>(
      "SELECT participant_id, birth_date, weight_kg, certs FROM hold_participants WHERE hold_id = ? ORDER BY rowid",
      hold.id,
    )
    .toArray();
  if (i.amountSen !== hold.price_sen * people.length) return refund("amount_mismatch");
  if (hold.status === "confirmed") return refund("duplicate");

  const slot = loadSlot(sql, hold.timeslot_id)!;
  const participantIds = people.map((p) => p.participant_id);
  const bookingId = crypto.randomUUID();
  const ticket = {
    customerId: hold.customer_id,
    bookingId,
    packId: null,
    timeslotId: slot.id,
    priceSen: hold.price_sen,
  };

  if (hold.status === "active" && slot.closed_at === null && slot.starts_at > now) {
    sql.exec("INSERT INTO bookings (id, customer_id, hold_id, created_at) VALUES (?, ?, ?, ?)", bookingId, hold.customer_id, hold.id, now);
    const ticketOf = insertTickets(sql, now, ticket, participantIds);
    for (const [participantId, ticketId] of ticketOf) {
      sql.exec(
        "UPDATE allocations SET ticket_id = ?, hold_id = NULL WHERE hold_id = ? AND participant_id = ?",
        ticketId,
        hold.id,
        participantId,
      );
    }
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
    insertAllocations(sql, picks, insertTickets(sql, now, ticket, participantIds));
  }
  const updated = sql.exec("UPDATE holds SET status = 'confirmed' WHERE id = ? AND status <> 'confirmed' RETURNING id", hold.id);
  if (updated.toArray().length !== 1) throw new Error("hold_confirm_conflict");
  markWindow(sql, now, slot.starts_at);
  return bookingOutcome(sql, bookingId);
}

export function confirmHold(sql: SqlStorage, now: number, i: { billId: string; holdId: string; amountSen: number }) {
  const prior = first(
    sql.exec<{ hold_id: string; amount_sen: number; booking_id: string | null; refund_reason: RefundReason | null }>(
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
  return result;
}

export function redeemPack(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; packId: string; timeslotId: string; participants: ParticipantFacts[] },
) {
  const pack = first(
    sql.exec<{ id: string; customer_id: string; sessions_total: number; expires_at: number }>(
      "SELECT id, customer_id, sessions_total, expires_at FROM packs WHERE id = ?",
      i.packId,
    ),
  );
  if (!pack || pack.customer_id !== i.customerId || !loadSlot(sql, i.timeslotId)) {
    throw new BookingError("pack_unavailable");
  }
  const { slot, picks } = allocate(sql, now, i.timeslotId, i.participants, pack.customer_id);
  const { used } = sql
    .exec<{ used: number }>("SELECT count(*) AS used FROM tickets WHERE pack_id = ? AND status <> 'cancelled'", pack.id)
    .one();
  if (slot.starts_at > pack.expires_at || pack.sessions_total - used < i.participants.length) {
    throw new BookingError("pack_unavailable");
  }
  if (i.participants.some((p) => !p.waiverSigned)) throw new BookingError("waiver_missing");
  const ticketOf = insertTickets(
    sql,
    now,
    { customerId: pack.customer_id, bookingId: null, packId: pack.id, timeslotId: slot.id, priceSen: 0 },
    i.participants.map((p) => p.id),
  );
  insertAllocations(sql, picks, ticketOf);
  mark(sql, "pack", [pack.id]);
  markWindow(sql, now, slot.starts_at);
  return { ticketIds: [...ticketOf.values()] };
}

export function rescheduleTicket(
  sql: SqlStorage,
  now: number,
  i: { customerId: string; ticketId: string; timeslotId: string; participant: ParticipantFacts },
) {
  const t = first(
    sql.exec<{ status: string; customer_id: string; participant_id: string; option_id: string; closed_at: number | null }>(
      `SELECT t.status, t.customer_id, t.participant_id, s.option_id, s.closed_at
       FROM tickets t JOIN timeslots s ON s.id = t.timeslot_id WHERE t.id = ?`,
      i.ticketId,
    ),
  );
  if (
    !t ||
    t.status !== "issued" ||
    t.customer_id !== i.customerId ||
    t.closed_at === null ||
    t.participant_id !== i.participant.id
  ) {
    throw new BookingError("invalid_state");
  }
  const { slot, picks } = allocate(sql, now, i.timeslotId, [i.participant], i.customerId);
  if (slot.option_id !== t.option_id) throw new BookingError("invalid_state");
  sql.exec("UPDATE tickets SET timeslot_id = ? WHERE id = ?", slot.id, i.ticketId);
  insertAllocations(sql, picks, new Map([[i.participant.id, i.ticketId]]));
  mark(sql, "ticket", [i.ticketId]);
  markWindow(sql, now, slot.starts_at);
  return null;
}

export function cancelTicket(sql: SqlStorage, now: number, i: { customerId: string; ticketId: string }) {
  const t = first(
    sql.exec<{
      status: string;
      customer_id: string;
      pack_id: string | null;
      starts_at: number;
      closed_at: number | null;
      free_cancel_hours: number;
    }>(
      `SELECT t.status, t.customer_id, t.pack_id, s.starts_at, s.closed_at, a.free_cancel_hours
       FROM tickets t
       JOIN timeslots s ON s.id = t.timeslot_id
       JOIN options o ON o.id = s.option_id
       JOIN activities a ON a.id = o.activity_id
       WHERE t.id = ?`,
      i.ticketId,
    ),
  );
  if (!t || t.status !== "issued" || t.customer_id !== i.customerId) throw new BookingError("invalid_state");
  if (t.closed_at === null && t.starts_at <= now) throw new BookingError("invalid_state");
  const status: "cancelled" | "forfeited" =
    t.closed_at !== null || t.starts_at - t.free_cancel_hours * HOUR >= now ? "cancelled" : "forfeited";
  sql.exec("UPDATE tickets SET status = ? WHERE id = ? AND status = 'issued'", status, i.ticketId);
  sql.exec("DELETE FROM allocations WHERE ticket_id = ?", i.ticketId);
  mark(sql, "ticket", [i.ticketId]);
  if (t.pack_id) mark(sql, "pack", [t.pack_id]);
  markWindow(sql, now, t.starts_at);
  return { status };
}
