import { tx } from "./tx";

export const migrations: string[][] = [
  [
    `CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL,
      rev INTEGER NOT NULL DEFAULT 0, operator_id TEXT) STRICT`,
    `INSERT INTO meta (id, schema_version) VALUES (1, 0)`,
    `CREATE TABLE requests (request_id TEXT PRIMARY KEY, method TEXT NOT NULL, fingerprint TEXT NOT NULL,
      response TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT`,
    `CREATE INDEX requests_created_at ON requests(created_at)`,
    `CREATE TABLE outbox (entity TEXT NOT NULL,
      entity_id TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY (entity, entity_id)) STRICT`,
    `CREATE INDEX outbox_rev ON outbox(rev)`,

    `CREATE TABLE activities (id TEXT PRIMARY KEY, free_cancel_hours INTEGER NOT NULL CHECK (free_cancel_hours >= 0)) STRICT`,
    `CREATE TABLE options (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
      name_en TEXT NOT NULL CHECK (length(name_en) BETWEEN 1 AND 200),
      name_ms TEXT NOT NULL CHECK (length(name_ms) BETWEEN 1 AND 200),
      price_sen INTEGER NOT NULL CHECK (price_sen >= 0),
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
      min_age INTEGER, max_age INTEGER, max_weight_kg INTEGER CHECK (max_weight_kg > 0), required_cert TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      CHECK (min_age <= max_age)) STRICT`,
    `CREATE TABLE option_resources (option_id TEXT NOT NULL REFERENCES options(id),
      kind TEXT NOT NULL CHECK (kind IN ('horse','instructor','belayer','auto_belay_lane')),
      quantity INTEGER NOT NULL CHECK (quantity > 0), PRIMARY KEY (option_id, kind)) STRICT`,
    `CREATE TABLE resources (id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('horse','instructor','belayer','auto_belay_lane')),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      max_sessions_per_day INTEGER CHECK (max_sessions_per_day > 0),
      rest_minutes INTEGER NOT NULL DEFAULT 0 CHECK (rest_minutes BETWEEN 0 AND 720),
      max_rider_weight_kg INTEGER CHECK (max_rider_weight_kg > 0),
      CHECK (kind = 'horse' OR (max_sessions_per_day IS NULL AND rest_minutes = 0 AND max_rider_weight_kg IS NULL))) STRICT`,
    `CREATE INDEX resources_kind ON resources(kind, active)`,
    `CREATE TABLE timeslots (id TEXT PRIMARY KEY, option_id TEXT NOT NULL REFERENCES options(id),
      starts_at INTEGER NOT NULL, closed_at INTEGER, UNIQUE (option_id, starts_at)) STRICT`,
    `CREATE INDEX timeslots_starts_at ON timeslots(starts_at)`,

    `CREATE TABLE holds (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, timeslot_id TEXT NOT NULL REFERENCES timeslots(id),
      price_sen INTEGER NOT NULL CHECK (price_sen >= 0), created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','confirmed','expired','released'))) STRICT`,
    `CREATE INDEX holds_active_expiry ON holds(expires_at) WHERE status = 'active'`,
    `CREATE INDEX holds_timeslot ON holds(timeslot_id)`,
    `CREATE TABLE hold_participants (hold_id TEXT NOT NULL REFERENCES holds(id), participant_id TEXT NOT NULL,
      birth_date TEXT NOT NULL CHECK (birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      weight_kg INTEGER CHECK (weight_kg > 0), certs TEXT NOT NULL CHECK (json_valid(certs)),
      PRIMARY KEY (hold_id, participant_id)) STRICT`,
    `CREATE TABLE bookings (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      hold_id TEXT NOT NULL UNIQUE REFERENCES holds(id), created_at INTEGER NOT NULL) STRICT`,
    `CREATE TABLE payments (bill_id TEXT PRIMARY KEY, hold_id TEXT NOT NULL,
      amount_sen INTEGER NOT NULL CHECK (amount_sen >= 0), received_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('paid','refund_due')),
      refund_reason TEXT CHECK (refund_reason IN ('duplicate','amount_mismatch','unavailable','unknown_hold')),
      booking_id TEXT UNIQUE REFERENCES bookings(id),
      CHECK ((status = 'paid') = (booking_id IS NOT NULL)),
      CHECK ((status = 'refund_due') = (refund_reason IS NOT NULL))) STRICT`,
    `CREATE INDEX payments_hold ON payments(hold_id)`,
    `CREATE TABLE packs (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      sessions_total INTEGER NOT NULL CHECK (sessions_total > 0), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL) STRICT`,
    `CREATE TABLE tickets (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      booking_id TEXT REFERENCES bookings(id), pack_id TEXT REFERENCES packs(id),
      participant_id TEXT NOT NULL, timeslot_id TEXT NOT NULL REFERENCES timeslots(id),
      price_sen INTEGER NOT NULL CHECK (price_sen >= 0),
      status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled','forfeited')),
      created_at INTEGER NOT NULL, CHECK ((booking_id IS NULL) <> (pack_id IS NULL))) STRICT`,
    `CREATE UNIQUE INDEX tickets_one_issued_per_participant_timeslot ON tickets(participant_id, timeslot_id) WHERE status = 'issued'`,
    `CREATE INDEX tickets_timeslot ON tickets(timeslot_id)`,
    `CREATE INDEX tickets_booking ON tickets(booking_id)`,
    `CREATE INDEX tickets_pack ON tickets(pack_id)`,
    `CREATE TABLE allocations (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id),
      participant_id TEXT NOT NULL, hold_id TEXT REFERENCES holds(id), ticket_id TEXT REFERENCES tickets(id),
      block_start INTEGER NOT NULL, block_end INTEGER NOT NULL,
      CHECK (block_end > block_start AND block_end - block_start <= 86400000),
      CHECK ((hold_id IS NULL) <> (ticket_id IS NULL))) STRICT`,
    `CREATE INDEX allocations_resource_start ON allocations(resource_id, block_start)`,
    `CREATE INDEX allocations_hold ON allocations(hold_id)`,
    `CREATE INDEX allocations_ticket ON allocations(ticket_id)`,
    `CREATE TRIGGER allocations_no_overlap_insert BEFORE INSERT ON allocations
      WHEN EXISTS (SELECT 1 FROM allocations a WHERE a.resource_id = NEW.resource_id
        AND a.block_start > NEW.block_start - 86400000
        AND a.block_start < NEW.block_end AND NEW.block_start < a.block_end)
      BEGIN SELECT RAISE(ABORT, 'allocations_no_overlap'); END`,
    `CREATE TRIGGER allocations_no_overlap_update BEFORE UPDATE OF resource_id, block_start, block_end ON allocations
      WHEN EXISTS (SELECT 1 FROM allocations a WHERE a.id <> NEW.id AND a.resource_id = NEW.resource_id
        AND a.block_start > NEW.block_start - 86400000
        AND a.block_start < NEW.block_end AND NEW.block_start < a.block_end)
      BEGIN SELECT RAISE(ABORT, 'allocations_no_overlap'); END`,
  ],
  [
    `ALTER TABLE options ADD COLUMN min_participants INTEGER CHECK (min_participants > 0)`,
    `CREATE TABLE add_ons (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
      name_en TEXT NOT NULL CHECK (length(name_en) BETWEEN 1 AND 200),
      name_ms TEXT NOT NULL CHECK (length(name_ms) BETWEEN 1 AND 200),
      price_sen INTEGER NOT NULL CHECK (price_sen >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))) STRICT`,
  ],
  [
    `ALTER TABLE holds ADD COLUMN amount_sen INTEGER CHECK (amount_sen >= 0)`,
    `CREATE TABLE hold_add_ons (hold_id TEXT NOT NULL REFERENCES holds(id), add_on_id TEXT NOT NULL REFERENCES add_ons(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0), price_sen INTEGER NOT NULL CHECK (price_sen >= 0),
      PRIMARY KEY (hold_id, add_on_id)) STRICT`,
    `CREATE INDEX holds_customer_active ON holds(customer_id) WHERE status = 'active'`,
  ],
  [
    `UPDATE meta SET rev = rev + 1`,
    `INSERT INTO outbox (entity, entity_id, rev) SELECT 'option', id, (SELECT rev FROM meta) FROM options WHERE true
      ON CONFLICT(entity, entity_id) DO UPDATE SET rev = excluded.rev`,
  ],
  [
    `ALTER TABLE activities ADD COLUMN booking_cutoff_minutes INTEGER NOT NULL DEFAULT 60 CHECK (booking_cutoff_minutes >= 0)`,
  ],
  [
    `ALTER TABLE activities ADD COLUMN closed_days TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(closed_days))`,
    `CREATE TABLE schedules (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
      option_ids TEXT NOT NULL CHECK (json_valid(option_ids)), weekdays TEXT NOT NULL CHECK (json_valid(weekdays)),
      times TEXT NOT NULL CHECK (json_valid(times)),
      starts_on TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      ends_on TEXT CHECK (ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))) STRICT`,
    `CREATE INDEX schedules_activity ON schedules(activity_id)`,
    `ALTER TABLE timeslots ADD COLUMN schedule_id TEXT REFERENCES schedules(id)`,
    `ALTER TABLE timeslots ADD COLUMN closed_reason TEXT CHECK (closed_reason IN ('weather','horse_unfit','other','schedule'))`,
    `CREATE INDEX timeslots_schedule ON timeslots(schedule_id, starts_at)`,
    `ALTER TABLE tickets ADD COLUMN checked_in_at INTEGER`,
  ],
  // Step-4 Timeslots predate Schedules: close the free future ones as 'schedule' so a Schedule reopens and adopts
  // the times it wants and Closed days stay closed. Booked ones stay as one-offs.
  [
    `UPDATE timeslots SET closed_at = unixepoch() * 1000, closed_reason = 'schedule'
     WHERE schedule_id IS NULL AND closed_at IS NULL AND starts_at > unixepoch() * 1000
       AND NOT EXISTS (SELECT 1 FROM tickets WHERE timeslot_id = timeslots.id AND status = 'issued')
       AND NOT EXISTS (SELECT 1 FROM holds WHERE timeslot_id = timeslots.id AND status = 'active')`,
    `UPDATE meta SET rev = max(rev + 1, unixepoch() * 1000000)`,
    `INSERT INTO outbox (entity, entity_id, rev)
     SELECT 'timeslot', id, (SELECT rev FROM meta) FROM timeslots WHERE schedule_id IS NULL AND closed_reason = 'schedule'
     ON CONFLICT(entity, entity_id) DO UPDATE SET rev = excluded.rev`,
  ],
  // Legacy Packs get no eligible Options, so they can't be redeemed. Every refund_due Payment gets a Refund row.
  [
    `CREATE TABLE pack_offers (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
      name_en TEXT NOT NULL CHECK (length(name_en) BETWEEN 1 AND 200),
      name_ms TEXT NOT NULL CHECK (length(name_ms) BETWEEN 1 AND 200),
      sessions INTEGER NOT NULL CHECK (sessions BETWEEN 1 AND 50),
      price_sen INTEGER NOT NULL CHECK (price_sen >= 100),
      valid_days INTEGER NOT NULL CHECK (valid_days BETWEEN 1 AND 730),
      option_ids TEXT NOT NULL CHECK (json_valid(option_ids) AND json_array_length(option_ids) > 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))) STRICT`,
    `CREATE TABLE pack_orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, offer_id TEXT NOT NULL REFERENCES pack_offers(id),
      price_sen INTEGER NOT NULL, sessions INTEGER NOT NULL, valid_days INTEGER NOT NULL,
      option_ids TEXT NOT NULL CHECK (json_valid(option_ids)), created_at INTEGER NOT NULL,
      bill_id TEXT UNIQUE, pack_id TEXT UNIQUE REFERENCES packs(id)) STRICT`,
    `ALTER TABLE packs ADD COLUMN offer_id TEXT`,
    `ALTER TABLE packs ADD COLUMN option_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(option_ids))`,
    `CREATE TABLE refunds (id TEXT PRIMARY KEY, customer_id TEXT, bill_id TEXT, booking_id TEXT,
      amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
      reason TEXT NOT NULL CHECK (reason IN ('duplicate','amount_mismatch','unavailable','unknown_hold','cancel','closure')),
      created_at INTEGER NOT NULL, refunded_at INTEGER, refunded_by TEXT,
      CHECK ((refunded_at IS NULL) = (refunded_by IS NULL))) STRICT`,
    `CREATE INDEX refunds_booking ON refunds(booking_id)`,
    `ALTER TABLE tickets ADD COLUMN refund_id TEXT`,
    `CREATE TABLE closure_choices (id TEXT PRIMARY KEY, timeslot_id TEXT NOT NULL, group_id TEXT NOT NULL,
      choice TEXT NOT NULL CHECK (choice IN ('refund','reschedule')), chosen_at INTEGER NOT NULL) STRICT`,
    `CREATE INDEX closure_choices_group ON closure_choices(group_id)`,
    `INSERT INTO refunds (id, customer_id, bill_id, amount_sen, reason, created_at)
     SELECT 'bill:' || p.bill_id, h.customer_id, p.bill_id, p.amount_sen, p.refund_reason, p.received_at
     FROM payments p LEFT JOIN holds h ON h.id = p.hold_id WHERE p.status = 'refund_due' AND p.amount_sen > 0`,
    `UPDATE meta SET rev = max(rev + 1, unixepoch() * 1000000)`,
    `INSERT INTO outbox (entity, entity_id, rev) SELECT 'refund', id, (SELECT rev FROM meta) FROM refunds WHERE true
     ON CONFLICT(entity, entity_id) DO UPDATE SET rev = excluded.rev`,
    `INSERT INTO outbox (entity, entity_id, rev) SELECT 'pack', id, (SELECT rev FROM meta) FROM packs WHERE true
     ON CONFLICT(entity, entity_id) DO UPDATE SET rev = excluded.rev`,
  ],
  [`ALTER TABLE activities ADD COLUMN requires_waiver INTEGER NOT NULL DEFAULT 1 CHECK (requires_waiver IN (0,1))`],
];

export function migrate(storage: DurableObjectStorage) {
  const sql = storage.sql;
  const hasMeta = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
  const version = hasMeta ? (sql.exec<{ v: number }>("SELECT schema_version AS v FROM meta").one().v) : 0;
  for (let i = version; i < migrations.length; i++) {
    tx(storage, () => {
      for (const s of migrations[i]) sql.exec(s);
      sql.exec("UPDATE meta SET schema_version = ?", i + 1);
    });
  }
}
