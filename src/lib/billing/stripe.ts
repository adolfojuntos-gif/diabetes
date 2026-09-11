/**
 * NOTE: no `server-only` import, so `tests/billing.test.ts` can reach the pure helpers from plain
 * Node. `tests/boundaries.test.ts` asserts no client component imports `lib/billing`.
 */
/**
 * The Stripe client and the configuration around it.
 *
 * Two rules shape this file.
 *
 * IT IS OPTIONAL, AND MISSING MEANS OFF. The app has to run with no Stripe keys at all: that is the
 * developer's machine, and it is also the state a misconfigured deployment is in. Missing keys mean
 * no checkout is offered and nobody's plan changes. An app that opens its paid features when its
 * billing is misconfigured is worse than one that refuses, because the failure is invisible and
 * every user is affected.
 *
 * NO CARD DATA REACHES THIS APP. Checkout and the billing portal are hosted by Stripe. This app
 * knows a customer id and a subscription id, and nothing else: no card, no last four digits, no
 * billing address. That is the reason for using hosted checkout rather than a form.
 */
import Stripe from "stripe";

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  /** The recurring price the upgrade button buys. */
  priceId: string;
};

/**
 * Read the configuration, or explain what is missing.
 *
 * Returns a reason rather than throwing, because "billing is not set up" is a state the billing
 * screen has to render, not an error it should crash on.
 */
export function stripeConfig(): { ok: true; config: StripeConfig } | { ok: false; missing: string[] } {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const priceId = process.env.STRIPE_PRICE_ID ?? "";
  const missing: string[] = [];
  if (!secretKey) missing.push("STRIPE_SECRET_KEY");
  if (!webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!priceId) missing.push("STRIPE_PRICE_ID");
  if (missing.length) return { ok: false, missing };
  return { ok: true, config: { secretKey, webhookSecret, priceId } };
}

export function billingConfigured(): boolean {
  return stripeConfig().ok;
}

/**
 * True when the keys are Stripe's test keys. The billing screen says so, because the single worst
 * billing outcome is believing you are taking real money when you are not, or the reverse.
 */
export function isTestMode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

const g = globalThis as unknown as { __stStripe?: Stripe };

/** Lazy, like every other client here, so `next build` does not need a key to collect page data. */
export function stripeClient(): Stripe {
  if (g.__stStripe) return g.__stStripe;
  const cfg = stripeConfig();
  if (!cfg.ok) throw new Error(`Stripe is not configured: ${cfg.missing.join(", ")} not set`);
  const client = new Stripe(cfg.config.secretKey, {
    /**
     * Pinned. An unpinned version means Stripe can change the shape of a webhook payload under a
     * running deployment, and the thing reading that payload decides who has paid.
     */
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
    appInfo: { name: "Steady", version: "1.0.0" },
  });
  g.__stStripe = client;
  return client;
}

/**
 * Where Stripe sends people back to. Absolute, because Stripe redirects a browser to it.
 *
 * `APP_URL` is the deployment's own address and is not derived from the request, on purpose: a
 * `Host` header is attacker-controlled, and a success URL built from one is an open redirect on the
 * end of a payment flow.
 */
export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3140").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** What $20 a month looks like to a person. Display only; Stripe holds the real price. */
export const PLUS_PRICE_DISPLAY = process.env.STRIPE_PRICE_DISPLAY ?? "$20 a month";
