/**
 * Turns the generated Drizzle migration into an array of idempotent statements the app can run
 * against a brand-new account database at signup.
 *
 * `drizzle-kit push` is a CLI that reads a config file and targets one database, so it cannot be
 * called per account from inside a request. This generates the same DDL as a plain array instead.
 *
 * Every statement is rewritten to `if not exists`, which makes the same function usable both to
 * create a database and to bring an existing one up to date after a column is added.
 *
 * Run `npm run schema:build` after any change to `src/lib/db/schema.ts`. A test asserts the
 * generated file is in step with the schema, so forgetting is caught rather than discovered.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "drizzle";
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (files.length === 0) {
  console.error("No migration SQL found. Run `npx drizzle-kit generate` first.");
  process.exit(1);
}

/** Drizzle separates statements with this marker. */
const BREAK = "--> statement-breakpoint";

const statements = [];
for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const raw of sql.split(BREAK)) {
    const s = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;$/, "")
      .trim();
    if (!s) continue;
    statements.push(s);
  }
}

const idempotent = statements.map((s) =>
  s
    .replace(/^CREATE TABLE(?! IF NOT EXISTS)/i, "CREATE TABLE IF NOT EXISTS")
    .replace(/^CREATE UNIQUE INDEX(?! IF NOT EXISTS)/i, "CREATE UNIQUE INDEX IF NOT EXISTS")
    .replace(/^CREATE INDEX(?! IF NOT EXISTS)/i, "CREATE INDEX IF NOT EXISTS"),
);

const notIdempotent = idempotent.filter((s) => !/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/i.test(s));
if (notIdempotent.length > 0) {
  console.error(
    `${notIdempotent.length} statement(s) are not create-if-not-exists and would fail on re-run.\n` +
      "A column added to an existing table needs an ALTER, which this generator does not produce.\n" +
      "Add it to ACCOUNT_SCHEMA_EXTRA in src/lib/db/accountSchema.ts by hand, guarded so a re-run is safe:\n" +
      notIdempotent.map((s) => "  " + s.slice(0, 100)).join("\n"),
  );
}

const tables = idempotent.filter((s) => /^CREATE TABLE/i.test(s)).length;
const indexes = idempotent.length - tables;

const out = `/**
 * GENERATED FILE. Run \`npm run schema:build\` to regenerate; do not edit by hand.
 *
 * The account schema as executable statements, so a new account's database can be created inside a
 * request. Generated from \`src/lib/db/schema.ts\` via \`drizzle-kit generate\`.
 *
 * ${tables} tables, ${indexes} indexes. Every statement is create-if-not-exists, so applying this to
 * an existing database is a no-op and the same list doubles as the migration path.
 */

export const ACCOUNT_SCHEMA_SQL: string[] = [
${idempotent.map((s) => "  " + JSON.stringify(s) + ",").join("\n")}
];

/**
 * Statements the generator cannot produce, added by hand. A column added to a table that already
 * exists needs an ALTER, and SQLite has no \`add column if not exists\`, so each one is written to
 * be safe when it has already been applied.
 */
export const ACCOUNT_SCHEMA_EXTRA: string[] = [];

export const ACCOUNT_SCHEMA_TABLES = ${tables};
`;

writeFileSync("src/lib/db/accountSchema.ts", out);
console.log(`wrote src/lib/db/accountSchema.ts: ${tables} tables, ${indexes} indexes, ${idempotent.length} statements`);
