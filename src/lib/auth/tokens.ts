/**
 * NOTE: no `server-only` import here on purpose. The migration and seeding scripts import this
 * module from plain Node, and `server-only` throws outside Next's bundler. The boundary it was
 * guarding, that a screen must never import the control plane directly, is asserted by
 * `tests/boundaries.test.ts` instead, which is a check that also catches the case where somebody
 * adds the import back.
 */
/**
 * Tokens that identify an account from outside a session: a caregiver share link, and the bearer
 * token a cron uses for the scheduled check-ins.
 *
 * Both are looked up in the control plane to find WHICH account, and then everything about what the
 * token may do is read from inside that account's own database. The control row is a directory
 * entry, not a permission: a caregiver's scopes still live with the patient, where they can be
 * changed and revoked by the person they belong to.
 */
import { and, eq, isNull } from "drizzle-orm";
import { controlDb, accountTokens, accounts, type Account, type TokenKind } from "../db/control";
import { newId } from "../ids";
import { hashToken, newSessionToken } from "./passwords";

export type ResolvedToken = { account: Account; tokenId: string; subjectId: string | null };

/**
 * Mint a token, hand back the raw value once, and store only its digest.
 *
 * The caller is responsible for putting the raw token somewhere the person can copy it, because
 * this is the only moment it exists in readable form.
 */
export async function issueToken(opts: {
  kind: TokenKind;
  accountId: string;
  subjectId?: string | null;
  label?: string;
}): Promise<{ raw: string; tokenId: string }> {
  const raw = newSessionToken();
  const tokenId = newId();
  await controlDb().insert(accountTokens).values({
    id: tokenId,
    tokenHash: hashToken(raw),
    kind: opts.kind,
    accountId: opts.accountId,
    subjectId: opts.subjectId ?? null,
    label: (opts.label ?? "").slice(0, 120),
    createdAt: new Date(),
    revokedAt: null,
    lastUsedAt: null,
  });
  return { raw, tokenId };
}

/**
 * Index a token the caller already has, rather than minting one.
 *
 * A caregiver share link is kept in readable form inside the patient's OWN database, because they
 * need to be able to copy it again when a family member loses the message. That is a different
 * trade from a session token: if an account's database leaks, the attacker already has every record
 * in it, so the link adds nothing. What must not happen is the control plane holding usable links
 * for everybody, so only the digest goes here.
 */
export async function registerToken(raw: string, opts: { kind: TokenKind; accountId: string; subjectId?: string | null; label?: string }): Promise<string> {
  const tokenId = newId();
  await controlDb().insert(accountTokens).values({
    id: tokenId,
    tokenHash: hashToken(raw),
    kind: opts.kind,
    accountId: opts.accountId,
    subjectId: opts.subjectId ?? null,
    label: (opts.label ?? "").slice(0, 120),
    createdAt: new Date(),
    revokedAt: null,
    lastUsedAt: null,
  });
  return tokenId;
}

/**
 * Resolve a raw token to its account, or null. Never says WHY it failed, so a wrong token and a
 * revoked one are indistinguishable from outside.
 */
export async function resolveToken(kind: TokenKind, raw: string): Promise<ResolvedToken | null> {
  if (!raw || raw.length < 16 || raw.length > 200) return null;
  const rows = await controlDb()
    .select({ token: accountTokens, account: accounts })
    .from(accountTokens)
    .innerJoin(accounts, eq(accounts.id, accountTokens.accountId))
    .where(and(eq(accountTokens.tokenHash, hashToken(raw)), eq(accountTokens.kind, kind), isNull(accountTokens.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.account.status !== "active" || !row.account.provisionedAt) return null;

  try {
    await controlDb().update(accountTokens).set({ lastUsedAt: new Date() }).where(eq(accountTokens.id, row.token.id));
  } catch {
    /* a stamp is not worth failing a request over */
  }
  return { account: row.account, tokenId: row.token.id, subjectId: row.token.subjectId };
}

/** Revoke by the account-local subject, which is how the caregivers screen knows a link. */
export async function revokeTokensForSubject(accountId: string, subjectId: string): Promise<number> {
  const rows = await controlDb()
    .select({ id: accountTokens.id })
    .from(accountTokens)
    .where(and(eq(accountTokens.accountId, accountId), eq(accountTokens.subjectId, subjectId), isNull(accountTokens.revokedAt)));
  for (const r of rows) {
    await controlDb().update(accountTokens).set({ revokedAt: new Date() }).where(eq(accountTokens.id, r.id));
  }
  return rows.length;
}

/** Replace a subject's tokens with one fresh token. Used when a revoked share link is restored. */
export async function rotateTokenForSubject(accountId: string, subjectId: string, label = ""): Promise<string> {
  await revokeTokensForSubject(accountId, subjectId);
  const { raw } = await issueToken({ kind: "share", accountId, subjectId, label });
  return raw;
}

/** The coach token for an account, minted on first use so a cron can be pointed at it. */
export async function coachTokenFor(accountId: string): Promise<string> {
  const existing = await controlDb()
    .select({ id: accountTokens.id })
    .from(accountTokens)
    .where(and(eq(accountTokens.accountId, accountId), eq(accountTokens.kind, "coach"), isNull(accountTokens.revokedAt)))
    .limit(1);
  // An existing token cannot be shown again, only replaced, because only its digest was kept.
  if (existing[0]) await controlDb().update(accountTokens).set({ revokedAt: new Date() }).where(eq(accountTokens.id, existing[0].id));
  const { raw } = await issueToken({ kind: "coach", accountId, label: "scheduled check-ins" });
  return raw;
}
