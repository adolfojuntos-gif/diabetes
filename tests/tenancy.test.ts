import { test } from "node:test";
import assert from "node:assert/strict";
import { rm, mkdir } from "node:fs/promises";
/**
 * FIRST, before anything reaches `db/control`. The spend limiter now resolves an account's plan
 * from the control plane, so these tests need control rows, and they must not be written to the
 * real control database. See the note in `_controlEnv.ts`.
 */
import { CONTROL_PATH } from "./_controlEnv";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { glucoseReadings, profile } from "../src/lib/db/schema";
import { withAccount, currentAccountId, db, handleFor, urlForRef, closeHandle, openHandleCount, NoAccountContextError } from "../src/lib/db";
import { ACCOUNT_SCHEMA_SQL, ACCOUNT_SCHEMA_TABLES } from "../src/lib/db/accountSchema";
import { hashPassword, verifyPassword, newSessionToken, hashToken, normalizeEmail } from "../src/lib/auth/passwords";
import { newId } from "../src/lib/ids";
import { windowsFor } from "../src/lib/ai/limits";
import { recordAiUse, checkSpendLimit } from "../src/lib/data/aiAudit";
import { controlDb, accounts } from "../src/lib/db/control";
import { CONTROL_SCHEMA_SQL } from "../src/lib/db/controlSchema";

/**
 * The isolation boundary, tested directly.
 *
 * The whole reason this app uses one database per account rather than an `accountId` column is that
 * correctness should not depend on 300 query sites remembering a predicate. These tests assert the
 * property that replaces it: with no account in context there is no database, and with account A in
 * context, account B's rows are not reachable because they are not in the file.
 */

const DIR = "./data/test-accounts";

async function makeAccountDb(ref: string) {
  await mkdir(DIR, { recursive: true });
  const url = `file:${DIR}/${ref}.db`;
  const client = createClient({ url });
  for (const s of ACCOUNT_SCHEMA_SQL) await client.execute(s);
  // The client is returned so the test can close it. Windows keeps an open SQLite file locked, and
  // deleting it while a handle is live fails with EBUSY, which looks like a test failure and is not.
  return { url, client, handle: drizzle(client, { schema }) };
}

/** Best effort: a leftover test file is harmless, a failed teardown masking a real result is not. */
async function cleanup(...clients: { close?: () => void }[]) {
  for (const c of clients) {
    try {
      c.close?.();
    } catch {
      /* ignore */
    }
  }
  await rm(DIR, { recursive: true, force: true }).catch(() => {});
}

test("the generated schema covers every table in the Drizzle schema", () => {
  // If someone adds a table and forgets `npm run schema:build`, new accounts get a database missing
  // it and the failure shows up as a confusing runtime error on one screen.
  const tablesInSchema = Object.values(schema).filter(
    (v) => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in (v as object),
  ).length;
  assert.equal(
    ACCOUNT_SCHEMA_TABLES,
    tablesInSchema,
    `accountSchema.ts has ${ACCOUNT_SCHEMA_TABLES} tables and the schema has ${tablesInSchema}. Run: npm run schema:build`,
  );
});

test("db throws with no account in context, rather than defaulting somewhere", () => {
  assert.equal(currentAccountId(), null);
  assert.throws(
    () => {
      // Touching any property has to resolve a handle, and there is nothing to resolve to.
      void db.select;
    },
    NoAccountContextError,
    "a handle that silently defaults is how data ends up in the wrong person's records",
  );
});

test("context is established and torn down by withAccount", () => {
  assert.equal(currentAccountId(), null);
  const inside = withAccount({ accountId: "acct-a", dbRef: "ref-a" }, () => currentAccountId());
  assert.equal(inside, "acct-a");
  assert.equal(currentAccountId(), null, "context must not leak out of the callback");
});

test("nested contexts do not bleed into each other", () => {
  const seen = withAccount({ accountId: "acct-a", dbRef: "ref-a" }, () => {
    const outer = currentAccountId();
    const inner = withAccount({ accountId: "acct-b", dbRef: "ref-b" }, () => currentAccountId());
    return { outer, inner, after: currentAccountId() };
  });
  assert.equal(seen.outer, "acct-a");
  assert.equal(seen.inner, "acct-b");
  assert.equal(seen.after, "acct-a", "the outer account must be restored");
});

test("two accounts cannot see each other's readings", async () => {
  await rm(DIR, { recursive: true, force: true });
  const a = await makeAccountDb("iso-a");
  const b = await makeAccountDb("iso-b");
  const now = new Date();

  await a.handle.insert(profile).values({ id: 1, name: "Ana", createdAt: now, updatedAt: now });
  await b.handle.insert(profile).values({ id: 1, name: "Ben", createdAt: now, updatedAt: now });

  await a.handle.insert(glucoseReadings).values({ id: newId(), at: now, valueMgdl: 111, source: "manual", createdAt: now });
  await b.handle.insert(glucoseReadings).values({ id: newId(), at: now, valueMgdl: 222, source: "manual", createdAt: now });

  const aRows = await a.handle.select().from(glucoseReadings);
  const bRows = await b.handle.select().from(glucoseReadings);

  // The query carries no predicate at all, which is the point.
  assert.deepEqual(aRows.map((r) => r.valueMgdl), [111]);
  assert.deepEqual(bRows.map((r) => r.valueMgdl), [222]);

  const aProfile = await a.handle.select().from(profile).where(eq(profile.id, 1));
  assert.equal(aProfile[0].name, "Ana", "profile id 1 now means the owner of this database");

  const bProfile = await b.handle.select().from(profile).where(eq(profile.id, 1));
  assert.equal(bProfile[0].name, "Ben", "the same primary key is a different person in each database");

  await cleanup(a.client, b.client);
});

test("a dbRef resolves to a distinct database per account", () => {
  const a = urlForRef("acct-aaa");
  const b = urlForRef("acct-bbb");
  assert.notEqual(a, b);
  assert.match(a, /acct-aaa/);
  // An explicit URL is passed through, so an account can be moved without changing its id.
  assert.equal(urlForRef("libsql://somewhere.turso.io"), "libsql://somewhere.turso.io");
  assert.equal(urlForRef("file:./data/custom.db"), "file:./data/custom.db");
});

test("handles are cached per account, not shared between them", () => {
  const a1 = handleFor("cache-a");
  const a2 = handleFor("cache-a");
  const b1 = handleFor("cache-b");
  assert.equal(a1, a2, "the same account reuses one handle");
  assert.notEqual(a1, b1, "different accounts must never share a handle");
});

/* --------------------------------- passwords --------------------------------- */

test("a password is stored as scrypt with a per-account salt, and verifies", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(hash.includes("correct horse"), false, "the password must not be recoverable from the hash");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);

  // Two accounts with the same password must not share a hash, or one crack reveals both.
  const other = await hashPassword("correct horse battery staple");
  assert.notEqual(hash, other, "the salt must be per account");
});

test("verifying against nonsense is false, never a throw", async () => {
  for (const stored of [null, undefined, "", "not-a-hash", "scrypt$x$y$z$a$b", "scrypt$16384$8$1$$"]) {
    assert.equal(await verifyPassword("anything", stored as string | null), false, `threw or passed on: ${stored}`);
  }
});

test("a session token is long, random, and stored only as a digest", () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.notEqual(a, b);
  // 32 random bytes in base64url is 43 characters, so roughly 256 bits.
  assert.ok(a.length >= 40, `token was only ${a.length} characters`);
  const digest = hashToken(a);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.includes(a), false, "the raw token must not be derivable from the stored value");
  assert.equal(hashToken(a), digest, "hashing is deterministic, so a lookup works");
});

test("email is normalised once, so the unique index and every lookup agree", () => {
  assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizeEmail("person@example.com"), "person@example.com");
});

/* ------------------------- the open handle ceiling ------------------------- */

test("the handle cache is bounded, so accounts cannot exhaust file descriptors", async () => {
  /**
   * The cache was unbounded to begin with. One SQLite connection per account, never closed, is
   * invisible at three accounts and a hard failure at a few thousand on one machine. This asserts
   * the eviction actually runs, because a cap that is only written in a comment is not a cap.
   */
  await mkdir("./data/test-accounts", { recursive: true });
  const before = openHandleCount();
  const cap = Number(process.env.MAX_OPEN_ACCOUNT_DBS ?? 256);

  /**
   * Full file: refs, so these land in the test directory. A bare ref resolves to ./data/accounts,
   * and an earlier version of this test wrote several hundred empty databases in among the real
   * ones. libsql creates the file when the client is constructed, not on first query, which is the
   * assumption that was wrong.
   */
  const refs: string[] = [];
  for (let i = 0; i < cap + 8 - before; i++) refs.push(`file:./data/test-accounts/bound-${i}.db`);
  for (const r of refs) handleFor(r);

  assert.ok(openHandleCount() <= cap, `cache grew to ${openHandleCount()}, past the cap of ${cap}`);

  // The most recent ref must still be live: eviction takes the coldest, never the one just handed
  // out, and getting that backwards would close a handle a request is about to use.
  const last = refs[refs.length - 1];
  assert.equal(handleFor(last), handleFor(last), "the newest handle was evicted");

  for (const r of refs) closeHandle(r);
});

test("touching a handle makes it the newest, so a busy account is not evicted", () => {
  const hot = `file:./data/test-accounts/hot-${newId(6)}.db`;
  const cap = Number(process.env.MAX_OPEN_ACCOUNT_DBS ?? 256);
  const first = handleFor(hot);

  for (let i = 0; i < cap + 4; i++) {
    handleFor(`file:./data/test-accounts/churn-${i}.db`);
    // Reading the hot account on every pass is what a busy account looks like. If recency is not
    // tracked on read, this is exactly the handle that gets closed underneath it.
    handleFor(hot);
  }

  assert.equal(handleFor(hot), first, "the continuously used handle was evicted and reconnected");

  closeHandle(hot);
  for (let i = 0; i < cap + 4; i++) closeHandle(`file:./data/test-accounts/churn-${i}.db`);
});

/* ---------------------- the spend limit is per account ---------------------- */

/**
 * A control-plane account, because the limiter reads the plan from there.
 *
 * Worth stating why this is not a shortcut: the plan deliberately does NOT live in the account's own
 * database. If it did, the database a person can export, import and edit would be the one that
 * decides what they are entitled to.
 */
async function makeControlAccount(id: string, dbRef: string, plan: "free" | "plus") {
  await controlDb().insert(accounts).values({
    id,
    email: `${id}@steady.test`,
    passwordHash: "x",
    dbRef,
    plan,
    status: "active",
    provisionedAt: new Date(),
    createdAt: new Date(),
    lastSeenAt: null,
  });
}

test("one account burning its AI allowance does not spend anybody else's", async () => {
  /**
   * The multi-tenancy plan claimed per-account spend limits came for free, because `ai_audit` lives
   * inside each account's own database and the limiter counts rows. Claimed is not shown. This is
   * the test that shows it, and the failure it guards against is the expensive one: a global
   * counter would let the first heavy user lock out everyone, and a global ALLOWANCE would let one
   * account spend the whole budget.
   */
  const controlClient = createClient({ url: `file:${CONTROL_PATH}` });
  for (const statement of CONTROL_SCHEMA_SQL) await controlClient.execute(statement);

  const a = await makeAccountDb(`spend-a-${newId(6)}`);
  const b = await makeAccountDb(`spend-b-${newId(6)}`);

  const idA = `spend-a-${newId(6)}`;
  const idB = `spend-b-${newId(6)}`;
  // Both on the paid plan, so the test is about ISOLATION and not about entitlement. The free
  // plan's own caps are covered in `tests/billing.test.ts`.
  await makeControlAccount(idA, a.url, "plus");
  await makeControlAccount(idB, b.url, "plus");

  const feature = "coach" as const;
  const cap = windowsFor("plus", feature).find((w) => w.label === "day")!.max;

  // Fill account A exactly to its cap. Only rows whose responder is "model" cost money, which is
  // why the limiter counts those and not every audit row.
  await withAccount({ accountId: idA, dbRef: a.url }, async () => {
    for (let i = 0; i < cap; i++) {
      await recordAiUse({
        mode: "checkin",
        feature,
        userQuestion: `call ${i}`,
        dataAccessed: [],
        triageLevel: "general",
        responder: "model",
        model: "test",
      });
    }
  });

  const aVerdict = await withAccount({ accountId: idA, dbRef: a.url }, () => checkSpendLimit(feature));
  const bVerdict = await withAccount({ accountId: idB, dbRef: b.url }, () => checkSpendLimit(feature));

  assert.equal(aVerdict.allowed, false, `account A used ${aVerdict.used} of ${aVerdict.max} and was still allowed`);
  assert.equal(aVerdict.used, cap);
  assert.equal(bVerdict.allowed, true, "account B was blocked by account A's usage, so the counter is shared");
  assert.equal(bVerdict.used, 0, `account B already showed ${bVerdict.used} calls it never made`);

  closeHandle(a.url);
  closeHandle(b.url);
  await cleanup(a.client, b.client, controlClient);
});

test("an account with no control row gets the free plan, never the paid one", async () => {
  /**
   * The fail-closed direction, and it is the one that costs money if it is wrong. An account the
   * control plane cannot answer for is not a reason to hand out the generous allowance.
   */
  const orphan = await makeAccountDb(`orphan-${newId(6)}`);
  const verdict = await withAccount({ accountId: `missing-${newId(6)}`, dbRef: orphan.url }, () =>
    checkSpendLimit("coach"),
  );
  assert.equal(verdict.allowed, false, "an unknown account was given a paid allowance");

  closeHandle(orphan.url);
  await cleanup(orphan.client);
});

test("the account schema can be applied twice, because the deployment applies it on every boot", async () => {
  /**
   * Adding `foods.source_date` broke this the moment it was generated. The first migration
   * succeeded and the second failed for every account with "duplicate column name", because SQLite
   * has no `add column if not exists`. The deployment logs a failed migration and carries on, so
   * the live app would have booted with a permanently broken migration step and no column added
   * after that one would ever have landed.
   *
   * Applied to a real file twice, because that is what a boot does.
   */
  await mkdir(DIR, { recursive: true });
  const ref = `file:${DIR}/reapply-${newId(6)}.db`;

  const { applyAccountSchema } = await import("../src/lib/auth/provision");
  await applyAccountSchema(ref);
  await applyAccountSchema(ref);

  // And the second pass has to have left the schema intact rather than merely not thrown.
  const client = createClient({ url: ref });
  try {
    const tables = await client.execute("select count(*) n from sqlite_master where type = 'table'");
    assert.ok(Number(tables.rows[0].n) >= ACCOUNT_SCHEMA_TABLES, "tables went missing on the second pass");

    const info = await client.execute("PRAGMA table_info(`foods`)");
    const columns = info.rows.map((r) => String(r.name));
    assert.ok(columns.includes("source_date"), "the added column is missing");
    assert.equal(columns.filter((c) => c === "source_date").length, 1, "the column was added twice");
  } finally {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
});
