/**
 * Glucose replay. One day, told in order, then set against this person's best days.
 *
 * Pure and deterministic, like every other engine here. It answers two questions that a list of
 * numbers cannot: what actually happened across that day, and what was different about it.
 *
 * The second question is the useful one and it is also where an app can mislead. "Your best days
 * had 40 g less carbohydrate" is a real difference between two sets of days this person logged. It
 * is NOT a finding that eating 40 g less would have fixed this day, and the wording never implies
 * it. Days differ in dozens of ways at once and only a handful are logged, so what this produces is
 * a place to look, not a conclusion.
 *
 * BEST is defined as time in range, not as a low average, and it has an absolute floor rather than
 * only a ranking. A day spent at 60 mg/dL has a beautiful average and is a day of hypoglycaemia. A
 * ranking alone let one through when there were only three days to choose from, because the top
 * five of three is all of them. See `bestDays`.
 */
import { between, glucoseStats, round, type ReadingLike } from "./stats";
import type { MealLike } from "./mealResponse";
import type { ChartUnit } from "./patterns";
import { dateKey, startOfDay, addDays, fmtTime } from "../time";

export type ExerciseLike = { at: Date; minutes: number; intensity: string; kind: string };
export type SleepLike = { wakeDate: string; minutes: number; quality: number; bedAt?: Date; wakeAt?: Date };
export type InsulinLike = { at: Date; kind: string; units: number };

export type ReplayInput = {
  targetLow: number;
  targetHigh: number;
  readings: ReadingLike[];
  meals: MealLike[];
  insulin: InsulinLike[];
  exercise: ExerciseLike[];
  sleep: SleepLike[];
};

/** A day worth offering to replay, because something happened on it. */
export type SpikeCandidate = {
  date: string;
  /** The highest reading of the day. */
  peakMgdl: number;
  peakAt: Date;
  /** The biggest rise between two consecutive readings that day. */
  biggestRise: number;
  readings: number;
  timeInRange: number | null;
};

export type ReplayEventKind = "wake" | "meal" | "insulin" | "exercise" | "rise" | "peak" | "back_in_range" | "bed";

export type ReplayEvent = {
  at: Date;
  kind: ReplayEventKind;
  /** A short heading. */
  label: string;
  /** The numbers, when there are any. */
  detail: string | null;
  /** Where on the glucose curve this sits, when it can be placed. */
  valueMgdl: number | null;
};

export type Difference = {
  key: string;
  label: string;
  thisDay: number;
  bestAverage: number;
  unit: ChartUnit;
  better: "lower" | "higher";
  /** One plain sentence. Never says this difference caused anything. */
  sentence: string;
};

export type DayReplay = {
  date: string;
  readings: ReadingLike[];
  events: ReplayEvent[];
  peak: { at: Date; valueMgdl: number } | null;
  /** Minutes from the first meal of the day to the peak, when both exist. */
  minutesFirstMealToPeak: number | null;
  timeInRange: number | null;
  mean: number | null;
  /** The dates the comparison is against. Empty when there were not enough good days to compare. */
  bestDays: string[];
  /** Biggest difference first. Empty when there is nothing to compare against. */
  differences: Difference[];
  /** Set when the answer needs a caveat about itself. */
  note: string | null;
};

/** Enough readings that a day's shape means something. Below this the curve is a guess. */
const MIN_READINGS_FOR_A_DAY = 4;
const BEST_DAY_COUNT = 5;

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function readingsOn(date: string, readings: ReadingLike[]): ReadingLike[] {
  return readings.filter((r) => dateKey(r.at) === date).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* --------------------------- which days to offer --------------------------- */

/**
 * Days from the window worth replaying, worst first.
 *
 * "Worst" is the highest peak, because that is the day a person remembers and wants explained. A
 * day is only offered when it has enough readings to draw, since replaying four hours of a day
 * tells a misleading story about it.
 */
export function spikeDays(input: ReplayInput, now: Date, windowDays = 30): SpikeCandidate[] {
  const from = addDays(startOfDay(now), -(windowDays - 1));
  const inWindow = between(input.readings, from, now);

  const byDate = new Map<string, ReadingLike[]>();
  for (const r of inWindow) {
    const k = dateKey(r.at);
    byDate.set(k, [...(byDate.get(k) ?? []), r]);
  }

  const out: SpikeCandidate[] = [];
  for (const [date, rows] of byDate) {
    if (rows.length < MIN_READINGS_FOR_A_DAY) continue;
    const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
    const peak = sorted.reduce((a, b) => (b.valueMgdl > a.valueMgdl ? b : a));

    let biggestRise = 0;
    for (let i = 1; i < sorted.length; i++) {
      biggestRise = Math.max(biggestRise, sorted[i].valueMgdl - sorted[i - 1].valueMgdl);
    }

    const stats = glucoseStats(sorted, input.targetLow, input.targetHigh);
    // Only days that actually went above target. A steady day is not a spike to explain.
    if (peak.valueMgdl <= input.targetHigh) continue;

    out.push({
      date,
      peakMgdl: peak.valueMgdl,
      peakAt: peak.at,
      biggestRise,
      readings: sorted.length,
      timeInRange: stats.timeInRange,
    });
  }

  return out.sort((a, b) => b.peakMgdl - a.peakMgdl);
}

/* ------------------------------ the best days ------------------------------ */

/**
 * A day has to actually be GOOD to be a best day, not merely the least bad available.
 *
 * Ranking and then taking the top five is not enough, and a test caught it: with only three
 * well-logged days to choose from, the top five included a day spent between 58 and 62 mg/dL. That
 * day has a beautiful average, zero time in range, and is a day of hypoglycaemia. Offering it as a
 * model to copy would be the most harmful thing this feature could do.
 *
 * So there are absolute floors as well as a ranking. A day worth copying spends most of itself in
 * range and very little of itself low.
 */
const BEST_DAY_MIN_TIR = 60;
const BEST_DAY_MAX_LOW_PCT = 10;

/**
 * This person's best days, excluding the one being replayed.
 *
 * Time in range and not average, because a low day flatters an average. A day also has to clear the
 * reading minimum, or a single in-range reading would make a day look perfect.
 */
export function bestDays(input: ReplayInput, now: Date, exclude: string, windowDays = 30, count = BEST_DAY_COUNT): string[] {
  const from = addDays(startOfDay(now), -(windowDays - 1));
  const inWindow = between(input.readings, from, now);

  const byDate = new Map<string, ReadingLike[]>();
  for (const r of inWindow) {
    const k = dateKey(r.at);
    byDate.set(k, [...(byDate.get(k) ?? []), r]);
  }

  const scored: { date: string; tir: number }[] = [];
  for (const [date, rows] of byDate) {
    if (date === exclude || rows.length < MIN_READINGS_FOR_A_DAY) continue;
    const stats = glucoseStats(rows, input.targetLow, input.targetHigh);
    if (stats.timeInRange === null) continue;
    if (stats.timeInRange < BEST_DAY_MIN_TIR) continue;
    if (stats.pct.very_low + stats.pct.low > BEST_DAY_MAX_LOW_PCT) continue;
    scored.push({ date, tir: stats.timeInRange });
  }

  return scored
    .sort((a, b) => b.tir - a.tir)
    .slice(0, count)
    .map((d) => d.date);
}

/* ------------------------------ what a day held ------------------------------ */

type DayFacts = {
  carbs: number;
  largestMealCarbs: number;
  meals: number;
  movementMinutes: number;
  sleepHours: number | null;
  insulinUnits: number;
  readings: number;
};

function factsFor(date: string, input: ReplayInput): DayFacts {
  const meals = input.meals.filter((m) => dateKey(m.at) === date);
  const ex = input.exercise.filter((e) => dateKey(e.at) === date);
  const ins = input.insulin.filter((d) => dateKey(d.at) === date);
  const sleep = input.sleep.find((s) => s.wakeDate === date);

  return {
    carbs: meals.reduce((n, m) => n + (m.carbsG || 0), 0),
    largestMealCarbs: meals.reduce((n, m) => Math.max(n, m.carbsG || 0), 0),
    meals: meals.length,
    movementMinutes: ex.reduce((n, e) => n + (e.minutes || 0), 0),
    sleepHours: sleep ? sleep.minutes / 60 : null,
    insulinUnits: ins.reduce((n, d) => n + (d.units || 0), 0),
    readings: readingsOn(date, input.readings).length,
  };
}

/* ------------------------------- the replay ------------------------------- */

export function replayDay(date: string, input: ReplayInput, now: Date, windowDays = 30): DayReplay {
  const rows = readingsOn(date, input.readings);
  const stats = glucoseStats(rows, input.targetLow, input.targetHigh);
  const events: ReplayEvent[] = [];

  /** The reading nearest a moment, so an event can be placed on the curve. */
  const valueAt = (t: Date): number | null => {
    if (!rows.length) return null;
    const nearest = rows.reduce((a, b) =>
      Math.abs(b.at.getTime() - t.getTime()) < Math.abs(a.at.getTime() - t.getTime()) ? b : a,
    );
    // Beyond half an hour it is not this reading's story, so the event floats rather than lying.
    return Math.abs(nearest.at.getTime() - t.getTime()) <= 30 * 60_000 ? nearest.valueMgdl : null;
  };

  const sleep = input.sleep.find((s) => s.wakeDate === date);
  if (sleep?.wakeAt) {
    events.push({
      at: sleep.wakeAt,
      kind: "wake",
      label: "Woke up",
      detail: `${round(sleep.minutes / 60, 1)} hours of sleep`,
      valueMgdl: valueAt(sleep.wakeAt),
    });
  }

  for (const m of input.meals.filter((x) => dateKey(x.at) === date)) {
    events.push({
      at: m.at,
      kind: "meal",
      label: m.name || "A meal",
      detail: m.carbsG > 0 ? `${round(m.carbsG)} g of carbohydrate` : null,
      valueMgdl: valueAt(m.at),
    });
  }

  for (const d of input.insulin.filter((x) => dateKey(x.at) === date)) {
    events.push({
      at: d.at,
      kind: "insulin",
      label: "Insulin recorded",
      /** What was RECORDED. This app never suggests an amount, it only reports one. */
      detail: `${round(d.units, 1)} units, ${d.kind}`,
      valueMgdl: valueAt(d.at),
    });
  }

  for (const e of input.exercise.filter((x) => dateKey(x.at) === date)) {
    events.push({
      at: e.at,
      kind: "exercise",
      label: e.kind ? `Moved: ${e.kind}` : "Movement",
      detail: `${e.minutes} minutes, ${e.intensity}`,
      valueMgdl: valueAt(e.at),
    });
  }

  /* ----------------------- the shape of the day itself ----------------------- */

  let peak: { at: Date; valueMgdl: number } | null = null;
  if (rows.length) {
    const top = rows.reduce((a, b) => (b.valueMgdl > a.valueMgdl ? b : a));
    peak = { at: top.at, valueMgdl: top.valueMgdl };
    events.push({
      at: top.at,
      kind: "peak",
      label: "Highest reading of the day",
      detail: `${top.valueMgdl} mg/dL at ${fmtTime(top.at)}`,
      valueMgdl: top.valueMgdl,
    });

    /**
     * Where the climb toward the peak started: the last reading before it that was still in range.
     * More useful than the first reading of the day, because it marks the beginning of the event
     * rather than the beginning of the clock.
     */
    const beforePeak = rows.filter((r) => r.at.getTime() < top.at.getTime());
    const lastInRange = [...beforePeak].reverse().find((r) => r.valueMgdl <= input.targetHigh);
    if (lastInRange && top.valueMgdl > input.targetHigh) {
      events.push({
        at: lastInRange.at,
        kind: "rise",
        label: "The rise starts here",
        detail: `${lastInRange.valueMgdl} mg/dL, climbing ${round(top.valueMgdl - lastInRange.valueMgdl)} mg/dL from here`,
        valueMgdl: lastInRange.valueMgdl,
      });
    }

    const backInRange = rows.find((r) => r.at.getTime() > top.at.getTime() && r.valueMgdl <= input.targetHigh);
    if (backInRange && top.valueMgdl > input.targetHigh) {
      const mins = Math.round((backInRange.at.getTime() - top.at.getTime()) / 60_000);
      events.push({
        at: backInRange.at,
        kind: "back_in_range",
        label: "Back in range",
        detail: `${backInRange.valueMgdl} mg/dL, ${mins >= 60 ? `${round(mins / 60, 1)} hours` : `${mins} minutes`} after the peak`,
        valueMgdl: backInRange.valueMgdl,
      });
    }
  }

  if (sleep?.bedAt && dateKey(sleep.bedAt) === date) {
    events.push({ at: sleep.bedAt, kind: "bed", label: "Went to bed", detail: null, valueMgdl: valueAt(sleep.bedAt) });
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  const firstMeal = input.meals.filter((m) => dateKey(m.at) === date).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const minutesFirstMealToPeak =
    firstMeal && peak && peak.at.getTime() > firstMeal.at.getTime()
      ? Math.round((peak.at.getTime() - firstMeal.at.getTime()) / 60_000)
      : null;

  /* ------------------------------ the comparison ------------------------------ */

  const best = bestDays(input, now, date, windowDays);
  const differences: Difference[] = [];
  let note: string | null = null;

  if (best.length < 2) {
    note = `There are not enough other well-logged days in the last ${windowDays} to compare this one against yet.`;
  } else {
    const here = factsFor(date, input);
    const bestFacts = best.map((d) => factsFor(d, input));

    const avg = (pick: (f: DayFacts) => number | null): number | null => {
      const xs = bestFacts.map(pick).filter((x): x is number => x !== null);
      return mean(xs);
    };

    const candidates: { key: string; label: string; mine: number | null; theirs: number | null; unit: ChartUnit; better: "lower" | "higher"; word: (d: number) => string }[] = [
      {
        key: "carbs",
        label: "Carbohydrate across the day",
        mine: here.carbs,
        theirs: avg((f) => f.carbs),
        unit: "count",
        better: "lower",
        word: (d) => `${round(Math.abs(d))} g ${d > 0 ? "more" : "less"} than your best days`,
      },
      {
        key: "largest_meal",
        label: "Largest single meal",
        mine: here.largestMealCarbs,
        theirs: avg((f) => f.largestMealCarbs),
        unit: "count",
        better: "lower",
        word: (d) => `${round(Math.abs(d))} g ${d > 0 ? "bigger" : "smaller"} than on your best days`,
      },
      {
        key: "movement",
        label: "Movement",
        mine: here.movementMinutes,
        theirs: avg((f) => f.movementMinutes),
        unit: "minutes",
        better: "higher",
        word: (d) => `${round(Math.abs(d))} minutes ${d > 0 ? "more" : "less"} than your best days`,
      },
      {
        key: "sleep",
        label: "Sleep the night before",
        mine: here.sleepHours,
        theirs: avg((f) => f.sleepHours),
        unit: "count",
        better: "higher",
        word: (d) => `${round(Math.abs(d), 1)} hours ${d > 0 ? "more" : "less"} than before your best days`,
      },
      {
        key: "meals",
        label: "Number of meals logged",
        mine: here.meals,
        theirs: avg((f) => f.meals),
        unit: "count",
        better: "lower",
        word: (d) => `${round(Math.abs(d), 1)} ${d > 0 ? "more" : "fewer"} than your best days`,
      },
    ];

    for (const c of candidates) {
      if (c.mine === null || c.theirs === null) continue;
      const delta = c.mine - c.theirs;
      // A difference smaller than this is noise between two small samples.
      const floor = c.key === "sleep" ? 0.5 : c.key === "meals" ? 0.8 : 8;
      if (Math.abs(delta) < floor) continue;

      differences.push({
        key: c.key,
        label: c.label,
        thisDay: round(c.mine, 1) ?? 0,
        bestAverage: round(c.theirs, 1) ?? 0,
        unit: c.unit,
        better: c.better,
        sentence: c.word(delta),
      });
    }

    /**
     * Ranked by how far apart the two are in proportion to the better days, so "twice the
     * carbohydrate" outranks "ten minutes less walking" rather than losing to it on raw size.
     */
    differences.sort((a, b) => {
      const ra = a.bestAverage === 0 ? Math.abs(a.thisDay) : Math.abs(a.thisDay - a.bestAverage) / Math.abs(a.bestAverage);
      const rb = b.bestAverage === 0 ? Math.abs(b.thisDay) : Math.abs(b.thisDay - b.bestAverage) / Math.abs(b.bestAverage);
      return rb - ra;
    });

    if (differences.length === 0) {
      note = "On everything this app can measure, this day looks like your best days. Whatever was different is not in the log.";
    }
  }

  if (rows.length < MIN_READINGS_FOR_A_DAY) {
    note = `Only ${rows.length} readings on this day, which is too few to draw its shape honestly.`;
  }

  return {
    date,
    readings: rows,
    events,
    peak,
    minutesFirstMealToPeak,
    timeInRange: stats.timeInRange,
    mean: stats.mean,
    bestDays: best,
    differences,
    note,
  };
}
