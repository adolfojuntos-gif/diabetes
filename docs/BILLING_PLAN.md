# Billing: stage 5

Written 2026-09-11. Stage 5 of `MULTI_TENANCY_PLAN.md`, the last one before this can be sold.

## Lane

**Full.** Money, an external integration, and a webhook that grants paid access. The failure modes
are all expensive in one direction or the other: a caller who can grant themselves a plan, or a
paying subscriber who is refused the thing they paid for.

## Why the caps matter more than the checkout

The checkout is the easy half. `SUBSCRIPTION_ECONOMICS.md` already established the hard half:

> **Your current caps allow $299 of spend on a $20 plan.**

The caps in the app were built to stop a stranger with a demo link running up a bill, and they do
that. They are not plan limits. On a flat price you are not underwriting the average subscriber, you
are underwriting the worst one, and one determined or malfunctioning account at today's caps costs
fifteen times what it pays. So the load-bearing work in this stage is tying allowances to the plan,
and the checkout is what makes the plan mean something.

## Acceptance criteria

| # | Criterion |
|---|---|
| 1 | Every AI allowance comes from the account's plan, not from a global constant |
| 2 | The plus allowances match the economics doc: 90 photos, 120 Copilot replies, 30 briefs a month, with daily sub-caps |
| 3 | A free account that runs out degrades to the free path with an upgrade prompt, and never shows a broken screen |
| 4 | The plan is resolved server-side from the control plane. No value a client can send grants access |
| 5 | A webhook whose Stripe signature does not verify is rejected, and changes nothing |
| 6 | A replayed webhook does not apply twice |
| 7 | A completed checkout upgrades exactly the account it names and no other |
| 8 | Cancellation, expiry and a failed payment all end with the account on free |
| 9 | The billing screen shows the real plan, real usage against the real caps, and a working upgrade path |
| 10 | With no Stripe keys configured the app still runs, says billing is unavailable, and leaves every plan untouched |
| 11 | The suite, `tsc` and `next build` are clean |

## Decisions

**Stripe Checkout, not a card form.** No card details reach this app, which keeps it out of scope
for handling them at all. Cancellation and card updates go to Stripe's own billing portal for the
same reason.

**Billing lives in its own control-plane table.** Not columns on `accounts`. Every statement in
`controlSchema.ts` has to be `CREATE ... IF NOT EXISTS` so the file doubles as installer and
migration, and SQLite has no `ADD COLUMN IF NOT EXISTS`. A new table keeps that property. It also
keeps a Stripe customer id out of the row that every session lookup reads.

**The plan on `accounts` stays the single source of truth for access.** The subscription row records
what Stripe said; `accounts.plan` is what the app enforces. The webhook is the only thing that moves
one to the other. That way a Stripe outage cannot silently downgrade a paying subscriber, and a
malformed subscription row cannot grant access.

**Free is a real tier, not a wall.** 3 photo scans and 10 Copilot replies a month, and unlimited use
of everything that costs nothing: the 179-food carbohydrate reference with real portion weights, the
pattern engine, trends, the planner, the packing list, appointment prep. Somebody who never pays
still has a usable diabetes app. That is deliberate. The economics doc's largest lever is pointing
people at the free path, and a free tier that works is the same lever.

**Fails closed on configuration.** No keys means no checkout offered and nobody's plan changes. An
app that opens the paid features when its billing is misconfigured is worse than one that refuses.

## Not in scope

Annual billing, coupons, proration handling beyond what Stripe does itself, team plans, and usage
overage billing. The economics doc notes annual billing is worth more to the margin than any model
choice, so it is the obvious next thing, not part of this.
