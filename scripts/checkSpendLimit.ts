/**
 * Proves the spend limiter blocks against a real account database, not just in unit tests.
 *
 * Fills the window with audit rows, asks the limiter, then clears them again. No model is called
 * and no money is spent: the limiter counts the audit log, so the audit log is what gets set up.
 *
 * Two things were wrong with the version this replaces, and they compounded.
 *
 * It opened `data/steady.db`, which since the database split is only the pre-migration backup, so
 * it exercised a table the app never reads and reported PASS on every assertion.
 *
 * And it restated the caps in its own prose and assertions: "the cap is 10 an hour", written when
 * that was true. Caps are per plan now and none of those numbers survived. So every figure here is
 * read from `windowsFor(plan, feature)`, the same source the limiter itself uses, which means this
 * script cannot disagree with the thing it is checking.
 *
 *   npm run check:limit -- you@example.com
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { accountFromArgv, clientForAccount } from "./_account";
import { windowsFor } from "../src/lib/ai/limits";
import { withAccount } from "../src/lib/db";
import { checkSpendLimit } from "../src/lib/data/aiAudit";

const USAGE = "npm run check:limit -- you@example.com";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");

/** Marks every row this script writes, so cleanup removes exactly its own and nothing else. */
const MARK = "spend-limit-check";

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function main() {
  const account = await accountFromArgv(USAGE);
  const plan = account.plan;
  const client = clientForAccount(account);
  const now = Math.floor(Date.now() / 1000);

  const insert = (feature: string, secondsAgo: number) =>
    client.execute({
      sql:
        "insert into ai_audit (id,at,conversation_id,message_id,mode,feature,user_question,data_accessed,knowledge_used,safety_rules,triage_level,responder,model,filtered)" +
        " values (?,?,null,null,'talk',?,?,'[]','[]','[]','general','model','test',0)",
      args: [newId(), now - secondsAgo, feature, MARK],
    });

  const countIn = async (feature: string, seconds: number) => {
    const r = await client.execute({
      sql: "select count(*) n from ai_audit where feature = ? and responder = 'model' and at > ?",
      args: [feature, now - seconds],
    });
    return Number(r.rows[0].n);
  };

  const clean = () => client.execute({ sql: "delete from ai_audit where user_question = ?", args: [MARK] });

  try {
    console.log(`Account: ${account.email} (${account.dbRef}), plan ${plan}\n`);

    /**
     * The tightest window on this plan is the one to test, because it is the one that blocks first.
     * On free that is a month; on plus it is an hour. Picking it from the table rather than naming
     * it is what keeps this script true as the plans change.
     */
    const windows = windowsFor(plan, "photo");
    const tightest = windows.reduce((a, b) => (a.ms <= b.ms ? a : b));
    const seconds = Math.floor(tightest.ms / 1000);
    console.log(`photo on ${plan}: ${windows.map((w) => `${w.max} a ${w.label}`).join(", ")}`);
    console.log(`testing the ${tightest.label} window, cap ${tightest.max}\n`);

    if (tightest.max === 0) {
      // A plan with no allowance at all is a real state and needs no rows to prove it.
      const verdict = await withAccount({ accountId: account.id, dbRef: account.dbRef }, () => checkSpendLimit("photo"));
      check(!verdict.allowed, "a zero allowance refuses with no usage at all");
      check(verdict.resetsAt === null, "and offers no reset time, because waiting cannot help");
      check(/not part of your plan/i.test(verdict.message), "and says the plan is the reason");
      await clean();
      console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
      process.exit(failures === 0 ? 0 : 1);
    }

    await clean();
    const before = await countIn("photo", seconds);
    console.log(`photo calls already inside the ${tightest.label} window: ${before}`);

    // One under the cap must still be allowed.
    const toWrite = Math.max(0, tightest.max - 1 - before);
    for (let i = 0; i < toWrite; i++) await insert("photo", 60 * (i + 1));
    const atJustUnder = await countIn("photo", seconds);
    check(atJustUnder === tightest.max - 1, `${tightest.max - 1} photo calls are on record for the ${tightest.label}`);

    const allowed = await withAccount({ accountId: account.id, dbRef: account.dbRef }, () => checkSpendLimit("photo"));
    check(allowed.allowed, `one under the cap is still allowed (used ${allowed.used} of ${allowed.max})`);

    // The one that reaches the cap must block.
    await insert("photo", 30);
    check((await countIn("photo", seconds)) === tightest.max, `${tightest.max} photo calls are on record`);
    const blocked = await withAccount({ accountId: account.id, dbRef: account.dbRef }, () => checkSpendLimit("photo"));
    check(!blocked.allowed, `at the cap the limiter refuses (used ${blocked.used} of ${blocked.max})`);
    check(blocked.message.length > 0, "and gives the person a sentence explaining it");

    /**
     * A burst older than the window must not count toward it. This is the assertion that catches a
     * limiter comparing against the wrong end of its window, which would refuse somebody over
     * usage from last week.
     */
    const OLD = 20;
    for (let i = 0; i < OLD; i++) await insert("photo", seconds + 120 * (i + 1));
    check((await countIn("photo", seconds)) === tightest.max, `a burst older than the ${tightest.label} does not count toward it`);

    // Features are independent, so one cannot exhaust another's allowance.
    check((await countIn("copilot", seconds)) === 0, "the Copilot allowance is untouched by photo usage");
    const copilot = await withAccount({ accountId: account.id, dbRef: account.dbRef }, () => checkSpendLimit("copilot"));
    check(copilot.allowed, "and the Copilot is still allowed while photo is blocked");

    await clean();
    console.log(`\ncleaned up. photo calls on record now: ${await countIn("photo", seconds)}`);
    console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    // Cleanup runs even on a throw, so a failed run does not leave rows counting against a person.
    await clean().catch(() => {});
    try {
      client.close();
    } catch {
      /* a handle that will not close is not worth failing over */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
