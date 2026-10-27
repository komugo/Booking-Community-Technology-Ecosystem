import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/worker.ts",
      remoteBindings: false,
      miniflare: {
        compatibilityDate: "2026-10-01",
        d1Databases: ["DB"],
        durableObjects: { BOOKING: { className: "OperatorBooking", useSQLite: true } },
        bindings: { TEST_MIGRATIONS: await readD1Migrations("../db/migrations") },
      },
    })),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
});
