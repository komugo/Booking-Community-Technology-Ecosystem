// pnpm --filter @komugo/api putrajaya build              CSV → data/putrajaya.json (review its diff before loading)
// pnpm --filter @komugo/api putrajaya import --dry-run  print what would be inserted into local D1
// pnpm --filter @komugo/api putrajaya import            insert new rows into local D1
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./putrajaya-build";
import { diff, EXISTING_SQL, existingFrom, insertSql, plan, type Catalogue } from "./putrajaya-load";

const CSV = "../../data/putrajaya-master-list.csv";
const JSON_FILE = "../../data/putrajaya.json";
const LOCAL = ["--local", "--persist-to", "../../.wrangler/state"];

const d1 = (...args: string[]) => execFileSync("wrangler", ["d1", "execute", "komugo", ...LOCAL, ...args], { encoding: "utf8" });

const [command, flag] = process.argv.slice(2);

if (command === "build") {
  const data = build(readFileSync(CSV, "utf8"));
  writeFileSync(JSON_FILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${data.venues.length} venues, ${data.activities.length} activities, ${data.operators.length} operators, ${data.excluded.length} excluded → ${JSON_FILE}`);
} else if (command === "import") {
  const data = JSON.parse(readFileSync(JSON_FILE, "utf8")) as Catalogue;
  const results = JSON.parse(d1("--json", "--command", EXISTING_SQL.join("; "))) as { results: unknown[] }[];
  const p = plan(data, existingFrom(results.map((r) => r.results)));
  console.log(diff(p).join("\n"));
  const sql = insertSql(p);
  if (flag !== "--dry-run" && sql.length) {
    const file = join(mkdtempSync(join(tmpdir(), "putrajaya-")), "import.sql");
    writeFileSync(file, sql.join("\n"));
    d1("--yes", "--file", file);
    console.log(`Inserted ${sql.length} rows`);
  }
} else {
  console.error("Usage: putrajaya build | putrajaya import [--dry-run]");
  process.exit(1);
}
