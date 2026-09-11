# Steady — architecture

*A diabetes self-management app with a clinical copilot. Single person, runs with no services.*

## Stack

Next.js 16 (App Router, server actions) · Drizzle + libsql (SQLite file at `data/steady.db`) ·
Tailwind 4 with a hand-written design system in `src/app/globals.css` · optional Anthropic SDK.
Same stack as the two apps before it, on purpose.

## Invariants — enforced in code, and a change that breaks one is wrong even if it typechecks

1. **Glucose is stored in mg/dL, always.** `glucose_readings.value_mgdl` is the only glucose
   column. mmol/L is a display preference converted in `src/lib/units.ts` at the edge.
2. **Insulin and medication are recorded, never recommended.** No function takes carbs or glucose
   and returns units. The Copilot's system prompt forbids dosing language; `src/lib/ai/filter.ts`
   removes any sentence that slips through and marks the audit row `filtered`. Tests in
   `tests/filter.test.ts` pin this.
3. **Numbers come from the engine, never the model.** `src/lib/engines/*` compute every statistic,
   pattern, ranking and review. The Copilot receives their output as text and can only narrate it.
   It is told the sample size and told to say when it is too small.
4. **The safety engine is deterministic, separate from the model, and it wins.**
   `src/lib/engines/triage.ts` sets `emergency | urgent | clinic | general` from a table of 37 rules
   over recent glucose, symptoms, the person's reported medication classes and age, and a few
   profile facts. It discards readings that are non-finite, physiologically impossible or dated in
   the future, and reports how many it threw away, because a reading it cannot trust must make the
   engine louder rather than quieter. The app renders that level as a banner from
   fixed text, above anything the model writes. The model cannot raise or lower it.
5. **Medical knowledge is a controlled list, not the model's memory.** `src/lib/knowledge/*` carries
   every clinical statement and medication fact with its source, date and review status. The
   status is `draft_needs_clinician_review` until a clinician has actually reviewed it — the field is
   honest by construction. The model is told to trace claims to retrieved items and to say when it
   cannot.
6. **Memory is a table the person can read, correct and delete.** `memory_facts` is the only memory
   the Copilot has. It is handed the table and nothing else.
7. **Everything works with no `ANTHROPIC_API_KEY` and no network.** Every screen, every guided flow
   and the safety engine run locally. Without a key the Copilot answers from the engine and says so.
   Nothing is faked and no canned "AI" text is shown.
8. **Every clinically relevant AI response is audited.** `ai_audit` records the question, data
   windows consulted, knowledge ids, safety rules evaluated, level, responder, model and whether the
   filter fired — not the health data itself.
9. **A caregiver sees only what the patient scoped.** `/share/[token]` renders sections strictly by
   `caregivers.can_view`, and that includes the alerts strip: an alert is shown only when the
   caregiver holds the scope for the data it is about, and only its title crosses the wire, never
   its body, because alert bodies carry exact figures. The token is the credential, revocation is
   immediate, and a restored link gets a new token. Share tokens are never included in an export.
   No accounts in v1.
10. **Photo estimates stay estimates.** Meals estimated from a photo carry `estimate_source =
    "photo"` and per-item confidence; the photo itself is never stored.

## Where things live

| Concern | Path |
|---|---|
| Schema (all tables, enums, the invariants in comments) | `src/lib/db/schema.ts` |
| Units, thresholds, bands | `src/lib/units.ts` |
| Statistics (mean, SD, CV, GMI, time in range, blocks, low events) | `src/lib/engines/stats.ts` |
| Post-meal response and meal ranking | `src/lib/engines/mealResponse.ts` |
| Pattern detection | `src/lib/engines/patterns.ts` |
| Safety triage | `src/lib/engines/triage.ts` |
| Weekly review | `src/lib/engines/review.ts` |
| Nudges, doctor questions | `src/lib/engines/nudges.ts`, `doctorQuestions.ts` |
| CGM CSV import (Dexcom Clarity, LibreView, generic) | `src/lib/engines/cgmImport.ts` |
| Lab extraction, A1C conversions | `src/lib/engines/labs.ts` |
| Clinical + medication knowledge | `src/lib/knowledge/` |
| Copilot orchestration, dose filter, meal photo | `src/lib/ai/` |
| Data loading for engines and Copilot | `src/lib/data/` |
| Seed content (recipes, exercise ideas, packing template, food reference) | `src/lib/data/seed/` |
| Carbohydrate reference: search, portion maths, personal response | `src/lib/engines/foods.ts`, `src/lib/data/foods.ts` |
| The one place `ai_audit` is written | `src/lib/data/aiAudit.ts` |
| Screens | `src/app/` — Today `/`, `/log/*`, `/trends`, `/review`, `/copilot`, `/plan`, `/move`, `/toolkit/*`, `/settings/*`, `/share/[token]` |

## Clinical definitions used

- Time-in-range bands: <54, 54–69, 70–180 (or the personal target), 181–250, >250 mg/dL
  (International Consensus on Time in Range, 2019).
- GMI = 3.31 + 0.02392 × mean mg/dL (Bergenstal 2018); flagged unreliable under 14 days.
- CV = sample SD / mean × 100; target ≤ 36%.
- Post-meal rise = max reading 1–3 h after the meal minus the reading nearest the meal within
  −60/+10 min. Meals without both are "uncovered" and shown as such.
- eAG = 28.7 × A1C − 46.7 (ADAG); IFCC mmol/mol = (A1C% − 2.15) × 10.929.

## What this is not

Not a medical device, not a dosing calculator, not a diagnostic tool. The knowledge layer has not
been clinician-reviewed. Both statements appear in the app.

## What a form is allowed to do

Two rules learned from an adversarial pass, and both cost real defects before they were written down.

**An id from a hidden field is untrusted.** `zStr(n)` has no minimum, so an empty string parsed
cleanly and the mutation ran against a filter matching nothing, then reported success. Every
mutation that takes an id now uses a schema with a minimum AND loads the row before changing it.
Where state matters, it is checked: a revoked share link cannot be edited, and restoring one issues
a new token rather than reviving the old URL.

**Anything that arrives in a URL is untrusted text, not app copy.** `?e=` and `?m=` are rendered
in a `role="alert"`, and while React escapes HTML, a crafted link could still display fabricated
dosing instructions in the app's own styling on the app's own domain. Those messages are length
capped and passed through the same dose filter and certainty softener the model's output gets, and
framed as the app reporting a problem rather than as a clinical statement.

## Known gaps

Stated here rather than discovered later.

- **There is no authentication.** No users, no sessions, no ownership column on any row. The demo
  gate in `src/proxy.ts` is one shared passphrase and says so in its own source. That is a
  defensible design for an app running on one person's machine and is not a foundation for a
  multi-user product.
- **The knowledge layer is not clinician-reviewed.** Every item carries
  `draft_needs_clinician_review`, and the app says so on `/settings/about`.
- **One SQLite file on one machine is a single writer.** Reads scale; concurrent writers do not.
  `fly.toml` pins one machine on purpose, because two would mean two databases disagreeing.
