import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Rules the type system cannot express, checked by reading the source.
 *
 * Each of these is a property that was broken once, or that would break silently if it were. A grep
 * is a crude tool and it is the right one here: it catches the case where somebody adds an import
 * back in six months, which is exactly when nobody is thinking about it.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full.replace(/\\/g, "/"));
    }
  }
  return out;
}

const APP = walk("src/app");
const LIB = walk("src/lib");
const ALL = [...APP, ...LIB, ...walk("src/components")];

const read = (f: string) => readFileSync(f, "utf8");

/* -------------------------- the account boundary -------------------------- */

test("no screen imports the control plane directly", () => {
  // Accounts, sessions and billing are not application data. A screen that reads them can see every
  // account's email, and the point of splitting the databases was that a screen cannot.
  const allowed = ["src/app/signin/page.tsx", "src/app/signup/page.tsx"];
  const offenders = APP.filter(
    (f) => !allowed.includes(f) && /from "@\/lib\/db\/control"|from "\.\.\/db\/control"/.test(read(f)),
  );
  assert.deepEqual(offenders, [], "these must go through src/lib/auth instead");
});

test("every page and server action establishes an account context", () => {
  /**
   * `db` throws without a context, so a page that forgets fails loudly rather than reading the
   * wrong account. That is the safety net. This test is the thing that stops anybody relying on it,
   * because a loud failure is still a broken screen.
   */
  const missing: string[] = [];
  for (const f of APP) {
    const src = read(f);
    if (src.startsWith('"use client"') || src.startsWith("'use client'")) continue;
    /**
     * Importing a constant or a type from the db barrel is not touching the database. What matters
     * is whether the file actually issues a query, or calls something that does, so judge by use.
     */
    const queries = /\bdb\s*\.\s*(select|insert|update|delete|transaction|run)\b/.test(src);
    const callsDataLayer = /from "@\/lib\/data\//.test(src);
    if (!queries && !callsDataLayer) continue;

    const isPublic = f.includes("/signin/") || f.includes("/signup/");
    if (isPublic) continue;

    /**
     * Helpers that are deliberately bare, because they are called only from an already-established
     * context. Leaving them unwrapped keeps it visible whether the CALLER established one, which is
     * the property worth preserving; wrapping them would hide a missing wrapper upstream.
     */
    const SHARED_HELPERS = ["src/app/toolkit/appointments/brief.ts"];
    if (SHARED_HELPERS.includes(f)) continue;

    const establishes = /requireAccount|asAccount/.test(src);
    if (!establishes) missing.push(f);
  }
  assert.deepEqual(missing, [], "these reach the database with no account context established");
});

test("the share page and the coach route resolve an account from a token", () => {
  // Both are reachable without a session, so neither can use requireAccount. They must resolve the
  // token in the control plane and then scope everything to the account it names.
  for (const f of ["src/app/share/[token]/page.tsx", "src/app/api/coach/[kind]/route.ts"]) {
    const src = read(f);
    assert.match(src, /resolveToken\(/, `${f} must resolve its token`);
    assert.match(src, /asAccount\(/, `${f} must scope its work to the resolved account`);
  }
});

test("nothing reads a raw token out of the account database to authenticate", () => {
  // The old share page looked up `caregivers.token`, which cannot identify an account any more and
  // would silently read whichever database happened to be in context.
  const offenders = ALL.filter((f) => /caregivers\.token|eq\(caregivers\.token/.test(read(f)));
  assert.deepEqual(offenders, [], "authenticate through src/lib/auth/tokens instead");
});

/* ---------------------------- the safety rules ---------------------------- */

test("the dose filter is the only thing that rewrites model output", () => {
  // Every path that hands model prose to a person must pass it through the filter. A new one that
  // forgets is how the never-suggests-a-dose invariant quietly stops being true.
  const modelCallers = LIB.filter((f) => /messages\.create\(/.test(read(f)));
  assert.ok(modelCallers.length >= 3, `expected at least 3 model call sites, found ${modelCallers.length}`);
  const unfiltered = modelCallers.filter((f) => !/filterDoseLanguage/.test(read(f)));
  assert.deepEqual(unfiltered, [], "these call a model and never run its output through the dose filter");
});

test("every paid feature writes an audit row somewhere", async () => {
  /**
   * Asserted per feature rather than per file, because the module that calls the model is not
   * always the one that writes the row. The Copilot's audit is written by `data/copilotTurn.ts`,
   * which knows the conversation and message ids that the `ai/` module does not. What invariant 8
   * requires is that no FEATURE is unaudited, not that every file audits itself.
   */
  const { AI_FEATURES } = await import("../src/lib/db/schema");
  const writers = LIB.filter((f) => /recordAiUse\(|insert\(aiAudit\)/.test(read(f)));
  assert.ok(writers.length > 0, "nothing writes an audit row at all");

  // The literal, not `feature: "x"`, because one call site picks the value with a ternary:
  // a reply to a coach message is metered as coach rather than as an ordinary Copilot turn.
  const combined = writers.map(read).join("\n");
  const missing = AI_FEATURES.filter((feature) => !combined.includes(`"${feature}"`));
  assert.deepEqual(missing, [], "these features call a model and leave no audit row");
});

test("every model call site is metered", () => {
  const modelCallers = LIB.filter((f) => /messages\.create\(/.test(read(f)));
  const unmetered = modelCallers.filter((f) => !/checkSpendLimit/.test(read(f)));
  assert.deepEqual(unmetered, [], "an unmetered paid endpoint is somebody else's budget");
});

test("no function anywhere returns an insulin dose", () => {
  /**
   * Invariant 2, checked structurally rather than by reading comments. A function whose name says
   * it computes units is the shape this codebase must never grow.
   */
  const banned = /function\s+(calculate|compute|suggest|recommend|advise)\w*(Dose|Units|Bolus|Insulin|Correction)\b/i;
  const offenders = ALL.filter((f) => banned.test(read(f)));
  assert.deepEqual(offenders, [], "this app records doses and never produces one");
});

/* ------------------------------- house rules ------------------------------- */

test("no em-dash in anything a person reads", () => {
  const offenders: string[] = [];
  for (const f of ALL) {
    const lines = read(f).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("—")) continue;
      // Comments are for developers and may use whatever punctuation reads best.
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
      /**
       * The bare glyph on its own is the placeholder for a value that does not exist yet, and that
       * is a design decision: blank space reads as a bug and a zero would be a lie. What the house
       * rule forbids is an em-dash joining two clauses in a sentence somebody reads.
       */
      const withoutPlaceholders = line
        .replace(/>\s*—\s*</g, "><")
        .replace(/"—"/g, '""')
        .replace(/'—'/g, "''")
        .replace(/`—`/g, "``")
        // A regex that strips em-dashes is not an em-dash in prose.
        .replace(/\/[^/\n]*—[^/\n]*\/[gimsuy]*/g, "/RE/");
      if (!withoutPlaceholders.includes("—")) continue;
      offenders.push(`${f}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [], "the house style has no em-dashes in user-facing copy");
});

test("the generated account schema is in step with the Drizzle schema", async () => {
  // A table added without running `npm run schema:build` gives every NEW account a database missing
  // it, while existing accounts are fine, which is a confusing way to find out.
  const { ACCOUNT_SCHEMA_TABLES } = await import("../src/lib/db/accountSchema");
  const schema = await import("../src/lib/db/schema");
  const count = Object.values(schema).filter(
    (v) => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in (v as object),
  ).length;
  assert.equal(ACCOUNT_SCHEMA_TABLES, count, "run: npm run schema:build");
});

test("the control schema statements cover the control tables", async () => {
  const { CONTROL_SCHEMA_SQL, CONTROL_SCHEMA_TABLES } = await import("../src/lib/db/controlSchema");
  for (const table of CONTROL_SCHEMA_TABLES) {
    assert.ok(
      CONTROL_SCHEMA_SQL.some((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${table}`)),
      `${table} has no create statement`,
    );
  }
  // Every statement has to be safe to re-run, because this list is both installer and migration.
  for (const s of CONTROL_SCHEMA_SQL) {
    assert.match(s, /IF NOT EXISTS/, `not idempotent: ${s.slice(0, 60)}`);
  }
});

test("no client component imports a server-side data or auth module", () => {
  /**
   * This is what replaces the `server-only` import in the few modules that had to drop it so plain
   * Node tests could reach them. `server-only` fails the build when a client component pulls a
   * server module in; this fails the suite for the same mistake, and it covers every file in
   * `lib/data`, `lib/auth` and `lib/db` rather than only the ones that remembered the import.
   *
   * The stakes are not abstract. A client component that imports the audit module ships the
   * database code, the control-plane connection string handling and the account resolution into
   * the browser bundle.
   */
  const SERVER_ONLY = /from "(?:@\/lib|\.{1,2}(?:\/\.\.)*)\/(?:data|auth|db|billing)\//;
  const offenders: string[] = [];
  for (const f of ALL) {
    const src = read(f);
    if (!/^(?:"use client"|'use client')/.test(src)) continue;
    if (SERVER_ONLY.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], "these are client components reaching into server-only modules");
});

test("only the webhook and the checkout helpers can change an account's plan", () => {
  /**
   * `accounts.plan` is what every entitlement check reads, so the set of things that can write it
   * has to stay small enough to hold in your head. A second writer is how somebody ends up on a
   * paid plan without a payment, and it would not look like a bug in review: it would look like a
   * helpful admin shortcut.
   *
   * Matched on the Drizzle shape rather than the column name, because that is what a write is.
   */
  const writesPlan = /update\(accounts\)[\s\S]{0,200}?\bplan\s*:/;
  const allowed = ["src/lib/billing/apply.ts"];
  const offenders = ALL.filter((f) => !allowed.includes(f) && writesPlan.test(read(f)));
  assert.deepEqual(offenders, [], "a plan must only be granted by the billing layer");
});

test("the webhook verifies a signature before it reads the body", () => {
  /**
   * The security boundary of the whole billing stage, asserted structurally as well as behaviourally
   * (`tests/webhook.test.ts` drives the real handler). What this catches is somebody "simplifying"
   * the route later: without `constructEvent`, the body is an unauthenticated claim about who has
   * paid, and anybody who knows the URL can upgrade any account.
   */
  const src = read("src/app/api/stripe/webhook/route.ts");
  assert.match(src, /constructEvent\(/, "the webhook must verify the Stripe signature");
  assert.match(src, /await req\.text\(\)/, "it must read the raw body, because a reparse breaks the signature");
  assert.doesNotMatch(src, /await req\.json\(\)/, "parsing the body as JSON discards the bytes the signature covers");

  /**
   * The signature check has to come before anything that could act on the contents. Matched on the
   * CALL and not the name: the first version of this looked for `applySubscription`, found it in the
   * import list at the top of the file, and failed a route that was correct.
   */
  const verifyAt = src.indexOf("constructEvent(");
  const applyAt = src.indexOf("applySubscription(");
  assert.ok(verifyAt > 0, "no signature verification found at all");
  assert.ok(applyAt > verifyAt, "the event is applied before its signature is verified");
});

test("every route that cannot sign in is public in the gate", async () => {
  /**
   * The bug this exists for cost nothing to make and would have cost real money.
   *
   * `/api/stripe/webhook` was not in the gate's allowlist, so every Stripe delivery got a 307 to the
   * sign-in page. Stripe reads a 307 as a delivered response, so the events were simply dropped:
   * subscribers would have paid and never been upgraded, and nothing in the app's own logs would
   * have said so. Every unit test passed throughout, because they call the route handler directly
   * and never pass through the gate. Only a real HTTP request showed it.
   *
   * The rule: a route with no `requireAccount` has no session by design, and a caller with no
   * session cannot get past the gate, so the two facts have to agree.
   */
  const { PUBLIC_PREFIXES } = await import("../src/proxy");

  const routes = APP.filter((f) => /\/api\/.*\/route\.ts$/.test(f) || /\/api\/route\.ts$/.test(f));
  assert.ok(routes.length > 0, "no API routes were found, so this test is checking nothing");

  const mismatched: string[] = [];
  for (const f of routes) {
    const src = read(f);
    // A route that establishes a session-based account is meant to be behind the gate.
    if (/requireAccount/.test(src)) continue;

    // "src/app/api/stripe/webhook/route.ts" becomes "/api/stripe/webhook".
    const urlPath = f.replace(/^src\/app/, "").replace(/\/route\.ts$/, "");
    const covered = PUBLIC_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(p));
    if (!covered) mismatched.push(`${urlPath} (from ${f})`);
  }
  assert.deepEqual(mismatched, [], "these routes authenticate their own callers but the gate redirects them to sign-in");
});
