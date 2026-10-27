import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function () {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must be set and name a database ending in _test");
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client`drop schema if exists drizzle cascade`;
  await client`drop schema public cascade`;
  await client`create schema public`;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
}
