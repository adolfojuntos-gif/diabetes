# Steady

*Your diabetes, one day at a time.*

A diabetes self-management app with a clinical copilot. Daily glucose and CGM tracking, meals and
carbohydrates, insulin, movement, sleep, water, weekly review, grocery and meal planning, a
vacation packing checklist, questions for your care team, lab explanations, appointment prep, a
caregiver share link, and a conversational copilot that reads your own numbers.

It runs with no services and no API key. It is not a medical device, it does not diagnose, and it
never suggests or changes a medication or insulin dose.

## Run it

```bash
cd steady
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3140 and create an account. Signing up is the setup step: it creates a
database for that account and seeds 28 recipes, 32 exercise ideas, a 52-item packing template and
174 reference foods into it. Then the first screen asks nine questions and never appears again.

There is no global seeding command, because there is no global database. Every account has its own,
so anything that seeds has to be told which one. The old `npm run setup` chained `db:push` and
`seed`, and neither can work without naming an account.

Nothing seeds **readings, meals or insulin**, on purpose: an app seeded with invented numbers would
show invented patterns, which is the one thing this app must never do.

## Look at it with data in it

Sign up first, then name that account. Every row goes into its database and no other.

```bash
npm run demo -- you@example.com
```

45 days of clearly fictional logs, generated so the pattern engine has something real to find:
weekend highs, a dawn rise, overnight lows, days after short sleep running higher, and post-meal
spikes on the takeout meals. Each pattern card draws its own evidence, from the engine's numbers.
`npm run demo -- you@example.com --clear` removes exactly what it added.

## The AI features

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5
```

Two features use the model: the Copilot's conversational replies, and meal estimates from a photo.

Without a key the Copilot still answers, from the app's own engine over your real data, and says so
in the reply. Nothing is faked and no canned "AI" text is shown. The photo estimator simply says it
needs a key and points at the manual form.

**The safety engine does not depend on this key.** Triage is deterministic, runs locally on every
message, and the model cannot raise or lower its verdict.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on 3140 |
| `npm run seed -- <email>` | Recipes, exercise ideas, packing template into one account (idempotent) |
| `npm run seed:foods -- <email>` | The carbohydrate reference into one account (idempotent) |
| `npm run demo -- <email>` | Add fictional demo data to one account (`--clear` removes it) |
| `npm run demo:links -- <email>` | Link the demo meals to reference foods |
| `npm run demo:premeal -- <email>` | Add before-meal readings to the linked demo meals |
| `npm run foods:dedupe -- <email>` | Remove duplicate reference entries, keeping logged history |
| `npm run foods:starter -- <email>` | The old starter food slice. Superseded by signup seeding |
| `npm run check:limit -- <email>` | The spend limiter, against that account's real audit log |
| `npm run migrate:all` | Bring the control plane and every account database up to schema |
| `npm run check:share` | Caregiver links, against a running server |
| `npm run check:coach` | The coach endpoint's per-account tokens |
| `npm run sweep:orphans` | List account databases no account row points at |
| `npm test` | The engine and safety test suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build (`output: standalone`) |

## The screens

| | |
|---|---|
| **Today** | The latest number, today's range, the last 7 days, what needs attention, and the patterns your data supports. |
| **Log** | Glucose, meals (typed or estimated from a photo), insulin, movement, sleep, water, symptoms, weight, blood pressure, medication taken. Plus CGM and meter CSV import. |
| **Trends** | Time in range, average, GMI, CV, a glucose chart, time-of-day blocks, day by day, low episodes. A separate post-meal page ranks your own meals. |
| **Review** | This week against last, with wins and things worth discussing. Printable for an appointment. |
| **Copilot** | *Tell me what's going on.* Open conversation, a guided symptom check, lab explanations, appointment prep and a daily check-in. |
| **Plan** | A week of meals, a recipe library, a grocery list built from the plan, and best meals drawn from your own readings. |
| **Move** | Exercise ideas filtered by the time and energy you actually have, with what to expect from your glucose. |
| **Toolkit** | Notifications, questions for your doctor, appointments and briefs, labs, the packing checklist, what Steady knows about you, and caregiver links. |
| **Settings** | Profile, targets, units, Copilot style, data export and deletion, and a plain statement of what this is and is not. |

## The ten invariants

These are enforced in code. A change that breaks one is wrong even if it typechecks. The full list,
with where each lives, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

1. Glucose is stored in mg/dL, always.
2. Insulin and medication are recorded, never recommended.
3. Numbers come from the engine, never the model.
4. The safety engine is deterministic, separate from the model, and it wins.
5. Medical knowledge is a controlled list with sources, dates and review status.
6. Memory is a table you can read, correct and delete.
7. Everything works with no API key and no network.
8. Every clinically relevant AI response is audited.
9. A caregiver sees only what you scoped.
10. Photo estimates stay estimates.

## What this is not

Not a medical device. Not a dosing calculator. Not a diagnostic tool. The clinical knowledge layer
is marked `draft_needs_clinician_review` and has not been reviewed by a qualified professional.
Both statements appear inside the app, on `/settings/about`.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the invariants, where everything lives, the
  clinical definitions and their sources.
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — how to write a screen in this codebase.
- [docs/HERO_VIDEO_PROMPTS.md](docs/HERO_VIDEO_PROMPTS.md) — the four background video prompts.
- `docs/verification/` — the verification report for each build.
