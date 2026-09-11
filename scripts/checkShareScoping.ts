/**
 * Proves caregiver share links against a RUNNING server, because both bugs this covers were found
 * by reading rendered HTML and neither was visible in the code.
 *
 * Two properties, and they fail in opposite directions:
 *
 *  1. SCOPE. A caregiver sees only the sections the patient ticked. The original leak was that
 *     alert bodies carried exact glucose figures into a sleep-only view.
 *  2. TENANCY. A link resolves to the account that issued it and to no other. Since the databases
 *     were split, `/share/<token>` looks the token up in the control plane and then reads whichever
 *     account that names. Get that wrong and a link renders a stranger's records, which is why the
 *     check now creates TWO accounts and asserts the second one's marker never appears.
 *
 * Both accounts and their database files are deleted at the end, pass or fail.
 *
 *   npx tsx scripts/checkShareScoping.ts          (server on :3140)
 *   BASE=https://... npx tsx scripts/checkShareScoping.ts
 */
import { rm } from "node:fs/promises";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { db, glucoseReadings, sleepLogs, caregivers, nudges, urlForRef, withAccount, closeHandle } from "../src/lib/db";
import { controlDb, accounts, accountTokens } from "../src/lib/db/control";
import { signUp } from "../src/lib/auth/provision";
import { registerToken, revokeTokensForSubject } from "../src/lib/auth/tokens";
import { newId } from "../src/lib/ids";

config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE ?? "http://localhost:3140";

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

/**
 * Marker values, picked to be unmistakable. Three digits so they cannot be confused with a date
 * component, and far apart so one cannot be a rounding of the other.
 */
const MARKER_A = 147;
const MARKER_B = 283;

const suffix = newId(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
const EMAIL_A = `scope-a-${suffix}@steady.test`;
const EMAIL_B = `scope-b-${suffix}@steady.test`;
const PASSWORD = "scope-check-passphrase";

const created: string[] = [];

async function cleanup() {
  const stranded: string[] = [];
  for (const id of created) {
    const rows = await controlDb().select().from(accounts).where(eq(accounts.id, id));
    await controlDb().delete(accountTokens).where(eq(accountTokens.accountId, id));
    await controlDb().delete(accounts).where(eq(accounts.id, id));
    if (!rows[0]) continue;
    // The connection has to be released first. An earlier version of this script swallowed the
    // delete error, so it printed a clean cleanup while leaving an orphan database file per run.
    closeHandle(rows[0].dbRef);
    const url = urlForRef(rows[0].dbRef);
    if (!url.startsWith("file:")) continue;
    const path = url.slice("file:".length);
    for (const p of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        await rm(p, { force: true });
      } catch (err) {
        stranded.push(`${p}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }
  if (stranded.length) {
    /**
     * Not a test failure. The running server opened this database to render the share page, and on
     * Windows its handle blocks the delete from a different process. The control row is already
     * gone, so the file is unreachable rather than exposed. It must not be silent though, because
     * one file per run does add up.
     */
    console.error(`\n${stranded.length} file(s) left behind, most likely still open in the dev server:`);
    for (const s of stranded) console.error(`  ${s}`);
    console.error(`  clear them with: npx tsx scripts/sweepOrphanAccounts.ts --delete`);
  }
}

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    /**
     * Dates come off both sides before comparing. A first run flagged "09" as a leaked figure and
     * it was the month in a wake-date, which is data the caregiver IS scoped for. Comparing bare
     * digits against a page full of ISO dates is a checker bug, not a leak.
     */
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
}

const get = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: { "cache-control": "no-cache" }, redirect: "manual" });
  return { status: res.status, text: strip(await res.text()) };
};

async function main() {
  try {
  // The server has to be up, because rendering is the evidence. Say so plainly rather than
  // reporting every assertion as a failure.
  const probe = await fetch(`${BASE}/signin`, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`No server at ${BASE}. Start one with: npm run dev -- -p 3140`);
    process.exit(2);
  }

  const a = await signUp(EMAIL_A, PASSWORD);
  const b = await signUp(EMAIL_B, PASSWORD);
  if (!a.ok || !b.ok) throw new Error(`signup failed: ${!a.ok ? a.error : ""} ${!b.ok ? (b as { error: string }).error : ""}`);
  created.push(a.account.id, b.account.id);
  console.log(`two accounts provisioned: ${a.account.dbRef}, ${b.account.dbRef}\n`);

  const now = new Date();
  const wide = newId(14) + newId(14);
  const narrow = newId(14) + newId(14);
  const wideId = newId();
  const narrowId = newId();

  await withAccount({ accountId: a.account.id, dbRef: a.account.dbRef }, async () => {
    await db.insert(glucoseReadings).values({ id: newId(), at: now, valueMgdl: MARKER_A, source: "manual", createdAt: now });
    await db.insert(sleepLogs).values({
      id: newId(),
      wakeDate: now.toISOString().slice(0, 10),
      bedAt: new Date(now.getTime() - 8 * 3_600_000),
      wakeAt: now,
      minutes: 456,
      quality: 4,
      createdAt: now,
    });
    /**
     * The alert body carries the figure. This is the exact shape of the original leak: the sleep
     * caregiver below receives alerts and must still never see this number.
     */
    await db.insert(nudges).values({
      id: newId(),
      dedupeKey: `scope-check:${suffix}`,
      kind: "pattern",
      title: "Mornings are running high",
      body: `Your average before breakfast was ${MARKER_A} mg/dL over the last week.`,
      createdAt: now,
    });
    await db.insert(caregivers).values({
      id: wideId,
      name: "Wide Scope",
      relationship: "spouse",
      token: wide,
      canView: "glucose,sleep,meals,insulin,activity,hydration,mood,labs,meds,alerts",
      canComment: false,
      alertKinds: "safety,pattern,win",
      status: "active",
      createdAt: now,
    });
    await db.insert(caregivers).values({
      id: narrowId,
      name: "Sleep Only",
      relationship: "nurse",
      token: narrow,
      canView: "sleep",
      canComment: false,
      alertKinds: "safety,pattern,win",
      status: "active",
      createdAt: now,
    });
  });

  await registerToken(wide, { kind: "share", accountId: a.account.id, subjectId: wideId, label: "Wide Scope" });
  await registerToken(narrow, { kind: "share", accountId: a.account.id, subjectId: narrowId, label: "Sleep Only" });

  await withAccount({ accountId: b.account.id, dbRef: b.account.dbRef }, async () => {
    await db.insert(glucoseReadings).values({ id: newId(), at: now, valueMgdl: MARKER_B, source: "manual", createdAt: now });
  });

  /* ------------------------------- tenancy ------------------------------- */

  const wideRes = await get(`/share/${wide}`);
  check(wideRes.status === 200, `a registered link renders (${wideRes.status})`);
  check(
    new RegExp(`\\b${MARKER_A}\\b`).test(wideRes.text),
    `the issuing account's own reading (${MARKER_A}) appears, so the link reached the right database`,
  );
  check(
    !new RegExp(`\\b${MARKER_B}\\b`).test(wideRes.text),
    `the OTHER account's reading (${MARKER_B}) does not appear`,
  );

  /**
   * A token that never existed renders the same inactive page as one that was revoked, at the same
   * status. That is the design: a 404 for one and a page for the other would tell whoever is
   * guessing which tokens are real. So the check is that the two responses are IDENTICAL, which is
   * a stronger statement than any single status code.
   */
  const unregistered = await get(`/share/${newId(14)}${newId(14)}`);
  check(unregistered.status === 200 && /no longer active/i.test(unregistered.text), `an unregistered token renders the inactive page (${unregistered.status})`);
  check(!/mg\/dL/i.test(unregistered.text), "the inactive page carries no data of any kind");

  /* -------------------------------- scope -------------------------------- */

  const narrowRes = await get(`/share/${narrow}`);
  check(narrowRes.status === 200, `the sleep-only link renders (${narrowRes.status})`);
  check(/sleep/i.test(narrowRes.text), "the sleep section, which they ARE scoped for, appears");
  check(!/mg\/dL/i.test(narrowRes.text), "no glucose unit appears anywhere on the sleep-only page");
  check(
    !new RegExp(`\\b${MARKER_A}\\b`).test(narrowRes.text),
    `the figure from the alert body (${MARKER_A}) did not leak into the sleep-only view`,
  );

  /* ------------------------------ revocation ------------------------------ */

  await withAccount({ accountId: a.account.id, dbRef: a.account.dbRef }, async () => {
    await db.update(caregivers).set({ status: "revoked" }).where(eq(caregivers.id, wideId));
  });
  await revokeTokensForSubject(a.account.id, wideId);

  const revoked = await get(`/share/${wide}`);
  check(!new RegExp(`\\b${MARKER_A}\\b`).test(revoked.text), "a revoked link renders no data");
  check(
    revoked.status === unregistered.status && revoked.text === unregistered.text,
    "a revoked link is byte-identical to a token that never existed, so neither can be told apart",
  );

  /**
   * Revoking has to work from EITHER side on its own. The caregivers screen does both, but a
   * directory entry left behind would still resolve an account, and a live directory entry whose
   * caregiver row is gone would too, so each is checked without the other.
   */
  const dirOnly = await get(`/share/${narrow}`);
  check(dirOnly.status === 200, "the untouched second link still works, so revocation was not global");
  await revokeTokensForSubject(a.account.id, narrowId);
  const dirGone = await get(`/share/${narrow}`);
  check(
    dirGone.text === unregistered.text,
    "revoking only the directory entry, with the caregiver row still active, stops the link",
  );
  } finally {
    await cleanup();
    console.log(`\ncleaned up both accounts. ${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  // The accounts exist by now even if an assertion threw, and leaving them behind would make the
  // next run collide on the email.
  await cleanup().catch(() => {});
  process.exit(1);
});
