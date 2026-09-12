/**
 * What has to happen on a deployment before the server starts.
 *
 * The old boot script was written for one database and does not survive the split. It pushed the
 * schema to `DATABASE_URL` and then ran `seed`, `seedFoods` and `demo`, all three of which now
 * require an account named on the command line and would have exited immediately. Every failure was
 * swallowed by a `|| echo`, so the machine would have started with no control database at all and
 * the first request to the sign-in page would have failed on a missing table.
 *
 * What this does instead, in order, all of it idempotent:
 *
 *  1. Creates the control tables, because nothing else does on a fresh volume.
 *  2. Brings every existing account database up to the current schema.
 *  3. Creates the demo account, if one is configured and absent, and seeds fictional data into it
 *     so a prospect opening the link sees a working app rather than a sign-in form.
 *
 * Step 3 runs ONLY when the account did not already exist. Re-seeding on every restart would wipe
 * anything somebody had done while looking at it, and a machine that suspends and resumes restarts
 * often.
 */
import { mkdir } from "node:fs/promises";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { controlDb, accounts, CONTROL_URL } from "../src/lib/db/control";
import { CONTROL_SCHEMA_SQL, CONTROL_SCHEMA_TABLES } from "../src/lib/db/controlSchema";
import { ACCOUNTS_DIR, withAccount } from "../src/lib/db";
import { clientForAccount } from "./_account";
import { writeDemoData } from "./demo";
import { linkDemoFoods } from "./demoFoodLinks";
import { addPreMealReadings } from "./demoPreMeal";
import { migrateAllAccounts, signUp, changePassword } from "../src/lib/auth/provision";
import { normalizeEmail } from "../src/lib/auth/passwords";

config({ path: ".env.local", quiet: true });

async function main() {
  console.log(`steady: control database at ${CONTROL_URL}`);
  console.log(`steady: account databases in ${ACCOUNTS_DIR}`);

  /**
   * The directory has to exist before libsql is asked to open a file in it. A missing directory
   * reads as "unable to open database file", which sounds like a permissions problem and is not.
   */
  await mkdir(ACCOUNTS_DIR, { recursive: true }).catch(() => {});

  const control = createClient({ url: CONTROL_URL, authToken: process.env.CONTROL_DATABASE_AUTH_TOKEN });
  try {
    for (const statement of CONTROL_SCHEMA_SQL) await control.execute(statement);
    console.log(`steady: control plane ready, ${CONTROL_SCHEMA_TABLES.length} tables`);
  } finally {
    try {
      control.close();
    } catch {
      /* a handle that will not close is not a reason to refuse to boot */
    }
  }

  const { migrated, failed } = await migrateAllAccounts();
  console.log(`steady: ${migrated} account database${migrated === 1 ? "" : "s"} up to schema`);
  for (const f of failed) console.error(`steady: MIGRATION FAILED for ${f}`);

  /* ----------------------------- the demo account ----------------------------- */

  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;

  if (!email || !password) {
    console.log("steady: no DEMO_EMAIL and DEMO_PASSWORD set, so no demo account. Sign up to use the app.");
    return;
  }

  /*
   * RENAMING THE DEMO ACCOUNT, when DEMO_EMAIL has been pointed somewhere new.
   *
   * Without this, changing DEMO_EMAIL silently forks the deployment: the lookup below finds no
   * account at the new address, a fresh one is created and seeded, and the world somebody had
   * actually been using stays behind on the old address with nothing pointing at it. The data is
   * not lost, but it is orphaned, which is worse than an error because nothing reports it.
   *
   * So the old address is named in DEMO_EMAIL_WAS and the account is moved rather than replaced.
   * It is only ever a rename: same id, same database, same sessions, same history. It does nothing
   * unless DEMO_EMAIL_WAS is set, and nothing once the move has happened, so it is safe to leave
   * configured and safe to remove.
   */
  const previousEmail = process.env.DEMO_EMAIL_WAS;
  if (previousEmail && normalizeEmail(previousEmail) !== normalizeEmail(email)) {
    const [atNew] = await controlDb().select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).limit(1);
    const [atOld] = await controlDb().select().from(accounts).where(eq(accounts.email, normalizeEmail(previousEmail))).limit(1);
    if (atNew) {
      console.log(`steady: ${email} already exists, so ${previousEmail} was left alone`);
    } else if (!atOld) {
      console.log(`steady: nothing at ${previousEmail} to rename`);
    } else {
      await controlDb().update(accounts).set({ email: normalizeEmail(email) }).where(eq(accounts.id, atOld.id));
      console.log(`steady: renamed the demo account from ${previousEmail} to ${email}, same database and history`);
    }
  }

  const existing = await controlDb().select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).limit(1);
  if (existing[0]) {
    /**
     * For THIS one account, the configured password is the password.
     *
     * Ordinary accounts are never touched by a deploy, and must not be. The demo account is
     * different in kind: its credentials live in the deployment's own configuration, it exists to
     * be handed to people, and its data is fictional. Leaving it alone meant that changing
     * DEMO_PASSWORD did nothing, so whoever deployed it could end up unable to sign in to the
     * account they had just configured, which is what happened the first time.
     *
     * The data is left completely alone. This resets a password and nothing else.
     */
    const reset = await changePassword(existing[0].id, password);
    console.log(
      reset.ok
        ? `steady: demo account ${email} already exists, password set to match DEMO_PASSWORD`
        : `steady: demo account ${email} exists, password NOT reset: ${reset.error}`,
    );
    return;
  }

  console.log(`steady: creating demo account ${email}`);
  const result = await signUp(email, password);
  if (!result.ok) {
    // Not fatal. The app works without a demo account; it just shows a sign-in page.
    console.error(`steady: could not create the demo account: ${result.error}`);
    return;
  }
  console.log(`steady: demo account created (${result.account.dbRef})`);

  if (process.env.SEED_DEMO !== "1") {
    console.log("steady: SEED_DEMO is not 1, so the demo account starts empty");
    return;
  }

  /**
   * Fictional data, and the app says so on every screen that shows it. Three steps in order,
   * because the meals have to exist before they can be linked to reference foods, and the foods
   * have to be linked before a before-meal reading against them is worth adding.
   *
   * IMPORTED, not spawned. Spawning meant a shell command path, which behaves differently on
   * Windows and Linux: the first version failed locally with "'.' is not recognized" and would
   * have worked in the container, which is the worst of both, because it could only be tested in
   * the place where failing is expensive.
   */
  const { account } = result;
  try {
    await withAccount({ accountId: account.id, dbRef: account.dbRef }, () => writeDemoData());
    console.log("steady: demo data written");

    const client = clientForAccount(account);
    try {
      await linkDemoFoods(client);
      await addPreMealReadings(client);
      console.log("steady: food links and before-meal readings written");
    } finally {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    // Not fatal: an account with no demo data still works, it just looks empty.
    console.error("steady: demo seeding failed, continuing", err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    /**
     * This one DOES fail the boot. Starting a server whose control database has no tables gives
     * every visitor an error page, and a machine that refuses to start is a problem somebody sees
     * in the deploy output rather than in a support message a week later.
     */
    console.error("steady: bootstrap failed, refusing to start", err);
    process.exit(1);
  });
