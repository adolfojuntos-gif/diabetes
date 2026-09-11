/**
 * Find account database files that no account row points at, and optionally delete them.
 *
 * Two things produce one. A signup that dies between creating the file and inserting the control
 * row leaves a database nobody owns, which is by design: `provision.ts` writes the file first so a
 * half-finished signup cannot sign in to a database with no tables. And deleting an account cannot
 * always remove the file on Windows, because an open handle in the running server blocks it.
 *
 * An orphan is unreachable rather than dangerous: with no control row there is no token, no session
 * and no way to name it, so nothing can read it. It is disk, and on a volume-mounted deployment
 * disk is the thing that runs out quietly.
 *
 *   npx tsx scripts/sweepOrphanAccounts.ts            list them
 *   npx tsx scripts/sweepOrphanAccounts.ts --delete   remove them
 */
import { readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";
import { controlDb, accounts } from "../src/lib/db/control";

config({ path: ".env.local", quiet: true });

const DIR = "./data/accounts";
const DELETE = process.argv.includes("--delete");

async function main() {
  const rows = await controlDb().select({ dbRef: accounts.dbRef }).from(accounts);
  const known = new Set(rows.map((r) => r.dbRef));

  const files = await readdir(DIR).catch(() => [] as string[]);
  const orphans: { name: string; bytes: number }[] = [];

  for (const name of files) {
    if (!name.endsWith(".db")) continue;
    /**
     * The ref is the file name without the extension, which is the inverse of `urlForRef`. Anything
     * that is not shaped like a ref this app would mint is left alone: a file somebody put here on
     * purpose is not this script's business.
     */
    const ref = name.slice(0, -3);
    if (!ref.startsWith("acct-")) continue;
    if (known.has(ref)) continue;
    const info = await stat(join(DIR, name)).catch(() => null);
    orphans.push({ name, bytes: info?.size ?? 0 });
  }

  if (!orphans.length) {
    console.log(`No orphans. ${known.size} account database${known.size === 1 ? "" : "s"} all accounted for.`);
    return;
  }

  const total = orphans.reduce((n, o) => n + o.bytes, 0);
  console.log(`${orphans.length} orphan file(s), ${(total / 1_048_576).toFixed(1)} MB:`);
  for (const o of orphans) console.log(`  ${o.name}  ${(o.bytes / 1024).toFixed(0)} KB`);

  if (!DELETE) {
    console.log(`\nNothing deleted. Re-run with --delete to remove them.`);
    return;
  }

  let removed = 0;
  const stuck: string[] = [];
  for (const o of orphans) {
    const base = join(DIR, o.name);
    try {
      for (const p of [base, `${base}-wal`, `${base}-shm`]) await rm(p, { force: true });
      removed++;
    } catch (err) {
      // Almost always a live server holding the handle. Saying so beats a bare EBUSY.
      stuck.push(`${o.name}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  console.log(`\nDeleted ${removed}.`);
  if (stuck.length) {
    console.error(`${stuck.length} could not be deleted, most likely open in a running server:`);
    for (const s of stuck) console.error(`  ${s}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
