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
import { eq } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { controlDb, accounts, type Account } from "../db/control";
import { urlForRef, handleFor } from "../db";
import { newId } from "../ids";
import { hashPassword, normalizeEmail } from "./passwords";
import { ACCOUNT_SCHEMA_SQL } from "../db/accountSchema";
import { seedAccountReference } from "../data/seedAccount";

export type SignupResult = { ok: true; account: Account } | { ok: false; error: string };

/**
 * Apply the schema to a fresh account database.
 *
 * The statements come from `accountSchema.ts`, generated from the Drizzle schema, because
 * `drizzle-kit push` is a CLI that reads a config file and cannot be called per account at signup.
 * Every statement is `if not exists`, so running this against an existing database is a no-op and
 * the same function doubles as the migration path when a column is added.
 */
export async function applyAccountSchema(dbRef: string): Promise<void> {
  const url = urlForRef(dbRef);
  if (url.startsWith("file:")) {
    // libsql will not create the directory for you, and a missing one reads as "unable to open".
    await mkdir("./data/accounts", { recursive: true }).catch(() => {});
  }
  const client = createClient({ url, authToken: process.env.ACCOUNT_DATABASE_AUTH_TOKEN });
  for (const statement of ACCOUNT_SCHEMA_SQL) {
    await client.execute(statement);
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
