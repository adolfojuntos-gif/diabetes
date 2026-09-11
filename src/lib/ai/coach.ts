import "server-only";
/**
 * THE DAILY COACH'S VOICE.
 *
 * The coach engine (lib/engines/coach.ts) has already decided every fact and every number. This
 * file's only job is to put them into warm prose. It is handed a JSON object and told, in the same
 * HARD RULES the Copilot reads, that it may not do arithmetic. If a figure in a delivered message
 * is wrong, it is wrong in the engine, where `tests/coach.test.ts` can catch it.
 *
 * With no API key, `engineMorning` / `engineWeekly` write the message instead and say so. The
 * person still gets a complete check-in, which is invariant 7.
 *
 * The safety banner is NOT written here. The route prepends it from fixed text in triage.ts, so a
 * model that ignores rule 4 cannot bury an urgent level.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { checkSpendLimit } from "../data/aiAudit";
import { aiAvailable, aiClient, AI_MODEL, textOf, extractJson } from "./client";
import { filterDoseLanguage, softenCertainty } from "./filter";
import { HARD_RULES } from "./copilot";
import { retrieveKnowledge, KNOWLEDGE_VERSION, type KnowledgeItem } from "../knowledge/clinical";
import { engineMorning, engineWeekly, type CoachDayFacts, type CoachWeekFacts } from "../engines/coach";
import type { TriageResult } from "../engines/triage";
import type { CopilotStyle, MemoryFact } from "../db/schema";

export type CoachVoiceInput = {
  profile: { name: string; diabetesType: string; style: CopilotStyle; pregnant: boolean; usesInsulin: boolean };
  goals: string;
  /** A handful of memory facts, so the coach can say "this looks like the pattern from <date>". */
  memory: MemoryFact[];
  triage: TriageResult;
};

export type CoachVoiceResult = {
  text: string;
  responder: "model" | "engine";
  model: string | null;
  filtered: boolean;
  knowledgeUsed: string[];
};

const LENGTH_GUIDE: Record<CopilotStyle, string> = {
  simple: "Four to six very short sentences. Everyday words only. No medical terms unless you explain them in the same sentence.",
  standard: "Around 90 to 130 words. Two or three short paragraphs. Warm, clear, unhurried.",
  clinical: "Around 120 to 160 words. You may use time in range, variability and postprandial, and say what each means the first time.",
};

/** What a morning message is for, and the lines it must not cross. */
const MORNING_BRIEF = `YOUR JOB
Write one short morning check-in, the kind a person reads in thirty seconds before their day starts.

SHAPE
1. Greet them by name if you have one.
2. Say what they did yesterday, drawn from "showedUp" in the FACTS. Credit the showing up, not the readings. A day with no entries is described without any hint of disappointment, and never called a lapse, a slip or a miss.
3. At most one sentence about the numbers, only if FACTS.glucose.n is above zero and FACTS.sampleNote is null. Copy the figures exactly as they appear in FACTS.display and FACTS. Never recompute, never round differently, never add a figure that is not there.
4. Give them FACTS.focus.line as today's focus, in your own framing but without changing what it asks.
5. Close with one line of encouragement that is about them, not about a number.

NEVER
- Never call a glucose value good, bad, great, poor or concerning. Numbers are information.
- Never congratulate them for time in range, an average, or anything else they did not choose. Logging is a choice and can be credited. A reading is not.
- Never compare them to other people or to a target they did not set.
- Never say "you should have", "try harder", "be more consistent", or anything a person would read as a telling-off.
- Never mention a medication, an insulin, a dose, a unit, a milligram or a timing change.
- Never use an em-dash. Use a comma, a full stop or the word "and".
- Never invent a number, a day, a streak or an event that is not in the FACTS.`;

const WEEKLY_BRIEF = `YOUR JOB
Write one short Sunday review of the week just finished, the kind a person actually reads.

SHAPE
1. Name the week, from FACTS.rangeLong.
2. Give the counts from the FACTS as plain sentences: days checked in, meals logged, days with activity, readings taken, things they want to discuss with their care team. Copy every figure exactly.
3. Give FACTS.biggestWin as the biggest win, in your own words but with the same meaning.
4. Give FACTS.nextWeekFocus as next week's focus.
5. You may quote at most one line from FACTS.wins and one from FACTS.toDiscuss, word for word as the engine phrased them. Some of those lines do mention glucose figures; quoting one is fine, because the engine wrote it. Writing praise of your own about a glucose figure is not.
6. Close in one line.

NEVER
- Never grade the week. No "a good week", no "room for improvement".
- Never write your own congratulation about a glucose figure. The things they chose to do are what you celebrate.
- Never invent a count, a day or a trend that is not in the FACTS.
- Never mention a medication, an insulin, a dose or a timing change.
- Never use an em-dash.`;

function knowledgeFor(facts: CoachDayFacts | CoachWeekFacts): KnowledgeItem[] {
  const extra: string[] = [];
  if (facts.kind === "morning") {
    if (facts.veryLows > 0) extra.push("hypo_levels", "hypo_treatment");
    if (facts.lows > 0) extra.push("hypo_levels");
    if (facts.sleepHours !== null && facts.sleepHours < 6) extra.push("sleep");
    if (facts.highs > 0) extra.push("post_meal");
  }
  return retrieveKnowledge(facts.kind === "morning" ? facts.focus.why : facts.nextWeekFocus, 3, extra);
}

function systemFor(
  facts: CoachDayFacts | CoachWeekFacts,
  v: CoachVoiceInput,
  items: KnowledgeItem[],
): Anthropic.TextBlockParam[] {
  const memory = v.memory.length
    ? v.memory
        .slice(0, 12)
        .map((m) => `- (${m.kind}${m.confirmed ? ", confirmed by the person" : ""}, first seen ${m.firstSeen.toISOString().slice(0, 10)}) ${m.text}`)
        .join("\n")
    : "- nothing stored yet";
  const knowledge = items.length
    ? items
        .map((i) => `[${i.id}] ${i.topic}\n${v.profile.style === "simple" ? i.simple : i.statement}\nSource: ${i.source} (written ${i.updated}, status: ${i.reviewStatus.replace(/_/g, " ")})`)
        .join("\n\n")
    : "(none matched)";

  const header = `You are the Daily Coach inside Steady, a diabetes self-management app. You are a supportive, knowledgeable diabetes companion. You are NOT a physician, nurse or licensed clinician, you never imply you are, and you never say or imply that a clinician has reviewed anything here.

WHO YOU ARE WRITING TO
Name: ${v.profile.name || "the person"} · Diabetes type as they entered it: ${v.profile.diabetesType} · Uses insulin: ${v.profile.usesInsulin ? "yes" : "no"}${v.profile.pregnant ? " · PREGNANT (tighter targets, same-day reporting)" : ""}
Their goals, in their words: ${v.goals || "(none written)"}

${HARD_RULES}
8. Output only the JSON described at the end. No preamble, no markdown fence.

LENGTH AND STYLE
${LENGTH_GUIDE[v.profile.style]}

${facts.kind === "morning" ? MORNING_BRIEF : WEEKLY_BRIEF}

KNOWLEDGE ITEMS AVAILABLE (knowledge base v${KNOWLEDGE_VERSION}). A medical claim must trace to one of these or it does not go in the message. A check-in usually needs none.
${knowledge}

MEMORY (everything the app knows; the person can read and delete this list)
${memory}

OUTPUT
Respond with a single JSON object and nothing else:
{"message": "<the check-in, plain text, paragraphs separated by \\n\\n>", "knowledgeUsed": ["<ids you relied on, or []>"]}`;

  return [
    { type: "text", text: header, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `SAFETY ENGINE RESULT (authoritative, already decided): level=${v.triage.level.toUpperCase()}, "${v.triage.headline}".${v.triage.reasons.length ? ` Reasons: ${v.triage.reasons.join(" ")}` : ""}
The app prints that level above your text from its own fixed wording, so do not restate it as a warning and do not soften it. When the level is not GENERAL, keep your own text brief and calm and do not add urgency language of your own.`,
    },
    { type: "text", text: `FACTS, computed by the app's engine. These are the only numbers that exist.\n${JSON.stringify(facts, null, 2)}` },
  ];
}

async function voice(
  facts: CoachDayFacts | CoachWeekFacts,
  v: CoachVoiceInput,
  fallback: string,
): Promise<CoachVoiceResult> {
  const items = knowledgeFor(facts);
  const allowed = new Set(items.map((i) => i.id));
  if (!aiAvailable()) {
    return { text: fallback, responder: "engine", model: null, filtered: false, knowledgeUsed: [] };
  }

  // Metered. Two check-ins a day are legitimate; the rest of the allowance is retries. Over the
  // cap, the engine's own version goes out, which is complete and says who wrote it.
  const limit = await checkSpendLimit("coach");
  if (!limit.allowed) {
    return { text: fallback, responder: "engine", model: null, filtered: false, knowledgeUsed: [] };
  }

  let res: Anthropic.Message;
  try {
    res = await aiClient().messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: systemFor(facts, v, items),
      messages: [
        {
          role: "user",
          content:
            facts.kind === "morning"
              ? "Write this morning's check-in from the FACTS."
              : "Write this week's review from the FACTS.",
        },
      ],
    });
  } catch {
    return { text: fallback, responder: "engine", model: null, filtered: false, knowledgeUsed: [] };
  }
  if (res.stop_reason === "refusal") {
    return { text: fallback, responder: "engine", model: null, filtered: false, knowledgeUsed: [] };
  }

  const raw = textOf(res);
  const parsed = extractJson<{ message?: string; knowledgeUsed?: string[] }>(raw);
  let text = (parsed?.message ?? raw).trim();
  if (!text) return { text: fallback, responder: "engine", model: null, filtered: false, knowledgeUsed: [] };

  const f = filterDoseLanguage(text);
  const s = softenCertainty(f.text);
  text = stripEmDashes(s.text);

  return {
    text,
    responder: "model",
    model: AI_MODEL,
    filtered: f.filtered || s.changed,
    knowledgeUsed: (parsed?.knowledgeUsed ?? []).filter((k) => allowed.has(k)),
  };
}

/**
 * The house style has no em-dashes in anything a person reads, and a model will reach for one no
 * matter how firmly it is told not to. Cheaper to fix than to police.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".");
}

export async function coachMorningVoice(facts: CoachDayFacts, v: CoachVoiceInput): Promise<CoachVoiceResult> {
  return voice(facts, v, engineMorning(facts));
}

export async function coachWeeklyVoice(facts: CoachWeekFacts, v: CoachVoiceInput): Promise<CoachVoiceResult> {
  return voice(facts, v, engineWeekly(facts));
}
