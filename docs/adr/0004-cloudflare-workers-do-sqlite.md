# Booking engine lives in one Durable Object per Operator, on its SQLite

## Context

The platform is all Cloudflare (Workers Paid, no Postgres, no Docker). Booking needs check-and-write atomicity: two Customers racing for the last horse, a Pack redeemed twice at once, a payment landing while the Operator closes the Timeslot. D1 has no interactive transactions, so a check followed by a write always has an `await` between them.

## Decision

All booking state has its source of truth in one Durable Object per Operator (`OperatorBooking`, `new_sqlite_classes`): Option booking facts (price, duration, Requirements, Resource needs, names), Cancellation Policy, Resources and Welfare Rules, Timeslots, Holds (with hold-time Participant facts), Allocations, Bookings, Tickets, Packs and Payments. Every operation runs its checks and writes in one `ctx.storage.transactionSync` with no `await` between them. The `NotPromise` type stops an async callback at compile time; the runtime check only rolls back writes made before the first `await`.

D1 holds the catalogue copy, Operators, Customers, Participants and Waivers. The API loads Participant facts and the Waiver flag from D1 and passes them into the DO call; that is the only caller-trusted input.

Every DO change writes an outbox row in the same transaction. The DO alarm drains it into D1 `proj_*` tables (activities, options, timeslots with `spots`, tickets, packs, payments) with upserts guarded by `version`. Versions come from `meta.rev`, floored at the clock, so they keep rising after a restore. Duplicate or out-of-order delivery is a no-op. A row D1 rejects stays queued without blocking the others. The alarm also expires Holds, prunes idempotency records after 7 days, and always re-arms (30 s after a failure).

## Why not D1 batch plus a mutex, or Postgres

D1 `batch()` is atomic but cannot read-then-decide; a mutex in a Worker is not durable across isolates and still leaves the check outside the write. Postgres would work (`SELECT ... FOR UPDATE`, `EXCLUDE`), but the user chose an all-Cloudflare stack. A per-Operator DO gives single-threaded, durable, transactional SQLite next to the logic, and Operators never contend with each other.

## Consequences

- D1 projections lag the DO: normally under a second, unbounded while D1 is down, with nothing lost. Checkout uses the DO response. Payouts must check that the Operator's outbox is empty.
- `proj_timeslots.spots` is not refreshed when a Timeslot starts; catalogue reads filter `starts_at > now`.
- Two backup systems (DO PITR and D1 Time Travel); the restore drill covers both.
- DO schema migrations are append-only, additive TS arrays applied on first wake. A bad one fails that Operator closed until a fix ships; then each Operator's DO must be woken so its alarm re-arms.
- Preview URLs do not support DOs, so pre-production runs in a `staging` env with its own DO namespace and D1.
- Hold-time Participant facts (birth date, weight, certs) live in the DO, so data-deletion requests must reach it.
