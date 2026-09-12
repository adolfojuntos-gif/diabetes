import "server-only";
/**
 * Data access for the engines. Every screen and the Copilot load their evidence through here, so
 * there is one definition of "the last N days".
 */
import { and, desc, eq, gte, lt, asc } from "drizzle-orm";
import {
  db,
  profile as profileTable,
  glucoseReadings,
  meals,
  insulinDoses,
  exerciseSessions,
  sleepLogs,
  hydrationLogs,
  weightLogs,
  labResults,
  symptomLogs,
  medications,
  appointments,
  memoryFacts,
  wellbeingCheckins,
  type Profile,
} from "../db";
import { addDays, startOfDay, dateKey, endOfDay } from "../time";
import type { Snapshot } from "../engines/patterns";
import type { ReviewInput } from "../engines/review";
import { glucoseStats, between } from "../engines/stats";
import { detectPatterns } from "../engines/patterns";
import type { CopilotContext } from "../ai/copilot";
import { formatGlucose, unitLabel } from "../units";

export async function getProfile(): Promise<Profile> {
  const rows = await db.select().from(profileTable).where(eq(profileTable.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  const now = new Date();
  await db.insert(profileTable).values({ id: 1, createdAt: now, updatedAt: now }).onConflictDoNothing();
  return (await db.select().from(profileTable).where(eq(profileTable.id, 1)).limit(1))[0];
}

export function usesInsulin(p: Profile): boolean {
  return p.insulinRegimen !== "none";
}
export function usesBolus(p: Profile): boolean {
  return p.insulinRegimen === "basal_bolus" || p.insulinRegimen === "pump";
}

/** Everything the pattern engine needs for a window ending now (plus 1 day of lookback for sleep). */
export async function loadSnapshot(days: number, now = new Date(), p?: Profile): Promise<Snapshot & { profile: Profile }> {
  const prof = p ?? (await getProfile());
  const from = addDays(startOfDay(now), -(days + 1));
  const to = endOfDay(now);
  const [readings, mealRows, ex, sleep, hyd, ins] = await Promise.all([
    db.select().from(glucoseReadings).where(and(gte(glucoseReadings.at, from), lt(glucoseReadings.at, to))).orderBy(asc(glucoseReadings.at)),
    db.select().from(meals).where(and(gte(meals.at, from), lt(meals.at, to))).orderBy(asc(meals.at)),
    db.select().from(exerciseSessions).where(and(gte(exerciseSessions.at, from), lt(exerciseSessions.at, to))),
    db.select().from(sleepLogs).where(gte(sleepLogs.wakeDate, dateKey(from))),
    db.select().from(hydrationLogs).where(and(gte(hydrationLogs.at, from), lt(hydrationLogs.at, to))),
    db.select().from(insulinDoses).where(and(gte(insulinDoses.at, from), lt(insulinDoses.at, to))),
  ]);
  return {
    profile: prof,
    now,
    windowDays: days,
    targetLow: prof.targetLowMgdl,
    targetHigh: prof.targetHighMgdl,
    hydrationGoalMl: prof.hydrationGoalMl,
    sleepGoalMinutes: prof.sleepGoalMinutes,
    usesInsulinBolus: usesBolus(prof),
    readings,
    meals: mealRows,
    exercise: ex,
    sleep,
    hydration: hyd,
    insulin: ins,
  };
}

export async function loadReviewInput(now = new Date(), weekStart?: Date): Promise<ReviewInput & { profile: Profile }> {
  const snap = await loadSnapshot(21, now);
  const from = addDays(startOfDay(now), -22);
  const weights = await db.select().from(weightLogs).where(gte(weightLogs.at, from));
  const { windowDays: _w, ...rest } = snap;
  void _w;
  return { ...rest, units: snap.profile.units, weightLogs: weights, weekStart };
}

/** Assemble the Copilot's evidence. Records which windows were consulted for the audit row. */
export async function loadCopilotContext(now = new Date()): Promise<CopilotContext> {
  const prof = await getProfile();
  const snap = await loadSnapshot(90, now, prof);
  const windows = [
    { label: "Today", days: 1 },
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ].map((w) => {
    const from = w.days === 1 ? startOfDay(now) : addDays(startOfDay(now), -(w.days - 1));
    return { label: w.label, stats: glucoseStats(between(snap.readings, from, endOfDay(now)), prof.targetLowMgdl, prof.targetHighMgdl) };
  });
  const patterns = detectPatterns({ ...snap, windowDays: 14 });

  const since14 = addDays(startOfDay(now), -14);
  const [memory, meds, labs, symptoms, appt, checkin] = await Promise.all([
    db.select().from(memoryFacts).orderBy(desc(memoryFacts.lastSeen)).limit(40),
    db.select().from(medications).where(eq(medications.active, true)),
    db.select().from(labResults).where(eq(labResults.verified, true)).orderBy(desc(labResults.at)).limit(12),
    db.select().from(symptomLogs).where(gte(symptomLogs.at, since14)).orderBy(desc(symptomLogs.at)).limit(10),
    db.select().from(appointments).where(gte(appointments.at, startOfDay(now))).orderBy(asc(appointments.at)).limit(1),
    db.select().from(wellbeingCheckins).where(eq(wellbeingCheckins.date, dateKey(now))).limit(1),
  ]);

  const today = startOfDay(now);
  const tr = between(snap.readings, today, endOfDay(now));
  const tm = between(snap.meals, today, endOfDay(now));
  const ti = between(snap.insulin, today, endOfDay(now));
  const te = between(snap.exercise, today, endOfDay(now));
  const th = between(snap.hydration, today, endOfDay(now)).reduce((a, h) => a + h.ml, 0);
  const lastNight = snap.sleep.find((s) => s.wakeDate === dateKey(now));
  const u = prof.units;
  const todayLog = [
    tr.length ? `${tr.length} glucose reading${tr.length === 1 ? "" : "s"} (latest ${formatGlucose(tr[tr.length - 1].valueMgdl, u)} ${unitLabel(u)} at ${tr[tr.length - 1].at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : "no glucose readings yet",
    tm.length ? `${tm.length} meal${tm.length === 1 ? "" : "s"} logged (${Math.round(tm.reduce((a, m) => a + m.carbsG, 0))} g carbs)` : "no meals logged",
    usesInsulin(prof) ? (ti.length ? `${ti.length} insulin entr${ti.length === 1 ? "y" : "ies"} totalling ${ti.reduce((a, d) => a + d.units, 0)} units` : "no insulin logged") : null,
    te.length ? `${te.reduce((a, e) => a + e.minutes, 0)} min of movement` : "no movement logged",
    `${th} ml water of ${prof.hydrationGoalMl} goal`,
    lastNight ? `slept ${(lastNight.minutes / 60).toFixed(1)} h (quality ${lastNight.quality}/5)` : "last night's sleep not logged",
    checkin[0] ? `check-in done (feeling ${checkin[0].feeling}/5${checkin[0].unusual ? `; noted: "${checkin[0].unusual}"` : ""})` : "no check-in yet",
  ]
    .filter(Boolean)
    .join("; ") + ".";

  return {
    profile: {
      name: prof.name,
      diabetesType: prof.diabetesType,
      units: prof.units,
      targetLow: prof.targetLowMgdl,
      targetHigh: prof.targetHighMgdl,
      usesInsulin: usesInsulin(prof),
      pregnant: prof.pregnant,
      style: prof.copilotStyle,
    },
    windows,
    patterns,
    memory,
    medications: meds.map((m) => ({ name: m.name, doseText: m.doseText })),
    recentLabs: labs.map((l) => ({ name: l.name, value: l.value, unit: l.unit, at: dateKey(l.at), refLow: l.refLow, refHigh: l.refHigh })),
    recentSymptoms: symptoms.map((s) => ({ at: s.at.toISOString().slice(0, 16).replace("T", " "), symptoms: s.symptoms, severity: s.severity })),
    todayLog,
    upcomingAppointment: appt[0] ? `${appt[0].at.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} with ${appt[0].withWhom || "care team"}${appt[0].kind ? ` (${appt[0].kind})` : ""}` : null,
    goals: prof.goals,
    dataAccessed: ["glucose:today", "glucose:7d", "glucose:30d", "glucose:90d", "patterns:14d", "meals:90d", "insulin:90d", "exercise:90d", "sleep:90d", "hydration:90d", "memory", "medications", "labs:verified", "symptoms:14d", "appointments:next", "checkin:today"],
  };
}
