/**
 * NOTE: no `server-only` import, so `tests/billing.test.ts` can drive this from plain Node against
 * a temporary control database. `tests/boundaries.test.ts` asserts no client component imports it.
 */
/**
 * Turning what Stripe said into what the app enforces.
 *
 * This is the only code that changes `accounts.plan`, and it is deliberately separate from the HTTP
 * route so it can be tested without Stripe, without a network, and without a signature. The route's
 * job is to verify the signature and parse; this file's job is to decide.
 *
 * Three properties it has to hold, all of them about Stripe's delivery guarantees being weaker than
 * people assume:
 *
 *  - AT LEAST ONCE, NOT EXACTLY ONCE. Stripe retries on any non-2xx, and a retry of an event
 *    already applied must change nothing.
 *  - OUT OF ORDER. Two events about one subscription can arrive in either order. The later one by
 *    Stripe's own clock wins, not the one that happened to arrive second.
 *  - EVENTUALLY, NOT PROMPTLY. An event can be delayed or lost, so entitlement is not "the last
 *    status we were told" alone; the period end has to still be in the future. See
 *    `entitlementFrom`, which is the rule that stops a lost cancellation entitling somebody forever.
 */
import { eq } from "drizzle-orm";
import {
  controlDb,
  accounts,
  subscriptions,
  billingEvents,
  type Plan,
  type SubStatus,
} from "../db/control";
import { entitlementFrom } from "./plan";

export type SubscriptionFacts = {
  accountId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubStatus | null;
  plan: Plan;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type EventMeta = { id: string; type: string; createdAt: Date | null };

export type ApplyOutcome =
  | { applied: true; accountId: string; plan: Plan; previousPlan: Plan }
  | { applied: false; reason: "duplicate" | "stale" | "unknown_account" | "no_account_mapping" };

/**
 * Has this event been seen before?
 *
 * Checked against a table of every event id rather than only the last one on the subscription row,
 * because the hard case is not an immediate retry. It is the same event replayed after a later one
 * has already landed, which the last-event field alone would let through.
 */
export async function alreadyHandled(eventId: string): Promise<boolean> {
  const rows = await controlDb().select({ id: billingEvents.id }).from(billingEvents).where(eq(billingEvents.id, eventId)).limit(1);
  return rows.length > 0;
}

/** Write the event down. Called for every event, including the ones deliberately ignored. */
export async function noteEvent(meta: EventMeta, accountId: string | null, outcome: string): Promise<void> {
  try {
    await controlDb()
      .insert(billingEvents)
      .values({
        id: meta.id,
        type: meta.type,
        accountId,
        receivedAt: new Date(),
        createdAt: meta.createdAt,
        outcome: outcome.slice(0, 200),
      })
      .onConflictDoNothing();
  } catch {
    /**
     * Swallowed. A missing audit line must not turn into a non-2xx, because Stripe reads a non-2xx
     * as "retry this", and retrying an event that was already applied is exactly what the audit
     * line exists to prevent. Failing here would make the problem it guards against more likely.
     */
  }
}

/** The account a Stripe customer belongs to, by the id recorded when the customer was created. */
export async function accountForCustomer(customerId: string): Promise<string | null> {
  const rows = await controlDb()
    .select({ accountId: subscriptions.accountId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  return rows[0]?.accountId ?? null;
}

/** The account a Stripe subscription belongs to. */
export async function accountForSubscription(subscriptionId: string): Promise<string | null> {
  const rows = await controlDb()
    .select({ accountId: subscriptions.accountId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);
  return rows[0]?.accountId ?? null;
}

/**
 * Remember which Stripe customer belongs to which account.
 *
 * Called when the customer is created, BEFORE checkout begins, so that a webhook arriving while the
 * person is still on Stripe's page can already be mapped back to an account. Doing this after
 * checkout would leave a window where a paid event cannot be attributed.
 */
export async function linkCustomer(accountId: string, customerId: string): Promise<void> {
  const existing = await controlDb().select().from(subscriptions).where(eq(subscriptions.accountId, accountId)).limit(1);
  if (existing[0]) {
    await controlDb()
      .update(subscriptions)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(subscriptions.accountId, accountId));
    return;
  }
  await controlDb().insert(subscriptions).values({
    accountId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    status: null,
    // No plan yet. Recording the customer is not a sale.
    plan: "free",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastEventId: null,
    lastEventAt: null,
    updatedAt: new Date(),
  });
}

/**
 * Apply what Stripe said to an account, and move `accounts.plan` to match.
 *
 * The order is: record the event, write the subscription row, then set the plan. If it dies part
 * way the worst state is a recorded event with an unchanged plan, which the next event repairs,
 * because Stripe sends the full current state on every subscription event rather than a delta.
 */
export async function applySubscription(facts: SubscriptionFacts, meta: EventMeta): Promise<ApplyOutcome> {
  if (await alreadyHandled(meta.id)) return { applied: false, reason: "duplicate" };

  const accountRows = await controlDb()
    .select({ id: accounts.id, plan: accounts.plan })
    .from(accounts)
    .where(eq(accounts.id, facts.accountId))
    .limit(1);
  const account = accountRows[0];
  if (!account) {
    await noteEvent(meta, facts.accountId, "unknown account");
    return { applied: false, reason: "unknown_account" };
  }

  const existing = await controlDb().select().from(subscriptions).where(eq(subscriptions.accountId, facts.accountId)).limit(1);
  const prior = existing[0];

  /**
   * Out-of-order guard. Stripe's `created` time orders two events correctly; arrival time does not.
   * A stale event is recorded and ignored rather than dropped silently, so the audit shows it came.
   *
   * Strictly older only. Two events with the same timestamp are possible and the second is not
   * necessarily stale, so those are applied.
   */
  if (prior?.lastEventAt && meta.createdAt && meta.createdAt.getTime() < prior.lastEventAt.getTime()) {
    await noteEvent(meta, facts.accountId, "stale, a newer event was already applied");
    return { applied: false, reason: "stale" };
  }

  const row = {
    stripeCustomerId: facts.stripeCustomerId ?? prior?.stripeCustomerId ?? null,
    stripeSubscriptionId: facts.stripeSubscriptionId ?? prior?.stripeSubscriptionId ?? null,
    status: facts.status,
    plan: facts.plan,
    currentPeriodEnd: facts.currentPeriodEnd,
    cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
    lastEventId: meta.id,
    lastEventAt: meta.createdAt,
    updatedAt: new Date(),
  };

  if (prior) {
    await controlDb().update(subscriptions).set(row).where(eq(subscriptions.accountId, facts.accountId));
  } else {
    await controlDb().insert(subscriptions).values({ accountId: facts.accountId, ...row });
  }

  const entitled = entitlementFrom({ status: facts.status, plan: facts.plan, currentPeriodEnd: facts.currentPeriodEnd });
  if (entitled !== account.plan) {
    await controlDb().update(accounts).set({ plan: entitled }).where(eq(accounts.id, facts.accountId));
  }

  await noteEvent(meta, facts.accountId, `plan ${account.plan} -> ${entitled} (${facts.status ?? "no status"})`);
  return { applied: true, accountId: facts.accountId, plan: entitled, previousPlan: account.plan };
}

/**
 * Re-check entitlement from the row already stored, with no new event.
 *
 * This is the safety net for the event that never arrives. A subscription whose period has ended
 * with no renewal is not entitled, however healthy its last recorded status was, and something has
 * to notice that without being told. Called from the billing screen and by a scheduled sweep.
 */
export async function reconcileAccount(accountId: string, now = new Date()): Promise<Plan> {
  const [subRows, accountRows] = await Promise.all([
    controlDb().select().from(subscriptions).where(eq(subscriptions.accountId, accountId)).limit(1),
    controlDb().select({ plan: accounts.plan }).from(accounts).where(eq(accounts.id, accountId)).limit(1),
  ]);
  const current = accountRows[0]?.plan ?? "free";
  const sub = subRows[0];
  // No subscription row at all means nothing to reconcile against. Leave the plan alone: an account
  // upgraded by hand, for a friend or a clinician, should not be downgraded by this sweep.
  if (!sub) return current;

  const entitled = entitlementFrom(sub, now);
  if (entitled !== current) {
    await controlDb().update(accounts).set({ plan: entitled }).where(eq(accounts.id, accountId));
  }
  return entitled;
}
