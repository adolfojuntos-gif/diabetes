# Scripts pointing at the pre-migration database

Date: 2026-09-11
Lane: **Standard**, raised from Light. The starting brief was two scripts writing to the wrong file.
It turned out to be eight, and three of them had a second bug underneath that the first one hid.
Verdict: **SHIP.** 183 tests pass, `tsc` clean, `next build` exit 0, and every script verified by
running it against a real account.

## What was actually wrong

The brief named `demoFoodLinks.mjs` and `demoPreMeal.mjs`. Grepping `scripts/` for the hardcoded URL
found three more with the identical line, and three more with the opposite failure.

| Script | Symptom |
|---|---|
| `demoFoodLinks` | Wrote to `data/steady.db`, reported success |
| `demoPreMeal` | Same |
| `checkSpendLimit` | Same, and therefore printed PASS on every assertion against a table the app never reads |
| `dedupeFoods` | Same |
| `starterFoods` | Same |
| `seed` | Used `db` with no account context, so it threw `NoAccountContextError` |
| `seedFoods` | Same |
| `importcheck` | Same. Registered nowhere, so nothing would have run it to find out |

The five silent ones are the interesting half. `data/steady.db` still exists as the pre-migration
backup, so every query succeeded, every insert landed, and every summary line was accurate about a
database nothing reads. The three that threw were the fail-closed default doing its job, and they
are the reason the default is worth having.

## Three bugs the first bug was hiding

**`demoFoodLinks` had three stale food ids out of four.** The ids came from the old starter slice,
whose word order is the reverse of the canonical reference: `rice-white-cooked` against
`white-rice-cooked`, `spaghetti-meat-sauce` against `spaghetti-with-meat-sauce`,
`pizza-cheese-slice` against `cheese-pizza-slice`. So only the oats ever linked. Nobody could see it
because everything the script did was invisible. Fixed: 31 meals linked before, 81 after.

**`checkSpendLimit` restated caps that no longer exist.** It asserted "the cap is 10 an hour", true
when written. Caps are per plan now, and the free plan's photo allowance is three a month with no
hourly window at all. Every figure is now read from `windowsFor(plan, feature)`, the same source the
limiter uses, so the check cannot disagree with the thing it checks.

**`starterFoods` and `dedupeFoods` disagreed about what a duplicate food is, and both were wrong.**
`starterFoods` skipped on id only. `dedupeFoods` normalised punctuation and preparation words but
kept word order. Between them, seeding inserted six duplicates and deduplicating then reported
finding none, each correct by its own rule. Both now use one shared `foodKey` that sorts the words.

## Two more findings from fixing those

**`dedupeFoods` would have deleted the canonical row.** Its survivor ranking used portion count and
note length, which for the tortillas picked the old starter row over the reference one. Deleting a
canonical row does not hold: `seed:foods` and the next signup re-add it from `SEED_FOODS`, so the
duplicate returns and the script has to run again forever. A canonical id now wins ahead of
everything else, which is the only ranking stable under re-seeding.

**A fuzzy match plus a hard delete plus no prompt is a bad combination.** `dedupeFoods` removes rows
and repoints logged meals, on a grouping that is deliberately loose. It now reports by default and
needs `--apply`.

## Evidence

Each script run against `ui-check@steady.test`, and `checkSpendLimit` against both a free and a paid
account so both window shapes are exercised.

```
demo:links     81 demo meals linked across all four reference foods (was 31, three ids stale)
demo:premeal   81 before-meal readings added
foods:dedupe   6 duplicates found and reported; --apply removed them, back to 174 foods
foods:starter  0 added, 9 skipped by id, 5 skipped by name. "Nothing to add", which is correct now
check:limit    ALL PASS on free (3 a month) and on plus (6 an hour), caps read from the plan
seed           idempotent, 0 added, everything already present
seed:foods     idempotent, reference holds 174
check:import   PASS, chunked CGM import slices to the same readings and undoes by batch
```

The decisive check is where the rows went:

| | account database | `steady.db` backup |
|---|---|---|
| `meal_items` | 81 | 80 |
| before-meal readings | 81 | 80 |
| foods | 174 | 179 |
| `ai_audit` rows | 0 | 1 |

The backup's size and modification time are byte-identical before and after every run. Its 80 rows
and 179 foods are the historical evidence of the bug: written by the old scripts where nothing would
read them, the 179 including the five duplicates `starterFoods` inserted and the one audit row
`checkSpendLimit` left behind.

Refusal paths checked too: no email prints the usage line, an unknown address says so by name, and
an account with no `provisionedAt` is refused as an unfinished signup.

## Changed

- Added `scripts/_account.ts`, the single account resolver, and `scripts/_foodName.ts`, the single
  definition of when two foods are the same.
- Converted five `.mjs` scripts to `.ts` and deleted the originals. They could not import the app's
  own modules, which is why each carried its own drifting copy of shared logic.
- Wrapped `seed` and `seedFoods` in an account context.
- Registered all of them in `package.json`, which none of the five were, plus `importcheck`,
  which was registered nowhere and so had nothing to reveal that it was broken.
- Removed `npm run setup` and `npm run demo:clear`. Both chained commands that now require an
  account named on the command line, so neither could work. The README describes the real first-run
  flow instead, which is that signing up IS the setup step.

## Not done, on purpose

- **`drizzle.config.ts` has the same hardcoded URL.** It is outside `scripts/` and drizzle-kit is a
  CLI that reads one config file, so it cannot be per-account. That is exactly why
  `accountSchema.ts` and `npm run migrate:all` exist. Worth a decision rather than a quiet change:
  the honest options are to point its default at a scratch file so `db:push` cannot touch the
  backup, or to drop `db:push` in favour of `schema:build` plus `migrate:all`.
- **`starterFoods` is dead.** All 20 of its entries are covered by the canonical reference, and it
  now adds nothing to any account. It is kept because its per-100g figures and notes are
  hand-checked against named sources, and it is now safe. Deleting it is a reasonable call and is
  yours to make.
- **`npm run lint` crashes** in `@eslint/eslintrc`'s config validator with a circular reference,
  before it reads a single file. Pre-existing, a version incompatibility in the Next eslint config,
  and untouched by this change.
- **Two reference entries fail `seedFoods`' own energy check**: `spinach-raw` states 23 kcal where
  its macros imply 30, and `beer` states 43 where they imply 16. Pre-existing data, reported by that
  script every run, and not part of this task.
