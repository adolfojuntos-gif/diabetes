/**
 * NOTE: no `server-only` import, so the guards here can be reached from a plain Node test.
 * `tests/boundaries.test.ts` asserts no client component imports `lib/billing`.
 */
/**
 * Starting a checkout, and sending somebody to Stripe's billing portal.
 *
 * Everything that decides money is server side and derived from the signed-in account. Nothing a
 * browser sends chooses a price, a plan, a quantity or a customer. The only thing the client does is
 * ask to begin, and the answer is a URL on Stripe's domain.
 */
import { eq } from "drizzle-orm";
import { controlDb, accounts, subscriptions, type Account } from "../db/control";
import { stripeClient, stripeConfig, appUrl } from "./stripe";
import { linkCustomer } from "./apply";

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * The Stripe customer for an account, created once and remembered.
 *
 * The id is written to the control plane BEFORE checkout begins, because a webhook can arrive while
 * the person is still looking at Stripe's payment page. Recording it afterwards would leave a window
 * in which a paid event cannot be attributed to anybody.
 *
 * `metadata.accountId` is set as well, so the link is recoverable from the Stripe dashboard alone if
 * this database is ever lost.
 */
async function customerFor(account: Account): Promise<string> {
  const rows = await controlDb()
    .select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.accountId, account.id))
    .limit(1);
  const existing = rows[0]?.customerId;
  if (existing) return existing;

  const customer = await stripeClient().customers.create({
    email: account.email,
    metadata: { accountId: account.id },
  });
  await linkCustomer(account.id, customer.id);
  return customer.id;
}

/**
 * Begin an upgrade. Returns a URL to send the browser to, or a reason it cannot.
 *
 * Refuses when the account is already on the paid plan, rather than quietly selling a second
 * subscription to somebody who already has one. That is an easy mistake to make and an unpleasant
 * one to be on the receiving end of.
 */
export async function startCheckout(account: Account): Promise<CheckoutResult> {
  const cfg = stripeConfig();
  if (!cfg.ok) return { ok: false, error: "Billing is not set up on this deployment yet." };
  if (account.plan !== "free") return { ok: false, error: "You are already on Steady Plus." };
  if (account.status !== "active") return { ok: false, error: "This account cannot start a subscription." };

  try {
    const customerId = await customerFor(account);
    const session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      /** The account this purchase is for. Read back off the event Stripe sends, never off a redirect. */
      client_reference_id: account.id,
      line_items: [{ price: cfg.config.priceId, quantity: 1 }],
      /**
       * Absolute and built from the deployment's own configured address, not from the request's Host
       * header, which an attacker controls. A success URL taken from a header is an open redirect on
       * the end of a payment flow.
       */
      success_url: appUrl("/settings/billing?checkout=done"),
      cancel_url: appUrl("/settings/billing?checkout=cancelled"),
      /** Stripe collects and remits sales tax where it applies. Cheaper than getting it wrong. */
      automatic_tax: { enabled: true },
      billing_address_collection: "auto",
      allow_promotion_codes: true,
      subscription_data: { metadata: { accountId: account.id } },
    });
    if (!session.url) return { ok: false, error: "Stripe did not return a checkout page. Nothing was charged." };
    return { ok: true, url: session.url };
  } catch (err) {
    // The real reason goes to the log; the person gets a sentence that does not leak configuration.
    console.error("stripe checkout could not be created", err);
    return { ok: false, error: "The checkout page could not be opened. Nothing was charged." };
  }
}

/**
 * A link to Stripe's billing portal, where somebody can change their card or cancel.
 *
 * Cancelling is deliberately NOT a button in this app. Stripe's portal is authenticated by the
 * session this creates, shows the real invoices, and cannot get out of step with what Stripe
 * believes. A cancel button here would be a second source of truth about whether somebody is a
 * subscriber, and the whole design of this stage is to avoid having one of those.
 */
export async function portalUrl(account: Account): Promise<CheckoutResult> {
  const cfg = stripeConfig();
  if (!cfg.ok) return { ok: false, error: "Billing is not set up on this deployment yet." };

  const rows = await controlDb()
    .select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.accountId, account.id))
    .limit(1);
  const customerId = rows[0]?.customerId;
  if (!customerId) return { ok: false, error: "There is no subscription on this account yet." };

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: appUrl("/settings/billing"),
    });
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("stripe billing portal could not be created", err);
    return { ok: false, error: "The billing portal could not be opened." };
  }
}

/** The account row, fresh from the control plane. The session's copy can be a request old. */
export async function freshAccount(accountId: string): Promise<Account | null> {
  const rows = await controlDb().select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return rows[0] ?? null;
}
