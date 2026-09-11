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
