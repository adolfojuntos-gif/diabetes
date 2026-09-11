# Multi-tenancy, stage 4: the edges that are not ordinary queries

Date: 2026-09-11
Lane: **Full**. This stage decides whether one patient's records can reach another patient's screen.
Verdict: **SHIP for stage 4.** Stage 5, billing, is not started and is not claimed.

## What stage 4 had to close

Every ordinary query was already safe: `db` resolves through async context to the signed-in
account's database and throws with no account in context, so roughly 300 query sites needed no
change. Stage 4 is the list of places that are not an ordinary query, because they run with no
session and therefore cannot use `requireAccount`.

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | A caregiver link created through the screen resolves to the account that issued it | Browser: signed up, added a caregiver ticking glucose and sleep, fetched the link the page printed. Rendered "Shared with Form Path" plus exactly the Glucose and Sleep sections | PASS |
| 2 | The control-plane row for that link carries the right account, subject and label, and only a digest | Queried `account_tokens` by SHA-256 of the raw token: `kind=share`, `label=Form Path`, `subject_id` set, `account_id` set, `revoked_at` null, `last_used_at` stamped by the render | PASS |
| 3 | A link never renders another account's data | `npm run check:share`: account A's reading 147 appears, account B's reading 283 does not | PASS |
| 4 | Revoking works from either side alone | Revoked the caregiver row and the directory entry together, then a second link by directory entry only with its caregiver row still active. Both stopped the link | PASS |
| 5 | A revoked link cannot be told apart from one that never existed | The two responses are byte-identical after stripping markup, at the same status | PASS |
| 6 | Scope still holds after the token change | Sleep-only caregiver with every alert kind ticked, and an alert body containing 147 mg/dL. No glucose unit and no figure on the page | PASS |
| 7 | Spend limits are per account | `tests/tenancy.test.ts`: account A filled to its 6-call cap is blocked showing 6 used, account B is allowed showing 0 | PASS |
| 8 | Open database handles are bounded | `tests/tenancy.test.ts` with `MAX_OPEN_ACCOUNT_DBS=5`: the cache holds at most 5 across 13 accounts, and a continuously used handle is never the one evicted | PASS |
| 9 | Nothing authenticates by reading a raw token out of an account database | `tests/boundaries.test.ts` greps for `caregivers.token` as a lookup across all of `src` | PASS |
| 10 | No client component pulls a server module into the browser bundle | `tests/boundaries.test.ts`, scanning the 13 client components in `src` | PASS |
| 11 | The coach endpoint resolves its account from the bearer token, not a global secret | `npm run check:coach`: account A's token reports A, account B's reports B, and the old `COACH_API_SECRET` is refused with 401 | PASS |
| 12 | A refused coach request is refused cleanly, on both methods | 401 for no token and for an unknown one, on GET and on POST, naming no account. **Failed first**, see below | PASS after fix |
| 13 | The suite, the types and the build are clean | 132 tests pass, 0 fail. `tsc --noEmit` silent. `next build` exit 0 | PASS |

## Negative controls

Four assertions were written this session, so each was run against code that should fail it. A test
that passes both before and after proves nothing.

**The handle bound.** Re-ran the old unbounded cache logic with a cap of 5 and 13 accounts: it holds
13, so the assertion `size <= cap` is violated. The control works.

**The client boundary.** The regex was run against five sample import lines. It matches
`@/lib/data/aiAudit`, `@/lib/auth/session` and `../db/index`, and does not match `@/lib/time` or
`@/components/ui`. It also scans 13 real client components rather than an empty set.

**The spend limit.** Asserted in both directions. A shared counter fails on `account B allowed`, and
a count that reads nothing fails on `account A used === 6`.

**The coach refusal.** This one needed no contrivance. It was written before the fix existed, failed
against the real code with a 500, and passes after. The control is the run history itself.

## What was found by running things rather than reading them

**My own assertions were wrong twice, not the app.** The check first demanded a 404 for a revoked
link. The app deliberately returns one identical "no longer active" page at 200 for both a revoked
token and a token that never existed, which is the stronger property. The assertion was rewritten to
compare the two responses to each other.

**The cleanup reported success while leaving a database file behind every run.** It swallowed the
delete error. Four orphan files had accumulated before the sweeper made them visible. The cause is
real and specific: a live connection blocks the delete on Windows, which is also why deleting an
account needs `closeHandle`. Confirmed rather than assumed by stopping the dev server and sweeping
again, at which point all three held files deleted cleanly.

**A test of mine wrote several hundred empty databases into the live accounts directory.** The code
comment claimed libsql opens a file lazily. It does not: the file appears when the client is
constructed. Found because the orphan sweeper listed them. The refs now resolve into the test
directory.

**The coach endpoint returned 500 instead of 401 for a wrong token, intermittently.** The worst
finding of the session, and it was invisible to every existing test. The refusal logger wrote a row
to an account database, and a caller who failed to authenticate has no account, so `db` threw
`NoAccountContextError` and the handler died with a 500. It was intermittent because refusals are
sampled per address per minute: the FIRST wrong token from an address each minute took the write and
500ed, and every one after it hit the suppressed early return and got a clean 401. So the endpoint
was telling a stranger that a wrong token follows a different path from no token at all, which is
exactly the distinction the design took care to erase everywhere else.

Two more instances of the same shape were sitting next to it. An authenticated request for a kind
that does not exist logged without an account wrapper, turning a 400 into a 500. And the catch block
on the generation path did too, so a genuine failure was replaced by a logging failure and the real
cause was lost.

The fix separates the two cases by who owns the event. A refusal belongs to nobody, so it goes to
the server log, sampled as before, and writes nothing to disk, which also strengthens the denial of
service argument the original sampling was written for. An authenticated event belongs to that
account, so it is wrapped and written to that account's own log.

**The handle cache was unbounded.** Not a bug anybody had hit, and not on the plan. It surfaced while
working out why a file could not be deleted: nothing ever closed a connection, so a long-running
server accumulates one open SQLite handle per account forever.

**`npm run migrate:all` pointed at a script that did not exist.** A documented operational command
that would have failed the first time somebody needed it, which is after adding a table, when every
existing account is already behind.

## Not verified

- **Billing.** Stage 5, not started.
- **Clinician review of the 43 knowledge items.** Unrelated to this stage and still open. It blocks
  selling to patients.
- **Turso.** `urlForRef` returns a `libsql://` URL when `TURSO_ORG_HOST` is set, and that path has
  never been run. Every check here used local files.
- **Concurrency.** Nothing in this stage was tested under simultaneous requests from two accounts.
  The isolation argument does not depend on locking, since the databases are separate files, but
  "was not tested" is the honest statement.
- **The coach generation path itself** was only exercised in its refusal and bad-kind branches. A
  successful POST calls a model, so it was not run here.

## Commands

```bash
npm test                    # 132 tests
npm run check:share         # 13 assertions against a running server
npm run check:coach         # 11 assertions against the coach endpoint
npm run sweep:orphans       # list orphan account databases; --delete removes them
npm run migrate:all         # bring every account database up to the current schema
```
