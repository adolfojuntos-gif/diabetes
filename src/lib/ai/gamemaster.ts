import "server-only";
/**
 * THE GAME MASTER'S VOICE.
 *
 * The engine has already decided everything: what was earned, how much, why, over which window, at
 * what data quality. This file's only job is to say it warmly, in a guardian's voice, and it is
 * given no ability to do anything else.
 *
 * CLAUDE IS THE NARRATOR AND NEVER THE SCOREKEEPER. The structured facts go in; prose comes out;
 * the prose is then CHECKED against those facts by `narrationGate.ts` before a person sees it. If
 * the model invents a figure, changes an amount, or slips into clinical language, it is rejected
 * and the engine's own sentence is shown instead. The person gets a complete message either way,
 * which is the same promise the daily coach makes.
 *
 * WHY A VERIFIER AND NOT JUST A GOOD PROMPT. A prompt is a request. In a health product the
 * difference between "we asked it not to" and "it cannot" is the entire safety argument, and the
 * only figures a reader should ever see are ones that came out of the ledger.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { aiAvailable, aiClient, AI_MODEL, textOf } from "./client";
import { checkSpendLimit, recordAiUse } from "../data/aiAudit";
import { filterDoseLanguage } from "./filter";
import { verifyNarration, engineCelebration, type NarrationFacts } from "./narrationGate";

export { verifyNarration, engineCelebration };
export type { NarrationFacts };

/** Bumped whenever the brief below changes, and recorded with anything generated under it. */
export const GAME_MASTER_PROMPT_VERSION = "1.0.0";

export type Narration = {
  text: string;
  responder: "model" | "engine";
  model: string | null;
  promptVersion: string;
  /** Why the model's text was rejected, when it was. Recorded, never shown to the person. */
  rejected: string | null;
};

const BRIEF = `YOU ARE THE GAME MASTER
You write two or three sentences in the voice of one guardian in a quiet adventure game, celebrating something a person has just earned.

WHAT YOU ARE GIVEN
A JSON object of FACTS. Everything true is in it. Nothing true is outside it.

SHAPE
1. One line in the guardian's voice about the world or the place they are in.
2. One line naming what they did, taken from the titles in FACTS.earned.
3. Stop. Two or three sentences in total, under 60 words.

NEVER
- Never state a number that is not in FACTS. Not an XP amount, not a gem count, not a day count, not a percentage, not a level. To mention an amount, copy it exactly from FACTS.
- Never mention glucose, blood sugar, a reading, a target, a range, anything clinical, a medication, an insulin, a dose, a unit, a milligram, or a symptom. You do not know any of those and must not appear to.
- Never give advice, medical or otherwise. You are not telling them what to do next.
- Never say they are healthy, healthier, doing well medically, improving medically, or in control.
- Never imply a clinician has looked at anything.
- Never scold, and never mention a lapse, a slip, a miss, a streak lost, or a day they did not log.
- Never use an em-dash. Use a comma, a full stop or the word "and".
- Never invent an event, a place, a character or a quest that is not in FACTS.

TONE
Warm, unhurried, specific. A guardian who has been watching somebody build something and is pleased about it. Not a cheerleader, not a coach, and never breathless.`;

function systemFor(f: NarrationFacts): string {
  return `${BRIEF}

THE GUARDIAN SPEAKING
${f.guardian.name}, ${f.guardian.animal}. Their voice: ${f.guardian.voice}.
They are standing in ${f.region}.`;
}

/**
 * Write the celebration. Falls back to the engine's own sentence whenever the model is
 * unavailable, errors, or produces something that fails the gate.
 */
export async function narrateAward(f: NarrationFacts): Promise<Narration> {
  const base: Narration = {
    text: f.fallback,
    responder: "engine",
    model: null,
    promptVersion: GAME_MASTER_PROMPT_VERSION,
    rejected: null,
  };
  if (!aiAvailable() || f.earned.length === 0) return base;

  /*
   * Metered like every other paid path in this app. Being over the cap is not an error here and
   * is never shown: the engine's sentence carries the same facts, so the person sees a complete
   * celebration and never learns that a budget was involved.
   */
  const verdict = await checkSpendLimit("gamemaster");
  if (!verdict.allowed) return { ...base, rejected: "over the gamemaster limit" };

  try {
    const res: Anthropic.Message = await aiClient().messages.create({
      model: AI_MODEL,
      max_tokens: 300,
      system: systemFor(f),
      messages: [
        {
          role: "user",
          content: `FACTS\n${JSON.stringify({ playerName: f.playerName || null, region: f.region, level: f.level, earned: f.earned }, null, 2)}\n\nWrite the celebration.`,
        },
      ],
    });
    // The dose filter runs first and unconditionally, exactly as it does on every other model path
    // in this app. The Game Master is not exempt from the app's oldest safety rule.
    const raw = filterDoseLanguage(textOf(res));
    const gate = verifyNarration(raw.text, f);

    /*
     * The audit row is written whether or not the text survived the gate, because the call was
     * made and the money was spent. A rejected narration that left no trace would make the
     * rejection rate unmeasurable, and that rate is the number worth watching most.
     */
    await recordAiUse({
      mode: "talk",
      feature: "gamemaster",
      userQuestion: `celebrate: ${f.earned.map((e) => e.title).join("; ")}`,
      dataAccessed: ["journey_awards:unseen", "journey:level"],
      knowledgeUsed: [],
      safetyRules: [`gamemaster_gate:${gate.ok ? "passed" : gate.reason}`, `prompt:${GAME_MASTER_PROMPT_VERSION}`],
      triageLevel: "general",
      responder: "model",
      model: AI_MODEL,
      filtered: raw.filtered || !gate.ok,
    });

    if (!gate.ok) return { ...base, rejected: gate.reason };
    return { text: raw.text, responder: "model", model: AI_MODEL, promptVersion: GAME_MASTER_PROMPT_VERSION, rejected: null };
  } catch {
    // A narration is decoration on top of a reward that has already been granted. It must never be
    // the reason somebody does not see what they earned.
    return { ...base, rejected: "model call failed" };
  }
}
