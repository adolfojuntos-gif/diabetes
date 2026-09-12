import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Billing, tested without Stripe.
 *
 * Everything that decides whether somebody has paid is pure or reaches only a local database, which
 * is the reason the code is split the way it is: the HTTP route verifies a signature and parses, and
 * the deciding happens in functions that can be driven from here with a fixture.
 *
 * The failures these guard against are asymmetric and both are bad. Granting a plan to somebody who
 * has not paid is revenue and, worse, it is an unauthenticated caller changing an account. Refusing
 * a plan to somebody who has paid is a support ticket from a person who is unwell and was charged.
 *
 * IMPORT ORDER MATTERS ON THE FIRST LINE BELOW. `_controlEnv` points the control database at a
 * temporary file, and it has to run before anything imports `db/control`, which reads the variable
 * once at module load. Moving it down this list makes these tests write to the real control plane.
 */
import { CONTROL_DIR, CONTROL_PATH, cleanupControl } from "./_controlEnv";
import { createClient } from "@libsql/client";
import { controlDb, accounts, subscriptions, billingEvents } from "../src/lib/db/control";
import { CONTROL_SCHEMA_SQL } from "../src/lib/db/controlSchema";
import { entitlementFrom, planForAccount, planStateFor } from "../src/lib/billing/plan";
import { applySubscription, reconcileAccount, linkCustomer, accountForCustomer, alreadyHandled } from "../src/lib/billing/apply";
import {
  statusFrom,
  dateFromUnix,
  periodEndSecondsFrom,
  factsFromSubscription,
  accountIdFromSession,
  planForPrice,
} from "../src/lib/billing/map";
import { PLAN_LIMITS, verdictFor, windowsFor, rowsNeededFor, ROUGH_COST_USD } from "../src/lib/ai/limits";

/* ------------------------------- the harness ------------------------------- */

const client = createClient({ url: `file:${CONTROL_PATH}` });

test("setup: a control database with the real schema", async () => {
  // The same statement list the installer and the migration use, so a schema drift fails here too.
  for (const statement of CONTROL_SCHEMA_SQL) await client.execute(statement);
  const tables = await client.execute("select name from sqlite_master where type = 'table'");
  const names = tables.rows.map((r) => String(r.name));
  for (const required of ["accounts", "subscriptions", "billing_events"]) {
    assert.ok(names.includes(required), `${required} was not created`);
  }
});

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function makeAccount(plan: "free" | "plus" = "free") {
  const id = nextId("acct");
  await controlDb().insert(accounts).values({
    id,
    email: `${id}@steady.test`,
    passwordHash: "x",
    dbRef: `file:${CONTROL_DIR}/${id}.db`,
    plan,
    status: "active",
    provisionedAt: new Date(),
    createdAt: new Date(),
    lastSeenAt: null,
  });
  return id;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A Stripe subscription, only the fields this app reads. Shaped like the current API. */
function stripeSub(over: Partial<{ id: string; status: string; customer: string; cancel_at_period_end: boolean; periodEnd: number | null; price: string }> = {}) {
  const periodEnd = over.periodEnd === undefined ? Math.floor((Date.now() + 30 * DAY) / 1000) : over.periodEnd;
  return {
    id: over.id ?? "sub_test_1",
    status: over.status ?? "active",
    customer: over.customer ?? "cus_test_1",
    cancel_at_period_end: over.cancel_at_period_end ?? false,
    items: { data: [{ current_period_end: periodEnd, price: { id: over.price ?? "price_test_1" } }] },
  } as unknown as Parameters<typeof factsFromSubscription>[0];
}

/* ------------------------------- entitlement ------------------------------- */

test("only a live status entitles, and a lapsed period does not", () => {
  const future = new Date(Date.now() + DAY);
  const past = new Date(Date.now() - DAY);

  assert.equal(entitlementFrom({ status: "active", plan: "plus", currentPeriodEnd: future }), "plus");
  assert.equal(entitlementFrom({ status: "trialing", plan: "plus", currentPeriodEnd: future }), "plus");

  /**
   * `past_due` is the one people get wrong. Stripe is still retrying the card, and Stripe's own
   * dunning window IS the grace period, so inventing a second one here means serving somebody free
   * for however long that lasts on top.
   */
  assert.equal(entitlementFrom({ status: "past_due", plan: "plus", currentPeriodEnd: future }), "free");
  for (const status of ["canceled", "unpaid", "incomplete", "paused"] as const) {
    assert.equal(entitlementFrom({ status, plan: "plus", currentPeriodEnd: future }), "free", `${status} must not entitle`);
  }
  assert.equal(entitlementFrom({ status: null, plan: "plus", currentPeriodEnd: future }), "free");

  // The rule that stops a lost cancellation entitling somebody forever.
  assert.equal(entitlementFrom({ status: "active", plan: "plus", currentPeriodEnd: past }), "free");

  // A missing period end is allowed through, because refusing would cut off a paying subscriber
  // over a field they do not control. The status check still applies.
  assert.equal(entitlementFrom({ status: "active", plan: "plus", currentPeriodEnd: null }), "plus");
  assert.equal(entitlementFrom({ status: "active", plan: "free", currentPeriodEnd: null }), "free");
});

/* --------------------------- reading Stripe's shape --------------------------- */

test("an unrecognised Stripe status becomes null rather than being stored raw", () => {
  assert.equal(statusFrom("active"), "active");
  assert.equal(statusFrom("something_new_stripe_added"), null);
  assert.equal(statusFrom(undefined), null);
  assert.equal(statusFrom(""), null);
  // Null does not entitle, so an unknown status fails closed.
  assert.equal(entitlementFrom({ status: statusFrom("whatever"), plan: "plus", currentPeriodEnd: null }), "free");
});

test("epoch seconds become a date, and nonsense becomes null", () => {
  assert.equal(dateFromUnix(1_800_000_000)?.getTime(), 1_800_000_000_000, "Stripe sends seconds, Date wants ms");
  for (const bad of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(dateFromUnix(bad as number), null, `should reject: ${String(bad)}`);
  }
});

test("the period end is read off the subscription item, with the old location as a fallback", () => {
  // Stripe moved this field onto items in the 2025 API versions. Getting it wrong does not throw.
  const onItem = { items: { data: [{ current_period_end: 1_800_000_000 }] } } as unknown as Parameters<typeof periodEndSecondsFrom>[0];
  assert.equal(periodEndSecondsFrom(onItem), 1_800_000_000);

  const legacy = { items: { data: [{}] }, current_period_end: 1_700_000_000 } as unknown as Parameters<typeof periodEndSecondsFrom>[0];
  assert.equal(periodEndSecondsFrom(legacy), 1_700_000_000);

  const neither = { items: { data: [] } } as unknown as Parameters<typeof periodEndSecondsFrom>[0];
  assert.equal(periodEndSecondsFrom(neither), null);
});

test("a subscription Stripe does not consider live maps to the free plan, whatever its price says", () => {
  /**
   * The important one. Deriving the plan from the price alone would record a cancelled subscription
   * as `plus`, and then any later code that trusted the stored plan rather than the status would
   * hand out paid access on a cancelled card.
   */
  const live = factsFromSubscription(stripeSub({ status: "active" }), "acct-x");
  assert.equal(live.plan, "plus");
  assert.equal(live.status, "active");
  assert.equal(live.stripeCustomerId, "cus_test_1");

  const dead = factsFromSubscription(stripeSub({ status: "canceled" }), "acct-x");
  assert.equal(dead.plan, "free", "a cancelled subscription must not be recorded as a paid plan");
  assert.equal(planForPrice("price_test_1"), "plus", "the price still maps to plus; the status is what refused");
});

test("the account reference on a checkout session is validated, not trusted", () => {
  assert.equal(accountIdFromSession({ client_reference_id: "acct-1" } as never), "acct-1");
  assert.equal(accountIdFromSession({ client_reference_id: "" } as never), null);
  assert.equal(accountIdFromSession({ client_reference_id: null } as never), null);
  assert.equal(accountIdFromSession({} as never), null);
  // A long value is refused rather than passed to a query as an account id.
  assert.equal(accountIdFromSession({ client_reference_id: "x".repeat(65) } as never), null);
});

/* ------------------------------ the plan caps ------------------------------ */

test("the free plan cannot reach the paid features, and says so without a reset time", () => {
  const plan = "free" as const;
  assert.equal(windowsFor(plan, "coach")[0].max, 0);

  const v = verdictFor("coach", plan, []);
  assert.equal(v.allowed, false);
  assert.equal(v.max, 0);
  /**
   * The bug this guards: the general path reads the oldest call in the window to work out when a
   * slot frees, and with a zero allowance there are no calls, so it built a date from NaN and told
   * the person their check-in would be available at "Invalid Date".
   */
  assert.equal(v.resetsAt, null, "waiting cannot help, so there must be no reset time");
  assert.equal(Number.isNaN(new Date(v.resetsAt ?? 0).getTime()), false);
  assert.match(v.message, /not part of your plan/i);
  assert.equal(v.upgradeWouldHelp, true, "the interface needs to know an upgrade is the answer");
});

test("a free account gets a real taste of the photo estimator and then stops", () => {
  const cap = windowsFor("free", "photo").find((w) => w.label === "month")!.max;
  assert.ok(cap > 0 && cap < 10, `a taste, not a living: got ${cap}`);

  const recent = Array.from({ length: cap }, (_, i) => new Date(Date.now() - i * DAY));
  const blocked = verdictFor("photo", "free", recent);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.upgradeWouldHelp, true);
  // The free path has to be named, because the feature degrading is the whole design.
  assert.match(blocked.message, /carbohydrate reference|by hand/i);

  // The same usage on the paid plan is fine, which is what somebody is buying.
  assert.equal(verdictFor("photo", "plus", recent).allowed, true);
});

test("the paid caps cannot cost more than the subscription earns", () => {
  /**
   * The finding that motivated this whole stage: the old caps allowed $299 of inference on a $20
   * plan. This is the assertion that stops that coming back, and it is deliberately written against
   * revenue rather than against a fixed number, so changing a cap fails here rather than silently
   * turning the product upside down.
   *
   * $20 less Stripe's 2.9% plus 30 cents leaves $19.12 a month.
   */
  const KEPT_PER_MONTH = 19.12;
  let worst = 0;
  for (const feature of ["photo", "copilot", "coach"] as const) {
    const monthly = PLAN_LIMITS.plus[feature].find((w) => w.label === "month");
    assert.ok(monthly, `${feature} needs a monthly cap or its spend is unbounded`);
    worst += monthly.max * ROUGH_COST_USD[feature];
  }
  assert.ok(
    worst < KEPT_PER_MONTH,
    `a subscriber riding every cap costs $${worst.toFixed(2)} against $${KEPT_PER_MONTH} kept`,
  );
  // And with real headroom, not by a cent, because these are Opus rates and estimates.
  assert.ok(worst < KEPT_PER_MONTH * 0.6, `only $${(KEPT_PER_MONTH - worst).toFixed(2)} of margin left`);
});

test("every feature on every plan has a monthly cap", () => {
  // An hourly cap alone bounds a burst and not a month: 6 photos an hour is 4,320 a month.
  for (const plan of ["free", "plus"] as const) {
    for (const feature of ["photo", "copilot", "coach"] as const) {
      const labels = windowsFor(plan, feature).map((w) => w.label);
      assert.ok(labels.includes("month"), `${plan}/${feature} has no monthly cap: ${labels.join(", ")}`);
    }
  }
});

test("the audit query asks for enough rows to see over any cap", () => {
  /**
   * The old query took 500 rows. That is ample today and a fail-OPEN the moment a plan allows more:
   * a truncated count makes somebody look under their limit when they are over it. Derived now, so
   * raising a cap cannot reintroduce it.
   */
  for (const plan of ["free", "plus"] as const) {
    for (const feature of ["photo", "copilot", "coach"] as const) {
      const biggest = Math.max(...windowsFor(plan, feature).map((w) => w.max));
      assert.ok(rowsNeededFor(plan, feature) > biggest, `${plan}/${feature} would truncate at its own cap`);
    }
  }
});

test("an unknown plan is treated as free, never as paid", () => {
  // A plan string from an older row, or a typo in a manual database edit, must not grant access.
  const windows = windowsFor("enterprise" as never, "photo");
  assert.deepEqual(windows, PLAN_LIMITS.free.photo);
});

/* --------------------------- applying what Stripe said --------------------------- */

test("a completed subscription upgrades exactly the account it names", async () => {
  const target = await makeAccount();
  const bystander = await makeAccount();

  const result = await applySubscription(factsFromSubscription(stripeSub({ customer: nextId("cus") }), target), {
    id: nextId("evt"),
    type: "customer.subscription.created",
    createdAt: new Date(),
  });

  assert.equal(result.applied, true);
  assert.equal(await planForAccount(target), "plus");
  assert.equal(await planForAccount(bystander), "free", "another account was changed by this event");
});

test("a replayed event changes nothing the second time", async () => {
  const id = await makeAccount();
  const eventId = nextId("evt");
  const meta = { id: eventId, type: "customer.subscription.created", createdAt: new Date() };

  const first = await applySubscription(factsFromSubscription(stripeSub({ customer: nextId("cus") }), id), meta);
  assert.equal(first.applied, true);
  assert.equal(await alreadyHandled(eventId), true, "the event has to be recorded or a retry reapplies it");

  // Stripe retries on any non-2xx, so this is the normal case rather than an attack.
  const second = await applySubscription(factsFromSubscription(stripeSub({ customer: nextId("cus") }), id), meta);
  assert.equal(second.applied, false);
  assert.equal(second.applied === false && second.reason, "duplicate");
});

test("an event older than one already applied is ignored, not applied backwards", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  const now = Date.now();

  // The cancellation happened second and arrived first, which Stripe permits.
  await applySubscription(factsFromSubscription(stripeSub({ customer: cus, status: "canceled" }), id), {
    id: nextId("evt"),
    type: "customer.subscription.deleted",
    createdAt: new Date(now),
  });
  assert.equal(await planForAccount(id), "free");

  // The older activation now turns up. Arrival order would upgrade them again; Stripe's clock says no.
  const stale = await applySubscription(factsFromSubscription(stripeSub({ customer: cus, status: "active" }), id), {
    id: nextId("evt"),
    type: "customer.subscription.updated",
    createdAt: new Date(now - 60_000),
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.applied === false && stale.reason, "stale");
  assert.equal(await planForAccount(id), "free", "a stale event resurrected a cancelled subscription");
});

test("cancellation, expiry and a failed payment all end on free", async () => {
  for (const status of ["canceled", "unpaid", "past_due", "incomplete"] as const) {
    const id = await makeAccount("plus");
    const applied = await applySubscription(factsFromSubscription(stripeSub({ customer: nextId("cus"), status }), id), {
      id: nextId("evt"),
      type: "customer.subscription.updated",
      createdAt: new Date(),
    });
    assert.equal(applied.applied, true);
    assert.equal(await planForAccount(id), "free", `${status} left the account on a paid plan`);
  }
});

test("an event for an account that does not exist grants nothing", async () => {
  const result = await applySubscription(factsFromSubscription(stripeSub({ customer: nextId("cus") }), "acct-does-not-exist"), {
    id: nextId("evt"),
    type: "customer.subscription.created",
    createdAt: new Date(),
  });
  assert.equal(result.applied, false);
  assert.equal(result.applied === false && result.reason, "unknown_account");

  // Recorded even so, because an event nobody can be found for is worth being able to look up.
  const rows = await controlDb().select().from(billingEvents);
  assert.ok(rows.some((r) => r.outcome.includes("unknown account")));
});

test("a customer is mapped to its account before checkout, so an early webhook can be attributed", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  assert.equal(await accountForCustomer(cus), null);

  await linkCustomer(id, cus);
  assert.equal(await accountForCustomer(cus), id);

  // Linking a customer is not a sale. This is the bug where recording the id upgrades somebody.
  assert.equal(await planForAccount(id), "free");

  // Called twice, as it is on a second checkout attempt, it must not create a second row.
  await linkCustomer(id, cus);
  const rows = await controlDb().select().from(subscriptions);
  assert.equal(rows.filter((r) => r.accountId === id).length, 1);
});

test("a period that has quietly ended is caught without any event arriving", async () => {
  /**
   * The safety net for the webhook that never comes. A `customer.subscription.deleted` that is lost,
   * or a deployment that was down for its delivery window, would otherwise leave somebody on the
   * paid plan indefinitely with a status of `active` and a period end in the past.
   */
  const id = await makeAccount();
  await applySubscription(
    factsFromSubscription(stripeSub({ customer: nextId("cus"), periodEnd: Math.floor((Date.now() + DAY) / 1000) }), id),
    { id: nextId("evt"), type: "customer.subscription.created", createdAt: new Date() },
  );
  assert.equal(await planForAccount(id), "plus");

  // Two days later, with no renewal event.
  const later = new Date(Date.now() + 2 * DAY);
  assert.equal(await reconcileAccount(id, later), "free");
  assert.equal(await planForAccount(id), "free");
});

test("reconciling leaves an account with no subscription row alone", async () => {
  // An account upgraded by hand, for a family member or a clinician, must not be swept back to free.
  const id = await makeAccount("plus");
  assert.equal(await reconcileAccount(id), "plus");
  assert.equal(await planForAccount(id), "plus");
});

test("the billing screen can read a plan with no subscription behind it", async () => {
  const id = await makeAccount();
  const state = await planStateFor(id);
  assert.equal(state.plan, "free");
  assert.equal(state.subscription, null);
  assert.equal(state.endingAt, null);
});

test("a subscription set to cancel still reads as paid until the period ends", async () => {
  const id = await makeAccount();
  // Seconds, because that is Stripe's unit. Deriving the expectation from the same integer avoids
  // comparing a truncated round trip against a millisecond-precision original.
  const endSeconds = Math.floor((Date.now() + 10 * DAY) / 1000);
  const end = new Date(endSeconds * 1000);
  await applySubscription(
    factsFromSubscription(stripeSub({ customer: nextId("cus"), cancel_at_period_end: true, periodEnd: endSeconds }), id),
    { id: nextId("evt"), type: "customer.subscription.updated", createdAt: new Date() },
  );

  // They paid for this month. Cancelling is a decision about the next one.
  assert.equal(await planForAccount(id), "plus");
  const state = await planStateFor(id);
  assert.ok(state.endingAt, "the screen has to be able to say when access stops");
  assert.equal(state.endingAt?.getTime(), end.getTime());
});

test("teardown", async () => {
  try {
    client.close();
  } catch {
    /* ignore */
  }
  await cleanupControl();
});

/* ------------------------- unlimited signup was the hole ------------------------- */

test("signups from one address are capped, because the spend caps are per account", async () => {
  /**
   * The per-account AI caps do their job and are the wrong shape for this. Total spend is unbounded
   * in the NUMBER of accounts, and signup had no limit at all on a public URL, so a script could
   * spend the free tier once per account indefinitely. Sign-in was rate limited throughout; signup
   * was not.
   */
  const { tooManySignups, recordSignup } = await import("../src/lib/auth/provision");
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

  assert.equal(await tooManySignups(ip), false, "a first signup must be allowed");

  // A household or somebody setting an account up for a parent is real, so the limit is not one.
  for (let i = 0; i < 5; i++) {
    await recordSignup(ip);
    assert.equal(await tooManySignups(ip), false, `signup ${i + 2} from one address should still be allowed`);
  }

  await recordSignup(ip);
  assert.equal(await tooManySignups(ip), true, "the cap never engaged");

  // Another address is unaffected, or one busy office would lock out everybody else.
  assert.equal(await tooManySignups("198.51.100.7"), false, "the limit leaked across addresses");
});

test("a signup with no address to attribute is allowed rather than refused", async () => {
  /**
   * Deliberately open in this one direction. Some proxies strip the header, and refusing every
   * visitor behind one would break the product for them completely, which is a worse failure than
   * one unattributable account getting through.
   */
  const { tooManySignups } = await import("../src/lib/auth/provision");
  assert.equal(await tooManySignups(null), false);
});
