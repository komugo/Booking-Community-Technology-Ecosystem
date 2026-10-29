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
- [x] Billplz webhook as a Worker route, duplicate callbacks handled in code (cron reconciles lost callbacks; no Queues)
- [ ] R2 for photos/files
- [x] Rate limiting on auth + checkout (Workers `ratelimits` plus D1 caps: 5 codes per email per hour, 10 per day, 5 tries per code; 3 active Holds and 10 held people per Timeslot per Customer; 8 Holds per Checkout)
- [ ] Allowlist `/billplz/callback` in WAF/bot rules
- [ ] Git-connected deploys to a `staging` env with its own DO namespace and D1 database (DOs don't support preview URLs)

## Checkout (step 4)

- [x] Guest checkout: Option → Timeslot → Participants + Waivers → email code → Hold (15 min) → Billplz → Tickets with QR, EN + BM
- [x] Waiver records version, text hash, signer, and a guardian flag for a minor (under 18 at signing)
- [x] Late payment after Hold expiry: re-allocate the same Timeslot (or the Checkout's replacement Hold for the same people), else `refund_due` with a refund email and rebook link
- Refunds are manual: ops pays out every `refund_due` Payment (`proj_payments`, `bills.refund_reason`) by hand; the Customer gets an email. Not an automatic Refund.
- [ ] Real Billplz keys and collection (`BILLPLZ_API_KEY`, `BILLPLZ_X_SIGNATURE_KEY`, `BILLPLZ_COLLECTION_ID`), "Extra Payment Completion Information" on, then a sandbox smoke test on staging
- [ ] Email domain: verify `komugo.com` in Resend (SPF/DKIM), set `RESEND_API_KEY` and `APP_SECRET`
- [ ] Legal review of the DRAFT Waiver text (EN + BM) and of adult self-attestation on the lead booker's device; bump `WAIVER.version` when it changes
- [ ] Test Safari on staging (`__Host-` Secure cookies don't set on http://localhost)

## Operator dashboard (step 5)

- [x] Member Sign-in with the email code (`__Host-ops` cookie, 30 days); staff act for any Operator, an operator Member only for theirs; enforced in the API
- [x] Setup: Resources with Welfare Rules, Options, Add-ons, Activity settings and Closed days; staff-only publish
- [x] Schedules generate Timeslots 60 days ahead, regenerated on save, on a Closed-day change and by the daily 03:00 KL cron (`0 19 * * *`); one-off Timeslots
- [x] Closure with a reason → affected list, one email per Customer (cron retries unsent ones every 5 min)
- [x] Today view (Participants, age, weight, horse, Waiver, Add-ons, contact phone) and a Check-in scanner (camera QR, typed code, offline queue in `localStorage`)
- [x] Same-origin `/api` proxy: the dashboard Worker forwards `/api/*` to the API through the `API` service binding (Vite proxy in dev), so the API needs no CORS
- [ ] Real Members on production, one statement per person:
  `wrangler d1 execute komugo --remote --command "INSERT INTO members (id, email, name, role, operator_id, created_at) VALUES (lower(hex(randomblob(16))), 'name@example.com', 'Name', 'operator', 'op_equestrian', unixepoch() * 1000)"` (staff: role `staff`, operator_id `NULL`)
- [ ] Dashboard custom domain (e.g. `ops.komugo.com`) on `komugo-dashboard`; test the camera on a real phone over HTTPS
- Local dev: run the API with `--port 8790` style flags if 8787 is taken and `API_URL=http://localhost:8790 pnpm --filter @komugo/dashboard dev`. Local state seeded before step 5 keeps its old one-off Timeslots; delete `.wrangler/state` and re-seed to get the Schedule-generated ones.
- e2e: `pnpm --filter @komugo/dashboard e2e` starts its own API (8790, state in `.wrangler/state-e2e`) and dashboard (5180).

## Customer changes (step 6)

- [x] Pack offers in dashboard Setup (Packs tab); Activity page lists active offers; Pack purchase via Sign-in + Billplz, Pack issued on the paid callback (idempotent; late or duplicate payment → Refund row)
- [x] "Use Pack" at the Pay step consumes the Checkout's Hold (Requirements, Waivers, eligible Options, expiry and remaining sessions enforced in the DO); no Add-ons with a Pack
- [x] Standalone Sign-in (`/sign-in`) and My bookings (`/bookings`): Needs your choice, Upcoming, Packs, Past
- [x] Cancel per Ticket with the outcome shown first (ticket price + Add-on share, or forfeited; Pack session returned); refused with `quote_changed` if the outcome moved
- [x] Reschedule per Ticket inside the free-cancel window; after a Closure free to any future open Timeslot
- [x] Closure choice from the emailed link (refund or new time), recorded in the Operator DO with the change and projected by the outbox onto `closure_notices`, shown in the dashboard
- [x] Staff-only "Refunds to pay" (`/refunds`): mark refunded (idempotent) emails the Customer
- [x] DO migration 7 and D1 `0006_customer_changes` are additive only
- `free_cancel_hours = 0` now means no free cancel (it used to allow a free cancel up to the start)
- e2e: `pnpm --filter @komugo/web exec playwright test` starts its own API (8790) and web (4330) on `.wrangler/state-e2e`, with a private dev registry (`WRANGLER_REGISTRY_PATH`/`MINIFLARE_REGISTRY_PATH=.wrangler/registry-e2e`) so the web's `API` service binding reaches that API and not another local one. `PERSIST_TO` and `INSPECTOR_PORT` point `astro dev` at the same D1 and a free inspector port; `--ignore-lock` keeps it in the foreground.

## Putrajaya catalogue (step 7)

Decisions: CONTEXT.md (Listing mode, Venue, Operator signed up, Booking unit, Ticket type, Daily limit), ADR 0005.

- [ ] Before any new Operator goes Bookable: Commission % on `operators`, snapshot on Tickets and Pack sales, staff "Payouts due" page (monthly, manual transfer, mark paid)
- [ ] One-time import: CSV + PPJ scrape → reviewed `data/putrajaya.json` → D1, all Hidden; insert-only (never overwrites; dashboard is source of truth after); scrape fills empty fields only; horse/climbing seed stays as dev fixtures. Load the master list (120 rows, 69 venues) as Venues + Activities; merge duplicates (Pancarona, Lake Club/Kelab Tasik, Taman Ekuestrian, Taman Persahabatan); normalise Operators; unknown Operator → Hidden
- [ ] Publish bar: Venue + map pin, Category, EN/BM description, a photo (stock allowed for now, swap later); staff fill the rest via dashboard
- [ ] 19 Categories (EN/BM slugs): badminton, futsal, football, tennis, squash, pickleball, basketball, sepak takraw, volleyball & netball, gym, swimming, water sports, cruises & boats, horse riding, climbing & adventure parks, ice skating, parks & cycling, landmarks & tours, farms & nature
- [ ] Venue pages `/putrajaya/venue/[slug]` (BM `/ms/putrajaya/tempat/[slug]`): address, map, hours, photos, Activity cards with Book now / Info badge; Activity links back to its Venue
- [ ] Slugs: Venue unique per City; Activity = venue slug + sport; never regenerated after publish
- [ ] Putrajaya page: category tiles, Bookable ranked first, filters (Bookable only, Free, Indoor/Outdoor, Presint), map view toggle. Out: text search, open now, reviews, distance sort
- [ ] Goal: replace PPJ as the way to book Putrajaya facilities. Now: scrape PPJ public catalogue data only (venues, courts, rates, hours; polite, check terms). No availability scraping, no reselling PPJ slots; pitch PPJ an official deal with demand numbers from Interest
- [ ] Info CTA by how it books today: walk-in/free "Just turn up", external "Book with PPJ" (link/phone), unknown "Call the venue"; plus "Notify me when bookable" (email-only Interest, sent once, unsubscribe link, staff see counts)
- [ ] Listing mode on Activity; Info pages (hours, price note, walk-in / book-elsewhere) with no checkout
- [ ] Waiver only when the Activity requires it (`validateWho` in `apps/api/src/checkout.ts` requires one for everyone today)
- [ ] Date ticket path: Pick and `POST /checkout` assume a `timeslotId`; cutoff uses `slot.startsAt`; Daily limit counted at Hold
- [ ] Per-court Option: quantity = back-to-back hours, skip Who, one court for all hours, assigned court on the Ticket; `court` Resource kind (DO `resources.kind` CHECK is hard-coded, dashboard `types.ts` too)
- [ ] Price per Schedule; weekend price on Date tickets; public holiday list; "From RMx" in the catalogue
- [ ] Closure reasons + maintenance, event (`closed_reason` CHECK); horse unfit only on horse Activities; free-cancel default 24h for courts/Date tickets; policy shown on Pick and Pay
- [ ] Per-Option max per booking (stepper max 10 and `MAX_PEOPLE` are hard-coded)
- [ ] Check the Billplz collection has e-wallets (TnG, GrabPay, Boost), not only FPX/card
- Eng risks: confirm nothing live in remote D1/DO before editing migrations in place, else additive only; `kind`/`closed_reason` CHECKs need one table rebuild (validate in code after), never one per value; `participant_id` NOT NULL on tickets/allocations/proj_tickets; `tickets.timeslot_id` single column vs back-to-back hours; `spots()` = 0 with no Resources; seed `onConflictDoUpdate` overwrites, block `/dev/seed` outside local; `listing_mode` backfill from `published`; venues backfilled from activities address/geo/hours; slug uniqueness across EN and MS
- [ ] Reschedule with tiered prices: Customer same total only; after Closure same-or-cheaper with difference refunded (Klook customer-promises)
- Deferred: several courts or times in one checkout, pay-the-difference bill for pricier post-Closure targets, inconvenience compensation for operator cancels within 24h, Packs on per-court/Date ticket Options (if needed later: Operator RM wallet, Playtomic-style), promo codes, split pay, contact edit on a Booking, per-date price overrides

## Deferred

- Payouts slice: Commission rate on `operators` plus a snapshot on `tickets` (and Pack purchases) at sale time.
- Auto-resolve unanswered Closures (needs an ops policy).
- Payouts (step 7) net `proj_refunds` and count Pack sales from the DO `pack_orders`.
- Pack purchase refunds are handled ad hoc by ops.

## Later

- Export to BI/spreadsheet when reporting outgrows D1 tooling
- Split D1 per region/tenant if nearing the 10GB per-database cap
