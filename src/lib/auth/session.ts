import "server-only";
/**
 * Sessions, and the one place an account becomes the ambient database.
 *
 * `requireAccount()` is the gate: it resolves the cookie to an account, establishes the async
 * context that `db` reads, and redirects to sign-in when there is nothing to resolve. Every screen
 * that touches clinical data calls it, and because `db` throws without that context, a screen that
 * forgets cannot read somebody else's data by accident. It gets an error instead, which is the
 * failure mode worth having.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { controlDb, accounts, sessions, signinAttempts, type Account } from "../db/control";
import { withAccount, handleFor } from "../db";
import { newId } from "../ids";
import { newSessionToken, hashToken, normalizeEmail, verifyPassword } from "./passwords";

export const SESSION_COOKIE = "steady_session";

/**
 * Clamped, because `SESSION_DAYS=0` or "30d" would otherwise mint a session that has already
 * expired: signing in would appear to work and bounce straight back to the sign-in page forever,
 * with no error anywhere to explain it.
 */
const SESSION_DAYS = (() => {
  const raw = process.env.SESSION_DAYS;
  const n = Number(raw);
  if (raw !== undefined && raw !== "" && (!Number.isFinite(n) || n < 1)) {
    console.warn(`[auth] SESSION_DAYS="${raw}" is not a usable number of days; using 30.`);
    return 30;
  }
  return Math.min(365, Math.max(1, Number.isFinite(n) && n >= 1 ? n : 30));
})();

/** A Secure cookie is dropped over plain http, so default to secure and make opting out explicit. */
const COOKIE_SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "false" : process.env.NODE_ENV === "production";

export type SessionAccount = Account & { sessionId: string };

/* ------------------------------- creating one ------------------------------- */

export async function createSession(accountId: string): Promise<string> {
  const token = newSessionToken();
  const now = new Date();
  const h = await headers();
  await controlDb()
    .insert(sessions)
    .values({
      id: newId(),
      accountId,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000),
      lastSeenAt: now,
      revokedAt: null,
      userAgent: (h.get("user-agent") ?? "").slice(0, 200),
    });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return token;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // Revoked server-side, not merely forgotten by the browser. A cookie the user still holds must
    // stop working, or signing out on a shared computer does nothing.
    await controlDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Every other session for this account, for a "sign out everywhere" action. */
export async function revokeOtherSessions(accountId: string, keepSessionId: string): Promise<number> {
  const rows = await controlDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
  const others = rows.filter((r) => r.id !== keepSessionId);
  for (const o of others) {
    await controlDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, o.id));
  }
  return others.length;
}

/* ------------------------------- reading one ------------------------------- */

/** Resolve the cookie to an account, or null. Never throws, never redirects. */
export async function optionalAccount(): Promise<SessionAccount | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await controlDb()
    .select({ session: sessions, account: accounts })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.account.status !== "active") return null;
  if (!row.account.provisionedAt) return null; // signup did not finish; treat as no session

  // Best-effort activity stamps. A failure here must not cost someone their session.
  try {
    const now = new Date();
    await controlDb().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    await controlDb().update(accounts).set({ lastSeenAt: now }).where(eq(accounts.id, row.account.id));
  } catch {
    /* ignore */
  }

  return { ...row.account, sessionId: row.session.id };
}

/**
 * The gate. Resolves the account, establishes the database context, and runs `fn` inside it.
 * With no session it redirects to sign-in rather than returning null, so a screen cannot forget to
 * check.
 */
export async function requireAccount<T>(fn: (account: SessionAccount) => Promise<T>): Promise<T> {
  const account = await optionalAccount();
  if (!account) redirect("/signin");
  return withAccount({ accountId: account.id, dbRef: account.dbRef }, () => fn(account));
}

/**
 * For the handful of places that are not a page: a route handler, a cron, a script. Takes the
 * account explicitly, because there is no cookie to read.
 */
export function asAccount<T>(account: Pick<Account, "id" | "dbRef">, fn: () => T): T {
  return withAccount({ accountId: account.id, dbRef: account.dbRef }, fn);
}

export async function accountByEmail(email: string): Promise<Account | null> {
  const rows = await controlDb().select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}

export async function accountById(id: string): Promise<Account | null> {
  const rows = await controlDb().select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The handle for an account, for provisioning and migration, outside any request. */
export function rawHandleFor(dbRef: string) {
  return handleFor(dbRef);
}

/* --------------------------- sign-in rate limiting --------------------------- */

const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

/**
 * A password field with no limit is a password field an attacker can guess at. Counted in the
 * control database rather than in memory, so a restart does not hand someone a fresh eight tries.
 */
export async function tooManyAttempts(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
  const rows = await controlDb()
    .select({ n: sql<number>`count(*)` })
    .from(signinAttempts)
    .where(and(eq(signinAttempts.email, normalizeEmail(email)), eq(signinAttempts.ok, false), gt(signinAttempts.at, since)));
  if (Number(rows[0]?.n ?? 0) >= MAX_ATTEMPTS) return true;

  if (ip) {
    const byIp = await controlDb()
      .select({ n: sql<number>`count(*)` })
      .from(signinAttempts)
      .where(and(eq(signinAttempts.ip, ip), eq(signinAttempts.ok, false), gt(signinAttempts.at, since)));
    if (Number(byIp[0]?.n ?? 0) >= MAX_ATTEMPTS * 3) return true;
  }
  return false;
}

export async function recordAttempt(email: string, ip: string | null, ok: boolean): Promise<void> {
  try {
    await controlDb().insert(signinAttempts).values({ id: newId(), at: new Date(), email: normalizeEmail(email), ip, ok });
  } catch {
    /* never block a sign-in on the audit write */
  }
}

/**
 * Verify a password for an email. Always does the scrypt work, even when the account does not
 * exist, so response time does not reveal which emails are registered.
 */
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyCredentials(email: string, password: string): Promise<Account | null> {
  const account = await accountByEmail(email);
  const ok = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || !ok) return null;
  if (account.status !== "active") return null;
  return account;
}
