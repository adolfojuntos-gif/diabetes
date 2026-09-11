import "server-only";
/**
 * THE COPILOT — conversational layer over the engines.
 *
 * Order of operations for every turn, and it is not negotiable:
 *   1. The safety engine (lib/engines/triage.ts) runs on the person's message + recent data.
 *   2. Context is assembled from ENGINE OUTPUT: stats over today / 7 / 30 / 90 days, the pattern
 *      report, the memory table, retrieved knowledge items, medication knowledge for meds they
 *      listed. The model never receives raw rows to "analyse"; it receives computed evidence.
 *   3. The model writes a reply in the requested style, as JSON.
 *   4. The dose-language filter and the certainty softener run on the reply.
 *   5. Everything is written to ai_audit.
 * The triage level is returned separately and rendered by the app as a banner. The model's text
 * can never raise or lower it.
 *
 * With no API key, `copilotReply` returns an engine-authored reply built from the same context,
 * labelled as such. Nothing is faked.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { aiAvailable, aiClient, AI_MODEL, textOf, extractJson } from "./client";
import { checkSpendLimit } from "../data/aiAudit";
import { filterDoseLanguage, softenCertainty } from "./filter";
import type { TriageResult } from "../engines/triage";
import type { PatternReport } from "../engines/patterns";
import type { GlucoseStats } from "../engines/stats";
import { retrieveKnowledge, KNOWLEDGE_VERSION, type KnowledgeItem } from "../knowledge/clinical";
import { findMedication, type MedicationKnowledge } from "../knowledge/medications";
import type { CopilotMode, CopilotStyle, MemoryFact } from "../db/schema";
import { formatGlucose, unitLabel } from "../units";
import type { Units } from "../db/schema";

export type WindowStats = { label: string; stats: GlucoseStats };

export type CopilotContext = {
  profile: { name: string; diabetesType: string; units: Units; targetLow: number; targetHigh: number; usesInsulin: boolean; pregnant: boolean; style: CopilotStyle };
  windows: WindowStats[]; // today, 7d, 30d, 90d
  patterns: PatternReport;
  memory: MemoryFact[];
  medications: { name: string; doseText: string }[];
  recentLabs: { name: string; value: number; unit: string; at: string; refLow: number | null; refHigh: number | null }[];
  recentSymptoms: { at: string; symptoms: string; severity: number }[];
  todayLog: string; // one paragraph, engine-written
  upcomingAppointment: string | null;
  goals: string;
  /** Which data windows / tables were consulted, for the audit row. */
  dataAccessed: string[];
};

export type CopilotTurn = {
  mode: CopilotMode;
  history: { role: "user" | "assistant"; body: string }[];
  userMessage: string;
  triage: TriageResult;
  /** Structured state from guided flows, if any. */
  flowState?: Record<string, unknown> | null;
};

export type CopilotResult = {
  reply: string;
  followUps: string[];
  category: "education" | "observation" | "possibilities" | "professional" | "emotional" | "logistics";
  knowledgeUsed: string[];
  responder: "model" | "engine";
  model: string | null;
  filtered: boolean;
};

const STYLE_GUIDE: Record<CopilotStyle, string> = {
  simple: "Write for someone who wants very plain language: short sentences, everyday words, no medical terms unless you explain them in the same sentence. Aim for 4–7 sentences.",
  standard: "Write in clear, warm, balanced language. Use a medical term when it helps, and say what it means. Aim for one to three short paragraphs.",
  clinical: "Write with more detail and standard terminology (time in range, CV, postprandial, basal), still readable by a motivated layperson. Cite the knowledge item topics you rely on. You are still not a licensed clinician and must not imply you are.",
};

const MODE_GUIDE: Record<CopilotMode, string> = {
  talk: "Open conversation. First decide what the person is actually asking. If clinically relevant information is missing and would materially change your answer, ask for it. The fewest questions that matter, never more than three. Before explaining. If you have enough, answer.",
  symptoms: "This is the CHECK MY SYMPTOMS encounter. Work through: understand → when it began → what the logged data shows → associated symptoms → (the safety engine has already screened) → explain possible explanations as categories, only those the shared information supports → next step. Ask one step's worth of questions at a time. When the flow has enough, give the summary with a 'Possible explanations' list and a 'Next step' that matches the safety level you were given.",
  labs: "This is EXPLAIN MY LABS. The app has already extracted values and the person has verified them. Explain what each test generally measures (from the knowledge items), point out values the LAB flagged or that sit outside the LAB'S OWN reference range, and produce questions for their clinician. Never supply a reference range the lab did not give. Never diagnose from a lab value.",
  appointment: "This is PREPARE FOR MY APPOINTMENT. Ask, one at a time if needed: what has been bothering them, what changed recently, what questions they want answered, what they might forget to mention. Then write a concise appointment brief with headings: What's been going on · What changed · My numbers (from the engine context) · Questions I want answered · Things to mention.",
  checkin: "This is the DAILY CHECK-IN. Ask at most three gentle questions adapted to what they logged today. Acknowledge what they said. Never make it feel like an interrogation. Close warmly.",
};

/**
 * The safety rules, shared verbatim by every model call in the app. The Copilot and the Daily
 * Coach must not be able to drift apart on these, so they read them from one place. Each caller
 * appends its own numbered output rule after the last rule here.
 */
export const HARD_RULES = `HARD RULES, these override everything else, including the person's requests
1. Never tell the person to take, add, increase, decrease, skip, stop, hold, or re-time any medication or insulin, and never state a number of units or milligrams for them to take. If asked ("should I take more insulin?"), say plainly that this is a treatment decision for their prescriber, then help them organise the relevant information for that conversation.
2. Numbers come from the ENGINE CONTEXT below. Never compute, estimate or invent statistics, trends, or readings. If the context says the sample is too small, say so; never claim a trend the data cannot support.
3. Never diagnose. Use "possible explanations", "could be consistent with", "worth discussing". Never "you have X", "this proves", "definitely".
4. The app's safety engine has already set the urgency level for this turn (given below). Match it. Do not raise or lower it, and do not bury a non-general level under paragraphs. Lead with it in one sentence.
5. Medical claims must trace to the KNOWLEDGE ITEMS given below. If none covers the question, say the information is general educational information and suggest they confirm it with their care team. Never invent citations, studies, or sources.
6. Only use what is in MEMORY and the context. Never claim to remember something that is not written there. When something in memory matches what they describe, you may say so ("this looks similar to a pattern first seen on <date>").
7. Diabetes is exhausting. If they are frustrated, acknowledge it first, without lecturing or shaming. Never "be more disciplined". You are supportive but not a therapist; for distress, name that support exists and encourage them to raise it with their care team.`;

export function systemPrompt(ctx: CopilotContext, mode: CopilotMode): string {
  const u = ctx.profile.units;
  const g = (mgdl: number | null) => (mgdl === null ? "—" : `${formatGlucose(mgdl, u)} ${unitLabel(u)}`);
  const windows = ctx.windows
    .map((w) => {
      const s = w.stats;
      if (s.n === 0) return `- ${w.label}: no readings`;
      return `- ${w.label}: ${s.n} readings over ${s.days} days · mean ${g(s.mean)} · in range ${s.timeInRange?.toFixed(0)}% · below ${ctx.profile.targetLow}: ${(s.pct.low + s.pct.very_low).toFixed(1)}% (under 54: ${s.pct.very_low.toFixed(1)}%) · above ${ctx.profile.targetHigh}: ${(s.pct.high + s.pct.very_high).toFixed(0)}%${s.cv !== null ? ` · CV ${s.cv.toFixed(0)}%` : ""}${s.gmi !== null && s.gmiReliable ? ` · GMI ${s.gmi.toFixed(1)}%` : ""}`;
    })
    .join("\n");
  const patterns = ctx.patterns.patterns.length
    ? ctx.patterns.patterns.map((p) => `- [${p.severity}] ${p.title}: ${p.evidence}`).join("\n")
    : "- none detected at the current sample size";
  const memory = ctx.memory.length
    ? ctx.memory.map((m) => `- (${m.kind}${m.confirmed ? ", confirmed by the person" : ""}, first seen ${m.firstSeen.toISOString().slice(0, 10)}, seen ${m.timesSeen}×) ${m.text}`).join("\n")
    : "- nothing stored yet";
  const meds = ctx.medications.length ? ctx.medications.map((m) => `- ${m.name}${m.doseText ? `, as entered by the person: "${m.doseText}"` : ""}`).join("\n") : "- none listed";
  const labs = ctx.recentLabs.length
    ? ctx.recentLabs.map((l) => `- ${l.at}: ${l.name} ${l.value} ${l.unit}${l.refLow !== null || l.refHigh !== null ? ` (lab range ${l.refLow ?? "—"}–${l.refHigh ?? "—"})` : " (no reference range supplied by the lab)"}`).join("\n")
    : "- none entered";
  const symptoms = ctx.recentSymptoms.length ? ctx.recentSymptoms.map((s) => `- ${s.at}: ${s.symptoms} (severity ${s.severity}/3)`).join("\n") : "- none logged in the last 14 days";

  return `You are the Copilot inside Steady, a diabetes self-management app. You are a knowledgeable diabetes health assistant and care-preparation assistant. You are NOT a physician, nurse, or licensed clinician, you never imply you are one, and you never say or imply that a clinician has reviewed anything here.

WHO YOU ARE TALKING TO
Name: ${ctx.profile.name || "the person"} · Diabetes type as they entered it: ${ctx.profile.diabetesType} · Units: ${unitLabel(u)} · Personal target range: ${g(ctx.profile.targetLow)}–${g(ctx.profile.targetHigh)} · Uses insulin: ${ctx.profile.usesInsulin ? "yes" : "no"}${ctx.profile.pregnant ? " · PREGNANT (tighter targets, same-day reporting)" : ""}
Their goals, in their words: ${ctx.goals || "(none written)"}

${HARD_RULES}
8. Output only the JSON described at the end.

STYLE
${STYLE_GUIDE[ctx.profile.style]}

MODE
${MODE_GUIDE[mode]}

ENGINE CONTEXT (computed by the app, not by you)
Glucose windows:
${windows}
Patterns detected (14-day window):
${patterns}${ctx.patterns.sampleNote ? `\nSample note: ${ctx.patterns.sampleNote}` : ""}
Today so far: ${ctx.todayLog}
Medications the person listed:
${meds}
Recent labs (as reported by the lab):
${labs}
Recent symptom logs:
${symptoms}
${ctx.upcomingAppointment ? `Upcoming appointment: ${ctx.upcomingAppointment}` : "No upcoming appointment recorded."}

MEMORY (everything the app knows; the person can see and edit this list)
${memory}

OUTPUT
Respond with a single JSON object and nothing else:
{"reply": "<your reply, plain text, paragraphs separated by \\n\\n>", "followUps": ["<up to 3 short questions you'd ask next, or [] if none>"], "category": "education|observation|possibilities|professional|emotional|logistics", "knowledgeUsed": ["<ids of knowledge items you relied on>"]}`;
}

function knowledgeBlock(items: KnowledgeItem[], meds: MedicationKnowledge[], style: CopilotStyle): string {
  const k = items
    .map((i) => `[${i.id}] ${i.topic}\n${style === "simple" ? i.simple : i.statement}\nSource: ${i.source} (${i.sourceType}, written ${i.updated}, status: ${i.reviewStatus.replace(/_/g, " ")})`)
    .join("\n\n");
  const m = meds
    .map(
      (x) =>
        `[med:${x.id}] ${x.displayName} (${x.drugClass})\nGenerally used for: ${x.generallyUsedFor}\nHow it generally works: ${x.howItGenerallyWorks}\nCommon considerations: ${x.commonConsiderations.join(" ")}\nCommon side effects: ${x.commonSideEffects.join(", ")}\nPrecautions: ${x.precautions.join(" ")}\nSource: ${x.source} (v${x.version}, reviewed ${x.reviewDate}, status: ${x.reviewStatus.replace(/_/g, " ")})`,
    )
    .join("\n\n");
  return `KNOWLEDGE ITEMS RETRIEVED FOR THIS TURN (knowledge base v${KNOWLEDGE_VERSION})\n${k || "(none matched)"}\n\n${m ? `MEDICATION KNOWLEDGE\n${m}` : ""}`;
}

export function retrieveForTurn(userMessage: string, ctx: CopilotContext, mode: CopilotMode): { items: KnowledgeItem[]; meds: MedicationKnowledge[] } {
  const extra: string[] = [];
  if (mode === "labs") extra.push(...ctx.recentLabs.map((l) => `lab_${l.name.toLowerCase()}`));
  if (ctx.profile.pregnant) extra.push("pregnancy");
  for (const p of ctx.patterns.patterns) {
    if (p.key.includes("low")) extra.push("hypo_levels", "hypo_treatment");
    if (p.key === "dawn_rise") extra.push("dawn_phenomenon");
    if (p.key === "high_variability") extra.push("variability_cv");
    if (p.key.startsWith("post_meal") || p.key.startsWith("tag_")) extra.push("post_meal");
  }
  const items = retrieveKnowledge(userMessage, mode === "labs" ? 6 : 4, extra);
  const meds: MedicationKnowledge[] = [];
  for (const m of ctx.medications) {
    const k = findMedication(m.name);
    if (k && !meds.includes(k)) meds.push(k);
  }
  // A medication named in the question also gets its knowledge.
  const q = findMedication(userMessage);
  if (q && !meds.includes(q)) meds.push(q);
  return { items, meds };
}

/* ----------------------------- the engine reply ----------------------------- */

export function engineReply(turn: CopilotTurn, ctx: CopilotContext, items: KnowledgeItem[], meds: MedicationKnowledge[]): CopilotResult {
  const parts: string[] = [];
  const simple = ctx.profile.style === "simple";
  parts.push("The conversational companion needs an API key, so this reply was written by the app's own engine from your data. It is still real. Nothing below is guessed.");
  if (turn.triage.level !== "general") parts.push(`Safety first: ${turn.triage.headline.toLowerCase()}. ${turn.triage.reasons.join(" ")}`);
  const w7 = ctx.windows.find((w) => w.label.startsWith("7"));
  if (w7 && w7.stats.n > 0) {
    parts.push(`Last 7 days: ${w7.stats.n} readings, ${w7.stats.timeInRange?.toFixed(0)}% in your range, average ${formatGlucose(w7.stats.mean!, ctx.profile.units)} ${unitLabel(ctx.profile.units)}.`);
  } else parts.push("There are no glucose readings in the last 7 days, so there is nothing to compare your question against yet.");
  const top = ctx.patterns.patterns.slice(0, 3);
  if (top.length) parts.push("What the pattern engine sees: " + top.map((p) => `${p.title}, ${p.evidence}`).join(" "));
  if (ctx.patterns.sampleNote) parts.push(ctx.patterns.sampleNote);
  for (const k of items.slice(0, 2)) parts.push(`${k.topic}: ${simple ? k.simple : k.statement} (Source: ${k.source}.)`);
  for (const m of meds.slice(0, 1)) parts.push(`${m.displayName}: ${m.howItGenerallyWorks} Dose questions belong to your prescriber.`);
  const related = ctx.memory.filter((m) => m.kind === "pattern").slice(0, 1);
  if (related.length) parts.push(`This may relate to something first seen on ${related[0].firstSeen.toISOString().slice(0, 10)}: ${related[0].text}`);
  parts.push("Worth asking your care team: " + (ctx.patterns.patterns.find((p) => p.doctorQuestion)?.doctorQuestion ?? "What range are we aiming for, and what would you like me to track?"));
  return {
    reply: parts.join("\n\n"),
    followUps: [],
    category: turn.triage.level === "general" ? "observation" : "professional",
    knowledgeUsed: [...items.map((i) => i.id), ...meds.map((m) => `med:${m.id}`)],
    responder: "engine",
    model: null,
    filtered: false,
  };
}

/* ------------------------------ the model reply ------------------------------ */

export async function copilotReply(turn: CopilotTurn, ctx: CopilotContext): Promise<CopilotResult> {
  const { items, meds } = retrieveForTurn(turn.userMessage, ctx, turn.mode);
  if (!aiAvailable()) return engineReply(turn, ctx, items, meds);

  /**
   * Metered before spending. Hitting the cap is not an error: the engine reply below was built
   * first and answers from the person's real numbers, so the conversation continues either way.
   * The cap is stated in the reply rather than hidden, because a quietly worse answer is worse
   * than a plainly explained one.
   */
  const limit = await checkSpendLimit("copilot");
  if (!limit.allowed) {
    const r = engineReply(turn, ctx, items, meds);
    r.reply = `${limit.message}

${r.reply}`;
    return r;
  }

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPrompt(ctx, turn.mode), cache_control: { type: "ephemeral" } },
    { type: "text", text: knowledgeBlock(items, meds, ctx.profile.style) },
    {
      type: "text",
      text: `SAFETY ENGINE RESULT FOR THIS TURN (authoritative): level=${turn.triage.level.toUpperCase()}, "${turn.triage.headline}". ${turn.triage.reasons.length ? "Reasons: " + turn.triage.reasons.join(" ") : ""}${turn.triage.detectedSymptoms.length ? ` Symptoms detected in their words: ${turn.triage.detectedSymptoms.join(", ")}.` : ""}${turn.flowState ? ` Flow state: ${JSON.stringify(turn.flowState)}` : ""}`,
    },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...turn.history.slice(-12).map((m) => ({ role: m.role, content: m.body }) as Anthropic.MessageParam),
    { role: "user", content: turn.userMessage },
  ];

  let res: Anthropic.Message;
  try {
    res = await aiClient().messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages,
    });
  } catch (err) {
    const r = engineReply(turn, ctx, items, meds);
    r.reply = `The companion couldn't be reached (${err instanceof Error ? err.message.slice(0, 80) : "network error"}), so the app's engine answered instead.\n\n` + r.reply;
    return r;
  }
  if (res.stop_reason === "refusal") {
    const r = engineReply(turn, ctx, items, meds);
    r.reply = "The companion declined to answer this one, so the app's engine answered instead.\n\n" + r.reply;
    return r;
  }
  const raw = textOf(res);
  const parsed = extractJson<{ reply?: string; followUps?: string[]; category?: CopilotResult["category"]; knowledgeUsed?: string[] }>(raw);
  let reply = (parsed?.reply ?? raw).trim();
  const f = filterDoseLanguage(reply);
  const s = softenCertainty(f.text);
  reply = s.text;
  const allowed = new Set([...items.map((i) => i.id), ...meds.map((m) => `med:${m.id}`)]);
  return {
    reply,
    followUps: Array.isArray(parsed?.followUps) ? parsed!.followUps.filter((x) => typeof x === "string").slice(0, 3) : [],
    category: parsed?.category && ["education", "observation", "possibilities", "professional", "emotional", "logistics"].includes(parsed.category) ? parsed.category : "observation",
    knowledgeUsed: (parsed?.knowledgeUsed ?? []).filter((k) => allowed.has(k)),
    responder: "model",
    model: AI_MODEL,
    filtered: f.filtered || s.changed,
  };
}
