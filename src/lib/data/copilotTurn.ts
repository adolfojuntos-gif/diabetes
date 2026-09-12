import "server-only";
/**
 * THE ONE COPILOT TURN.
 *
 * This used to live inside `src/app/copilot/actions.ts`. It was lifted out when the Daily Coach
 * arrived, because the coach's reply endpoint has to take exactly the same path a tap in the app
 * takes. A second implementation of this sequence would be a second safety contract, and one of
 * the two would eventually fall behind.
 *
 * The order is the contract and it is not negotiable:
 *   1. The safety engine runs first, on the person's own words plus recent readings.
 *   2. Context is assembled from ENGINE output.
 *   3. The model writes a reply, or the engine does when there is no key.
 *   4. The dose-language filter and the certainty softener run on it.
 *   5. It is persisted.
 *   6. It is audited.
 *
 * Callers add their own revalidatePath / redirect / HTTP response. Nothing here knows about
 * FormData, routes or screens.
 */
import { asc, desc, eq, gte } from "drizzle-orm";
import {
  db,
  conversations,
  messages as messagesTable,
  aiAudit,
  glucoseReadings,
  bloodPressureLogs,
  medications,
  type CopilotMode,
  type Symptom,
} from "../db";
import { newId } from "../ids";
import { getProfile, loadCopilotContext, usesInsulin } from "./snapshot";
import { triage, type TriageInput, type TriageResult } from "../engines/triage";
import { findMedication } from "../knowledge/medications";
import { copilotReply, retrieveForTurn, type CopilotResult } from "../ai/copilot";
import { rememberQuestion } from "./memory";
import { HOUR_MS } from "../time";

/** Flow state carried on the conversation for the guided symptom encounter. */
export type SymptomFlow = {
  step: 1 | 2 | 3 | 4 | 5;
  symptoms?: Symptom[];
  severity?: 1 | 2 | 3;
  sinceDays?: number;
  ketones?: "none" | "trace_small" | "moderate_large" | "unknown";
  lowNotResponding?: boolean;
};

/**
 * Run the deterministic safety engine over the last 26 hours of readings plus whatever the person
 * said. Safe to call with `{}` for a baseline read of the data alone.
 */
export async function loadTriage(opts: {
  freeText?: string;
  symptoms?: Symptom[];
  severity?: 1 | 2 | 3;
  flags?: TriageInput["flags"];
  now?: Date;
}): Promise<TriageResult> {
  const now = opts.now ?? new Date();
  const profile = await getProfile();
  const since = new Date(now.getTime() - 26 * HOUR_MS);
  const [recent, bp, meds] = await Promise.all([
    db
      .select({ at: glucoseReadings.at, valueMgdl: glucoseReadings.valueMgdl })
      .from(glucoseReadings)
      .where(gte(glucoseReadings.at, since))
      .orderBy(desc(glucoseReadings.at))
      .limit(400),
    db
      .select()
      .from(bloodPressureLogs)
      .where(gte(bloodPressureLogs.at, new Date(now.getTime() - 7 * 24 * HOUR_MS)))
      .orderBy(desc(bloodPressureLogs.at))
      .limit(1),
    // The engine needs the medication CLASSES, not the names: an SGLT2 inhibitor changes what a
    // glucose of 220 with vomiting means, and no symptom word carries that.
    db.select({ name: medications.name, knowledgeId: medications.knowledgeId }).from(medications).where(eq(medications.active, true)),
  ]);

  const classes = Array.from(
    new Set(
      meds
        .map((m) => m.knowledgeId ?? findMedication(m.name)?.id ?? null)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const age = profile.birthYear ? now.getFullYear() - profile.birthYear : null;
  return triage({
    now,
    recentReadings: recent,
    symptoms: opts.symptoms ?? [],
    freeText: opts.freeText,
    severity: opts.severity,
    flags: opts.flags,
    profile: {
      pregnant: profile.pregnant,
      usesInsulin: usesInsulin(profile),
      diabetesType: profile.diabetesType,
      medicationClasses: classes,
      age,
    },
    bloodPressure: bp[0] ? { systolic: bp[0].systolic, diastolic: bp[0].diastolic } : null,
  });
}

async function ensureConversation(id: string | null, mode: CopilotMode): Promise<string> {
  if (id) {
    const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (rows[0]) return rows[0].id;
  }
  const now = new Date();
  const newConvId = newId();
  await db.insert(conversations).values({ id: newConvId, mode, title: "", createdAt: now, updatedAt: now });
  return newConvId;
}

export type CopilotTurnInput = {
  body: string;
  mode: CopilotMode;
  conversationId?: string | null;
  flow?: SymptomFlow | null;
  /** Tag written into the audit row's question so a coach-triggered turn is distinguishable later. */
  origin?: "app" | "coach";
};

export type CopilotTurnOutput = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  reply: string;
  triage: TriageResult;
  result: CopilotResult;
};

export const MAX_TURN_CHARS = 4000;

/** The single path every Copilot turn takes, app or coach. Throws on empty or oversized input. */
export async function runCopilotTurn(input: CopilotTurnInput): Promise<CopilotTurnOutput> {
  const body = input.body.trim();
  if (!body) throw new Error("empty_message");
  if (body.length > MAX_TURN_CHARS) throw new Error("message_too_long");

  const now = new Date();
  const conversationId = await ensureConversation(input.conversationId ?? null, input.mode);
  const flow = input.flow ?? null;

  // 1. SAFETY ENGINE — before anything else, and its result is authoritative.
  const t = await loadTriage({
    freeText: body,
    symptoms: flow?.symptoms ?? [],
    severity: flow?.severity,
    flags: flow
      ? { symptomsForDays: flow.sinceDays, ketones: flow.ketones, lowNotRespondingAfterTwoTreatments: flow.lowNotResponding }
      : undefined,
    now,
  });

  // 2. CONTEXT from the engines.
  const ctx = await loadCopilotContext(now);

  const history = await db
    .select({ role: messagesTable.role, body: messagesTable.body })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt))
    .limit(24);

  const userMsgId = newId();
  await db.insert(messagesTable).values({ id: userMsgId, conversationId, role: "user", body, triageLevel: t.level, createdAt: now });

  // 3. The reply, from the model or from the engine.
  const result = await copilotReply(
    {
      mode: input.mode,
      history: history.filter((h) => h.role !== "system").map((h) => ({ role: h.role as "user" | "assistant", body: h.body })),
      userMessage: body,
      triage: t,
      flowState: flow as Record<string, unknown> | null,
    },
    ctx,
  );

  const assistantId = newId();
  const replyAt = new Date();
  await db.insert(messagesTable).values({
    id: assistantId,
    conversationId,
    role: "assistant",
    body: result.reply,
    triageLevel: t.level,
    meta: JSON.stringify({
      followUps: result.followUps,
      category: result.category,
      knowledgeUsed: result.knowledgeUsed,
      responder: result.responder,
      triageReasons: t.reasons,
      triageActions: t.actions,
      ...(input.origin === "coach" ? { origin: "coach" } : {}),
    }),
    createdAt: replyAt,
  });
  await db
    .update(conversations)
    .set({ updatedAt: replyAt, title: history.length === 0 ? body.slice(0, 70) : undefined, state: flow ? JSON.stringify(flow) : undefined })
    .where(eq(conversations.id, conversationId));

  // 4. AUDIT — every clinically relevant response.
  const { items, meds } = retrieveForTurn(body, ctx, input.mode);
  await db.insert(aiAudit).values({
    id: newId(),
    at: replyAt,
    conversationId,
    messageId: assistantId,
    mode: input.mode,
    // A reply to a coach message is metered as coach, not as a Copilot turn, so a chatty
    // conversation cannot eat the check-in allowance or the other way round.
    feature: input.origin === "coach" ? "coach" : "copilot",
    userQuestion: `${input.origin === "coach" ? "[coach] " : ""}${body}`.slice(0, 500),
    dataAccessed: JSON.stringify(ctx.dataAccessed),
    knowledgeUsed: JSON.stringify([...items.map((i) => i.id), ...meds.map((m) => `med:${m.id}`)]),
    safetyRules: JSON.stringify(t.rules.filter((r) => r.fired).map((r) => r.id)),
    triageLevel: t.level,
    responder: result.responder,
    model: result.model,
    filtered: result.filtered,
  });

  await rememberQuestion(body, now);

  return { conversationId, userMessageId: userMsgId, assistantMessageId: assistantId, reply: result.reply, triage: t, result };
}
