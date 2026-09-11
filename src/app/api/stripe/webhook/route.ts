/**
 * POST /api/stripe/webhook
 *
 * The only thing in this app that can grant paid access, and the only thing reachable from the
 * internet that changes an account. So it is written to the same standard as the coach endpoint,
 * with one extra rule on top.
 *
 * THE SIGNATURE IS THE WHOLE SECURITY BOUNDARY. The body is a claim about who has paid, posted by
 * an unauthenticated caller. Without `constructEvent` verifying it against the signing secret,
 * anybody who knows this URL can upgrade any account by posting JSON at it. Nothing in here reads
 * the body before the signature is checked, and the raw bytes are used for the check because any
 * reserialisation changes them and invalidates the signature.
 *
 * WHAT A NON-2XX MEANS TO STRIPE. It means "retry". So a 500 is reserved for the case where a retry
 * could genuinely help, and everything else returns 200 with a reason: an event about an account
 * that does not exist will never succeed, and asking Stripe to redeliver it for three days is noise
 * that hides the events that do matter.
 *
 * It resolves no session and touches no account database. Billing lives entirely in the control
 * plane, so nothing here runs inside `withAccount`.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeConfig, stripeClient } from "@/lib/billing/stripe";
import { applySubscription, accountForCustomer, accountForSubscription, noteEvent, alreadyHandled } from "@/lib/billing/apply";
import { factsFromSubscription, accountIdFromSession, customerIdFromSession, subscriptionIdFromSession } from "@/lib/billing/map";

export const dynamic = "force-dynamic";

/** The events acted on. Everything else is recorded and ignored, rather than guessed at. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function POST(req: Request) {
  const cfg = stripeConfig();
  if (!cfg.ok) {
    // Nothing is configured, so nothing can be granted. Not a retryable condition.
    console.warn(`stripe webhook arrived with billing unconfigured: ${cfg.missing.join(", ")} not set`);
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  // The RAW body. Parsing and re-encoding it would change the bytes the signature covers.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, cfg.config.webhookSecret);
  } catch (err) {
    /**
     * A 400, not a 500. A body whose signature does not verify will not verify on a retry either,
     * and this is the one failure worth being loud about in the log: it is either a misconfigured
     * signing secret or somebody probing the endpoint.
     */
    console.warn(`stripe webhook signature rejected: ${err instanceof Error ? err.message : "unknown"}`);
    return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
  }

  const meta = { id: event.id, type: event.type, createdAt: event.created ? new Date(event.created * 1000) : null };

  try {
    if (!HANDLED.has(event.type)) {
      await noteEvent(meta, null, "not handled");
      return NextResponse.json({ received: true, handled: false });
    }

    // Checked before doing any work, so a retry is cheap as well as harmless.
    if (await alreadyHandled(event.id)) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const outcome =
      event.type === "checkout.session.completed"
        ? await handleCheckout(event.data.object as Stripe.Checkout.Session, meta)
        : await handleSubscription(event.data.object as Stripe.Subscription, meta);

    return NextResponse.json({ received: true, ...outcome });
  } catch (err) {
    /**
     * A 500 here is a request for a retry, and that is the right answer: the signature was valid, so
     * this is a real Stripe event that this app failed to record. Losing it means a paying
     * subscriber stays on free.
     */
    console.error(`stripe webhook ${event.type} (${event.id}) failed`, err);
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}

/**
 * A completed checkout.
 *
 * The subscription is re-fetched from Stripe rather than read out of the session, because the
 * session carries an id and this app needs the status and the period end. Fetching also means the
 * state applied is Stripe's current state, not whatever it was when the event was queued, which
 * matters when a retry arrives days later.
 */
async function handleCheckout(session: Stripe.Checkout.Session, meta: { id: string; type: string; createdAt: Date | null }) {
  const accountId = accountIdFromSession(session);
  if (!accountId) {
    await noteEvent(meta, null, "checkout with no client_reference_id");
    return { handled: false, reason: "no account reference" };
  }

  const subscriptionId = subscriptionIdFromSession(session);
  if (!subscriptionId) {
    /**
     * A one-off payment rather than a subscription. Not something this app sells, so it grants
     * nothing. Recorded, because money that arrived and bought nothing is worth being able to find.
     */
    await noteEvent(meta, accountId, "checkout completed with no subscription");
    return { handled: false, reason: "not a subscription" };
  }

  const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
  const facts = factsFromSubscription(sub, accountId);
  // The session's customer is the fallback, for the case where the subscription object omits it.
  if (!facts.stripeCustomerId) facts.stripeCustomerId = customerIdFromSession(session);

  const result = await applySubscription(facts, meta);
  return result.applied ? { handled: true, plan: result.plan } : { handled: false, reason: result.reason };
}

/**
 * Any subscription lifecycle event.
 *
 * The account is found from the customer id recorded before checkout began, falling back to the
 * subscription id. Both are server-side mappings written by this app; neither comes from the event.
 */
async function handleSubscription(sub: Stripe.Subscription, meta: { id: string; type: string; createdAt: Date | null }) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const accountId = (customerId ? await accountForCustomer(customerId) : null) ?? (await accountForSubscription(sub.id));

  if (!accountId) {
    /**
     * A subscription this app has no record of. It happens legitimately: a subscription created in
     * the Stripe dashboard by hand, or a leftover from a different environment pointed at the same
     * webhook. Granting a plan on it would mean trusting a customer id this app never issued.
     */
    await noteEvent(meta, null, `no account for customer ${customerId ?? "unknown"}`);
    return { handled: false, reason: "no account mapping" };
  }

  const result = await applySubscription(factsFromSubscription(sub, accountId), meta);
  return result.applied ? { handled: true, plan: result.plan } : { handled: false, reason: result.reason };
}

/** A GET is not part of the contract, but a 405 is clearer than a framework error page. */
export async function GET() {
  return NextResponse.json({ error: "This endpoint accepts POST from Stripe only." }, { status: 405 });
}
