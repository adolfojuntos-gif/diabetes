# Steady — conventions for anyone writing a screen

Read `docs/ARCHITECTURE.md` first. Its 10 invariants are binding.

## Stack facts
- Next.js 16 App Router. **Server Components by default.** `export const dynamic = "force-dynamic"` is set
  on the root layout, so pages may read the DB directly.
- Server actions live in the page file or a sibling `actions.ts` with `"use server"` at the top.
  After writing, call `revalidatePath(...)` for the paths that show the data.
- Forms post to server actions directly (`<form action={myAction}>`). Use `SubmitButton` from
  `@/components/Form` for the pending state. Only add `"use client"` when you need state or an event handler.
- Validate every action input with the helpers in `@/lib/actions` (`parseForm`, `zLocalDateTime`, `zNum`,
  `zOptNum`, `zStr`, `zOptStr`). Never trust FormData.
- IDs: `newId()` from `@/lib/ids`. Timestamps: `new Date()`, stored as Drizzle `timestamp` mode.
- Dates and week keys: `@/lib/time` (`dateKey`, `startOfDay`, `endOfDay`, `startOfWeek`, `addDays`,
  `fmtDay`, `fmtTime`, `toDateTimeInput`, `relative`). Never write your own date math.
- Glucose: `@/lib/units` (`toMgdl`, `formatGlucose`, `unitLabel`, `bandOf`, `BAND_LABEL`,
  `GLUCOSE_MIN_MGDL`, `GLUCOSE_MAX_MGDL`). **Store mg/dL. Always.** Convert from the profile's unit
  at the edge with `toMgdl(value, profile.units)`.
- DB: `import { db, <table> } from "@/lib/db"`. Profile: `getProfile()` from `@/lib/data/snapshot`
  (there is exactly one row, id 1).

## UI kit — use these, do not reinvent
From `@/components/ui`: `PageHeader`, `Card`, `Stat`, `GlucoseChip`, `EmptyState`, `TriageBanner`,
`PatternCard`, `TirBar`, `Notice`. From `@/components/Form`: `SubmitButton`.
CSS classes in `globals.css`: `.page` (wrap every page body in `<div className="page">`), `.card`,
`.card-quiet`, `.card-sunk`, `.eyebrow`, `.lede`, `.muted`, `.faint`, `.hint`, `.num`, `.big-num`,
`.btn` (+ `.btn-secondary .btn-ghost .btn-juniper .btn-slate .btn-danger .btn-sm .btn-lg`),
`.field .label .input .select .textarea .input-big`, `.pill` (+ `-juniper -slate -amber -coral`),
`.seg`, `.divider`, `.prose-measure`, `.sev-*`, `.chip-*`, `.band-*`, `.bg-band-*`, `.no-print`.
Tailwind utilities are available; prefer the component classes for anything that repeats.

## Colour rule
Coral = low, amber = high, juniper = in range, ember = very high, slate = the Copilot's voice.
**Never use coral or amber for anything that is not a glucose band or a safety level.**

## Voice
Plain English. "Log a reading", not "Record glycemic datum". Warm, never guilt-inducing, never
congratulatory about a number the person did not choose. Never imply a clinician saw anything.
No em-dashes in user-facing copy.

## Charts
Inline SVG only. No chart library. Give every chart `role="img"` and an `aria-label` naming the
numbers. Wide things scroll inside `overflow-x:auto`.

## Accessibility
Every input has a `<label>`. Tap targets 44px (the `.btn`/`.input` classes already do this).
Never rely on colour alone: pair a band colour with its label or value.

## Accounts: how every screen and action must be written

The app is multi-tenant by **one database per account**. `db` is a Proxy that resolves to the
signed-in account's database, and **it throws if no account is in context.** That is deliberate: a
handle that silently defaulted somewhere is how data ends up in the wrong person's records.

So every page and every server action that touches clinical data must establish the context.

**A page:**

```tsx
import { requireAccount } from "@/lib/auth/session";

export default async function Trends({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  return requireAccount(async (account) => {
    const snap = await loadSnapshot(14);   // db now resolves to this account
    return <div className="page">...</div>;
  });
}
```

**A server action:**

```ts
async function logGlucose(fd: FormData) {
  "use server";
  return requireAccount(async () => {
    // parse, validate, write
  });
}
```

Rules:

- **Wrap the whole body**, not just the query. Anything that reaches `db` has to be inside.
- `requireAccount` **redirects to `/signin`** when there is no session, so a page never has to check.
- **Do not wrap children in a layout.** React may render a layout and a page in separate async
  tasks, so context set in a layout is not guaranteed to reach the page. The root layout resolves
  the account only for the chrome it draws, and each page establishes its own.
- For a route handler, a cron, or a script there is no cookie, so use `asAccount(account, fn)` with
  the account resolved explicitly.
- Never import `controlDb` outside `src/lib/auth`. Accounts, sessions and billing are not
  application data, and a screen has no business reading them.
- After adding or changing a table in `src/lib/db/schema.ts`, run **`npm run schema:build`**. New
  accounts get their database from the generated statements, and a test fails if it has drifted.

## Charts

Server-rendered SVG or plain styled elements. No charting library, and no client JavaScript for a
chart. These appear on the first screen somebody opens in the morning, and a chart that arrives
after a spinner is a chart they have already scrolled past.

**A chart may not show a number its own text does not state.** The engine builds the chart spec from
the same values as the sentence beside it, and the component does geometry only: a value becomes a
bar length, a unit becomes a label. A chart is read faster and trusted harder than a sentence, so
one that disagreed with the words beneath it would be worse than no chart. `tests/patternCharts.test.ts`
asserts this across every pattern the engine can produce.

Three further rules, each of which was broken once:

- **Bars start at zero.** Starting an axis at the smallest value is the standard way to make a small
  difference look enormous. On a glucose comparison that is not a presentation choice, it is a
  misleading medical picture.
- **A track has to be long enough for the value.** A fixed maximum is right where the scale is
  bounded, and quietly wrong where it is not: the share of readings under target was drawn on a
  track ending at 12%, and at 51% the needle pinned at the end and said "off the scale" when the
  number said something far more specific.
- **A word that follows a count has to agree with it.** "1 readings under 54" reached the screen.
  The engine picks the word, because it is the thing that knows the count.

## Scripts

**Every script that touches clinical data names an account on the command line.** There is no single
database and no default account, so there is nothing sensible to fall back to. `scripts/_account.ts`
is the one place that resolves one: `runForAccount` for anything using Drizzle's `db`, and
`clientFromArgv` for the scripts that write SQL by hand.

This is written down because the same bug appeared in eight scripts. Five built a client from
`process.env.DATABASE_URL ?? "file:./data/steady.db"`, which was correct when there was one database
and is silently wrong now: that file is only the pre-migration backup, so those scripts wrote rows
nothing would ever read and reported success. Three used `db` with no context and threw, which is
the fail-closed default working properly and at least said so.

A script that cannot tell which account it is for must refuse. Guessing, or taking the first
account, is the one behaviour that must never be added.

**Scripts are `.ts`, run through `tsx`, and registered in `package.json`.** A `.mjs` script cannot
import the app's own modules, so it ends up with a hand-written copy of whatever it needed, and the
copy drifts. That is how two food scripts came to disagree about what a duplicate food is: one
compared names exactly, the other normalised them but kept word order, and between them they
inserted six duplicates and then reported finding none. Shared rules live in one module.

**A destructive maintenance script reports by default.** Deleting on a fuzzy match without being
asked is not a thing to build. `foods:dedupe` prints what it would remove and needs `--apply`.

## Nutrition figures

**No carbohydrate figure is ever written from recall.** Somebody doses insulin against these
numbers. A figure that was recalled, inferred from a similar dish, or averaged across a category is
a made-up number wearing the clothes of a measurement, and it is worse than no figure at all,
because a person trusts it more than their own estimate of the plate in front of them.

So every row in the food reference names its source, and restaurant data is imported from a file the
restaurant published rather than typed. `npm run foods:restaurant` is the way in, and it validates
before it writes:

- Carbohydrate, protein and fat cannot exceed the serving weight. This is the check that catches a
  per-100g column pasted into a per-serving one, where every individual number looks plausible and
  the row is only wrong in relation to the weight.
- Calories have to agree with the macros within a quarter, at roughly 4 kcal a gram for protein and
  carbohydrate and 9 for fat.
- Fibre cannot exceed carbohydrate.
- A serving weight is required, because without one a per-serving figure cannot be converted and
  guessing the weight would invent the number.

**A restaurant figure carries the date it was read**, and the app says how old it is. A government
reference does not drift: a release is a version, and cooked rice contains what it contained. A
chain reformulates a sandwich, changes a supplier or resizes a portion whenever it likes, and the
old number stays exactly as authoritative-looking as it was. An undated figure invites more trust
than it has earned.

**Nothing in the wording may claim a figure describes the plate in front of the person.** A
published figure describes a standard recipe and a standard portion. It does not know how much rice
this kitchen put in this bowl. `tests/restaurant.test.ts` scans the provenance and age wording for
"exact", "accurate", "precise", "verified" and "your plate".
