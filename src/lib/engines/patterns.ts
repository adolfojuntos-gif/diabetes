/**
 * Pattern detection. Pure, deterministic, and the ONLY place a "pattern" is ever computed.
 *
 * Every pattern carries its evidence as numbers, a minimum sample it refused to speak below,
 * and a suggestion limited to lifestyle, logging, or a question for the care team. No pattern
 * ever suggests a medication or insulin change — see docs/ARCHITECTURE.md § Invariants.
 *
 * The AI reads the PatternReport. It never computes one.
 */
import { glucoseStats, statsByBlock, lowEvents, between, DAY_BLOCKS, round, type ReadingLike } from "./stats";
import { mealResponses, rankMeals, type MealLike } from "./mealResponse";
import { LOW_MGDL, HIGH_MGDL, VERY_LOW_MGDL } from "../units";
import { dateKey, addDays, startOfDay, fmtDay, HOUR_MS, DAY_MS } from "../time";

export type Severity = "win" | "info" | "watch" | "attention";

/**
 * How a pattern draws itself.
 *
 * The SPEC is built here, in the engine, from the same numbers as the evidence sentence. The
 * component that draws it does arithmetic on geometry only: it converts a value to a bar length and
 * a unit to a label, and it cannot introduce a figure of its own. That is the same rule the rest of
 * this app follows for numbers, and it matters more here than it looks, because a chart is read
 * faster and trusted harder than a sentence. A picture that disagreed with the words underneath it
 * would be worse than no picture.
 *
 * `tests/patterns.test.ts` asserts that every number in a chart also appears in the evidence text,
 * so the two cannot drift apart.
 *
 * Deliberately a small vocabulary. Three shapes cover every pattern this engine produces, and a
 * fourth would mean a new drawing path to get right for the sake of one card.
 */
export type ChartUnit = "mgdl" | "percent" | "count" | "minutes" | "ml";

export type PatternChart =
  /** Two or three labelled values side by side. The comparison IS the finding. */
  | { kind: "compare"; unit: ChartUnit; bars: { label: string; value: number }[]; better: "lower" | "higher" }
  /**
   * One value on a track, with the stretch of that track that counts as good. Used where the
   * number only means something against a threshold: time in range, variability, spike share.
   */
  | { kind: "gauge"; unit: ChartUnit; value: number; max: number; good: { from: number; to: number } }
  /** A count of discrete things, optionally out of a total. Episodes, meals covered, days logged. */
  | { kind: "tally"; count: number; of: number | null; noun: string; tone: "good" | "watch" | "bad" };

export type Pattern = {
  key: string;
  severity: Severity;
  title: string;
  /** One plain sentence with the numbers in it. */
  evidence: string;
  /** Lifestyle / logging / conversation only. */
  suggestion: string;
  /** A ready-to-ask question for the care team, when the pattern deserves one. */
  doctorQuestion?: string;
  /** Where in the app the evidence lives. */
  href: string;
  /** Machine-readable evidence for the model and for tests. */
  data: Record<string, number | string | null>;
  /**
   * How to draw this finding, when drawing it says something the sentence cannot.
   *
   * Optional, and left off on purpose where a picture would be decoration. A pattern whose whole
   * content is "you have not logged any movement" is not clearer as a chart.
   */
  chart?: PatternChart;
};

export type ExerciseLike = { at: Date; minutes: number; intensity: string; kind: string };
export type SleepLike = { wakeDate: string; minutes: number; quality: number };
export type HydrationLike = { at: Date; ml: number };
export type InsulinLike = { at: Date; kind: string; units: number };

export type Snapshot = {
  now: Date;
  /** Analysis window in days, ending now. */
  windowDays: number;
  targetLow: number;
  targetHigh: number;
  hydrationGoalMl: number;
  sleepGoalMinutes: number;
  usesInsulinBolus: boolean;
  readings: ReadingLike[];
  meals: MealLike[];
  exercise: ExerciseLike[];
  sleep: SleepLike[];
  hydration: HydrationLike[];
  insulin: InsulinLike[];
};

export type PatternReport = {
  generatedAt: string;
  windowDays: number;
  sampleNote: string | null;
  patterns: Pattern[];
};

const fmt = (n: number | null, dp = 0) => (n === null ? "—" : String(round(n, dp)));

/**
 * A gauge track long enough to hold the value being drawn.
 *
 * A fixed maximum is right where the scale is bounded: time in range cannot exceed 100%. It is
 * wrong wherever the measurement has no ceiling, and the failure is quiet rather than loud. The
 * share of readings under target was drawn on a track ending at 12%, chosen because 4% is the
 * consensus goal and 12% is a bad month. At 51% the needle sat at the end of the track and the
 * picture said "off the scale" when the number said something far more specific.
 *
 * So: keep the useful resolution for ordinary values, and grow rather than clip for the rest.
 */
function trackMax(value: number | null, base: number): number {
  const v = value === null || !Number.isFinite(value) ? 0 : value;
  if (v <= base) return base;
  // Round up to a readable step so the track does not end on an arbitrary figure.
  const step = base >= 100 ? 50 : base >= 50 ? 20 : 10;
  return Math.ceil(v / step) * step;
}

/**
 * Pick the singular or the plural to follow a count.
 *
 * The chart noun sits directly after a number, so it has to agree with it. "1 readings under 54"
 * was on screen: the count is computed and the word was fixed, which is fine until the count is one.
 * English is the component's problem only if the component knows the count, and it should not have
 * to, so the engine says the word.
 */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Mean of a list or null. */
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function detectPatterns(s: Snapshot): PatternReport {
  const patterns: Pattern[] = [];
  const from = addDays(startOfDay(s.now), -(s.windowDays - 1));
  const readings = between(s.readings, from, s.now);
  const low = s.targetLow || LOW_MGDL;
  const high = s.targetHigh || HIGH_MGDL;
  const all = glucoseStats(readings, low, high);
  const label = `${s.windowDays} days`;

  let sampleNote: string | null = null;
  if (all.n < 10) {
    sampleNote =
      all.n === 0
        ? "No glucose readings in this window yet, so there are no glucose patterns to report."
        : `Only ${all.n} glucose readings in the last ${label}, too few to call anything a pattern. Observations below are marked as early.`;
  }

  /* -------------------------- safety-adjacent first -------------------------- */

  const veryLow = readings.filter((r) => r.valueMgdl < VERY_LOW_MGDL);
  if (veryLow.length > 0) {
    const last = veryLow.reduce((a, b) => (a.at > b.at ? a : b));
    patterns.push({
      key: "very_low_readings",
      severity: "attention",
      title: veryLow.length === 1 ? "One very low reading" : `${veryLow.length} very low readings`,
      evidence: `${veryLow.length} reading${veryLow.length === 1 ? "" : "s"} under 54 mg/dL in the last ${label}; the lowest was ${Math.min(...veryLow.map((r) => r.valueMgdl))} mg/dL on ${fmtDay(last.at)}.`,
      suggestion:
        "Readings under 54 are the ones your care team most wants to hear about. Keep fast-acting carbs within reach and make sure someone close to you knows how to help with a low.",
      doctorQuestion: `I had ${veryLow.length} reading${veryLow.length === 1 ? "" : "s"} under 54 mg/dL in the last ${label}. What should we look at to reduce these?`,
      href: "/trends",
      data: { count: veryLow.length, lowest: Math.min(...veryLow.map((r) => r.valueMgdl)), lastDate: dateKey(last.at) },
      chart: {
        kind: "tally",
        count: veryLow.length,
        of: null,
        noun: plural(veryLow.length, "reading under 54", "readings under 54"),
        tone: "bad",
      },
    });
  }

  const events = lowEvents(readings, low);
  const nightEvents = events.filter((e) => {
    const h = e.start.getHours();
    return h >= 0 && h < 6;
  });
  if (nightEvents.length >= 2) {
    patterns.push({
      key: "overnight_lows",
      severity: "attention",
      title: "Lows between midnight and 6am",
      evidence: `${nightEvents.length} separate low episodes between midnight and 6am in the last ${label} (lowest ${Math.min(...nightEvents.map((e) => e.nadir))} mg/dL).`,
      suggestion:
        "Overnight lows are worth a bedtime reading for the next week so you and your care team can see what the number looks like before sleep.",
      doctorQuestion: `I've had ${nightEvents.length} overnight lows in the last ${label}. What could be behind them, and what should I check at bedtime?`,
      href: "/trends?block=overnight",
      data: { episodes: nightEvents.length, lowest: Math.min(...nightEvents.map((e) => e.nadir)) },
      chart: {
        kind: "tally",
        count: nightEvents.length,
        of: null,
        noun: plural(nightEvents.length, "overnight low episode", "overnight low episodes"),
        tone: "bad",
      },
    });
  }

  if (all.n >= 10 && (events.length >= 3 || all.pct.very_low + all.pct.low > 4)) {
    patterns.push({
      key: "frequent_lows",
      severity: "attention",
      title: "Lows are happening often",
      evidence: `${events.length} low episodes in the last ${label}; ${fmt(all.pct.very_low + all.pct.low, 1)}% of readings were under ${low} mg/dL (the consensus goal is under 4%).`,
      suggestion:
        "Note what happened in the hour before each low. A meal, activity, a long gap since eating. That story is what makes the appointment useful.",
      doctorQuestion: `About ${fmt(all.pct.very_low + all.pct.low, 1)}% of my readings are below ${low}. Can we go over what's causing the lows?`,
      href: "/trends",
      data: { episodes: events.length, lowPct: round(all.pct.very_low + all.pct.low, 1) },
      chart: {
        kind: "gauge",
        unit: "percent",
        value: all.pct.very_low + all.pct.low,
        max: trackMax(all.pct.very_low + all.pct.low, 12),
        good: { from: 0, to: 4 },
      },
    });
  }

  /* ------------------------------- time in range ------------------------------- */

  if (all.n >= 10 && all.timeInRange !== null) {
    if (all.timeInRange >= 70) {
      patterns.push({
        key: "tir_good",
        severity: "win",
        title: "Time in range is at goal",
        evidence: `${fmt(all.timeInRange)}% of ${all.n} readings were between ${low} and ${high} mg/dL over the last ${label}. The consensus goal is 70%.`,
        suggestion: "Whatever you're doing this fortnight is working. Worth noticing what that is.",
        href: "/trends",
        data: { tir: round(all.timeInRange), n: all.n },
        chart: { kind: "gauge", unit: "percent", value: all.timeInRange, max: 100, good: { from: 70, to: 100 } },
      });
    } else if (all.timeInRange < 50) {
      patterns.push({
        key: "tir_low",
        severity: "watch",
        title: "Less than half of readings in range",
        evidence: `${fmt(all.timeInRange)}% of ${all.n} readings were in range; ${fmt(all.pct.high + all.pct.very_high)}% were above ${high} mg/dL.`,
        suggestion:
          "Look at the time-of-day view. Range problems usually cluster in one part of the day, and that's a smaller problem to work on than 'everything'.",
        doctorQuestion: `My time in range over the last ${label} was about ${fmt(all.timeInRange)}%. Where would you start?`,
        href: "/trends",
        data: { tir: round(all.timeInRange), highPct: round(all.pct.high + all.pct.very_high) },
        chart: { kind: "gauge", unit: "percent", value: all.timeInRange, max: 100, good: { from: 70, to: 100 } },
      });
    }
  }

  if (all.n >= 20 && all.cv !== null && all.cv > 36) {
    patterns.push({
      key: "high_variability",
      severity: "watch",
      title: "Numbers swing a lot",
      evidence: `Glucose variability (CV) was ${fmt(all.cv)}% over the last ${label}; the consensus target is 36% or less.`,
      suggestion:
        "Big swings often trace back to a few specific meals or to lows followed by rebounds. The post-meal and lows views show which.",
      doctorQuestion: `My glucose variability is around ${fmt(all.cv)}%. Is that something we should work on, and how?`,
      href: "/trends",
      data: { cv: round(all.cv, 1) },
      chart: { kind: "gauge", unit: "percent", value: all.cv, max: trackMax(all.cv, 60), good: { from: 0, to: 36 } },
    });
  }

  /* ------------------------------ time of day ------------------------------ */

  if (all.n >= 24) {
    const blocks = statsByBlock(readings, low, high);
    let worst: { key: string; label: string; tir: number; n: number; mean: number | null } | null = null;
    for (const b of DAY_BLOCKS) {
      const st = blocks[b.key];
      if (st.n >= 8 && st.timeInRange !== null && (!worst || st.timeInRange < worst.tir)) {
        worst = { key: b.key, label: b.label, tir: st.timeInRange, n: st.n, mean: st.mean };
      }
    }
    if (worst && worst.tir < 50) {
      patterns.push({
        key: `hard_block_${worst.key}`,
        severity: "watch",
        title: `${worst.label.split(" (")[0]} is the hardest part of the day`,
        evidence: `${worst.label}: ${fmt(worst.tir)}% in range across ${worst.n} readings, mean ${fmt(worst.mean)} mg/dL.`,
        suggestion:
          worst.key === "morning"
            ? "Mornings that run high are common. A fasting reading before breakfast for a few days tells you whether it starts overnight or with breakfast."
            : worst.key === "evening"
              ? "Evenings often follow the biggest meal. A reading before dinner and two hours after will show how much is the meal."
              : "Try logging one extra reading in this block for a week so the picture is clearer.",
        doctorQuestion: `My ${worst.label.toLowerCase()} readings are the ones most often out of range. What would you like me to track?`,
        href: `/trends?block=${worst.key}`,
        data: { block: worst.key, tir: round(worst.tir), n: worst.n },
        chart: { kind: "gauge", unit: "percent", value: worst.tir, max: 100, good: { from: 70, to: 100 } },
      });
    }
  }

  // Dawn rise: 6–9am vs 2–5am, needs ≥3 of each.
  const early = readings.filter((r) => r.at.getHours() >= 2 && r.at.getHours() < 5).map((r) => r.valueMgdl);
  const dawn = readings.filter((r) => r.at.getHours() >= 6 && r.at.getHours() < 9).map((r) => r.valueMgdl);
  const earlyMean = mean(early);
  const dawnMean = mean(dawn);
  if (early.length >= 3 && dawn.length >= 3 && earlyMean !== null && dawnMean !== null && dawnMean - earlyMean >= 30) {
    patterns.push({
      key: "dawn_rise",
      severity: "watch",
      title: "Glucose climbs toward morning",
      evidence: `Average ${fmt(earlyMean)} mg/dL between 2–5am rising to ${fmt(dawnMean)} mg/dL between 6–9am (${early.length} and ${dawn.length} readings).`,
      suggestion:
        "A rise before breakfast is a known pattern (often called the dawn phenomenon). It's worth showing your care team, since the fix is theirs to decide.",
      doctorQuestion: `My glucose rises about ${fmt(dawnMean - earlyMean)} mg/dL between the middle of the night and breakfast. Could this be the dawn phenomenon, and what do you suggest?`,
      href: "/trends?block=morning",
      data: { earlyMean: round(earlyMean), dawnMean: round(dawnMean), rise: round(dawnMean - earlyMean) },
      chart: {
        kind: "compare",
        unit: "mgdl",
        better: "lower",
        bars: [
          { label: "2 to 5am", value: earlyMean },
          { label: "6 to 9am", value: dawnMean },
        ],
      },
    });
  }

  /* ------------------------------ weekday / weekend ------------------------------ */

  if (all.n >= 28) {
    const wk = readings.filter((r) => r.at.getDay() >= 1 && r.at.getDay() <= 5).map((r) => r.valueMgdl);
    const we = readings.filter((r) => r.at.getDay() === 0 || r.at.getDay() === 6).map((r) => r.valueMgdl);
    const mw = mean(wk);
    const me = mean(we);
    if (wk.length >= 10 && we.length >= 6 && mw !== null && me !== null && Math.abs(me - mw) >= 20) {
      const higher = me > mw ? "Weekends" : "Weekdays";
      patterns.push({
        key: "weekend_effect",
        severity: "info",
        title: `${higher} run higher`,
        evidence: `Weekend average ${fmt(me)} mg/dL vs weekday ${fmt(mw)} mg/dL (${we.length} and ${wk.length} readings).`,
        suggestion:
          higher === "Weekends"
            ? "Different meal times, later mornings, less walking. Weekends change the routine. Pick one weekend habit to keep from the week."
            : "Weekdays are the higher ones for you. Work meals, stress and desk hours are common reasons. A short walk after lunch is the easiest experiment.",
        href: "/trends",
        data: { weekendMean: round(me), weekdayMean: round(mw) },
        chart: {
          kind: "compare",
          unit: "mgdl",
          better: "lower",
          bars: [
            { label: "Weekdays", value: mw },
            { label: "Weekends", value: me },
          ],
        },
      });
    }
  }

  /* --------------------------------- meals --------------------------------- */

  const responses = mealResponses(between(s.meals, from, s.now), readings);
  const ranking = rankMeals(responses);
  if (ranking.covered.length >= 3 && ranking.spikeShare !== null) {
    if (ranking.spikeShare >= 0.4) {
      const top = ranking.worst.slice(0, 3).map((m) => `${m.name} (+${m.rise})`);
      patterns.push({
        key: "post_meal_spikes",
        severity: "watch",
        title: "Some meals spike you more than 50 mg/dL",
        evidence: `${Math.round(ranking.spikeShare * 100)}% of ${ranking.covered.length} meals with before-and-after readings rose more than 50 mg/dL. Biggest: ${top.join(", ")}.`,
        suggestion:
          "You don't have to give these up. Try eating the protein and vegetables first, a smaller portion of the carb, or a 10-minute walk after. Then log the same meal again and compare.",
        doctorQuestion: `Certain meals raise my glucose by more than 50 mg/dL (for example ${top[0]}). How should I handle those?`,
        href: "/plan",
        data: { spikeShare: round(ranking.spikeShare * 100), covered: ranking.covered.length, worst: top.join("; ") },
        chart: { kind: "gauge", unit: "percent", value: ranking.spikeShare * 100, max: 100, good: { from: 0, to: 15 } },
      });
    } else if (ranking.spikeShare <= 0.15) {
      patterns.push({
        key: "meals_gentle",
        severity: "win",
        title: "Your meals are landing gently",
        evidence: `Only ${Math.round(ranking.spikeShare * 100)}% of ${ranking.covered.length} covered meals rose more than 50 mg/dL.`,
        suggestion: "The best-meals list is built from exactly these. Lean on it when planning the week.",
        href: "/plan",
        data: { spikeShare: round(ranking.spikeShare * 100), covered: ranking.covered.length },
        chart: { kind: "gauge", unit: "percent", value: ranking.spikeShare * 100, max: 100, good: { from: 0, to: 15 } },
      });
    }
    const worstTag = ranking.byTag[0];
    if (worstTag && worstTag.meanRise > 50 && worstTag.n >= 3) {
      patterns.push({
        key: `tag_${worstTag.tag}`,
        severity: "info",
        title: `“${worstTag.tag}” meals rise the most`,
        evidence: `Meals tagged “${worstTag.tag}” rose an average of ${fmt(worstTag.meanRise)} mg/dL across ${worstTag.n} meals.`,
        suggestion: `Next time you eat something tagged “${worstTag.tag}”, try a reading at 1 hour as well as 2. It may peak earlier than you think.`,
        href: "/plan",
        data: { tag: worstTag.tag, meanRise: round(worstTag.meanRise), n: worstTag.n },
        chart: {
          kind: "gauge",
          unit: "mgdl",
          value: worstTag.meanRise,
          max: trackMax(worstTag.meanRise, 120),
          good: { from: 0, to: 50 },
        },
      });
    }
  }
  if (responses.length >= 5 && ranking.covered.length / responses.length < 0.3) {
    patterns.push({
      key: "meals_uncovered",
      severity: "info",
      title: "Most meals have no before-and-after reading",
      evidence: `${ranking.covered.length} of ${responses.length} logged meals had a reading before and one 1–3 hours after.`,
      suggestion:
        "Pick one meal a day this week and take a reading before and two hours after. That's enough to start ranking your meals.",
      href: "/log",
      data: { covered: ranking.covered.length, total: responses.length },
      chart: { kind: "tally", count: ranking.covered.length, of: responses.length, noun: "meals with readings either side", tone: "watch" },
    });
  }

  /* -------------------------------- exercise -------------------------------- */

  const ex = between(s.exercise, from, s.now);
  if (ex.length >= 3 && all.mean !== null && all.n >= 20) {
    const after: number[] = [];
    for (const e of ex) {
      const t0 = e.at.getTime() + e.minutes * 60_000;
      for (const r of readings) {
        const rt = r.at.getTime();
        if (rt >= t0 + HOUR_MS && rt <= t0 + 4 * HOUR_MS) after.push(r.valueMgdl);
      }
    }
    const ma = mean(after);
    if (after.length >= 5 && ma !== null && all.mean - ma >= 15) {
      patterns.push({
        key: "exercise_helps",
        severity: "win",
        title: "Movement is bringing your numbers down",
        evidence: `In the 1–4 hours after ${ex.length} logged sessions, readings averaged ${fmt(ma)} mg/dL vs ${fmt(all.mean)} mg/dL overall (${after.length} readings).`,
        suggestion: "That's your body telling you what works. The exercise page has ideas sized to the time you actually have.",
        href: "/move",
        data: { afterMean: round(ma), overallMean: round(all.mean), sessions: ex.length },
        chart: {
          kind: "compare",
          unit: "mgdl",
          better: "lower",
          bars: [
            { label: "After you moved", value: ma },
            { label: "Overall", value: all.mean ?? ma },
          ],
        },
      });
    }
  }
  const exMinutes = ex.reduce((a, e) => a + e.minutes, 0);
  if (s.windowDays >= 7 && ex.length === 0 && all.n >= 10) {
    patterns.push({
      key: "no_movement_logged",
      severity: "info",
      title: "No movement logged",
      evidence: `0 exercise sessions logged in the last ${label}.`,
      suggestion: "A 10-minute walk after your biggest meal is the single easiest experiment in this app. Log it and watch the 2-hour reading.",
      href: "/move",
      data: { sessions: 0 },
      chart: { kind: "tally", count: 0, of: null, noun: "sessions logged", tone: "watch" },
    });
  } else if (s.windowDays >= 7 && exMinutes >= 150 * (s.windowDays / 7)) {
    patterns.push({
      key: "active_week",
      severity: "win",
      title: "An active stretch",
      evidence: `${exMinutes} minutes of movement across ${ex.length} sessions in the last ${label}.`,
      suggestion: "150 minutes a week is the level most guidelines point to, and you're there.",
      href: "/move",
      data: { minutes: exMinutes, sessions: ex.length },
      chart: { kind: "tally", count: ex.length, of: null, noun: plural(ex.length, "session logged", "sessions logged"), tone: "good" },
    });
  }

  /* --------------------------------- sleep --------------------------------- */

  const sleep = s.sleep.filter((x) => x.wakeDate >= dateKey(from));
  if (sleep.length >= 6 && all.n >= 20) {
    // Next-day mean after short vs adequate sleep.
    const dayMean = new Map<string, number[]>();
    for (const r of readings) {
      const k = dateKey(r.at);
      dayMean.set(k, [...(dayMean.get(k) ?? []), r.valueMgdl]);
    }
    const shortDays: number[] = [];
    const goodDays: number[] = [];
    for (const n of sleep) {
      const m = mean(dayMean.get(n.wakeDate) ?? []);
      if (m === null) continue;
      if (n.minutes < 360) shortDays.push(m);
      else if (n.minutes >= 420) goodDays.push(m);
    }
    const ms = mean(shortDays);
    const mg = mean(goodDays);
    if (shortDays.length >= 3 && goodDays.length >= 3 && ms !== null && mg !== null && ms - mg >= 15) {
      patterns.push({
        key: "short_sleep_higher",
        severity: "watch",
        title: "Short nights, higher days",
        evidence: `Days after less than 6 hours of sleep averaged ${fmt(ms)} mg/dL; days after 7+ hours averaged ${fmt(mg)} mg/dL (${shortDays.length} vs ${goodDays.length} days).`,
        suggestion: "Sleep is one of the few levers that moves glucose without touching food. A consistent bedtime for a week is the experiment.",
        href: "/log/sleep",
        data: { shortMean: round(ms), goodMean: round(mg), shortDays: shortDays.length, goodDays: goodDays.length },
        chart: {
          kind: "compare",
          unit: "mgdl",
          better: "lower",
          bars: [
            { label: "After 7+ hours", value: mg },
            { label: "After under 6 hours", value: ms },
          ],
        },
      });
    }
    const avg = mean(sleep.map((x) => x.minutes));
    if (avg !== null && avg < s.sleepGoalMinutes - 60) {
      patterns.push({
        key: "sleep_short",
        severity: "info",
        title: "Sleeping less than your goal",
        evidence: `Average ${Math.round(avg / 60 * 10) / 10} hours a night over ${sleep.length} nights; your goal is ${Math.round(s.sleepGoalMinutes / 60 * 10) / 10}.`,
        suggestion: "Even 30 minutes earlier to bed changes the next morning's number for many people.",
        href: "/log/sleep",
        data: { avgMinutes: Math.round(avg), nights: sleep.length },
        chart: {
          kind: "compare",
          unit: "minutes",
          better: "higher",
          bars: [
            { label: "Your average", value: avg },
            { label: "Your goal", value: s.sleepGoalMinutes },
          ],
        },
      });
    }
  }

  /* ------------------------------- hydration ------------------------------- */

  const hyd = between(s.hydration, from, s.now);
  if (hyd.length > 0 && s.windowDays >= 7) {
    const byDay = new Map<string, number>();
    for (const h of hyd) byDay.set(dateKey(h.at), (byDay.get(dateKey(h.at)) ?? 0) + h.ml);
    const days = [...byDay.values()];
    const hit = days.filter((ml) => ml >= s.hydrationGoalMl).length;
    if (days.length >= 5 && hit / days.length < 0.4) {
      patterns.push({
        key: "hydration_under_goal",
        severity: "info",
        title: "Under your water goal most days",
        evidence: `Hit ${s.hydrationGoalMl} ml on ${hit} of ${days.length} logged days.`,
        suggestion: "When glucose runs high, the body loses water. A glass with each reading is an easy anchor.",
        href: "/log/water",
        data: { hitDays: hit, loggedDays: days.length },
        chart: { kind: "tally", count: hit, of: days.length, noun: "days at your goal", tone: "watch" },
      });
    } else if (days.length >= 5 && hit / days.length >= 0.8) {
      patterns.push({
        key: "hydration_good",
        severity: "win",
        title: "Hydration is on track",
        evidence: `Hit ${s.hydrationGoalMl} ml on ${hit} of ${days.length} logged days.`,
        suggestion: "Keep it up.",
        href: "/log/water",
        data: { hitDays: hit, loggedDays: days.length },
        chart: { kind: "tally", count: hit, of: days.length, noun: "days at your goal", tone: "good" },
      });
    }
  }

  /* -------------------------------- logging -------------------------------- */

  if (s.windowDays >= 7) {
    const daysWith = new Set(readings.map((r) => dateKey(r.at)));
    const missing: string[] = [];
    for (let t = from.getTime(); t < s.now.getTime(); t += DAY_MS) {
      const k = dateKey(new Date(t));
      if (!daysWith.has(k)) missing.push(k);
    }
    if (missing.length >= 3 && all.n > 0) {
      patterns.push({
        key: "logging_gaps",
        severity: "info",
        title: `${missing.length} days with no glucose reading`,
        evidence: `No readings on ${missing.length} of the last ${s.windowDays} days.`,
        suggestion: "Patterns need days, not perfect days. One reading a day, any time, keeps the picture alive.",
        href: "/log",
        data: { missingDays: missing.length },
        chart: {
          kind: "tally",
          count: missing.length,
          of: s.windowDays,
          noun: plural(s.windowDays, "day with no reading", "days with no reading"),
          tone: "watch",
        },
      });
    }
  }

  if (s.usesInsulinBolus) {
    const mealsWithCarbs = between(s.meals, from, s.now).filter((m) => m.carbsG >= 15);
    const boluses = between(s.insulin, from, s.now).filter((d) => d.kind === "bolus" || d.kind === "correction");
    if (mealsWithCarbs.length >= 5) {
      let unmatched = 0;
      for (const m of mealsWithCarbs) {
        const t = m.at.getTime();
        if (!boluses.some((b) => Math.abs(b.at.getTime() - t) <= HOUR_MS)) unmatched++;
      }
      if (unmatched / mealsWithCarbs.length >= 0.4) {
        patterns.push({
          key: "meals_without_bolus_logged",
          severity: "info",
          title: "Meals without an insulin entry",
          evidence: `${unmatched} of ${mealsWithCarbs.length} meals with 15 g+ of carbs have no bolus logged within an hour.`,
          suggestion:
            "This is about the log, not about dosing: if those doses happened, adding them makes the weekly review honest. If they didn't, that's a useful thing to mention to your care team.",
          href: "/log/insulin",
          data: { unmatched, meals: mealsWithCarbs.length },
          chart: { kind: "tally", count: unmatched, of: mealsWithCarbs.length, noun: "meals with no bolus logged", tone: "watch" },
        });
      }
    }
  }

  const order: Record<Severity, number> = { attention: 0, watch: 1, info: 2, win: 3 };
  patterns.sort((a, b) => order[a.severity] - order[b.severity]);

  return { generatedAt: s.now.toISOString(), windowDays: s.windowDays, sampleNote, patterns };
}
