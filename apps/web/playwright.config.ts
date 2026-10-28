import { defineConfig, devices } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:8790";
const WEB = process.env.WEB_URL ?? "http://localhost:4330";
const api = new URL(API);
// A private dev registry, so the web's API service binding reaches this API and not another session's.
const REGISTRY = "WRANGLER_REGISTRY_PATH=../../.wrangler/registry-e2e MINIFLARE_REGISTRY_PATH=../../.wrangler/registry-e2e";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: WEB,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: [
    {
      command: `pnpm --filter @komugo/api exec sh -c 'rm -rf ../../.wrangler/registry-e2e && wrangler d1 migrations apply komugo --local --persist-to ../../.wrangler/state-e2e && ${REGISTRY} wrangler dev --port ${api.port} --inspector-port 9240 --persist-to ../../.wrangler/state-e2e --var DEV_SEED:1 BOOK_DRAFTS:1 EMAIL_MODE:log PUBLIC_SITE_URL:${WEB} BILLPLZ_BASE:${API}/dev/billplz/api/v3 BILLPLZ_COLLECTION_ID:dev-collection'`,
      url: `${API}/health`,
      reuseExistingServer: !!process.env.REUSE,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @komugo/web exec sh -c '${REGISTRY} PERSIST_TO=../../.wrangler/state-e2e INSPECTOR_PORT=9241 PUBLIC_SITE_URL=${WEB} astro dev --port ${new URL(WEB).port} --strictPort --ignore-lock'`,
      // /bookings calls the API through the service binding, so the first test doesn't race it.
      url: `${WEB}/bookings`,
      reuseExistingServer: !!process.env.REUSE,
      timeout: 120_000,
    },
  ],
});
