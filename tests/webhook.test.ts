import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

/**
 * The webhook route, driven directly with a Request object. No server, no network, no Stripe account.
 *
 * This is the single most security-sensitive endpoint in the app: it is reachable by anybody, it is
 * unauthenticated in the ordinary sense, and what it does is grant paid access. The signature is the
 * entire boundary. So the assertions here are mostly about refusal, and the one that matters most is
 * that a body which is perfectly well-formed JSON describing a paid subscription changes nothing
 * unless it is signed.
 *
 * IMPORT ORDER: `_controlEnv` first, and the Stripe variables set before the route is imported,
 * because `stripeConfig()` reads them per call but the module-level client is built once.
 */
import { CONTROL_DIR, CONTROL_PATH } from "./_controlEnv";

const WEBHOOK_SECRET = "whsec_test_secret_for_local_assertions_only";
process.env.STRIPE_SECRET_KEY = "sk_test_local_assertions_only";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_PRICE_ID = "price_test_local";
process.env.APP_URL = "http://localhost:3140";

import Stripe from "stripe";
import { createClient } from "@libsql/client";
import { controlDb, accounts, subscriptions, billingEvents } from "../src/lib/db/control";
import { CONTROL_SCHEMA_SQL } from "../src/lib/db/controlSchema";
import { planForAccount } from "../src/lib/billing/plan";
import { linkCustomer } from "../src/lib/billing/apply";
import { POST, GET } from "../src/app/api/stripe/webhook/route";

const client = createClient({ url: `file:${CONTROL_PATH}` });

/** Signature generation only. No key is used for anything that would leave the machine. */
const signer = new Stripe("sk_test_local_assertions_only");

let seq = 0;
const nextId = (p: string) => `${p}_${++seq}_${Math.random().toString(36).slice(2, 8)}`;

const DAY = 86_400_000;

function subscriptionEvent(over: {
  type?: string;
  customer: string;
  status?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  eventId?: string;
  created?: number;
}) {
  return {
    id: over.eventId ?? nextId("evt"),
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: over.created ?? Math.floor(Date.now() / 1000),
    type: over.type ?? "customer.subscription.updated",
    data: {
      object: {
        id: nextId("sub"),
        object: "subscription",
        status: over.status ?? "active",
        customer: over.customer,
        cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
        items: {
          data: [
            {
              current_period_end: over.periodEnd ?? Math.floor((Date.now() + 30 * DAY) / 1000),
              price: { id: "price_test_local" },
            },
          ],
        },
      },
    },
  };
}

/** A request signed the way Stripe signs one. */
function signedRequest(payload: unknown, opts: { secret?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const header = signer.webhooks.generateTestHeaderString({
    payload: body,
    secret: opts.secret ?? WEBHOOK_SECRET,
    timestamp: opts.timestamp,
  });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body,
  });
}

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

test("setup", async () => {
  for (const statement of CONTROL_SCHEMA_SQL) await client.execute(statement);
});

/* ------------------------------ refusing ------------------------------ */

test("an unsigned request is refused and grants nothing", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  /**
   * The attack, stated plainly: well-formed JSON describing an active paid subscription, posted by
   * anybody who knows the URL. Without signature verification this upgrades the account for free.
   */
  const res = await POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscriptionEvent({ customer: cus })),
    }),
  );

  assert.equal(res.status, 400);
  assert.equal(await planForAccount(id), "free", "an unsigned webhook upgraded an account");
});

test("a request signed with the wrong secret is refused", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  const res = await POST(subscriptedWrongSecret(subscriptionEvent({ customer: cus })));
  assert.equal(res.status, 400);
  assert.equal(await planForAccount(id), "free", "a forged signature upgraded an account");
});

function subscriptedWrongSecret(payload: unknown) {
  return signedRequest(payload, { secret: "whsec_a_completely_different_secret" });
}

test("a correctly signed body whose payload was then altered is refused", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  /**
   * Sign one payload, send another. This is what catches an implementation that verifies against a
   * reserialised body instead of the raw bytes, which is the most common way to get this wrong and
   * looks completely fine in a code review.
   */
  const honest = JSON.stringify(subscriptionEvent({ customer: nextId("cus") }));
  const header = signer.webhooks.generateTestHeaderString({ payload: honest, secret: WEBHOOK_SECRET });
  const tampered = JSON.stringify(subscriptionEvent({ customer: cus, status: "active" }));

  const res = await POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      body: tampered,
    }),
  );
  assert.equal(res.status, 400);
  assert.equal(await planForAccount(id), "free");
});

test("a signature from long ago is refused, so a captured request cannot be replayed", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  // Stripe's own tolerance is five minutes. An hour old is outside it.
  const hourAgo = Math.floor((Date.now() - 3_600_000) / 1000);
  const res = await POST(signedRequest(subscriptionEvent({ customer: cus }), { timestamp: hourAgo }));

  assert.equal(res.status, 400);
  assert.equal(await planForAccount(id), "free");
});

test("a GET is a 405 rather than a framework error", async () => {
  const res = await GET();
  assert.equal(res.status, 405);
});

/* ------------------------------ accepting ------------------------------ */

test("a properly signed subscription event upgrades the mapped account", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  const res = await POST(signedRequest(subscriptionEvent({ customer: cus, status: "active" })));
  assert.equal(res.status, 200);
  assert.equal(await planForAccount(id), "plus");
});

test("a signed event for a customer this app never issued grants nothing", async () => {
  /**
   * Legitimately possible: a subscription created by hand in the Stripe dashboard, or another
   * environment pointed at the same webhook. Granting on it would mean trusting a customer id that
   * was never linked to an account here.
   */
  const res = await POST(signedRequest(subscriptionEvent({ customer: "cus_never_seen_here" })));
  assert.equal(res.status, 200, "Stripe must not be asked to retry an event that can never succeed");
  const body = (await res.json()) as { handled?: boolean; reason?: string };
  assert.equal(body.handled, false);
  assert.match(String(body.reason), /no account mapping/);
});

test("the same signed event delivered twice is applied once", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);
  const event = subscriptionEvent({ customer: cus, eventId: nextId("evt") });

  const first = await POST(signedRequest(event));
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { handled?: boolean }).handled, true);

  // Stripe retries on any non-2xx and on its own schedule. A retry has to be a no-op, not a 500.
  const second = await POST(signedRequest(event));
  assert.equal(second.status, 200);
  assert.equal(((await second.json()) as { duplicate?: boolean }).duplicate, true);

  const rows = await controlDb().select().from(billingEvents);
  assert.equal(rows.filter((r) => r.id === event.id).length, 1, "the event was recorded twice");
});

test("a cancellation takes the plan away", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  await POST(signedRequest(subscriptionEvent({ customer: cus, status: "active" })));
  assert.equal(await planForAccount(id), "plus");

  const res = await POST(
    signedRequest(subscriptionEvent({ customer: cus, status: "canceled", type: "customer.subscription.deleted" })),
  );
  assert.equal(res.status, 200);
  assert.equal(await planForAccount(id), "free");
});

test("an event type this app does not handle is acknowledged and ignored", async () => {
  const id = await makeAccount();
  const cus = nextId("cus");
  await linkCustomer(id, cus);

  const res = await POST(signedRequest(subscriptionEvent({ customer: cus, type: "invoice.created" })));
  assert.equal(res.status, 200, "an unhandled type is not an error");
  assert.equal(((await res.json()) as { handled?: boolean }).handled, false);
  assert.equal(await planForAccount(id), "free", "an unhandled event changed a plan");
});

test("one account's event never moves another account's plan", async () => {
  const target = await makeAccount();
  const bystander = await makeAccount("plus");
  const cus = nextId("cus");
  await linkCustomer(target, cus);

  await POST(signedRequest(subscriptionEvent({ customer: cus, status: "canceled" })));
  assert.equal(await planForAccount(target), "free");
  assert.equal(await planForAccount(bystander), "plus", "an unrelated account was downgraded");
});

test("teardown", async () => {
  const rows = await controlDb().select().from(subscriptions);
  assert.ok(rows.length > 0, "the tests should have written subscription rows");
  try {
    client.close();
  } catch {
    /* ignore */
  }
  await rm(CONTROL_DIR, { recursive: true, force: true }).catch(() => {});
});
