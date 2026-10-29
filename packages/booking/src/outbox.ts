import { DAY, expireDue, klDayStart, spots } from "./engine";
import { tx } from "./tx";

type Entity = "activity" | "option" | "add_on" | "timeslot" | "ticket" | "pack" | "payment" | "pack_offer" | "refund" | "closure_choice";
type Row = Record<string, SqlStorageValue>;
type Key = { entity: string; entity_id: string };
type Statement = { key: Key; query: string; params: SqlStorageValue[] };

export function mark(sql: SqlStorage, entity: Entity, ids: string[]) {
  if (ids.length === 0) return;
  // Floor at the clock (µs) so versions keep rising after a PITR restore rewinds meta.rev.
  const { rev } = sql.exec<{ rev: number }>("UPDATE meta SET rev = max(rev + 1, ?) RETURNING rev", Date.now() * 1000).one();
  for (const id of ids) {
    sql.exec(
      "INSERT INTO outbox (entity, entity_id, rev) VALUES (?, ?, ?) ON CONFLICT(entity, entity_id) DO UPDATE SET rev = excluded.rev",
      entity,
      id,
      rev,
    );
  }
}

export function markWindow(sql: SqlStorage, now: number, startsAt: number) {
  const day = klDayStart(startsAt);
  const ids = sql
    .exec<{ id: string }>(
      "SELECT id FROM timeslots WHERE closed_at IS NULL AND starts_at > ? AND starts_at >= ? AND starts_at < ?",
      now,
      day - DAY,
      day + 2 * DAY,
    )
    .toArray()
    .map((r) => r.id);
  mark(sql, "timeslot", ids);
}

const SELECTS: Record<Entity, { table: string; pk: string; query: string }> = {
  activity: { table: "proj_activities", pk: "id", query: "SELECT id, free_cancel_hours, booking_cutoff_minutes, requires_waiver FROM activities WHERE id = ?" },
  option: {
    table: "proj_options",
    pk: "id",
    query: `SELECT id, activity_id, name_en, name_ms, price_sen, duration_minutes, min_age, max_age, max_weight_kg,
      required_cert, min_participants, active,
      (max_weight_kg IS NOT NULL OR EXISTS (SELECT 1 FROM option_resources WHERE option_id = options.id AND kind = 'horse'))
        AS asks_weight
      FROM options WHERE id = ?`,
  },
  add_on: {
    table: "proj_add_ons",
    pk: "id",
    query: "SELECT id, activity_id, name_en, name_ms, price_sen, active FROM add_ons WHERE id = ?",
  },
  timeslot: { table: "proj_timeslots", pk: "id", query: "SELECT id, option_id, starts_at, closed_at FROM timeslots WHERE id = ?" },
  ticket: {
    table: "proj_tickets",
    pk: "id",
    query: `SELECT t.id, t.customer_id, t.participant_id, t.booking_id, t.pack_id, s.option_id, t.timeslot_id,
      s.starts_at, s.closed_at, t.price_sen, t.status
      FROM tickets t JOIN timeslots s ON s.id = t.timeslot_id WHERE t.id = ?`,
  },
  pack: {
    table: "proj_packs",
    pk: "id",
    query: `SELECT id, customer_id, sessions_total,
      (SELECT count(*) FROM tickets WHERE pack_id = packs.id AND status <> 'cancelled') AS sessions_used, expires_at,
      offer_id, option_ids
      FROM packs WHERE id = ?`,
  },
  payment: {
    table: "proj_payments",
    pk: "bill_id",
    query: "SELECT bill_id, hold_id, booking_id, amount_sen, status, refund_reason, received_at FROM payments WHERE bill_id = ?",
  },
  pack_offer: {
    table: "proj_pack_offers",
    pk: "id",
    query: "SELECT id, activity_id, name_en, name_ms, sessions, price_sen, valid_days, option_ids, active FROM pack_offers WHERE id = ?",
  },
  closure_choice: {
    table: "closure_notices",
    pk: "",
    query: "SELECT choice, chosen_at, timeslot_id, group_id FROM closure_choices WHERE id = ?",
  },
  refund: {
    table: "proj_refunds",
    pk: "id",
    query: "SELECT id, customer_id, bill_id, booking_id, amount_sen, reason, created_at, refunded_at FROM refunds WHERE id = ?",
  },
};

const KNOWN = JSON.stringify(Object.keys(SELECTS));

export const knownQueued = (sql: SqlStorage) =>
  sql.exec("SELECT 1 FROM outbox WHERE entity IN (SELECT value FROM json_each(?)) LIMIT 1", KNOWN).toArray().length > 0;

function upsert(key: Key, table: string, pk: string, row: Row): Statement {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);
  return {
    key,
    query: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
      ON CONFLICT(${pk}) DO UPDATE SET ${updates.join(", ")} WHERE excluded.version > ${table}.version`,
    params: Object.values(row),
  };
}

// closure_notices is D1-owned; the DO's choice only fills it in once.
const chosen = (key: Key, row: Row): Statement => ({
  key,
  query: "UPDATE closure_notices SET choice = ?, chosen_at = ? WHERE timeslot_id = ? AND ? IN (booking_id, pack_id) AND choice IS NULL",
  params: [row.choice, row.chosen_at, row.timeslot_id, row.group_id],
});

export async function drain(
  storage: DurableObjectStorage,
  operatorId: string,
  d1: { prepare(query: string): D1PreparedStatement; batch(statements: D1PreparedStatement[]): Promise<unknown> },
) {
  const sql = storage.sql;
  const prepare = (s: Statement) => d1.prepare(s.query).bind(...s.params);
  for (let round = 0; round < 20; round++) {
    const snap = tx(storage, () => {
      const now = Date.now();
      expireDue(sql, now);
      const keys = sql
        .exec<Key>(
          `SELECT entity, entity_id FROM outbox WHERE entity IN (SELECT value FROM json_each(?))
           ORDER BY entity = 'timeslot', rev LIMIT 50`,
          KNOWN,
        )
        .toArray();
      if (keys.length === 0) return null;
      const { rev } = sql.exec<{ rev: number }>("SELECT rev FROM meta").one();
      const statements = keys.flatMap((key) => {
        const s = SELECTS[key.entity as Entity];
        const row = sql.exec<Row>(s.query, key.entity_id).toArray()[0];
        if (!row) return [];
        if (key.entity === "closure_choice") return [chosen(key, row)];
        if (key.entity === "timeslot") row.spots = spots(sql, now, key.entity_id);
        return [upsert(key, s.table, s.pk, { ...row, operator_id: operatorId, version: rev })];
      });
      return { rev, keys, statements };
    });
    if (!snap) return;
    const failed: Key[] = [];
    try {
      if (snap.statements.length) await d1.batch(snap.statements.map(prepare));
    } catch {
      for (const s of snap.statements) {
        try {
          await d1.batch([prepare(s)]);
        } catch {
          failed.push(s.key);
        }
      }
    }
    tx(storage, () => {
      for (const k of snap.keys.filter((k) => !failed.includes(k))) {
        sql.exec("DELETE FROM outbox WHERE entity = ? AND entity_id = ? AND rev <= ?", k.entity, k.entity_id, snap.rev);
      }
    });
    if (failed.length) throw new DrainError(failed);
  }
}

export class DrainError extends Error {
  constructor(readonly keys: Key[]) {
    super("outbox_rows_rejected");
  }
}

export function outboxBacklog(sql: SqlStorage) {
  const r = sql
    .exec<{ queued: number; unknown: number; oldest: number | null }>(
      `SELECT count(*) AS queued, count(*) FILTER (WHERE entity NOT IN (SELECT value FROM json_each(?))) AS unknown,
         min(rev) AS oldest FROM outbox`,
      KNOWN,
    )
    .one();
  return {
    queued: r.queued,
    unknown: r.unknown,
    oldestAgeMs: r.oldest === null ? 0 : Date.now() - Math.floor(r.oldest / 1000),
  };
}
