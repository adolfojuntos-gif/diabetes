/**
 * Moves the existing single-user database into the multi-account world.
 *
 * `data/steady.db` becomes the first account's database, whole and unmodified: the file is COPIED
 * to `data/accounts/<ref>.db` and the original is left alone as a backup. No rows are rewritten,
 * because there is nothing to rewrite. Every table already contains exactly one person's data, and
 * that is precisely what an account database is.
 *
 * Usage:
 *   npm run migrate:accounts -- you@example.com yourpassword
 *   npm run migrate:accounts -- you@example.com yourpassword --dry
 *
 * Safe to re-run: an account that already owns this data is detected and left alone.
 */
import "dotenv/config";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { controlDb, accounts, CONTROL_URL } from "../src/lib/db/control";
import { handleFor, urlForRef, ACCOUNTS_DIR } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { hashPassword, normalizeEmail } from "../src/lib/auth/passwords";
import { applyAccountSchema } from "../src/lib/auth/provision";
import { seedAccountReference } from "../src/lib/data/seedAccount";
import { CONTROL_SCHEMA_SQL } from "../src/lib/db/controlSchema";

const SOURCE = "./data/steady.db";

/** Tables worth counting, so the report proves nothing was lost. */
const COUNTED = [
  "glucose_readings",
  "meals",
  "insulin_doses",
  "exercise_sessions",
  "sleep_logs",
  "hydration_logs",
  "lab_results",
  "medications",
  "appointments",
  "conversations",
  "messages",
  "foods",
  "recipes",
];

async function countRows(url: string): Promise<Record<string, number>> {
  const c = createClient({ url });
  const out: Record<string, number> = {};
  for (const t of COUNTED) {
    try {
      const r = await c.execute(`select count(*) n from ${t}`);
      out[t] = Number(r.rows[0].n);
    } catch {
      out[t] = -1; // table absent
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  const [email, password] = args.filter((a) => !a.startsWith("--"));

  if (!email || !password) {
    console.error("Usage: npm run migrate:accounts -- you@example.com yourpassword [--dry]");
    process.exit(1);
  }

  try {
    await stat(SOURCE);
  } catch {
    console.error(`No existing database at ${SOURCE}. Nothing to migrate.`);
    process.exit(1);
  }

  console.log(`control database: ${CONTROL_URL}`);

  // The control database has to exist before an account can be written to it.
  const control = createClient({ url: CONTROL_URL, authToken: process.env.CONTROL_DATABASE_AUTH_TOKEN });
  // Created even on a dry run. They are empty tables, not data, and the dry run has to read
  // `accounts` to tell you whether this migration has already happened.
  for (const stmt of CONTROL_SCHEMA_SQL) await control.execute(stmt);
  console.log("control tables ready");

  const normalised = normalizeEmail(email);
  const existing = await controlDb().select().from(accounts).where(eq(accounts.email, normalised)).limit(1);
  if (existing[0]?.provisionedAt) {
    console.log(`\nAn account for ${normalised} already exists and is provisioned. Nothing to do.`);
    console.log(`Its database: ${urlForRef(existing[0].dbRef)}`);
    process.exit(0);
  }

  const id = existing[0]?.id ?? newId(18);
  const dbRef = `acct-${id}`;
  const target = urlForRef(dbRef);
  const targetPath = target.replace(/^file:/, "");

  const before = await countRows(`file:${SOURCE}`);
  console.log("\nrows in the existing database:");
  for (const [t, n] of Object.entries(before)) if (n > 0) console.log(`  ${t}: ${n}`);

  if (dry) {
    console.log(`\nwould copy ${SOURCE} to ${targetPath}`);
    console.log(`would create account ${normalised} with db_ref ${dbRef}`);
    console.log("\nDry run. Nothing was changed.");
    process.exit(0);
  }

  await mkdir(ACCOUNTS_DIR, { recursive: true });
  // A copy, not a move. The original stays as a backup that costs nothing but disk.
  await copyFile(SOURCE, targetPath);
  console.log(`\ncopied ${SOURCE} to ${targetPath} (the original is left in place as a backup)`);

  // Bring it up to the current schema, in case it predates a column, and top up the reference.
  await applyAccountSchema(dbRef);
  const seeded = await seedAccountReference(handleFor(dbRef));
  console.log(`schema applied. reference topped up: ${JSON.stringify(seeded)}`);

  const now = new Date();
  const passwordHash = await hashPassword(password);
  if (existing[0]) {
    await controlDb().update(accounts).set({ passwordHash, dbRef, provisionedAt: now }).where(eq(accounts.id, id));
  } else {
    await controlDb().insert(accounts).values({
      id,
      email: normalised,
      passwordHash,
      dbRef,
      plan: "plus",
      status: "active",
      provisionedAt: now,
      createdAt: now,
      lastSeenAt: null,
    });
  }

  const after = await countRows(target);
  console.log("\nrows in the account database:");
  let lost = 0;
  for (const [t, n] of Object.entries(after)) {
    const was = before[t] ?? 0;
    if (was > 0 || n > 0) {
      const flag = n < was ? "  LOST ROWS" : "";
      if (n < was) lost++;
      console.log(`  ${t}: ${was} -> ${n}${flag}`);
    }
  }

  console.log(
    lost === 0
      ? `\nDone. Sign in as ${normalised}. Every row survived, and ${SOURCE} is still there if you want to check.`
      : `\n${lost} table(s) LOST ROWS. Do not delete ${SOURCE}. Investigate before using the app.`,
  );
  process.exit(lost === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
