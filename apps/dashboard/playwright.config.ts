import { defineConfig, devices } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:8790";
const DASH = process.env.DASH_URL ?? "http://localhost:5180";
const api = new URL(API);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: DASH,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: [
    {
      command: `pnpm --filter @komugo/api exec sh -c 'wrangler d1 migrations apply komugo --local --persist-to ../../.wrangler/state-e2e && wrangler dev --port ${api.port} --inspector-port 9240 --persist-to ../../.wrangler/state-e2e --var DEV_SEED:1 BOOK_DRAFTS:1 EMAIL_MODE:log PUBLIC_SITE_URL:http://localhost:4330 BILLPLZ_BASE:${API}/dev/billplz/api/v3 BILLPLZ_COLLECTION_ID:dev-collection'`,
      url: `${API}/health`,
      reuseExistingServer: !!process.env.REUSE,
      timeout: 120_000,
    },
    {
      command: `API_URL=${API} pnpm --filter @komugo/dashboard exec vite --port ${new URL(DASH).port} --strictPort`,
      url: DASH,
      reuseExistingServer: !!process.env.REUSE,
    },
  ],
});
