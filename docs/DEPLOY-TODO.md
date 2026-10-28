# Deploy TODO

Cloudflare account `11b89f8794afc04ed1dd94beb34db9c9`, zone `komugo.com`, workers.dev subdomain `komugo`.

## Secrets (`komugo-api` only)

Run from `apps/api`. Add `--env staging` for staging.

| Secret | Staging | Prod | Source |
| --- | --- | --- | --- |
| `APP_SECRET` | [x] | [ ] | `openssl rand -base64 48 \| tr -d '\n' \| npx wrangler secret put APP_SECRET` (different value per env) |
| `BILLPLZ_API_KEY` | [ ] | [ ] | Billplz sandbox (staging) / live (prod) → Settings → API key |
| `BILLPLZ_X_SIGNATURE_KEY` | [ ] | [ ] | Billplz → Settings → X Signature key |
| `RESEND_API_KEY` | [ ] | [ ] | Resend → API Keys |

## Vars (`apps/api/wrangler.jsonc`)

- [ ] `BILLPLZ_COLLECTION_ID`: staging = sandbox collection id, prod = live collection id (empty in both now)
- [ ] Prod `EMAIL_FROM` `tickets@komugo.com` needs `komugo.com` verified in Resend (see DNS)
- Staging sends from `onboarding@resend.dev`: delivers only to the Resend account owner's email

## Staging (https://komugo-web-staging.komugo.workers.dev, https://komugo-dashboard-staging.komugo.workers.dev)

- [x] D1 `komugo-staging` migrated (0000–0006), 3 Workers deployed, seeded
- [ ] Set secrets above, set collection id, `pnpm --filter @komugo/api deploy:staging`
- [ ] Sandbox smoke test: book → pay (sandbox) → callback → ticket email → dashboard check-in
- [ ] Operator sign-in: seed members are `*@komugo.test` (no inbox); add a member with the Resend owner email to test the dashboard
- [ ] Optional: Cloudflare Access on both workers.dev URLs (bypass `/billplz/callback`)

## Prod

Order matters.

1. [ ] `pnpm --filter @komugo/api db:migrate:remote` (D1 `komugo`, 0000–0006)
2. [ ] Set prod secrets + live `BILLPLZ_COLLECTION_ID`
3. [ ] `pnpm --filter @komugo/api deploy`
4. [ ] Delete WordPress DNS records (takes WordPress offline): apex A ×2 + AAAA ×2, `www` CNAME. Keep MX, SPF, DMARC, DKIM, `ftp`, `autoconfig`, `autodiscover`
5. [ ] `pnpm --filter @komugo/web deploy` (creates `komugo.com` + `www` custom domains; `www` 301s to apex in middleware)
6. [ ] `pnpm --filter @komugo/dashboard deploy` (creates `dashboard.komugo.com`)
7. [ ] Seed prod: `npx wrangler deploy --var DEV_SEED:1`, `POST https://dashboard.komugo.com/api/dev/seed` with matching `Origin`, redeploy without the var, confirm 404
8. [ ] Resend: add `komugo.com`, add its DKIM/SPF/MX (`send.` subdomain) records in Cloudflare DNS, verify
9. [ ] Confirm prices/hours with both parks before publishing any Activity

## Later

- Step 7 (reviews/payouts): grilling session first
- [ ] Switch email from Resend to Cloudflare Email Sending: add `send_email` binding + `EMAIL_MODE` branch in `apps/api/src/email.ts`, onboard `komugo.com` (its DNS records), drop `RESEND_API_KEY`
- See `docs/PLAN.md` for the remaining Deployment / Platform / Checkout items (WAF, restore drill, Safari test)
