# Plan

## Deployment

Dokploy on a single Singapore VPS. Postgres self-hosted on the same VPS. No Cloudflare at launch.

- [ ] Set up WAL-G backups to R2 in docker-compose
  - Continuous WAL archiving + nightly base backup (point-in-time restore, ~1 min data loss max)
  - R2 bucket + credentials in env, not committed
- [ ] Monthly restore test: restore latest backup into a scratch container and verify bookings/payments
- [ ] Alert on failed backup and low disk
- [ ] Postgres on internal Docker network only (no public `5432` in prod)
- [ ] Container memory limits so API/builds can't starve Postgres
- [ ] Traefik: long `Cache-Control` for `/_astro/*`, gzip/brotli, rate limits on auth + checkout
- [ ] `ufw` (80, 443, SSH only) + `fail2ban`

## Deferred from the schema slice

- Checkout slice: Waiver signing must record that a guardian signed for a minor (under 18 at signing); `waivers` stores only `signer_name` today.
- Checkout slice: payment landing after Hold expiry → try re-allocating the same Timeslot; if taken, auto full Refund + rebook link (`confirmHold` currently returns `hold_gone`).
- Payouts slice: Commission rate on `operators` plus a snapshot on `tickets` (and Pack purchases) at sale time.

## Later

- Cloudflare proxy (DNS + DDoS shield, caching off) if attacks or bot traffic appear; allowlist Billplz webhook path
- Managed Postgres or a separate DB VPS once downtime becomes expensive
