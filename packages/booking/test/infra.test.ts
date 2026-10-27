import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { migrate, migrations } from "../src/migrations";
import { tx } from "../src/tx";
import { rid } from "./helpers";

const stubFor = (op: string) => env.BOOKING.get(env.BOOKING.idFromName(op));

test("an RPC whose operatorId does not match the Durable Object throws", async () => {
  await runInDurableObject(stubFor(rid()), async (instance) => {
    await expect(instance.upsertActivity(rid(), { id: rid(), freeCancelHours: 1 })).rejects.toThrow("wrong_operator");
  });
});

test("a fresh Durable Object is at the latest schema version and re-running migrate is a no-op", async () => {
  await runInDurableObject(stubFor(rid()), (_, s) => {
    const objects = () => s.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master").one().n;
    const version = () => s.storage.sql.exec("SELECT schema_version AS v FROM meta").one().v;
    expect(version()).toBe(migrations.length);
    const before = objects();
    migrate(s.storage);
    expect(version()).toBe(migrations.length);
    expect(objects()).toBe(before);
  });
});

test("an async callback inside tx throws and leaves no rows", async () => {
  await runInDurableObject(stubFor(rid()), (_, s) => {
    const write = async () => {
      s.storage.sql.exec("INSERT INTO activities (id, free_cancel_hours) VALUES (?, 1)", rid());
    };
    expect(() => tx(s.storage, write as () => never)).toThrow("async_in_transaction");
    expect(s.storage.sql.exec("SELECT count(*) AS n FROM activities").one().n).toBe(0);
  });
});
