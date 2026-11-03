// pnpm --filter @komugo/api putrajaya build              CSV + data/ppj-sport.json → data/putrajaya.json (review its diff before loading)
// pnpm --filter @komugo/api putrajaya scrape             fetch PPJ's public sport page once and print what would change
// pnpm --filter @komugo/api putrajaya scrape --write     also save data/ppj-sport.json and rebuild data/putrajaya.json
//   import only inserts new rows: PPJ prices reach Activities already in D1 only after a fresh local DB
// pnpm --filter @komugo/api putrajaya import --dry-run  print what would be inserted into local D1
// pnpm --filter @komugo/api putrajaya import            insert new rows into local D1
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./putrajaya-build";
import { diff, EXISTING_SQL, existingFrom, insertSql, plan, type Catalogue } from "./putrajaya-load";
import { fill, parseSport, PPJ_URL, report, type Facility } from "./putrajaya-ppj";

const CSV = "../../data/putrajaya-master-list.csv";
const JSON_FILE = "../../data/putrajaya.json";
const PPJ_FILE = "../../data/ppj-sport.json";
const USER_AGENT = "KomugoCatalogue/1.0 (+https://komugo.com; staff-run, catalogue facts only)";
const LOCAL = ["--local", "--persist-to", "../../.wrangler/state"];

const d1 = (...args: string[]) => execFileSync("wrangler", ["d1", "execute", "komugo", ...LOCAL, ...args], { encoding: "utf8" });

const [command, flag] = process.argv.slice(2);

const json = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;
const saved = () => JSON.parse(readFileSync(PPJ_FILE, "utf8")) as Facility[];

if (command === "build") {
  const data = fill(build(readFileSync(CSV, "utf8")), saved());
  writeFileSync(JSON_FILE, json(data));
  console.log(`${data.venues.length} venues, ${data.activities.length} activities, ${data.operators.length} operators, ${data.excluded.length} excluded → ${JSON_FILE}`);
} else if (command === "scrape") {
  // curl, not fetch: PPJ serves no intermediate certificate, which Node rejects. No redirects, so a login page is never followed.
  const html = execFileSync("curl", ["-fsSL", "--max-redirs", "0", "--proto", "=https", "-A", USER_AGENT, PPJ_URL], { encoding: "utf8" });
  const facilities = parseSport(html);
  const base = build(readFileSync(CSV, "utf8"));
  const current = fill(base, saved());
  if (readFileSync(JSON_FILE, "utf8") !== json(current)) {
    console.error(`${JSON_FILE} is out of date with the master list: run build and review its diff first`);
    process.exit(1);
  }
  const data = fill(base, facilities);
  console.log(report(facilities, current, data).join("\n"));
  if (flag === "--write") {
    writeFileSync(PPJ_FILE, json(facilities));
    writeFileSync(JSON_FILE, json(data));
    console.log(`→ ${PPJ_FILE}, ${JSON_FILE} (import only inserts new Activities: existing D1 rows keep their price)`);
  } else console.log("Dry run: nothing written (add --write after review)");
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
  console.error("Usage: putrajaya build | putrajaya scrape [--write] | putrajaya import [--dry-run]");
  process.exit(1);
}
