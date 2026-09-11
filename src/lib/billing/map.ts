/**
 * Turning a Stripe object into this app's own facts. Pure, so it can be tested against a fixture
 * with no network and no keys.
 */
import type Stripe from "stripe";
import { SUB_STATUSES, type Plan, type SubStatus } from "../db/control";
import type { SubscriptionFacts } from "./apply";

/** Stripe's status strings, narrowed to the ones this app stores. Anything unknown is null. */
export function statusFrom(raw: string | null | undefined): SubStatus | null {
  if (!raw) return null;
  return (SUB_STATUSES as readonly string[]).includes(raw) ? (raw as SubStatus) : null;
}

/**
 * When the paid period ends, in seconds since the epoch.
 *
 * Stripe moved `current_period_end` off the subscription and onto its items in the 2025 API
 * versions. Reading the item first and the subscription second means this keeps working across the
 * change in either direction, which matters because getting it wrong does not throw: it reads as
 * "no period end", and a missing period end is treated as valid so a paying subscriber is not cut
 * off over a field they do not control. That is the safe direction, and it is still wrong.
 */
export function periodEndSecondsFrom(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  if (typeof item?.current_period_end === "number") return item.current_period_end;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof legacy === "number" ? legacy : null;
}

/** Seconds since the epoch to a Date, or null. Stripe sends seconds; `new Date` wants milliseconds. */
export function dateFromUnix(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/**
 * Which plan a price buys.
 *
 * One paid tier today, so any priced subscription is `plus`. When a second tier arrives this becomes
 * a real lookup from price id to plan, and the important part is that it stays a SERVER-side lookup:
 * the plan must never come from anything the buyer can choose freely.
 */
export function planForPrice(_priceId: string | null | undefined): Plan {
  return "plus";
}

/** The id of the first price on a subscription, for the lookup above. */
export function priceIdFrom(sub: Stripe.Subscription): string | null {
  const price = sub.items?.data?.[0]?.price;
  return typeof price === "string" ? price : (price?.id ?? null);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Everything this app records about a subscription, read off the Stripe object. */
export function factsFromSubscription(sub: Stripe.Subscription, accountId: string): SubscriptionFacts {
  const status = statusFrom(sub.status);
  return {
    accountId,
    stripeCustomerId: idOf(sub.customer),
    stripeSubscriptionId: sub.id,
    status,
    /**
     * A subscription Stripe does not consider live buys nothing, whatever its price says. Deriving
     * the plan from the price alone would leave a cancelled subscription recorded as `plus`, and
     * then any later bug that trusted the stored plan instead of the status would grant it.
     */
    plan: status && ["active", "trialing"].includes(status) ? planForPrice(priceIdFrom(sub)) : "free",
    currentPeriodEnd: dateFromUnix(periodEndSecondsFrom(sub)),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
  };
}

/**
 * The account a completed checkout belongs to.
 *
 * `client_reference_id` is set by this app when the session is created, so it is the authoritative
 * answer. It is read back from the SESSION STRIPE SENT, not from anything the browser passed on the
 * way home, which is the difference between an identifier and a claim.
 */
export function accountIdFromSession(session: Stripe.Checkout.Session): string | null {
  const ref = session.client_reference_id;
  return typeof ref === "string" && ref.length > 0 && ref.length <= 64 ? ref : null;
}

export function subscriptionIdFromSession(session: Stripe.Checkout.Session): string | null {
  return idOf(session.subscription);
}

export function customerIdFromSession(session: Stripe.Checkout.Session): string | null {
  return idOf(session.customer);
}
