import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("../../packages/db/migrations"),
          DEV_SEED: "1",
          BOOK_DRAFTS: "0",
          PUBLIC_SITE_URL: "https://web.test",
          CHIP_BASE: "https://api.test/dev/chip/api/v1",
          CHIP_BRAND_ID: "brand_test",
          EMAIL_MODE: "log",
          WHATSAPP_MODE: "log",
          EMAIL_FROM: "Komugo <test@komugo.com>",
          APP_SECRET: "test-app-secret",
          CHIP_SECRET_KEY: "test-secret-key",
          RESEND_API_KEY: "re_test",
          WASENDER_API_KEY: "wasender_test",
          WASENDER_GAP_MS: "0",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
