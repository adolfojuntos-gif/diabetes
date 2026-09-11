/**
 * Bring the whole installation up to the current schema: the control plane first, then every
 * account database.
 *
 * This is the operational half of `npm run schema:build`. Generating the statements changes what a
 * NEW account gets; this command is what gives them to accounts that already exist. Skipping it is
 * the failure mode where a feature works perfectly for the developer who just signed up and throws
 * "no such column" for everybody who signed up last week.
 *
 * The CONTROL plane is migrated here too, and that was missing. Only the one-time account migration
 * ever created those tables, so adding one (billing added two) had no path onto a deployment that
 * was already running: the table simply would not exist, and the first request to touch it would
 * fail. Control tables come first because an account row has to be readable before its database can
 * be found.
 *
 * Safe to run repeatedly: every statement in both schemas is create-if-not-exists.
 */
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { migrateAllAccounts } from "../src/lib/auth/provision";
import { ACCOUNT_SCHEMA_TABLES } from "../src/lib/db/accountSchema";
import { CONTROL_SCHEMA_SQL, CONTROL_SCHEMA_TABLES } from "../src/lib/db/controlSchema";
import { CONTROL_URL } from "../src/lib/db/control";

config({ path: ".env.local", quiet: true });

async function main() {
  const control = createClient({ url: CONTROL_URL, authToken: process.env.CONTROL_DATABASE_AUTH_TOKEN });
  try {
    for (const statement of CONTROL_SCHEMA_SQL) await control.execute(statement);
    console.log(`Control plane: ${CONTROL_SCHEMA_TABLES.length} tables in step (${CONTROL_URL}).`);
  } finally {
    try {
      control.close();
    } catch {
      /* a handle that will not close is not a reason to fail a migration that succeeded */
    }
  }

  const { migrated, failed } = await migrateAllAccounts();
  console.log(`Applied ${ACCOUNT_SCHEMA_TABLES} tables to ${migrated} account database${migrated === 1 ? "" : "s"}.`);

  if (failed.length) {
    console.error(`\n${failed.length} failed:`);
    for (const f of failed) console.error(`  ${f}`);
    // A partial migration is the state that must not pass silently: the accounts that failed are
    // now behind the ones that worked, and only this exit code says so.
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
