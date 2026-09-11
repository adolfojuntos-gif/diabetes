/**
 * The control database as executable statements.
 *
 * Hand-written and deliberately short, unlike the account schema which is generated. The control
 * plane has four tables and they change rarely, so keeping the DDL beside the Drizzle definition is
 * clearer than another generator. `tests/tenancy.test.ts` asserts the two agree.
 *
 * Every statement is create-if-not-exists, so this is both the installer and the migration.
 */
export const CONTROL_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    password_hash text,
    db_ref text NOT NULL,
    plan text DEFAULT 'free' NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    provisioned_at integer,
    created_at integer NOT NULL,
    last_seen_at integer
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uq ON accounts (email)",
  "CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts (status)",

  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY NOT NULL,
    account_id text NOT NULL,
    token_hash text NOT NULL,
    created_at integer NOT NULL,
    expires_at integer NOT NULL,
    last_seen_at integer,
    revoked_at integer,
    user_agent text
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_uq ON sessions (token_hash)",
  "CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id)",

  `CREATE TABLE IF NOT EXISTS signin_attempts (
    id text PRIMARY KEY NOT NULL,
    at integer NOT NULL,
    email text NOT NULL,
    ip text,
    ok integer DEFAULT false NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS signin_at_idx ON signin_attempts (at)",
  "CREATE INDEX IF NOT EXISTS signin_email_idx ON signin_attempts (email)",

  `CREATE TABLE IF NOT EXISTS account_tokens (
    id text PRIMARY KEY NOT NULL,
    token_hash text NOT NULL,
    kind text NOT NULL,
    account_id text NOT NULL,
    subject_id text,
    label text DEFAULT '' NOT NULL,
    created_at integer NOT NULL,
    revoked_at integer,
    last_used_at integer
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS account_tokens_hash_uq ON account_tokens (token_hash)",
  "CREATE INDEX IF NOT EXISTS account_tokens_account_idx ON account_tokens (account_id, kind)",

  `CREATE TABLE IF NOT EXISTS subscriptions (
    account_id text PRIMARY KEY NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    status text,
    plan text DEFAULT 'free' NOT NULL,
    current_period_end integer,
    cancel_at_period_end integer DEFAULT false NOT NULL,
    last_event_id text,
    last_event_at integer,
    updated_at integer NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_customer_uq ON subscriptions (stripe_customer_id)",
  "CREATE INDEX IF NOT EXISTS subscriptions_sub_idx ON subscriptions (stripe_subscription_id)",

  `CREATE TABLE IF NOT EXISTS billing_events (
    id text PRIMARY KEY NOT NULL,
    type text NOT NULL,
    account_id text,
    received_at integer NOT NULL,
    created_at integer,
    outcome text DEFAULT '' NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS billing_events_account_idx ON billing_events (account_id)",
];

/** Table names, so a test can check this list against the Drizzle definitions. */
export const CONTROL_SCHEMA_TABLES = [
  "accounts",
  "sessions",
  "signin_attempts",
  "account_tokens",
  "subscriptions",
  "billing_events",
] as const;
