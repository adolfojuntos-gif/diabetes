/**
 * Resolving which account a script should act on.
 *
 * Every script that touches clinical data needs this now, and before it existed each one had its
 * own answer. The two demo helpers and three maintenance scripts each built a libsql client from
 * `process.env.DATABASE_URL ?? "file:./data/steady.db"`, which was correct when there was one
 * database and is silently wrong now: `data/steady.db` is only the pre-migration backup, so those
 * scripts reported success and changed nothing the app would ever read. The seed scripts had the
 * opposite failure and threw `NoAccountContextError`, which at least said so.
 *
 * One helper rather than five copies, and it reads the control plane through the app's own
 * `controlDb()` rather than raw SQL, so the account lookup cannot drift from the schema it queries.
 *
 * Two ways to use it, because the scripts genuinely differ. `runForAccount` establishes the async
 * context that Drizzle's `db` resolves through, for anything using the app's own query layer.
 * `clientForAccount` hands back a raw libsql client, for the scripts that deliberately write SQL
 * by hand against tables the schema does not model conveniently.
 */
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { controlDb, accounts, type Account } from "../src/lib/db/control";
import { urlForRef, withAccount } from "../src/lib/db";
import { normalizeEmail } from "../src/lib/auth/passwords";

/**
 * The account named on the command line.
 *
 * Exits rather than throwing, and says which of the three things went wrong: no email given, no
 * such account, or an account whose signup never finished. A script that guessed an account would
 * be the worst possible behaviour here, so there is no default and no "first account" fallback.
 */
export async function accountFromArgv(usage: string): Promise<Account> {
  const email = process.argv.slice(2).find((a) => a.includes("@"));
  if (!email) {
    console.error(`Which account? Pass an email.\n  ${usage}`);
    process.exit(2);
  }

  const rows = await controlDb().select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).limit(1);
  const account = rows[0];
  if (!account) {
    console.error(`No account for ${email}. Sign up first, or check the address.`);
    process.exit(2);
  }
  if (!account.provisionedAt) {
    console.error(`${email} has no database yet, so its signup did not finish. Retry the signup.`);
    process.exit(2);
  }
  return account;
}

/** Run `fn` with that account's database as the ambient one, for anything using Drizzle's `db`. */
export async function runForAccount<T>(usage: string, fn: (account: Account) => Promise<T>): Promise<T> {
  const account = await accountFromArgv(usage);
  console.log(`Account: ${account.email} (${account.dbRef})`);
  return withAccount({ accountId: account.id, dbRef: account.dbRef }, () => fn(account));
}

/**
 * A raw libsql client for one account's database.
 *
 * The caller closes it. On Windows an open SQLite handle blocks deleting the file, which is how a
 * script that leaves one behind turns into a confusing failure somewhere else entirely.
 */
export function clientForAccount(account: Account): Client {
  return createClient({ url: urlForRef(account.dbRef), authToken: process.env.ACCOUNT_DATABASE_AUTH_TOKEN });
}

/** Resolve the account and hand back a raw client, for the hand-written-SQL scripts. */
export async function clientFromArgv(usage: string): Promise<{ account: Account; client: Client }> {
  const account = await accountFromArgv(usage);
  console.log(`Account: ${account.email} (${account.dbRef})`);
  return { account, client: clientForAccount(account) };
}
