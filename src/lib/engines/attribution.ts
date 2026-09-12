/**
 * "Why did this happen?"
 *
 * Given one reading, this looks backward through what the person actually logged and names the
 * things that MAY have contributed to it. Pure, deterministic, and the only place a contributing
 * factor is ever computed. The model never computes one, the same as patterns.
 *
 * Four rules shape every sentence in this file, and they are not stylistic.
 *
 * IT NEVER SAYS "CAUSED". Glucose is moved by food, activity, sleep, hormones, illness, stress,
 * medication timing, absorption, the weather and things nobody has named yet. This app can see a
 * fraction of that. "A 62 g meal 90 minutes earlier may have contributed" is true. "Your pasta
 * caused this" is a claim about a mechanism in one person's body that no app can make.
 *
 * IT NAMES WHAT IT CANNOT SEE, every time. `blindSpots` is not optional and is not a disclaimer at
 * the bottom of a page. It is part of the answer, because the most likely explanation for a spike
 * is often something that was never logged, and a list of three factors with no mention of that
 * reads as a complete account when it is not.
 *
 * IT NEVER MENTIONS A DOSE, A CHANGE, OR A TIME TO TAKE ANYTHING. Where insulin is relevant, the
 * observation is that nothing is RECORDED, which is a fact about the log. What to do about it
 * belongs to the person and their care team, and `docs/ARCHITECTURE.md` invariant 2 is the reason.
 *
 * IT IS HONEST ABOUT FINDING NOTHING. A spike with nothing logged around it returns no contributors
 * and says so. Inventing a weak factor to fill the space would teach people to distrust the strong
 * ones.
 */
import { round, type ReadingLike } from "./stats";
import { mealResponses, rankMeals, type MealLike } from "./mealResponse";
import type { PatternChart } from "./patterns";
import { HOUR_MS, DAY_MS, dateKey, fmtTime } from "../time";

export type Confidence = "likely" | "possible";

export type Contributor = {
  key: string;
  /** A short heading, in plain words. */
  label: string;
  /** One sentence, with this person's own numbers in it. */
  evidence: string;
  /** Why this is a known mechanism. Plain, general, and never a fabricated citation. */
  because: string;
  confidence: Confidence;
  /** Where the evidence lives in the app. */
  href: string;
  /** Drawn with the same small vocabulary the pattern cards use. */
  chart?: PatternChart;
};

export type ExerciseLike = { at: Date; minutes: number; intensity: string; kind: string };
export type SleepLike = { wakeDate: string; minutes: number; quality: number };
export type HydrationLike = { at: Date; ml: number };
export type InsulinLike = { at: Date; kind: string; units: number; mealId?: string | null };

export type ExplainInput = {
  /** The reading being explained. */
  at: Date;
  valueMgdl: number;
  targetLow: number;
  targetHigh: number;
  usesInsulinBolus: boolean;
  hydrationGoalMl: number;
  sleepGoalMinutes: number;
  /**
   * Context, and it has to reach back further than the reading. Thirty days, so a factor can be
   * weighed against this person's own usual rather than against a population average.
   */
  readings: ReadingLike[];
  meals: MealLike[];
  insulin: InsulinLike[];
  exercise: ExerciseLike[];
  sleep: SleepLike[];
  hydration: HydrationLike[];
};

export type Attribution = {
  at: Date;
  valueMgdl: number;
  /** Strongest signal first. Empty when nothing logged stands out, which is a real answer. */
  contributors: Contributor[];
  /** What this cannot see. Always populated. */
  blindSpots: string[];
  /** Set when there is something to say about the answer itself rather than about the glucose. */
  note: string | null;
};

/* -------------------------------- thresholds -------------------------------- */

/**
 * Every number here is a threshold for deciding whether to MENTION something, never a clinical
 * cutoff and never advice. They are deliberately conservative: a factor has to be reasonably
 * obvious before it is named, because a list that mentions everything explains nothing.
 */
const MEAL_WINDOW_MIN = 15; // a meal closer than this has not had time to act
const MEAL_WINDOW_MAX_H = 3.5;
const CARBS_WORTH_MENTIONING = 25;
const CARBS_LIKELY = 45;
const BOLUS_WINDOW_MIN = 75;
const SHORT_SLEEP_MIN = 6 * 60;
const DAWN_FROM_H = 4;
const DAWN_TO_H = 10;
const REBOUND_WINDOW_H = 4;
const TAG_RISE_WORTH_MENTIONING = 45;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Minutes from `from` to `to`, positive when `to` is later. */
const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;

/* ------------------------------ the blind spots ------------------------------ */

/**
 * What this answer cannot account for.
 *
 * Written out rather than summarised as "other factors", because the specific ones are what make a
 * person recognise their own situation. Somebody who was unwell that week reads "illness" and has
 * their explanation, and no amount of logged carbohydrate would have given it to them.
 */
function blindSpotsFor(usesInsulinBolus: boolean): string[] {
  const out = [
    "Anything eaten or drunk that was not logged, including portions larger than they looked.",
    "Illness, infection, pain, or a recent vaccination, all of which push glucose up on their own.",
    "Stress, poor sleep quality rather than quantity, and hormonal cycles.",
    "How well the reading itself reflects the moment, which depends on the meter or sensor and on timing.",
  ];
  if (usesInsulinBolus) {
    /**
     * Factual, and deliberately not actionable. Absorption varying by site and a failed set are
     * real and common, and a person who does not know that will look for a dietary explanation
     * that is not there. What to do about either is a conversation with their care team.
     */
    out.push("How insulin was absorbed, which varies by injection site, and whether a pump set or pen was working as expected.");
  }
  return out;
}

/* ------------------------------- the engine ------------------------------- */

export function explainReading(input: ExplainInput): Attribution {
  const { at, valueMgdl, targetHigh, targetLow } = input;
  const contributors: Contributor[] = [];

  const usable = input.readings.filter((r) => Number.isFinite(r.valueMgdl) && r.at instanceof Date && !Number.isNaN(r.at.getTime()));
  const history = usable.filter((r) => r.at.getTime() <= at.getTime());

  /* ------------------------------ a meal before ------------------------------ */

  const mealsBefore = input.meals
    .filter((m) => {
      const mins = minutesBetween(m.at, at);
      return mins >= MEAL_WINDOW_MIN && mins <= MEAL_WINDOW_MAX_H * 60;
    })
    .sort((a, b) => b.carbsG - a.carbsG);

  const allCarbs = input.meals.map((m) => m.carbsG).filter((c) => c > 0);
  const usualCarbs = median(allCarbs);
  const biggest = mealsBefore[0];

  if (biggest && biggest.carbsG >= CARBS_WORTH_MENTIONING) {
    const mins = Math.round(minutesBetween(biggest.at, at));
    const howLongAgo = mins >= 60 ? `${round(mins / 60, 1)} hours` : `${mins} minutes`;
    const bigForThem = usualCarbs !== null && biggest.carbsG > usualCarbs * 1.5;

    contributors.push({
      key: "meal_before",
      label: bigForThem ? "A larger meal than usual, shortly before" : "A meal shortly before",
      evidence: `${biggest.name || "A meal"} at ${fmtTime(biggest.at)}, ${round(biggest.carbsG)} g of carbohydrate, ${howLongAgo} before this reading.`,
      because:
        "Carbohydrate raises glucose, and most of that rise lands one to two hours after eating. The amount and the type both matter.",
      confidence: biggest.carbsG >= CARBS_LIKELY ? "likely" : "possible",
      href: "/trends/meals",
      chart:
        usualCarbs !== null && usualCarbs > 0
          ? {
              kind: "compare",
              unit: "count",
              better: "lower",
              bars: [
                { label: "Your usual meal", value: round(usualCarbs) ?? 0 },
                { label: "This meal", value: round(biggest.carbsG) ?? 0 },
              ],
            }
          : undefined,
    });
  }

  /* --------------------------- a meal with no bolus --------------------------- */

  if (input.usesInsulinBolus && biggest && biggest.carbsG >= CARBS_WORTH_MENTIONING) {
    const covered = input.insulin.some((d) => {
      if (d.mealId && d.mealId === biggest.id) return true;
      const mins = Math.abs(minutesBetween(biggest.at, d.at));
      return mins <= BOLUS_WINDOW_MIN && d.kind !== "basal";
    });
    if (!covered) {
      contributors.push({
        key: "no_bolus_logged",
        label: "No mealtime insulin recorded for that meal",
        /**
         * The wording matters more here than anywhere else in this file. It reports the state of
         * the LOG, offers the innocent explanation first, and says nothing about what any dose
         * should have been or should be.
         */
        evidence: `Nothing is logged within an hour either side of ${biggest.name || "that meal"}. That may simply be a gap in the log rather than a missed dose.`,
        because:
          "Steady can only see what was written down, so this is an observation about the record and not about your treatment. What it means is a question for your care team.",
        confidence: "possible",
        href: "/log/insulin",
      });
    }
  }

  /* ------------------------------- a meal tag ------------------------------- */

  const responses = mealResponses(input.meals, usable);
  const ranking = rankMeals(responses);
  if (biggest) {
    const tags = biggest.tags.split(",").map((t) => t.trim()).filter(Boolean);
    for (const tag of tags) {
      const row = ranking.byTag.find((t) => t.tag === tag);
      if (row && row.n >= 3 && row.meanRise >= TAG_RISE_WORTH_MENTIONING) {
        contributors.push({
          key: `tag_${tag}`,
          label: `Meals tagged "${tag}" tend to run high for you`,
          evidence: `Across ${row.n} logged meals tagged "${tag}", the average rise afterwards was ${round(row.meanRise)} mg/dL.`,
          because: "This is your own logged history rather than a general rule, which is what makes it worth knowing.",
          confidence: "likely",
          href: "/trends/meals",
          chart: {
            kind: "gauge",
            unit: "mgdl",
            value: row.meanRise,
            max: Math.max(120, Math.ceil(row.meanRise / 10) * 10),
            good: { from: 0, to: 50 },
          },
        });
        break; // One tag. A list of five tags on one reading is noise.
      }
    }
  }

  /* -------------------------------- the dawn -------------------------------- */

  const hour = at.getHours();
  if (hour >= DAWN_FROM_H && hour < DAWN_TO_H) {
    const earlyWindow = history.filter((r) => {
      const h = r.at.getHours();
      return h >= 2 && h < 5;
    });
    const earlyMean = mean(earlyWindow.map((r) => r.valueMgdl));
    if (earlyMean !== null && earlyWindow.length >= 3 && valueMgdl > earlyMean + 20) {
      contributors.push({
        key: "dawn_rise",
        label: "The early morning rise",
        evidence: `Your readings between 2 and 5am average ${round(earlyMean)} mg/dL, and this one is ${round(valueMgdl - earlyMean)} mg/dL above that.`,
        because:
          "Glucose commonly rises in the hours before waking as the body releases hormones to get the day started. It is a known pattern and it is not something you did.",
        confidence: "likely",
        href: "/trends?block=overnight",
        chart: {
          kind: "compare",
          unit: "mgdl",
          better: "lower",
          bars: [
            { label: "Your 2 to 5am average", value: round(earlyMean) ?? 0 },
            { label: "This reading", value: valueMgdl },
          ],
        },
      });
    }
  }

  /* ---------------------------- rebound after a low ---------------------------- */

  const recentLow = history
    .filter((r) => r.at.getTime() >= at.getTime() - REBOUND_WINDOW_H * HOUR_MS && r.valueMgdl < targetLow)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (recentLow) {
    const mins = Math.round(minutesBetween(recentLow.at, at));
    contributors.push({
      key: "after_low",
      label: "A low shortly before this",
      evidence: `A reading of ${recentLow.valueMgdl} mg/dL at ${fmtTime(recentLow.at)}, ${mins} minutes before this one.`,
      because:
        "Glucose often overshoots after a low, both from treating it and from the body's own response. A high after a low is a very common sequence.",
      confidence: "likely",
      href: "/trends",
      chart: {
        kind: "compare",
        unit: "mgdl",
        better: "lower",
        bars: [
          { label: `At ${fmtTime(recentLow.at)}`, value: recentLow.valueMgdl },
          { label: "Now", value: valueMgdl },
        ],
      },
    });
  }

  /* --------------------------------- sleep --------------------------------- */

  const nightBefore = input.sleep.find((s) => s.wakeDate === dateKey(at));
  if (nightBefore && nightBefore.minutes < SHORT_SLEEP_MIN) {
    /**
     * Only mentioned when this person's OWN data shows the association. Short sleep raising glucose
     * is well established in general and still not true for everybody, and a factor drawn from
     * their own logs is one they can check.
     */
    const shortDays = new Set(input.sleep.filter((s) => s.minutes < SHORT_SLEEP_MIN).map((s) => s.wakeDate));
    const longDays = new Set(input.sleep.filter((s) => s.minutes >= input.sleepGoalMinutes).map((s) => s.wakeDate));
    const afterShort = mean(usable.filter((r) => shortDays.has(dateKey(r.at))).map((r) => r.valueMgdl));
    const afterLong = mean(usable.filter((r) => longDays.has(dateKey(r.at))).map((r) => r.valueMgdl));

    if (afterShort !== null && afterLong !== null && afterShort > afterLong + 10) {
      contributors.push({
        key: "short_sleep",
        label: "A short night before",
        evidence: `${round(nightBefore.minutes / 60, 1)} hours of sleep. Across your logs, days after a short night average ${round(afterShort)} mg/dL against ${round(afterLong)} after a full one.`,
        because: "Less sleep tends to make the body respond less well to insulin the next day.",
        confidence: "possible",
        href: "/log/sleep",
        chart: {
          kind: "compare",
          unit: "mgdl",
          better: "lower",
          bars: [
            { label: "After a full night", value: round(afterLong) ?? 0 },
            { label: "After a short night", value: round(afterShort) ?? 0 },
          ],
        },
      });
    }
  }

  /* -------------------------------- movement -------------------------------- */

  const movedRecently = input.exercise.some((e) => e.at.getTime() >= at.getTime() - DAY_MS && e.at.getTime() <= at.getTime());
  if (!movedRecently && input.exercise.length >= 3) {
    const afterExercise = mean(
      usable
        .filter((r) =>
          input.exercise.some((e) => {
            const mins = minutesBetween(e.at, r.at);
            return mins >= 60 && mins <= 4 * 60;
          }),
        )
        .map((r) => r.valueMgdl),
    );
    const overall = mean(usable.map((r) => r.valueMgdl));
    if (afterExercise !== null && overall !== null && afterExercise < overall - 10) {
      contributors.push({
        key: "no_movement",
        label: "No movement logged in the day before",
        evidence: `In the hours after your logged sessions, readings average ${round(afterExercise)} mg/dL against ${round(overall)} overall. Nothing is logged in the 24 hours before this reading.`,
        because: "Muscles take up glucose during and after activity, so a day without movement often sits higher.",
        confidence: "possible",
        href: "/move",
        chart: {
          kind: "compare",
          unit: "mgdl",
          better: "lower",
          bars: [
            { label: "After you move", value: round(afterExercise) ?? 0 },
            { label: "Overall", value: round(overall) ?? 0 },
          ],
        },
      });
    }
  }

  /* -------------------------------- ordering -------------------------------- */

  /**
   * Likely before possible, and within each the order they were found, which runs from the most
   * proximate cause outward: the meal, then the insulin record, then the pattern, then the day.
   * That is the order a person asks the questions in.
   */
  const weight = (c: Contributor) => (c.confidence === "likely" ? 0 : 1);
  contributors.sort((a, b) => weight(a) - weight(b));

  /* ---------------------------------- notes ---------------------------------- */

  let note: string | null = null;
  if (contributors.length === 0) {
    note =
      "Nothing you logged around this reading stands out. That happens often, and it usually means the cause is something this app cannot see rather than something you did.";
  } else if (history.length < 20) {
    note = `This is drawn from ${history.length} readings, which is early. The more you log, the more of this is your own pattern rather than a guess.`;
  }

  if (valueMgdl <= targetHigh) {
    note =
      note ??
      "This reading is inside your target range. The factors below are what moved it, not a problem to solve.";
  }

  return {
    at,
    valueMgdl,
    contributors,
    blindSpots: blindSpotsFor(input.usesInsulinBolus),
    note,
  };
}
