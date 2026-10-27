import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.WEB_URL ?? "http://localhost:4321",
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    contextOptions: { reducedMotion: "reduce" },
  },
});
