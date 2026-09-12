/**
 * Print the control plane's accounts, and check a password against one of them.
 *
 * A read-only look at who exists and whether a given password actually signs in. Written for
 * confirming a deployment after the demo account was renamed, where the thing worth proving is
 * that there is ONE account with the old database still attached rather than two.
 *
 * Usage: tsx scripts/checkAccounts.ts [email] [password]
 */
import { createClient } from "@libsql/client";
import { verifyPassword } from "../src/lib/auth/passwords";

const url = process.env.CONTROL_DATABASE_URL ?? "file:./data/control.db";
const [email, password] = process.argv.slice(2);

const c = createClient({ url });
const rows = (await c.execute("select id, email, db_ref, plan, status, created_at from accounts")).rows;
console.log(`accounts in ${url}: ${rows.length}`);
for (const r of rows) console.log(`  ${r.email}  db=${r.db_ref}  status=${r.status}`);

if (email) {
  const row = rows.find((r) => String(r.email) === email.trim().toLowerCase());
  console.log(`lookup ${email}: ${row ? "found" : "NOT FOUND"}`);
  if (row && password) {
    const hash = (await c.execute({ sql: "select password_hash from accounts where id = ?", args: [row.id] })).rows[0];
    console.log(`password valid: ${await verifyPassword(password, String(hash.password_hash))}`);
    const s = (await c.execute({ sql: "select count(*) as n from sessions where account_id = ?", args: [row.id] })).rows[0];
    console.log(`live sessions: ${s.n}`);
  }
}
