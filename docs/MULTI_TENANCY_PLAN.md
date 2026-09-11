# Multi-tenancy: the plan

Written 2026-09-11, before any code, because the tenancy decision is expensive to reverse.

## The problem

There is one `profile` row with `id = 1`. No account table, no session, and no ownership column on
any of the 37 tables. Every query in the app returns every row in its table, which is correct for
one person on their own machine and means a hundred subscribers would share one diary.

## The decision: one database per account

The obvious approach is a single database with an `accountId` column on every table and an
ownership predicate on every query. It is the standard answer and I am not taking it.

**Why not.** There are 37 owned tables and roughly 90 server actions. Correctness would depend on
every one of about 300 query sites carrying a predicate, forever, including the ones written next
year by someone in a hurry. One missing `where` is not a bug, it is one patient reading another
patient's glucose readings. The attack pass on this app already found a caregiver page that queried
a table it had not been scoped for, and that was with five scopes to keep track of, not 37 tables.

**What instead.** Each account gets its own database file. Locally that is
`data/accounts/<accountId>.db`; hosted it is a Turso database per account. A separate control
database holds accounts, sessions and billing, and nothing clinical.

The consequence that makes this worth it: **a missing predicate cannot leak anything, because the
other person's rows are not in the file.** Isolation stops being a property of 300 query sites and
becomes a property of one connection.

**What it costs.** An operational dependency on Turso in production, per-database backups, and no
cross-account queries. This app has no legitimate cross-account query, so that last one is free.

**Why it is cheap to build here.** `src/lib/db/index.ts` already exports `db` as a Proxy that
connects lazily, which I wrote to stop `next build` opening a connection. That Proxy becomes the
whole mechanism: it resolves the current request's account from async context and hands back that
account's handle. **Every one of the ~300 existing query sites keeps working unchanged.** The
alternative would have meant editing all of them.

## Acceptance criteria

Observable, and each names what settles it.

| # | Criterion | Settled by |
|---|---|---|
| 1 | A visitor with no session cannot reach any screen that reads clinical data | curl every route with no cookie; all redirect to sign-in |
| 2 | Signing up creates an account, its own database, and a seeded reference | the file exists, and the new account's food and recipe tables are populated |
| 3 | Two accounts cannot see each other's data | log a reading as A, assert it is absent for B, at the database level and in rendered HTML |
| 4 | A query with no account context fails closed, never silently returning another account's rows | a unit test asserting the Proxy throws outside a request |
| 5 | Passwords are stored as scrypt with a per-account salt, never recoverable | inspect the stored value; assert no plaintext, assert verify works |
| 6 | A session token is stored hashed, so a stolen control database does not grant access | inspect the row; assert the raw token is absent |
| 7 | Signing out revokes the session server-side, not just the cookie | reuse the old cookie; assert refusal |
| 8 | The existing single-user data survives, assigned to the first account | count rows before and after the migration; nothing lost |
| 9 | The spend limiter counts per account, not globally | fill account A's window; assert B is unaffected |
| 10 | The export contains only the caller's data | export as B after A has logged; assert A's rows absent |
| 11 | A caregiver share link resolves to exactly one account's data | a token from A renders A's data and never B's |
| 12 | The coach API names which account it is acting for | a request with A's token cannot generate B's brief |
| 13 | Schema changes reach every account database | add a column, assert it exists in two accounts |
| 14 | Nothing in `src/app` imports `db` directly | a test that greps and fails on a violation |

## Lane

**Full.** Auth, a migration, and a data-isolation boundary in a health app. A silent error here
exposes one patient's records to another, which is the worst thing this codebase could do.

## Stages, in dependency order

1. **The control plane.** `accounts`, `sessions`, scrypt passwords, hashed session tokens, sign up,
   sign in, sign out, the session helper. Ported from the pattern already working in `her-space`
   rather than invented.
2. **Per-account databases.** Async-context resolution behind the existing Proxy, database creation
   on signup, schema push and reference seeding per account, and a fail-closed default.
3. **The migration.** The existing data becomes account one. Reversible, and proven on a copy first.
4. **The edges that are not ordinary queries.** The spend limiter, the export, the share link, the
   coach API route, and the proxy gate.
5. **Billing.** Stripe, plan state, and per-plan caps. Last, because nothing above depends on it.

Stages 1 to 3 are the ones that must be right. 4 is mechanical. 5 is a separate piece of work.

## What is deliberately not in scope

- Password reset by email, which needs an email provider. Until then, a support path.
- Teams or shared accounts. A caregiver link is not an account and stays as it is.
- Cross-account admin tooling. There is no admin in this product.

---

# Progress

## Done and verified

**The control plane.** `accounts`, `sessions`, `signin_attempts` and `account_tokens`, in a database
of their own at `data/control.db`. Nothing clinical is in it. Passwords are scrypt with a per-account
salt; session tokens and share tokens are stored only as SHA-256, so a copy of the control database
grants nobody access to anything.

**Per-account databases.** `db` is a Proxy resolving through `AsyncLocalStorage` to the signed-in
account's database, and throwing `NoAccountContextError` when there is no account. That is what let
roughly 300 existing query sites stay untouched. 36 tables, generated into
`src/lib/db/accountSchema.ts` by `npm run schema:build`, applied per account at signup.

**Sign up, sign in, sign out.** Sign-out revokes server-side, not just in the browser. Sign-in is
rate limited by email and by address, counted in the control database so a restart does not hand
someone a fresh eight attempts. A wrong password and an unknown email give the same message and take
the same time, so the page cannot be used to discover who has an account.

**The migration.** `npm run migrate:accounts -- email password` copies `data/steady.db` to the
account's own file and leaves the original as a backup. Run on the real data: 284 readings, 120
meals, 206 water entries, 179 foods and everything else arrived intact, counted before and after.

**Tokens for things outside a session.** A caregiver share link and the coach bearer token both
resolve through `account_tokens` to find which account, then read what they may do from inside that
account's database. A share link is a directory entry in the control plane and a permission in the
account, which is the right split: the patient owns the scopes.

**Caregiver links, end to end.** The caregivers screen issues a link by writing the readable token
into the patient's own database and only its digest into the control plane. That split is deliberate:
the patient needs to re-send a link when a family member loses the message, and if their own database
leaks the attacker already has every record in it, so the link adds nothing. What must not happen is
one control plane holding usable links for everybody. Revoking, restoring and deleting all keep the
two sides in step, and each side alone is enough to stop a link working.

**A bounded handle cache.** One SQLite connection per account, cached, was unbounded. Invisible at
three accounts and file-descriptor exhaustion at a few thousand on one machine. Now least recently
used with a cap of 256, settable by `MAX_OPEN_ACCOUNT_DBS`, and `closeHandle` releases one so an
account can actually be deleted. A busy account is not evicted, because recency is tracked on read.

**The coach endpoint names its account.** One global `COACH_API_SECRET` cannot work here: a secret
says "you may", not "for whom", and this route has to know whose morning brief to write. Each account
has its own bearer token, resolved in the control plane, which authenticates and identifies in one
step. Verified against a running server, including the finding that a refusal has no account to be
logged to and so goes to the server log rather than throwing.

**Per-account spend limits came for free, and that is now shown rather than claimed.** `ai_audit`
lives inside each account's database and the limiter counts its rows, so the allowance is per person
by construction. The test fills one account to its cap and asserts the other is untouched, in both
directions: a shared counter would block the second account, and a broken count would show zero for
the first.

**Orphan databases.** A signup that dies between creating the file and inserting the control row
leaves a database nobody owns, which is by design, because writing the file first is what stops a
half-finished signup from signing in to a database with no tables. An orphan is unreachable rather
than exposed: no control row means no token, no session and no way to name it. But it is disk, and
disk runs out quietly on a mounted volume, so `npm run sweep:orphans` lists them and `--delete`
removes them.

**16 tests** in `tests/tenancy.test.ts`, including the one that matters: two accounts, the same
`profile.id = 1`, queries with no predicate at all, and neither can see the other. **12 more** in
`tests/boundaries.test.ts`, which assert the rules the type system cannot: no screen imports the
control plane, no page reaches the database without establishing an account, no client component
pulls a data or auth module into the browser bundle, and nothing authenticates by reading a raw
token out of an account database.

## Verified against a running server

`npm run check:share` provisions two real accounts, gives one of them a wide link and a sleep-only
link, and reads the rendered HTML. 13 assertions, all passing: the issuing account's own reading
appears, the other account's reading does not, the sleep-only view leaks no glucose figure even
though the alert body contains one, and a revoked link is byte-identical to a token that never
existed so neither can be told apart.

The screen's own path was walked in a browser as well, because the script bypasses the form: sign up,
add a caregiver ticking glucose and sleep, then fetch the link it produced. It rendered those two
sections and nothing else, and the control-plane row carried the right label, subject and account.

## Stage 5, billing

Built. Written up in `docs/BILLING_PLAN.md` and verified in
`docs/verification/2026-09-11-billing.md`, which carries a verdict of FIX rather than SHIP: no real
Stripe call has ever executed on this machine, because there are no keys and no account.

The load-bearing half was not the checkout. It was tying allowances to the plan, because the caps
this app shipped with allowed $299 of inference on a $20 subscription. A subscriber riding every
paid cap now costs $10.56 a month on Opus rates against $19.12 kept, and that ceiling is asserted
against revenue rather than against a number, so raising a cap too far fails a test.

The worst find of the stage was in the gate, not in the billing code: `/api/stripe/webhook` was not
in the public allowlist, so every Stripe delivery was redirected to the sign-in page and dropped.
Subscribers would have paid and never been upgraded. Every unit test passed throughout, because they
call the handler directly. One real HTTP request found it, and there is now a test that reads the
routes on disk against the allowlist and refuses to let them disagree.

## Still to do

- Run a real test-mode checkout end to end, and watch a plan move by webhook. This is the open item
  on the billing verdict.
- Clinician review of the 43 knowledge items. This is not a multi-tenancy task and it blocks selling
  to patients, so it comes first in the overall sequence.
- Annual billing. The economics doc puts it ahead of any model choice for the margin, because card
  fees are 4.4% of a monthly $20 plan.
