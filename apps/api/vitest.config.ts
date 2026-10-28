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
          BILLPLZ_BASE: "https://api.test/dev/billplz/api/v3",
          BILLPLZ_COLLECTION_ID: "col_test",
          EMAIL_MODE: "log",
          EMAIL_FROM: "Komugo <test@komugo.com>",
          APP_SECRET: "test-app-secret",
          BILLPLZ_API_KEY: "test-api-key",
          BILLPLZ_X_SIGNATURE_KEY: "S-s7b4yWpp9h7rrkNM1i3Z_g",
          RESEND_API_KEY: "re_test",
        },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
