/**
 * NOTE: no `server-only` import here on purpose. The migration and seeding scripts import this
 * module from plain Node, and `server-only` throws outside Next's bundler. The boundary it was
 * guarding, that a screen must never import the control plane directly, is asserted by
 * `tests/boundaries.test.ts` instead, which is a check that also catches the case where somebody
 * adds the import back.
 */
/**
 * Creating an account and its database.
 *
 * The order matters and is deliberate: the database is created, migrated, seeded and only THEN is
 * the account marked provisioned. `optionalAccount()` refuses a session whose account has no
 * `provisionedAt`, so a signup that dies halfway leaves an account that cannot sign in rather than
 * one that signs in to a database with no tables. Retrying the signup finishes the job.
 */
import { mkdir } from "node:fs/promises";
import { and, eq, gt, sql } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { controlDb, accounts, signinAttempts, type Account } from "../db/control";
import { urlForRef, handleFor, ACCOUNTS_DIR } from "../db";
import { newId } from "../ids";
import { hashPassword, normalizeEmail } from "./passwords";
import { ACCOUNT_SCHEMA_SQL } from "../db/accountSchema";
import { seedAccountReference } from "../data/seedAccount";

export type SignupResult = { ok: true; account: Account } | { ok: false; error: string };

/** `ALTER TABLE <t> ADD <c> ...`, pulled apart so the column can be checked before it is added. */
const ADD_COLUMN = /^\s*ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/i;

/**
 * Apply the schema to an account database, new or existing.
 *
 * The statements come from `accountSchema.ts`, generated from the Drizzle schema, because
 * `drizzle-kit push` is a CLI that reads a config file and cannot be called per account at signup.
 *
 * EVERY STATEMENT HAS TO BE SAFE TO RE-RUN, because this is both the installer and the migration
 * and `bootstrapDeploy` calls it on every single boot. The creates are all `if not exists` and take
 * care of themselves. A column ADDED to a table that already exists is the exception: SQLite has no
 * `add column if not exists`, so the second run fails with "duplicate column name".
 *
 * That is not hypothetical. Adding `foods.source_date` broke it immediately: the first migration
 * succeeded, the second failed for every account, and because the deployment logs a failed
 * migration and carries on, the live app would have booted with a broken migration step forever and
 * no later column would ever have landed.
 *
 * So an ADD COLUMN is checked against `PRAGMA table_info` first. Precise on purpose: catching the
 * error instead would also swallow a genuinely malformed statement, and a schema step that hides
 * its own failures is how a table quietly goes missing.
 */
export async function applyAccountSchema(dbRef: string): Promise<void> {
  const url = urlForRef(dbRef);
  if (url.startsWith("file:")) {
    // libsql will not create the directory for you, and a missing one reads as "unable to open".
    await mkdir(ACCOUNTS_DIR, { recursive: true }).catch(() => {});
  }
  const client = createClient({ url, authToken: process.env.ACCOUNT_DATABASE_AUTH_TOKEN });

  /** Columns a table already has, so an ADD can be skipped rather than attempted. */
  const columnsOf = async (table: string): Promise<Set<string>> => {
    try {
      const info = await client.execute(`PRAGMA table_info(\`${table}\`)`);
      return new Set(info.rows.map((r) => String(r.name)));
    } catch {
      // No such table yet. The CREATE earlier in the list will make it with the column included.
      return new Set();
    }
  };

  try {
    for (const statement of ACCOUNT_SCHEMA_SQL) {
      const add = ADD_COLUMN.exec(statement);
      if (add) {
        const [, table, column] = add;
        if ((await columnsOf(table)).has(column)) continue;
      }
      await client.execute(statement);
    }
  } finally {
    /**
     * Closed, which it was not before.
     *
     * This opens its own connection rather than using the cached handle, and left it open. One
     * leaked handle per account is invisible at signup and is a migration over a thousand accounts
     * opening a thousand connections and releasing none. On Windows it also blocks deleting the
     * file, which showed up as an occasional unexplained test failure with no assertion attached.
     */
    try {
      client.close();
    } catch {
      /* a handle that will not close is not a reason to fail a migration that succeeded */
    }
  }
}

/** Bring every existing account's database up to the current schema. Idempotent. */
export async function migrateAllAccounts(): Promise<{ migrated: number; failed: string[] }> {
  const rows = await controlDb().select().from(accounts);
  const failed: string[] = [];
  let migrated = 0;
  for (const a of rows) {
    try {
      await applyAccountSchema(a.dbRef);
      migrated++;
    } catch (err) {
      failed.push(`${a.email}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  return { migrated, failed };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function signUp(emailRaw: string, password: string): Promise<SignupResult> {
  const email = normalizeEmail(emailRaw);
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That does not look like an email address." };
  if (email.length > 200) return { ok: false, error: "That email address is too long." };
  if (password.length < 10) return { ok: false, error: "Use at least 10 characters. A short phrase is easier to remember and harder to guess than a short password." };
  if (password.length > 200) return { ok: false, error: "That password is longer than it needs to be." };

  const existing = await controlDb().select({ id: accounts.id, provisionedAt: accounts.provisionedAt }).from(accounts).where(eq(accounts.email, email)).limit(1);
  if (existing[0]?.provisionedAt) {
    return { ok: false, error: "There is already an account with that email. Try signing in instead." };
  }

  const id = existing[0]?.id ?? newId(18);
  const dbRef = existing[0] ? `acct-${id}` : `acct-${id}`;
  const now = new Date();
  const passwordHash = await hashPassword(password);

  if (!existing[0]) {
    await controlDb().insert(accounts).values({
      id,
      email,
      passwordHash,
      dbRef,
      plan: "free",
      status: "active",
      provisionedAt: null,
      createdAt: now,
      lastSeenAt: null,
    });
  } else {
    // A previous attempt got this far and then failed. Take the new password and finish the job.
    await controlDb().update(accounts).set({ passwordHash, dbRef }).where(eq(accounts.id, id));
  }

  try {
    await applyAccountSchema(dbRef);
    await seedAccountReference(handleFor(dbRef), now);
  } catch (err) {
    return {
      ok: false,
      error: `The account was created but its database could not be set up (${err instanceof Error ? err.message.slice(0, 120) : "unknown error"}). Try signing up again with the same email and it will finish.`,
    };
  }

  await controlDb().update(accounts).set({ provisionedAt: new Date() }).where(eq(accounts.id, id));
  const account = (await controlDb().select().from(accounts).where(eq(accounts.id, id)).limit(1))[0];
  return { ok: true, account };
}

export async function changePassword(accountId: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (password.length < 10) return { ok: false, error: "Use at least 10 characters." };
  await controlDb().update(accounts).set({ passwordHash: await hashPassword(password) }).where(eq(accounts.id, accountId));
  return { ok: true };
}

/* ---------------------------- how many accounts, how fast ---------------------------- */

/**
 * Signups allowed from one address in a day.
 *
 * Sign-IN was rate limited and signup was not, on a public URL where anybody can reach the form.
 * That mattered because the AI spend caps are PER ACCOUNT: they do their job perfectly and are the
 * wrong shape for this, since total spend is unbounded in the number of accounts. A script creating
 * accounts spends the free tier once per account, and nothing stopped it.
 *
 * Six, because a household sharing a connection is real and a person setting one up for a parent
 * is real, while a hundred from one address in an afternoon is not.
 */
const MAX_SIGNUPS_PER_IP = 6;
const SIGNUP_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Counted from `signin_attempts` rather than a new table, using a reserved email marker.
 *
 * The alternative was another table for one counter. This reuses the row shape that already exists,
 * already has an index on `at` and `ip`, and is already pruned by whatever prunes that table. The
 * marker is not a valid email, so it cannot collide with a real sign-in attempt.
 */
const SIGNUP_MARKER = "signup@local";

export async function tooManySignups(ip: string | null): Promise<boolean> {
  // No address to attribute it to. Counting nothing would be a hole, so this fails CLOSED on the
  // only thing it can: an unattributable signup is allowed, because refusing every visitor behind
  // a proxy that strips the header would break the product for them entirely.
  if (!ip) return false;
  try {
    const since = new Date(Date.now() - SIGNUP_WINDOW_MS);
    const rows = await controlDb()
      .select({ n: sql<number>`count(*)` })
      .from(signinAttempts)
      .where(and(eq(signinAttempts.email, SIGNUP_MARKER), eq(signinAttempts.ip, ip), gt(signinAttempts.at, since)));
    return Number(rows[0]?.n ?? 0) >= MAX_SIGNUPS_PER_IP;
  } catch {
    /**
     * Fails OPEN, deliberately, and it is the right way round here. If the control database cannot
     * be read then signup is about to fail anyway, and the cost of wrongly refusing somebody their
     * first account is higher than the cost of one extra account getting through.
     */
    return false;
  }
}

/** Record a signup against an address, so the next one can be counted. */
export async function recordSignup(ip: string | null): Promise<void> {
  try {
    await controlDb().insert(signinAttempts).values({ id: newId(), at: new Date(), email: SIGNUP_MARKER, ip, ok: true });
  } catch {
    /* never block a signup on its own audit write */
  }
}
