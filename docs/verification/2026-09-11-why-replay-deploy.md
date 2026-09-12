# Why did this happen, Glucose replay, and the deployment

Date: 2026-09-11
Lane: **Full.** Two features that explain glucose to a person who has diabetes, plus a deployment
whose data layout had never been updated for multi-tenancy.
Verdict: **SHIP.** 221 tests pass, `tsc` clean, `next build` clean, and both features verified live
at https://steady-diabetes.fly.dev.

## The deployment was going to lose every account's data

This is the finding worth reading, and it had nothing to do with the two features.

`urlForRef` returned `file:./data/accounts/<ref>.db`, relative to the working directory. On Fly the
volume is mounted at `/data` and the app runs from `/app`. So every account database, and the
control database with it, would have been written inside the container and **deleted on the next
restart**. Nothing would have failed or logged: signup would work, the app would work, and the data
would be gone after a redeploy. All three paths are now configured to the volume, and `ACCOUNTS_DIR`
exists so the default can never silently be the wrong place again.

The boot script was also still the single-database one. It pushed a schema to `DATABASE_URL` and
then ran `seed`, `seedFoods` and `demo`, all three of which now need an account named on the command
line and would have exited immediately. Every failure was swallowed by a `|| echo`, so the machine
would have started with no control database and served an error page for every request.

`scripts/bootstrapDeploy.ts` replaces all of it: control schema, then migrate every account, then
create and seed the demo account only if it does not already exist. Idempotent, and it exits
non-zero rather than starting a server that has nothing to serve.

## Feature 1: why did this happen

`src/lib/engines/attribution.ts` plus `src/app/trends/why/page.tsx`.

Instead of "glucose 238", the screen leads with "We found 3 things that may have contributed" and
names them from the person's own log: a larger meal than usual shortly before, a meal tag that runs
high for them, no movement logged in the preceding day. Each factor carries its evidence, a chart
drawn with the existing pattern-chart vocabulary, and a plain sentence on why the mechanism is real.

Four rules are enforced by tests rather than by review:

- **It never says "caused".** A scan over every sentence every branch can produce.
- **It never reads as advice about a dose.** Same scan, separate pattern. The dose-language filter
  guards model output and this engine's text never passes through it, so it needs its own check.
- **It never blames the person.**
- **What it cannot see is always part of the answer**, not a disclaimer at the bottom. Unlogged food,
  illness, stress, hormones, the reading itself, and for insulin users absorption and a failed set.
  The most likely explanation for a spike is often something never logged, and three factors with no
  mention of that reads as a complete account when it is not.

With nothing logged nearby it returns no factors and says so, including "rather than something you
did". Inventing a weak factor to fill the space would teach people to distrust the strong ones.

## Feature 2: glucose replay

`src/lib/engines/replay.ts`, `src/app/trends/replay/page.tsx`, `src/app/trends/replay/DayCurve.tsx`.

Pick a day from the last 30, worst peak first. The day is then told in order: went to bed, woke up
with the hours slept, pancakes at 10:00, the rise starts here at 13:48 with the climb named, takeout
pizza at 14:00, highest reading at 16:00, back in range at 20:18. A server-rendered SVG puts every
logged event on the day's curve, with a shape per kind rather than a colour, because only five
colours in this app mean anything and four are reserved for glucose bands.

Then the comparison against the five best days, ranked proportionally: 123 g more carbohydrate, 18
minutes less movement, a largest meal 37 g bigger. Captioned "These are differences, not causes."

## The bug the tests caught, and it was the harmful one

**A day spent between 58 and 62 mg/dL was offered as a "best day" to copy.**

`bestDays` ranked on time in range and took the top five, which is correct reasoning and not
sufficient. With only three well-logged days to choose from, the top five is all of them, including
a day with 0% time in range and a beautiful average. Holding that up as a model is the most harmful
thing this feature could do, and a ranking with no floor will do it whenever the data is thin.

There are now absolute floors as well: at least 60% in range and at most 10% low. The test failed
against the unfixed engine and passes after, which is the control.

## Other findings

**My own safety scan had a hole.** A negative control against phrasings the pattern must catch found
it let through "Consider increasing your mealtime insulin dose", because the list held base verb
forms and "increasing" is not "increase". Verb stems now, and an inflection is exactly how that
sentence would get written.

**Three test files were deleting each other's databases.** They share one directory and each removed
it recursively in teardown, so whichever finished first deleted what the others were still using. It
showed as one unrelated test failing in a full run and passing alone. Each now deletes only its own
file. Three consecutive full runs, 221 passing.

**The check-ins screen told users to configure a secret that does nothing.** It asked for a bearer
token "matching COACH_API_SECRET in your environment". The endpoint has authenticated per-account
tokens since the split, and there was no way for anybody to obtain theirs, so the instruction
described a dead variable and asked for something the interface could not produce. The copy is fixed
and the screen now mints the account's token, saying plainly that a new one replaces the old.

**The day curve forced a horizontal scroll.** A fixed pixel width put the second half of the day past
the right edge, so the 16:00 peak, the whole reason somebody opened the screen, was hidden until they
scrolled. It scales to the card now.

**A gauge read "outside 0 mg/dL to 50 mg/dL".** The zero carries no information and the reader has to
work out which half matters. A zone starting at zero is a ceiling, so it says "over 50 mg/dL".

**Importing a script ran its command-line path.** The three demo scripts called their entry point at
the top level, so the bootstrap's import would have resolved an account from `process.argv` and
exited the process before the boot got anywhere. Guarded.

**Spawning a script behaved differently per platform.** The first bootstrap shelled out to
`./node_modules/.bin/tsx`, which failed locally with "'.' is not recognized" and would have worked
in the container. That is the worst combination, because it can only be tested where failing is
expensive. It imports the functions directly now.

## Evidence

```
npm test                    221 pass, 0 fail, stable across three consecutive runs
npx tsc --noEmit            silent
npm run build               compiled successfully
flyctl deploy               deployed, machine in a good state
```

Boot log from the live machine, which is the part that could not be tested any other way:

```
steady: control database at file:/data/control.db
steady: account databases in /data/accounts
steady: control plane ready, 6 tables
steady: 1 account database up to schema
steady: demo account already exists, password set to match DEMO_PASSWORD
steady: starting server on 8080
```

Both features rendered on the live deployment, signed in as the demo account. The why screen named
three factors with charts and the blind spots card. The replay drew the curve, the ordered timeline
and the three differences against the best days.

## Not verified

- **The attribution engine against real clinical review.** Every threshold in it decides whether to
  MENTION something and none is a clinical cutoff, but a diabetes clinician should read the factor
  wording before this is sold. That is the same open item as the 43 knowledge entries.
- **`npm run lint`** still crashes in eslint's own config loader, pre-existing and unrelated.
- **The cold-start cost.** The first request after a suspend waits for the bootstrap, which took
  about 14 seconds on the first boot and under a second warm. Worth watching if the machine
  suspends often.
- **`drizzle.config.ts`** still points at the pre-migration database. Outside the scripts fix and
  noted in that verification file.
