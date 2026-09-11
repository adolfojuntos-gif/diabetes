/**
 * NOTE: no `server-only` import, for the same reason as `auth/tokens.ts`: the billing checks are
 * exercised from plain Node in `tests/billing.test.ts`. `tests/boundaries.test.ts` asserts that no
 * client component reaches into `lib/billing`, which is the property that was being guarded.
 */
/**
 * What plan an account is on, and what that entitles them to.
 *
 * `accounts.plan` is the single source of truth for ACCESS. The `subscriptions` row records what
 * Stripe last said, and the webhook is the only thing that moves a fact from one to the other. The
 * split matters in both directions: a Stripe outage cannot silently downgrade somebody who is
 * paying, and a malformed subscription row cannot grant access on its own.
 *
 * Everything here fails closed to `free`. If the plan cannot be read, the answer is the tier that
 * spends no money. An entitlement check that opens on error is not an entitlement check.
 */
import { eq } from "drizzle-orm";
import { controlDb, accounts, subscriptions, ENTITLING_STATUSES, type Plan, type Subscription } from "../db/control";
import { currentAccountId } from "../db";

export type PlanState = {
  plan: Plan;
  /** Null when this account has never been through checkout. */
  subscription: Subscription | null;
  /** True when the paid plan is set to lapse at the end of the period they already paid for. */
  endingAt: Date | null;
};

/** The plan an account is on. Fails closed to `free`. */
export async function planForAccount(accountId: string): Promise<Plan> {
  try {
    const rows = await controlDb().select({ plan: accounts.plan }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return rows[0]?.plan ?? "free";
  } catch {
    return "free";
  }
}

/**
 * The plan of whoever's database is currently in context.
 *
 * The same async-context trick the database Proxy uses, and for the same reason: the three places
 * that call a model are several layers below the request and should not have to thread a plan down
 * by hand. A caller that cannot be told which account it is serving gets `free`, not paid.
 */
export async function planForCurrentAccount(): Promise<Plan> {
  const id = currentAccountId();
  if (!id) return "free";
  return planForAccount(id);
}

/** The plan plus the subscription behind it, for the billing screen. */
export async function planStateFor(accountId: string): Promise<PlanState> {
  const [accountRows, subRows] = await Promise.all([
    controlDb().select({ plan: accounts.plan }).from(accounts).where(eq(accounts.id, accountId)).limit(1),
    controlDb().select().from(subscriptions).where(eq(subscriptions.accountId, accountId)).limit(1),
  ]);
  const sub = subRows[0] ?? null;
  return {
    plan: accountRows[0]?.plan ?? "free",
    subscription: sub,
    endingAt: sub?.cancelAtPeriodEnd ? (sub.currentPeriodEnd ?? null) : null,
  };
}

/**
 * The plan a subscription row entitles its owner to, on the evidence in the row alone.
 *
 * Pure, so the webhook's decision can be tested without Stripe and without a database. Two rules,
 * and both are about not trusting a single field:
 *
 *  - The status has to be one that entitles. `past_due` does not: Stripe is still retrying the card,
 *    and Stripe's own dunning window is the grace period, so there is no need to invent a second one.
 *  - The period end has to be in the future. A row left `active` by a webhook that never arrived
 *    would otherwise entitle somebody forever, and a missed `deleted` event is exactly the kind of
 *    thing that happens.
 */
export function entitlementFrom(sub: Pick<Subscription, "status" | "plan" | "currentPeriodEnd">, now = new Date()): Plan {
  if (!sub.status || !ENTITLING_STATUSES.includes(sub.status)) return "free";
  if (sub.plan === "free") return "free";
  /**
   * A missing period end is treated as valid. Stripe sends one on every subscription event, so its
   * absence means this row was written by something else, and refusing on it would downgrade a
   * paying subscriber over a field they have no control of. The status check above still applies.
   */
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() <= now.getTime()) return "free";
  return sub.plan;
}
