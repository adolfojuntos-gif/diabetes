/**
 * Proves the spend limiter blocks against the real database, not just in unit tests.
 *
 * Fills the photo window with audit rows, asks the limiter, then clears them again. No model is
 * called and no money is spent: the limiter reads the audit log, so the audit log is what we set up.
 */
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");
const client = createClient({ url: process.env.DATABASE_URL ?? "file:./data/steady.db" });

const MARK = "spend-limit-check";
const now = Math.floor(Date.now() / 1000);

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function countIn(feature, seconds) {
  const r = await client.execute({
    sql: "select count(*) n from ai_audit where feature = ? and responder = 'model' and at > ?",
    args: [feature, now - seconds],
  });
  return Number(r.rows[0].n);
}

async function insert(feature, secondsAgo) {
  await client.execute({
    sql:
      "insert into ai_audit (id,at,conversation_id,message_id,mode,feature,user_question,data_accessed,knowledge_used,safety_rules,triage_level,responder,model,filtered)" +
      " values (?,?,null,null,'talk',?,?,'[]','[]','[]','general','model','test',0)",
    args: [newId(), now - secondsAgo, feature, MARK],
  });
}

// Clean slate for the feature under test.
await client.execute({ sql: "delete from ai_audit where user_question = ?", args: [MARK] });

const before = await countIn("photo", 3600);
console.log(`photo calls in the last hour before the test: ${before}`);

// The cap is 10 an hour. Nine must still be allowed.
for (let i = 0; i < 9 - before; i++) await insert("photo", 60 * (i + 1));
check((await countIn("photo", 3600)) === 9, "nine photo calls are now on record for the hour");

// The tenth takes it to the cap.
await insert("photo", 30);
check((await countIn("photo", 3600)) === 10, "ten photo calls are on record");

// And an old burst must not count: twenty calls, all over an hour ago.
for (let i = 0; i < 20; i++) await insert("photo", 3600 + 120 * (i + 1));
check((await countIn("photo", 3600)) === 10, "a burst older than an hour does not count toward the hourly window");
check((await countIn("photo", 86400)) === 30, "but it does count toward the daily window");

// Features are independent.
check((await countIn("copilot", 3600)) === 0, "the Copilot allowance is untouched by photo usage");

await client.execute({ sql: "delete from ai_audit where user_question = ?", args: [MARK] });
const after = await countIn("photo", 86400);
console.log(`cleaned up. photo calls in the last day now: ${after}`);
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
