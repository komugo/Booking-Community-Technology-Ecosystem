# Plan

## Deployment

All on Cloudflare, Workers Paid ($5/mo). D1 instead of Postgres. Singapore/APAC everywhere a location hint exists.

### Database: Postgres → D1

D1 (`packages/db`, drizzle sqlite-core) holds the catalogue (Cities, Categories, Activity copy/slugs/i18n), Operators, Customers, Participants and Waivers, plus read-only `proj_*` projections of Durable Object data. Only the DO outbox drain writes `proj_*`.

- [x] Port the 25 `booking.test.ts` tests to `@cloudflare/vitest-plugin` (now in `packages/booking`); add the concurrent last-slot test
- [x] Port `schema.ts` to `sqlite-core`, regenerate migrations from scratch (`packages/db/migrations`)
  - `pgEnum` → `text` + `check`
  - `jsonb` / `text().array()` → `text({ mode: "json" })`
  - `uuid` → `text`, `crypto.randomUUID()` in app code
  - `timestamptz` → integer epoch ms
  - `now() + interval '15 minutes'` hold expiry → set in the DO
- [ ] Create the remote database with `wrangler d1 create komugo --location apac` and put its id in `apps/api/wrangler.jsonc` (a placeholder id is there for local dev)
- [ ] Monthly restore drill with D1 Time Travel (30-day PITR); the drill also covers Durable Object PITR
- Deploy order: `pnpm --filter @komugo/api db:migrate:remote`, then `wrangler deploy`. D1 migrations are additive only.
- Catalogue reads of `proj_timeslots` must filter `starts_at > now`: `spots` is not re-projected when a Timeslot starts.

### Booking engine: Durable Object per operator

See ADR 0004. `packages/booking`: `OperatorBooking` (one per Operator, embedded SQLite) is the source of truth for Option booking facts, Cancellation Policy, Resources, Timeslots, Holds, Allocations, Bookings, Tickets, Packs and Payments.

- [x] One Durable Object per operator owns all allocation: hold, confirm, cancel, expire, reschedule, Pack redeem, Closure
- [x] Each operation runs in one `ctx.storage.transactionSync` with no `await` between check and write
- [x] Hold expiry runs on the DO alarm, and every transaction sweeps expired Holds first
- [x] Idempotency: `request_id` on hold/redeem/cancel/reschedule/issuePack; `bill_id` on confirm (a reused `bill_id` with another Hold or amount is `idempotency_conflict`)
- [x] Late payment: re-allocate the same Timeslot, else `refund_due`; every paid callback is recorded in `payments`
- [x] Transactional outbox → D1 `proj_*`, drained by the alarm with versioned upserts; a row D1 rejects stays queued without blocking the rest
- [x] Postgres engine (`booking.ts`, `for update` / `skip locked`) removed
- [ ] After a failed DO migration is fixed, wake each Operator's DO (any RPC) so its alarm re-arms and the outbox drains
- [ ] Alert on `booking_alarm_failed` / `outbox_unknown_entity` logs (they carry the outbox backlog and its oldest age)

### Apps

- [x] `apps/web`: `@astrojs/node` → `@astrojs/cloudflare`; sessions off (KV when something needs them); images via Cloudflare Images or passthrough (no sharp)
- [x] `apps/api`: `@hono/node-server` entry → `export default app`; bindings for D1 and DO only; R2 and KV are added when something uses them
- [x] `apps/dashboard`: Workers static assets
- [x] Local dev via `wrangler dev`; drop the Postgres `docker-compose.yml`

### Platform

- [ ] Cron Triggers: payouts
- [ ] Billplz webhook as a Worker route, duplicate callbacks handled in code; Queues for retries if needed
- [ ] R2 for photos/files
- [ ] Rate limiting rules on auth + checkout; allowlist the Billplz webhook path in WAF/bot rules
- [ ] Git-connected deploys to a `staging` env with its own DO namespace and D1 database (DOs don't support preview URLs)

## Deferred from the schema slice

- Checkout slice: Waiver signing must record that a guardian signed for a minor (under 18 at signing); `waivers` stores only `signer_name` today.
- Late payment after Hold expiry: implemented in the engine (re-allocate the same Timeslot, else `refund_due`). Checkout slice: automatic Refund + rebook link.
- Payouts slice: Commission rate on `operators` plus a snapshot on `tickets` (and Pack purchases) at sale time.

## Later

- Export to BI/spreadsheet when reporting outgrows D1 tooling
- Split D1 per region/tenant if nearing the 10GB per-database cap
