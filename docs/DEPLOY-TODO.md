# Deploy TODO

Cloudflare account `11b89f8794afc04ed1dd94beb34db9c9` (komugohq@gmail.com; set `CLOUDFLARE_ACCOUNT_ID` if wrangler picks another), zone `komugo.com`, workers.dev subdomain `komugo`.

## Secrets (`komugo-api` only)

Run from `apps/api`. Add `--env staging` for staging.

| Secret | Staging | Prod | Source |
| --- | --- | --- | --- |
| `APP_SECRET` | [x] | [ ] | `openssl rand -base64 48 \| tr -d '\n' \| npx wrangler secret put APP_SECRET` (different value per env) |
| `CHIP_SECRET_KEY` | [ ] | [ ] | CHIP portal → Developers → API keys: test key (staging) / live key (prod) (#38) |
| `RESEND_API_KEY` | [ ] | [ ] | Resend → API Keys |
| `WASENDER_API_KEY` | [ ] | [ ] | WasenderAPI → the Komugo number's session → API key (#34) |
| `TURNSTILE_SECRET` | [ ] | [ ] | Cloudflare → Turnstile → widget for `digital.komugo.com` → secret key (Komugo Digital Leads; site key goes in `apps/digital`) |
| `STAFF_WHATSAPP` | [ ] | [ ] | Staff number for Lead alerts, `+60…`; empty skips the alert |

## Vars (`apps/api/wrangler.jsonc`)

- [ ] `CHIP_BRAND_ID`: CHIP portal → Developers → Brands (empty in both now); `CHIP_BASE` is the same for test and live, the key decides
- [ ] Prod `EMAIL_FROM` `tickets@komugo.com` needs `komugo.com` verified in Resend (see DNS)
- Staging sends from `onboarding@resend.dev`: delivers only to the Resend account owner's email
- [ ] `WASENDER_GAP_MS` (5000, Account Protection's 1 message per 5 s): lower it if the WasenderAPI plan allows (#34)

## Komugo Digital (`apps/digital`)

- [ ] Prod `TURNSTILE_SITE_KEY` in `apps/digital/wrangler.jsonc` top-level `vars` is still Cloudflare's always-pass test key: replace it with the real `digital.komugo.com` widget's site key, and set the matching `TURNSTILE_SECRET` on prod `komugo-api`. Never pair the test site key with a real secret (every Lead 403s) or the test secret with prod (no spam check)
- [ ] Turnstile widget hostnames: only `digital.komugo.com` (plus the staging host on a separate widget if staging uses a real key)
- [ ] DNS: `digital.komugo.com` custom domain is created by `pnpm --filter @komugo/digital deploy` (route `custom_domain: true`)

## Queues

- [ ] `npx wrangler queues create komugo-whatsapp-staging` before the first staging deploy with WhatsApp
- [x] `komugo-whatsapp` created (prod)

## Staging (https://komugo-web-staging.komugo.workers.dev, https://komugo-dashboard-staging.komugo.workers.dev)

- [x] D1 `komugo-staging` migrated (0000–0006), 3 Workers deployed, seeded
- [ ] Set secrets above, set brand id, `pnpm --filter @komugo/api deploy:staging`
- [ ] Test-mode smoke test: book → pay (CHIP test card) → callback → ticket email → dashboard check-in → cancel one Ticket → CHIP refund → "Refund sent" email
- [ ] Operator sign-in: seed members are `*@komugo.test` (no inbox); add a member with the Resend owner email to test the dashboard
- [ ] Optional: Cloudflare Access on both workers.dev URLs (bypass `/chip/callback`)

## Prod

Order matters.

1. [x] `pnpm --filter @komugo/api db:migrate:remote` (D1 `komugo`, 0000–0026)
   - [ ] Re-run for `0027_leads` (additive: new `leads` table) before deploying the api with `/digital/leads`
2. [ ] Set prod secrets (live `CHIP_SECRET_KEY`) + `CHIP_BRAND_ID`
3. [x] `pnpm --filter @komugo/api deploy`
4. [x] Delete WordPress DNS records (takes WordPress offline): apex A ×2 + AAAA ×2, `www` CNAME. Keep MX, SPF, DMARC, DKIM, `ftp`, `autoconfig`, `autodiscover`
5. [x] `pnpm --filter @komugo/web deploy` (creates `komugo.com` + `www` custom domains; `www` 301s to apex in middleware)
6. [x] `pnpm --filter @komugo/dashboard deploy` (creates `dashboard.komugo.com`)
7. [ ] Seed prod: blocked. `/dev/seed` and `putrajaya import` only reach local D1 (the seed overwrites rows, so it 404s on any deployed host); decide how launch data gets into prod D1
8. [ ] Resend: add `komugo.com`, add its DKIM/SPF/MX (`send.` subdomain) records in Cloudflare DNS, verify
9. [ ] Confirm prices/hours with both parks before publishing any Activity

## Later

- Step 7 (reviews/payouts): grilling session first
- [ ] Switch email from Resend to Cloudflare Email Sending: add `send_email` binding + `EMAIL_MODE` branch in `apps/api/src/email.ts`, onboard `komugo.com` (its DNS records), drop `RESEND_API_KEY`
- See `docs/PLAN.md` for the remaining Deployment / Platform / Checkout items (WAF, restore drill, Safari test)
