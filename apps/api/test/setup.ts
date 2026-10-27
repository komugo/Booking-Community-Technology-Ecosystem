import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { stubOutbound } from "./helpers";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  stubOutbound();
});
