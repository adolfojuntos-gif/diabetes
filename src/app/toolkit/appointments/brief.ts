import "server-only";
/**
 * The appointment brief. Written entirely by the engines from rows the person entered: no model
 * is called here, and nothing in the output interprets a value, names a condition, or touches a
 * dose. Every number carries the sample it came from, and the last line says what the document is.
 */
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db, doctorQuestions, glucoseReadings, labResults, medications, symptomLogs } from "@/lib/db";
import { loadSnapshot } from "@/lib/data/snapshot";
import { detectPatterns } from "@/lib/engines/patterns";
import { between, glucoseStats, round } from "@/lib/engines/stats";
import { addDays, dateKey, endOfDay, startOfDay } from "@/lib/time";
import { formatGlucose, unitLabel } from "@/lib/units";
import type { DiabetesType, InsulinRegimen, Units } from "@/lib/db/schema";

export const BRIEF_FOOTER = "This is a patient-generated summary. It is not a diagnosis and not a medical record.";

const WINDOW_DAYS = 30;

const TYPE_LABEL: Record<DiabetesType, string> = {
  type1: "Type 1 diabetes",
  type2: "Type 2 diabetes",
  gestational: "Gestational diabetes",
  prediabetes: "Prediabetes",
  lada: "LADA",
  other: "Other / not sure",
};

const REGIMEN_LABEL: Record<InsulinRegimen, string> = {
  none: "no insulin",
  basal: "basal insulin",
  basal_bolus: "basal and bolus insulin",
  pump: "an insulin pump",
  other: "another insulin arrangement",
};

const SEVERITY_LABEL: Record<number, string> = { 1: "mild", 2: "moderate", 3: "severe" };

function human(key: string): string {
  return key.replace(/_/g, " ");
}

function gline(label: string, mgdl: number | null, units: Units): string {
  return mgdl === null ? `${label}: not enough data` : `${label}: ${formatGlucose(mgdl, units)} ${unitLabel(units)}`;
}

function numbersBlock(
  title: string,
  stats: ReturnType<typeof glucoseStats>,
  units: Units,
  low: number,
  high: number,
): string[] {
  if (stats.n === 0) return [`${title}: no readings.`];
  const lines = [
    `${title}:`,
    `- ${stats.n} readings across ${stats.days} day${stats.days === 1 ? "" : "s"}`,
    `- Time in my range (${formatGlucose(low, units)} to ${formatGlucose(high, units)} ${unitLabel(units)}): ${round(stats.timeInRange, 0)}%`,
    `- ${gline("Average", stats.mean, units)}`,
    `- Variability (CV): ${stats.cv === null ? "not enough data" : `${round(stats.cv, 1)}%`}`,
    `- Below my low: ${stats.counts.very_low + stats.counts.low} reading${stats.counts.very_low + stats.counts.low === 1 ? "" : "s"} (${round(stats.pct.very_low + stats.pct.low, 1)}%), of which ${stats.counts.very_low} under 54 mg/dL`,
    `- Above my high: ${stats.counts.high + stats.counts.very_high} reading${stats.counts.high + stats.counts.very_high === 1 ? "" : "s"} (${round(stats.pct.high + stats.pct.very_high, 1)}%)`,
  ];
  return lines;
}

/**
 * Build the brief for an appointment. `now` is the moment the person pressed the button; the
 * window is the 30 days before it, with the 30 days before that for comparison when they exist.
 */
export async function buildAppointmentBrief(now = new Date()): Promise<string> {
  const snap = await loadSnapshot(WINDOW_DAYS, now);
  const p = snap.profile;
  const units = p.units;
  const low = p.targetLowMgdl;
  const high = p.targetHighMgdl;

  const windowStart = addDays(startOfDay(now), -(WINDOW_DAYS - 1));
  const windowEnd = endOfDay(now);
  const current = glucoseStats(between(snap.readings, windowStart, windowEnd), low, high);

  const prevStart = addDays(windowStart, -WINDOW_DAYS);
  const prevRows = await db
    .select()
    .from(glucoseReadings)
    .where(and(gte(glucoseReadings.at, prevStart), lt(glucoseReadings.at, windowStart)));
  const previous = glucoseStats(prevRows, low, high);

  const report = detectPatterns({ ...snap, windowDays: WINDOW_DAYS });

  const [questions, symptoms, labs, meds] = await Promise.all([
    db.select().from(doctorQuestions).where(eq(doctorQuestions.asked, false)).orderBy(desc(doctorQuestions.createdAt)),
    db.select().from(symptomLogs).where(gte(symptomLogs.at, windowStart)).orderBy(desc(symptomLogs.at)).limit(25),
    db.select().from(labResults).where(eq(labResults.verified, true)).orderBy(desc(labResults.at)).limit(15),
    db.select().from(medications).where(eq(medications.active, true)),
  ]);

  const mealsIn = between(snap.meals, windowStart, windowEnd);
  const insulinIn = between(snap.insulin, windowStart, windowEnd);
  const exerciseIn = between(snap.exercise, windowStart, windowEnd);

  const L: string[] = [];
  L.push(`# Appointment brief${p.name ? ` for ${p.name}` : ""}`);
  L.push("");

  L.push("## Reporting period");
  L.push(
    `${WINDOW_DAYS} days, ${dateKey(windowStart)} to ${dateKey(startOfDay(now))}. Written on ${dateKey(now)} from entries I made myself.`,
  );
  L.push("");

  L.push("## My diabetes, as I entered it");
  L.push(`- ${TYPE_LABEL[p.diabetesType]}`);
  L.push(`- I am on ${REGIMEN_LABEL[p.insulinRegimen]}`);
  L.push(`- ${p.usesCgm ? "I use a continuous glucose monitor" : "I check with a meter, not a CGM"}`);
  L.push(
    `- The target range set in my app: ${formatGlucose(low, units)} to ${formatGlucose(high, units)} ${unitLabel(units)}`,
  );
  if (p.birthYear) L.push(`- Born ${p.birthYear}`);
  if (p.pregnant) L.push("- I am pregnant, so my targets are being led by my care team");
  if (p.dailyCarbTargetG) L.push(`- Daily carbohydrate target I am using: ${p.dailyCarbTargetG} g`);
  if (p.goals.trim()) L.push(`- What I am working on: ${p.goals.trim()}`);
  L.push("");

  L.push("## My numbers");
  L.push(...numbersBlock(`Last ${WINDOW_DAYS} days (${dateKey(windowStart)} to ${dateKey(startOfDay(now))})`, current, units, low, high));
  L.push("");
  if (previous.n > 0) {
    L.push(
      ...numbersBlock(
        `The ${WINDOW_DAYS} days before that (${dateKey(prevStart)} to ${dateKey(addDays(windowStart, -1))})`,
        previous,
        units,
        low,
        high,
      ),
    );
  } else {
    L.push(`The ${WINDOW_DAYS} days before that: no readings logged, so there is nothing to compare against.`);
  }
  if (!current.gmiReliable && current.n > 0) {
    L.push("");
    L.push(
      "Note on the sample: this window has fewer than 14 dense days of readings, so treat the averages as a sketch rather than a measurement.",
    );
  }
  L.push("");

  L.push("## Logging consistency");
  L.push(`- Days with at least one glucose reading: ${current.days} of ${WINDOW_DAYS}`);
  L.push(`- Meals logged: ${mealsIn.length}`);
  if (p.insulinRegimen !== "none") L.push(`- Insulin entries logged: ${insulinIn.length}`);
  L.push(`- Movement sessions logged: ${exerciseIn.length} (${exerciseIn.reduce((a, e) => a + e.minutes, 0)} minutes)`);
  L.push(`- Symptom entries logged: ${symptoms.length}`);
  L.push("");

  L.push("## What I have noticed");
  if (report.sampleNote) L.push(report.sampleNote);
  if (report.patterns.length === 0) {
    L.push("The pattern engine did not find anything it had enough readings to call a pattern in this window.");
  } else {
    for (const pat of report.patterns) {
      L.push(`- ${pat.title}: ${pat.evidence}`);
    }
  }
  L.push("");

  L.push("## Symptoms I logged");
  if (symptoms.length === 0) {
    L.push("None logged in this window.");
  } else {
    for (const s of symptoms) {
      const names = s.symptoms
        .split(",")
        .map((x) => human(x.trim()))
        .filter(Boolean)
        .join(", ");
      L.push(`- ${dateKey(s.at)}: ${names} (${SEVERITY_LABEL[s.severity] ?? "severity " + s.severity})${s.note ? `. Note: ${s.note}` : ""}`);
    }
  }
  L.push("");

  L.push("## Medications I am taking (as I entered them)");
  if (meds.length === 0) {
    L.push("None entered in the app.");
  } else {
    for (const m of meds) {
      L.push(`- ${m.name}${m.doseText ? `: ${m.doseText}` : ""}${m.startedOn ? ` (started ${m.startedOn})` : ""}`);
    }
    L.push("These are my own entries. They have not been checked against a pharmacy record.");
  }
  L.push("");

  L.push("## Labs");
  if (labs.length === 0) {
    L.push("No lab results saved in the app.");
  } else {
    for (const l of labs) {
      const range =
        l.refLow !== null && l.refHigh !== null
          ? ` (the lab's range: ${l.refLow} to ${l.refHigh})`
          : l.refHigh !== null
            ? ` (the lab's range: under ${l.refHigh})`
            : l.refLow !== null
              ? ` (the lab's range: over ${l.refLow})`
              : " (no range supplied by the lab)";
      L.push(`- ${dateKey(l.at)}: ${l.name} ${l.value}${l.unit ? ` ${l.unit}` : ""}${range}${l.labFlag ? `, lab flag ${l.labFlag}` : ""}`);
    }
  }
  L.push("");

  L.push("## My questions");
  if (questions.length === 0) {
    L.push("None written down yet.");
  } else {
    questions.forEach((q, i) => {
      L.push(`${i + 1}. ${q.text}`);
      if (q.evidence) L.push(`   ${q.evidence}`);
    });
  }
  L.push("");

  L.push(BRIEF_FOOTER);

  return L.join("\n");
}
