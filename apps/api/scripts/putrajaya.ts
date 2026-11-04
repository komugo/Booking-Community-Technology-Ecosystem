// pnpm --filter @komugo/api putrajaya build              CSV + data/ppj-sport.json → data/putrajaya.json (review its diff before loading)
// pnpm --filter @komugo/api putrajaya scrape             fetch PPJ's public sport page once and print what would change
// pnpm --filter @komugo/api putrajaya scrape --write     also save data/ppj-sport.json and rebuild data/putrajaya.json
//   import only inserts new rows: PPJ prices reach Activities already in D1 only after a fresh local DB
// pnpm --filter @komugo/api putrajaya import --dry-run  print what would be inserted into local D1
// pnpm --filter @komugo/api putrajaya import            insert new rows into local D1
// pnpm --filter @komugo/api putrajaya import --remote [--env staging] [--write]
//   remote D1 (prod, or staging with --env staging): prints the diff only, unless --write
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./putrajaya-build";
import { launch, type Launch } from "./putrajaya-launch";
import { diff, EXISTING_SQL, existingFrom, insertSql, plan, type Catalogue } from "./putrajaya-load";
import { fill, parseSport, PPJ_URL, report, type Facility } from "./putrajaya-ppj";

const CSV = "../../data/putrajaya-master-list.csv";
const JSON_FILE = "../../data/putrajaya.json";
const PPJ_FILE = "../../data/ppj-sport.json";
const LAUNCH_FILE = "../../data/putrajaya-launch.json";
const USER_AGENT = "KomugoCatalogue/1.0 (+https://komugo.com; staff-run, catalogue facts only)";
const LOCAL = ["--local", "--persist-to", "../../.wrangler/state"];

const [command, ...flags] = process.argv.slice(2);
const flag = flags[0];
const remote = flags.includes("--remote");
const env = flags.includes("--env") ? flags[flags.indexOf("--env") + 1] : null;
const target = remote ? ["--remote", ...(env ? ["--env", env] : [])] : LOCAL;

const d1 = (...args: string[]) => execFileSync("wrangler", ["d1", "execute", "DB", ...target, ...args], { encoding: "utf8" });

const json = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;
const saved = () => JSON.parse(readFileSync(PPJ_FILE, "utf8")) as Facility[];
const launched = (data: Catalogue) => launch(data, JSON.parse(readFileSync(LAUNCH_FILE, "utf8")) as Launch);

if (command === "build") {
  const data = launched(fill(build(readFileSync(CSV, "utf8")), saved()));
  writeFileSync(JSON_FILE, json(data));
  console.log(`${data.venues.length} venues, ${data.activities.length} activities, ${data.operators.length} operators, ${data.excluded.length} excluded → ${JSON_FILE}`);
} else if (command === "scrape") {
  // curl, not fetch: PPJ serves no intermediate certificate, which Node rejects. No redirects, so a login page is never followed.
  const html = execFileSync("curl", ["-fsSL", "--max-redirs", "0", "--proto", "=https", "-A", USER_AGENT, PPJ_URL], { encoding: "utf8" });
  const facilities = parseSport(html);
  const base = build(readFileSync(CSV, "utf8"));
  const current = launched(fill(base, saved()));
  if (readFileSync(JSON_FILE, "utf8") !== json(current)) {
    console.error(`${JSON_FILE} is out of date with the master list: run build and review its diff first`);
    process.exit(1);
  }
  const data = launched(fill(base, facilities));
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
  const write = remote ? flags.includes("--write") : flag !== "--dry-run";
  if (write && sql.length) {
    const file = join(mkdtempSync(join(tmpdir(), "putrajaya-")), "import.sql");
    writeFileSync(file, sql.join("\n"));
    d1("--yes", "--file", file);
    console.log(`Inserted ${sql.length} rows`);
  } else if (sql.length) console.log(`Dry run: ${sql.length} rows not written${remote ? " (add --write after review)" : ""}`);
} else {
  console.error("Usage: putrajaya build | putrajaya scrape [--write] | putrajaya import [--dry-run] | putrajaya import --remote [--env staging] [--write]");
  process.exit(1);
}
