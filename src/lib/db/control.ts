/**
 * NOTE: no `server-only` import here on purpose. The migration and seeding scripts import this
 * module from plain Node, and `server-only` throws outside Next's bundler. The boundary it was
 * guarding, that a screen must never import the control plane directly, is asserted by
 * `tests/boundaries.test.ts` instead, which is a check that also catches the case where somebody
 * adds the import back.
 */
/**
 * THE CONTROL DATABASE.
 *
 * Accounts, sessions and billing live here and nothing clinical does. Every account's health data
 * lives in its own separate database, so this file holds the keys and none of the contents.
 *
 * That split is the point. If this database leaks, an attacker learns who has an account and gets
 * scrypt hashes and session digests, which are useless without the per-account databases. If one
 * account's database leaks, it contains exactly one person's records. Neither failure exposes
 * everybody, which is what a single shared database with an `accountId` column would do.
 *
 * Kept deliberately separate from `src/lib/db/index.ts`, which resolves to the CURRENT REQUEST's
 * account. Anything that must work before a session exists, like signing in, uses this handle.
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp" });
const bool = (name: string) => integer(name, { mode: "boolean" });

export const PLANS = ["free", "plus"] as const;
export type Plan = (typeof PLANS)[number];

export const ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    /** Normalised once, in `normalizeEmail`, and used for both the index and every lookup. */
    email: text("email").notNull(),
    /** scrypt$N$r$p$salt$hash. Null means the account cannot sign in with a password yet. */
    passwordHash: text("password_hash"),
    /**
     * Where this account's clinical database lives. A path for a local file, or a Turso database
     * name. Stored rather than derived, so an account can be moved without changing its id.
     */
    dbRef: text("db_ref").notNull(),
    plan: text("plan", { enum: PLANS }).notNull().default("free"),
    status: text("status", { enum: ACCOUNT_STATUSES }).notNull().default("active"),
    /** Set once the per-account database has been created, migrated and seeded. */
    provisionedAt: ts("provisioned_at"),
    createdAt: ts("created_at").notNull(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [uniqueIndex("accounts_email_uq").on(t.email), index("accounts_status_idx").on(t.status)],
);

/**
 * Only the SHA-256 of the session token is stored. The raw token exists in the cookie and nowhere
 * else, so a copy of this table does not let anyone sign in as somebody.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at"),
    /** Set on sign-out. A revoked session is refused even while the cookie still exists. */
    revokedAt: ts("revoked_at"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_account_idx").on(t.accountId)],
);

/** Failed sign-in attempts, so a password can be rate limited without an in-memory counter. */
export const signinAttempts = sqliteTable(
  "signin_attempts",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    /** The normalised email that was tried. No password material is ever recorded. */
    email: text("email").notNull(),
    ip: text("ip"),
    ok: bool("ok").notNull().default(false),
  },
  (t) => [index("signin_at_idx").on(t.at), index("signin_email_idx").on(t.email)],
);

/**
 * A directory of tokens that identify an account from outside a session.
 *
 * This has to exist in the control plane, and the reason is worth understanding. A caregiver share
 * link is a bare token in a URL, and the `caregivers` row that says what it may see lives inside an
 * account's own database. With one database per account there is no way to find which account owns
 * a token without either an index like this one or scanning every account's database, and scanning
 * would defeat the isolation the architecture exists for.
 *
 * Only the SHA-256 is stored, as with sessions, so a copy of the control database does not hand
 * anyone a working share link. The row carries no clinical data and no scopes: what a caregiver may
 * see still lives with the account, and is still read from there on every request.
 */
export const TOKEN_KINDS = ["share", "coach"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const accountTokens = sqliteTable(
  "account_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind", { enum: TOKEN_KINDS }).notNull(),
    accountId: text("account_id").notNull(),
    /** The `caregivers.id` inside the account database, for a share token. Null for a coach token. */
    subjectId: text("subject_id"),
    label: text("label").notNull().default(""),
    createdAt: ts("created_at").notNull(),
    revokedAt: ts("revoked_at"),
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [
    uniqueIndex("account_tokens_hash_uq").on(t.tokenHash),
    index("account_tokens_account_idx").on(t.accountId, t.kind),
  ],
);

/**
 * What Stripe last told us about an account's subscription.
 *
 * This is a RECORD, not a permission. `accounts.plan` is what the app enforces, and the webhook is
 * the only thing that moves a fact from here to there. The split is deliberate in both directions:
 * a Stripe outage cannot silently downgrade somebody who is paying, and a malformed row here cannot
 * grant access on its own.
 *
 * It is a separate table rather than columns on `accounts` for two reasons. Every statement in
 * `controlSchema.ts` has to be create-if-not-exists so that file doubles as the migration, and
 * SQLite has no `ADD COLUMN IF NOT EXISTS`. And a Stripe customer id has no business in the row
 * that every session lookup reads.
 *
 * No card data, no address, no last four digits. Stripe holds all of that, which is the point of
 * using their hosted checkout.
 */
export const SUB_STATUSES = ["active", "trialing", "past_due", "canceled", "incomplete", "unpaid", "paused"] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];

/** The statuses that entitle somebody to the paid plan. Anything else is free. */
export const ENTITLING_STATUSES: readonly SubStatus[] = ["active", "trialing"];

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    accountId: text("account_id").primaryKey(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status", { enum: SUB_STATUSES }),
    /** The plan this subscription pays for, so a future second tier does not need a code change. */
    plan: text("plan", { enum: PLANS }).notNull().default("free"),
    /** When the paid period ends. After this, with no renewal, entitlement lapses. */
    currentPeriodEnd: ts("current_period_end"),
    cancelAtPeriodEnd: bool("cancel_at_period_end").notNull().default(false),
    /**
     * The Stripe event that last changed this row, and when. Together they make a replayed webhook
     * a no-op: Stripe retries on any non-2xx, and retries are expected rather than exceptional.
     */
    lastEventId: text("last_event_id"),
    lastEventAt: ts("last_event_at"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("subscriptions_customer_uq").on(t.stripeCustomerId),
    index("subscriptions_sub_idx").on(t.stripeSubscriptionId),
  ],
);

/**
 * Every webhook Stripe has delivered, by event id.
 *
 * The subscription row's `last_event_id` catches an immediate retry of the same event. This catches
 * the harder case: two different events arriving out of order, or the same event replayed long after
 * a later one already landed. An id already in here is not processed again.
 */
export const billingEvents = sqliteTable(
  "billing_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    accountId: text("account_id"),
    receivedAt: ts("received_at").notNull(),
    /** Stripe's own creation time, which is what orders two events correctly. */
    createdAt: ts("created_at"),
    outcome: text("outcome").notNull().default(""),
  },
  (t) => [index("billing_events_account_idx").on(t.accountId)],
);

export const controlSchema = { accounts, sessions, signinAttempts, accountTokens, subscriptions, billingEvents };

export type Subscription = typeof subscriptions.$inferSelect;
export type BillingEvent = typeof billingEvents.$inferSelect;
export type AccountToken = typeof accountTokens.$inferSelect;

export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;

type ControlDb = ReturnType<typeof drizzle<typeof controlSchema>>;

const g = globalThis as unknown as { __stControl?: ControlDb };

export const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "file:./data/control.db";

/** Lazy for the same reason the account handle is: `next build` must not open a connection. */
export function controlDb(): ControlDb {
  if (g.__stControl) return g.__stControl;
  const instance = drizzle(
    createClient({ url: CONTROL_URL, authToken: process.env.CONTROL_DATABASE_AUTH_TOKEN }),
    { schema: controlSchema },
  );
  g.__stControl = instance;
  return instance;
}
