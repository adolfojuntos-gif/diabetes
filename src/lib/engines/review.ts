/**
 * Weekly review: this week against last, from the same engines every other screen uses.
 * Pure. Screens format; this computes.
 */
import { glucoseStats, between, type GlucoseStats, type ReadingLike } from "./stats";
import { mealResponses, rankMeals, type MealLike, type MealRanking } from "./mealResponse";
import { detectPatterns, type Pattern, type Snapshot } from "./patterns";
import { addDays, startOfWeek, dateKey } from "../time";
import { formatGlucose, unitLabel } from "../units";
import type { Units } from "../db/schema";

export type WeekSummary = {
  weekOf: string;
  from: Date;
  to: Date;
  glucose: GlucoseStats;
  meals: { count: number; avgCarbsPerDay: number | null; daysLogged: number };
  insulin: { totalUnits: number; avgUnitsPerDay: number | null; bolusCount: number; daysLogged: number };
  exercise: { sessions: number; minutes: number };
  sleep: { nights: number; avgMinutes: number | null; avgQuality: number | null };
  hydration: { daysLogged: number; avgMl: number | null; daysAtGoal: number };
  weight: { first: number | null; last: number | null };
};

export type WeeklyReview = {
  current: WeekSummary;
  previous: WeekSummary;
  ranking: MealRanking;
  patterns: Pattern[];
  sampleNote: string | null;
  /** Deltas current − previous, null when either side is missing. */
  delta: { tir: number | null; mean: number | null; cv: number | null; lows: number | null; sleepMinutes: number | null; exerciseMinutes: number | null };
  wins: string[];
  toDiscuss: string[];
};

export type ReviewInput = Omit<Snapshot, "windowDays"> & {
  /** Display unit, so the wins list never hardcodes mg/dL. */
  units: Units;
  weightLogs: { at: Date; kg: number }[];
  /** Which week to review; defaults to the week containing `now`. */
  weekStart?: Date;
};

function summarise(input: ReviewInput, from: Date, to: Date): WeekSummary {
  const readings = between(input.readings, from, to);
  const meals = between(input.meals, from, to);
  const insulin = between(input.insulin, from, to);
  const exercise = between(input.exercise, from, to);
  const hydration = between(input.hydration, from, to);
  const weight = between(input.weightLogs, from, to).sort((a, b) => a.at.getTime() - b.at.getTime());
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  const sleep = input.sleep.filter((s) => s.wakeDate >= fromKey && s.wakeDate < toKey);

  const mealDays = new Set(meals.map((m) => dateKey(m.at)));
  const carbs = meals.reduce((a, m) => a + m.carbsG, 0);
  const insulinDays = new Set(insulin.map((d) => dateKey(d.at)));
  const units = insulin.reduce((a, d) => a + d.units, 0);
  const hydDay = new Map<string, number>();
  for (const h of hydration) hydDay.set(dateKey(h.at), (hydDay.get(dateKey(h.at)) ?? 0) + h.ml);
  const hydVals = [...hydDay.values()];

  return {
    weekOf: fromKey,
    from,
    to,
    glucose: glucoseStats(readings, input.targetLow, input.targetHigh),
    meals: { count: meals.length, avgCarbsPerDay: mealDays.size ? carbs / mealDays.size : null, daysLogged: mealDays.size },
    insulin: {
      totalUnits: Math.round(units * 10) / 10,
      avgUnitsPerDay: insulinDays.size ? Math.round((units / insulinDays.size) * 10) / 10 : null,
      bolusCount: insulin.filter((d) => d.kind !== "basal").length,
      daysLogged: insulinDays.size,
    },
    exercise: { sessions: exercise.length, minutes: exercise.reduce((a, e) => a + e.minutes, 0) },
    sleep: {
      nights: sleep.length,
      avgMinutes: sleep.length ? sleep.reduce((a, s) => a + s.minutes, 0) / sleep.length : null,
      avgQuality: sleep.length ? sleep.reduce((a, s) => a + s.quality, 0) / sleep.length : null,
    },
    hydration: {
      daysLogged: hydVals.length,
      avgMl: hydVals.length ? hydVals.reduce((a, b) => a + b, 0) / hydVals.length : null,
      daysAtGoal: hydVals.filter((v) => v >= input.hydrationGoalMl).length,
    },
    weight: { first: weight[0]?.kg ?? null, last: weight[weight.length - 1]?.kg ?? null },
  };
}

export function weeklyReview(input: ReviewInput): WeeklyReview {
  const from = input.weekStart ? startOfWeek(input.weekStart) : startOfWeek(input.now);
  const to = addDays(from, 7);
  const current = summarise(input, from, to);
  const previous = summarise(input, addDays(from, -7), from);

  const readings = between(input.readings, from, to);
  const ranking = rankMeals(mealResponses(between(input.meals, from, to), readings));

  // Patterns over the 14 days ending at the end of this week, so the review has context.
  const endsAt = to < input.now ? to : input.now;
  const report = detectPatterns({ ...input, now: endsAt, windowDays: 14 });

  const d = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  const delta = {
    tir: d(current.glucose.timeInRange, previous.glucose.timeInRange),
    mean: d(current.glucose.mean, previous.glucose.mean),
    cv: d(current.glucose.cv, previous.glucose.cv),
    lows: current.glucose.n && previous.glucose.n ? current.glucose.lowsCount - previous.glucose.lowsCount : null,
    sleepMinutes: d(current.sleep.avgMinutes, previous.sleep.avgMinutes),
    exerciseMinutes: current.exercise.minutes - previous.exercise.minutes,
  };

  const wins: string[] = [];
  const toDiscuss: string[] = [];
  if (delta.tir !== null && delta.tir >= 5) wins.push(`Time in range up ${Math.round(delta.tir)} points on last week.`);
  if (current.glucose.timeInRange !== null && current.glucose.timeInRange >= 70 && current.glucose.n >= 10) wins.push(`${Math.round(current.glucose.timeInRange)}% in range, at the consensus goal.`);
  if (delta.lows !== null && delta.lows < 0) wins.push(`${-delta.lows} fewer low readings than last week.`);
  if (current.exercise.minutes >= 150) wins.push(`${current.exercise.minutes} minutes of movement.`);
  if (current.sleep.avgMinutes !== null && current.sleep.avgMinutes >= input.sleepGoalMinutes) wins.push("Slept at or above your goal on average.");
  if (current.hydration.daysLogged >= 5 && current.hydration.daysAtGoal / current.hydration.daysLogged >= 0.7) wins.push(`Hit your water goal ${current.hydration.daysAtGoal} of ${current.hydration.daysLogged} days.`);
  if (ranking.best[0] && ranking.best[0].rise !== null) {
    const r = ranking.best[0].rise;
    wins.push(`Gentlest meal: ${ranking.best[0].name}, ${r <= 0 ? "no rise at all" : `a rise of just ${formatGlucose(r, input.units)} ${unitLabel(input.units)}`}.`);
  }
  for (const p of report.patterns) if (p.severity === "win" && wins.length < 6) wins.push(p.title + ".");

  for (const p of report.patterns) if (p.severity === "attention" || p.severity === "watch") toDiscuss.push(p.evidence);
  if (ranking.worst[0] && (ranking.worst[0].rise ?? 0) > 50) toDiscuss.push(`${ranking.worst[0].name} raised glucose ${formatGlucose(ranking.worst[0].rise!, input.units)} ${unitLabel(input.units)}.`);

  return { current, previous, ranking, patterns: report.patterns, sampleNote: report.sampleNote, delta, wins: wins.slice(0, 6), toDiscuss: toDiscuss.slice(0, 5) };
}
