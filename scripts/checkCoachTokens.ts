/**
 * The coach endpoint against a running server.
 *
 * This route is how a cron triggers the morning brief and the weekly review, so it runs with no
 * session and cannot use `requireAccount`. It used to be gated by one global `COACH_API_SECRET`,
 * which on a multi-account deployment means anybody holding that one secret can trigger work in
 * every account. Now the bearer token names the account. This proves it does.
 *
 *   npx tsx scripts/checkCoachTokens.ts
 */
import { config } from "dotenv";
import { controlDb, accounts } from "../src/lib/db/control";
import { coachTokenFor } from "../src/lib/auth/tokens";
import { newId } from "../src/lib/ids";

config({ path: ".env.local", quiet: true });

const BASE = process.env.BASE ?? "http://localhost:3140";

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

const probeAs = async (token: string | null, method: "GET" | "POST" = "GET", kind = "morning") => {
  const res = await fetch(`${BASE}/api/coach/${kind}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as { account?: string; error?: string; kind?: string } };
};

async function main() {
  const rows = await controlDb().select().from(accounts);
  const active = rows.filter((r) => r.status === "active" && r.provisionedAt);
  if (active.length < 2) {
    console.error(`Needs two provisioned accounts to prove separation, found ${active.length}.`);
    process.exit(2);
  }
  const [a, b] = active;

  // Minting rotates: only a digest was ever stored, so an existing token cannot be shown again.
  const tokenA = await coachTokenFor(a.id);
  const tokenB = await coachTokenFor(b.id);
  check(tokenA !== tokenB, "each account gets its own coach token");

  const asA = await probeAs(tokenA);
  const asB = await probeAs(tokenB);
  check(asA.status === 200 && asA.body.account === a.email, `account A's token is recognised as A (${asA.body.account})`);
  check(asB.status === 200 && asB.body.account === b.email, `account B's token is recognised as B (${asB.body.account})`);
  check(asA.body.account !== asB.body.account, "the two tokens do not resolve to the same account");

  const nonsense = await probeAs(`${newId(14)}${newId(14)}`);
  check(nonsense.status === 401, `an unknown token is refused (${nonsense.status})`);
  check(!("account" in nonsense.body), "a refusal names no account");

  const none = await probeAs(null);
  check(none.status === 401, `no token at all is refused (${none.status})`);

  /**
   * The old global secret must not still work. If it does, the per-account tokens are an addition
   * rather than a replacement, and the weakest path is the one that counts.
   */
  const legacy = process.env.COACH_API_SECRET;
  if (legacy) {
    const asLegacy = await probeAs(legacy);
    check(asLegacy.status === 401, `the old global COACH_API_SECRET no longer works (${asLegacy.status})`);
  } else {
    console.log("note: no COACH_API_SECRET in the environment, so there is no legacy path to test");
  }

  /**
   * POST carries the same refusal code and is the method a cron actually uses, so it is checked
   * separately. GET passing is not evidence about POST: the two handlers refuse on their own lines.
   *
   * Fresh tokens per probe because the refusal sampler suppresses repeats from one address inside a
   * minute, and a suppressed refusal takes an earlier return. Testing only the suppressed path is
   * how the 500 on the FIRST refusal per minute stayed hidden in the first place.
   */
  const postNoToken = await probeAs(null, "POST");
  check(postNoToken.status === 401, `POST with no token is refused (${postNoToken.status})`);
  const postBadToken = await probeAs(`${newId(14)}${newId(14)}`, "POST");
  check(postBadToken.status === 401, `POST with an unknown token is refused (${postBadToken.status})`);

  // An authenticated caller asking for a kind that does not exist gets a 400, and that refusal DOES
  // have an account to be logged against, so it takes the other branch.
  const badKind = await probeAs(tokenA, "POST", "fortnightly");
  check(badKind.status === 400, `an authenticated request for an unknown kind is a 400, not a 500 (${badKind.status})`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
