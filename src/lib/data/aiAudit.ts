/**
 * NOTE: no `server-only` import here, for the same reason as `auth/tokens.ts`. The spend limiter is
 * exercised directly by `tests/tenancy.test.ts`, which runs in plain Node where `server-only`
 * throws on import, and the property worth testing is that one account's allowance is not another
 * account's. What `server-only` was guarding, that no client component pulls a data module into the
 * browser bundle, is asserted for the whole of `lib/data` by `tests/boundaries.test.ts`, which also
 * catches the file somebody adds next year without thinking about it.
 */
/**
 * One place that writes `ai_audit`.
 *
 * `docs/ARCHITECTURE.md` invariant 8 says every clinically relevant AI response is audited, and it
 * was not true: there are three places in this codebase that call a model, and only the Copilot
 * turn wrote a row. The Daily Coach and the meal photo estimator made real model calls and left no
 * trace. A photo estimate that produces the carbohydrate number somebody eats against is clinically
 * relevant by any reading of the word.
 *
 * What goes in a row is WHAT was consulted and WHICH rules fired, never the health data itself.
 * That already lives in its own tables, and duplicating it into an audit log would mean two copies
 * of the same sensitive rows to protect and delete.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db, aiAudit, type AiFeature, type CopilotMode, type TriageLevel } from "../db";
import { newId } from "../ids";
import { longestWindowMs, rowsNeededFor, verdictFor, usageSummary, type LimitVerdict } from "../ai/limits";
import { planForCurrentAccount } from "../billing/plan";
import type { Plan } from "../db/control";

export type AiUse = {
  /** Which paid feature this was, for the spend limiter and for an honest audit. */
  feature: AiFeature;
  mode: CopilotMode;
  /** What prompted it. For a scheduled brief, the trigger rather than a person's words. */
  userQuestion: string;
  /** Data windows or tables consulted, e.g. ["glucose:yesterday", "patterns:14d"]. */
  dataAccessed: string[];
  /** Knowledge item ids retrieved, if any. */
  knowledgeUsed?: string[];
  /** Safety rule ids that fired, if the safety engine ran for this turn. */
  safetyRules?: string[];
  triageLevel: TriageLevel;
  responder: "model" | "engine";
  model?: string | null;
  /** True when the dose-language filter rewrote part of the output. */
  filtered?: boolean;
  conversationId?: string | null;
  messageId?: string | null;
};

export async function recordAiUse(use: AiUse): Promise<void> {
  try {
    await db.insert(aiAudit).values({
      id: newId(),
      at: new Date(),
      conversationId: use.conversationId ?? null,
      messageId: use.messageId ?? null,
      mode: use.mode,
      feature: use.feature,
      userQuestion: use.userQuestion.slice(0, 500),
      dataAccessed: JSON.stringify(use.dataAccessed),
      knowledgeUsed: JSON.stringify(use.knowledgeUsed ?? []),
      safetyRules: JSON.stringify(use.safetyRules ?? []),
      triageLevel: use.triageLevel,
      responder: use.responder,
      model: use.model ?? null,
      filtered: use.filtered ?? false,
    });
  } catch {
    // An audit row must never be the reason a person cannot see their own reply. The failure is
    // swallowed here on purpose; a missing row is recoverable, a broken screen in the middle of a
    // symptom check is not.
  }
}

/* ------------------------------- the spend limiter ------------------------------- */

/**
 * How many times this feature has called a model inside its longest window.
 *
 * Counting the audit log rather than a separate counter means the limiter and the record can never
 * disagree, and a restart cannot hand someone a fresh allowance.
 */
async function recentModelCalls(feature: AiFeature, plan: Plan, now: Date): Promise<Date[]> {
  const longest = longestWindowMs(plan, feature);
  /**
   * The row limit is DERIVED, not a round number. It used to be a hard-coded 500, which was ample
   * at the old caps and is a fail-OPEN the moment a plan allows more than that: a truncated count
   * makes somebody look under their limit when they are over it. One more than the largest maximum
   * is enough, because the only question asked of the count is whether it has reached a maximum.
   */
  const rows = await db
    .select({ at: aiAudit.at })
    .from(aiAudit)
    .where(and(eq(aiAudit.feature, feature), eq(aiAudit.responder, "model"), gte(aiAudit.at, new Date(now.getTime() - longest))))
    .orderBy(desc(aiAudit.at))
    .limit(rowsNeededFor(plan, feature));
  return rows.map((r) => r.at);
}

/**
 * Ask before spending. Fails CLOSED: if the count cannot be read, the model is not called and the
 * feature falls back to its free path, because a limiter that opens on error is not a limiter.
 */
export async function checkSpendLimit(feature: AiFeature, now = new Date()): Promise<LimitVerdict> {
  try {
    /**
     * The plan is resolved here rather than passed in, so none of the three call sites can hand
     * over a plan the account is not on. It comes from the control plane, keyed by the account
     * already in async context, which is the same mechanism the database Proxy uses.
     */
    const plan = await planForCurrentAccount();
    return verdictFor(feature, plan, await recentModelCalls(feature, plan, now), now);
  } catch {
    return {
      allowed: false,
      blockedBy: null,
      used: 0,
      max: 0,
      resetsAt: null,
      upgradeWouldHelp: false,
      message:
        "The usage count could not be read, so this app did not call the model. It has answered from its own engine instead, which costs nothing.",
    };
  }
}

/** For a settings screen: where usage stands across every paid feature. */
export async function spendUsage(now = new Date()) {
  const features: AiFeature[] = ["copilot", "coach", "photo"];
  const plan = await planForCurrentAccount();
  const out = [];
  for (const f of features) {
    const times = await recentModelCalls(f, plan, now);
    out.push({ feature: f, plan, windows: usageSummary(f, plan, times, now) });
  }
  return out;
}
