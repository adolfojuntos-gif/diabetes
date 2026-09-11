/**
 * Questions for the care team, generated from patterns with their evidence attached, plus a
 * standing set everyone benefits from. Pure.
 */
import type { Pattern } from "./patterns";

export type QuestionDraft = { text: string; evidence: string | null; patternKey: string | null };

export function questionsFromPatterns(patterns: Pattern[]): QuestionDraft[] {
  return patterns
    .filter((p) => p.doctorQuestion)
    .map((p) => ({ text: p.doctorQuestion!, evidence: p.evidence, patternKey: p.key }));
}

/** Evergreen questions, keyed so they are only offered once. */
export const STANDING_QUESTIONS: QuestionDraft[] = [
  { text: "What glucose range are we aiming for, and has that changed?", evidence: null, patternKey: "standing_targets" },
  { text: "When is my next A1C, eye exam, foot exam, kidney check (eGFR and urine albumin) and cholesterol test due?", evidence: null, patternKey: "standing_screening" },
  { text: "Should I have a glucagon prescription, and do the people around me know how to use it?", evidence: null, patternKey: "standing_glucagon" },
  { text: "What is my sick-day plan. What do I do with my medicines and monitoring when I'm ill?", evidence: null, patternKey: "standing_sick_day" },
  { text: "Are there any of my medicines I should pause around surgery, fasting or dehydration?", evidence: null, patternKey: "standing_pause_rules" },
  { text: "Is a CGM or a different meter something we should consider?", evidence: null, patternKey: "standing_cgm" },
  { text: "Are there vaccines (flu, pneumonia, COVID, hepatitis B) I'm due for?", evidence: null, patternKey: "standing_vaccines" },
];
