/**
 * Plain-English labels for the stored vocabularies. The database keeps short keys; a person
 * reading the screen should never see one.
 */
import type { ReadingContext, MealSlot, InsulinKind, ExerciseIntensity, Symptom } from "@/lib/db/schema";

export const CONTEXT_LABEL: Record<ReadingContext, string> = {
  fasting: "Fasting",
  before_meal: "Before a meal",
  after_meal: "After a meal",
  bedtime: "Bedtime",
  overnight: "Overnight",
  exercise: "Around exercise",
  sick: "While sick",
  other: "Other",
};

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export const INSULIN_KIND_LABEL: Record<InsulinKind, string> = {
  bolus: "Mealtime (bolus)",
  basal: "Background (basal)",
  correction: "Correction",
};

export const INTENSITY_LABEL: Record<ExerciseIntensity, string> = {
  light: "Light",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

export const QUALITY_LABEL: Record<number, string> = {
  1: "Awful",
  2: "Poor",
  3: "OK",
  4: "Good",
  5: "Great",
};

export const SEVERITY_LABEL: Record<number, string> = {
  1: "Mild",
  2: "Moderate",
  3: "Severe",
};

export const SYMPTOM_LABEL: Record<Symptom, string> = {
  shaky: "Shaky",
  sweaty: "Sweaty",
  confused: "Confused or foggy",
  dizzy: "Dizzy",
  headache: "Headache",
  blurred_vision: "Blurred vision",
  very_thirsty: "Very thirsty",
  frequent_urination: "Peeing often",
  fatigue: "Very tired",
  nausea: "Nausea",
  vomiting: "Being sick",
  abdominal_pain: "Stomach pain",
  fruity_breath: "Fruity smelling breath",
  rapid_breathing: "Fast breathing",
  chest_pain: "Chest pain",
  short_of_breath: "Short of breath",
  numbness_tingling: "Numbness or tingling",
  foot_wound: "A wound on my foot",
  fever: "Fever",
  unable_to_keep_fluids: "Cannot keep fluids down",
  one_sided_weakness: "Weakness on one side",
  slurred_speech: "Slurred speech",
  fainted: "Fainted",
  seizure: "Seizure",
  irritable: "Irritable",
  hungry: "Very hungry",
  heart_racing: "Heart racing",
  slow_healing: "Something healing slowly",
  other: "Something else",
};

/** "1,250" rather than "1250" for the litres-of-water sort of number. */
export function group(n: number): string {
  return n.toLocaleString();
}
