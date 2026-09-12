/**
 * THE JOURNEY — Steady's progress engine.
 *
 * A diabetes app that scores you on your glucose is a punishment machine. Glucose moves for
 * reasons nobody controls: an infection, a period, a bad night, a drug that was changed last
 * month. So the rule this whole file is built on:
 *
 *   XP IS ONLY EVER EARNED FOR SOMETHING THE PERSON CHOSE TO DO.
 *   GEMS ARE ONLY EVER EARNED FOR A SUSTAINED CHANGE IN THEIR OWN TREND, NEVER FOR A NUMBER.
 *   NOTHING IN THIS FILE CAN RETURN A NEGATIVE. There is no penalty, no decay, no loss.
 *
 * A single reading of 260 earns nothing and costs nothing. Logging it earns XP, because logging
 * is the behaviour. A fortnight whose time in range is five points better than the fortnight
 * before earns a gem, because that is a trend and not a day.
 *
 * Improvement is always measured against THE SAME PERSON's earlier window, never against a target
 * or against anybody else, and only when both windows carry enough data to compare honestly
 * (`MIN_DAYS` days and `MIN_READINGS` readings on each side). Below that the engine says nothing,
 * which is the same discipline the pattern engine uses.
 *
 * Pure functions over rows already loaded. No database, no clock of its own, no I/O — so
 * `tests/journey.test.ts` can work an example by hand and check every number.
 */
import { glucoseStats, between, type ReadingLike } from "./stats";
import { dateKey, startOfDay, addDays, weekKey, parseDateKey, DAY_MS } from "../time";
import type { AwardKind } from "../db/schema";
import {
  SUFFICIENCY,
  TREND_RULES,
  HABIT_RULES,
  STREAK_RULES,
  provenance,
  qualityFor,
  type AnalysisStatus,
  type DataQuality,
  type Provenance,
} from "./rules";

/* ------------------------------- the ledger ------------------------------- */

export type { AwardKind };

export type AwardDraft = {
  /** Stable and unique. Re-running the engine on the same data can never award twice. */
  key: string;
  /** The rule that produced it, for grouping and for tests. */
  code: string;
  kind: AwardKind;
  title: string;
  body: string;
  /** The engine's own numbers. Shown under the award; the model may never rewrite it. */
  evidence: string;
  xp: number;
  gems: number;
  /** The moment the award belongs to, which is usually not the moment it was written. */
  at: Date;
  /**
   * Which rules produced this, over what window, from how many records, at what quality. Written
   * onto the ledger row so any reward can be explained and reproduced months later.
   */
  provenance: Provenance;
};

/* ------------------------------- the input -------------------------------- */

export type JourneyInput = {
  now: Date;
  targetLow: number;
  targetHigh: number;
  hydrationGoalMl: number;
  readings: ReadingLike[];
  meals: { at: Date }[];
  exercise: { at: Date; minutes: number }[];
  /** One row per morning, keyed "YYYY-MM-DD". */
  sleep: { wakeDate: string }[];
  hydration: { at: Date; ml: number }[];
  /** One row per local day, keyed "YYYY-MM-DD". */
  checkins: { date: string }[];
  journal: { at: Date }[];
  /** Appointments whose brief was actually built before the visit. */
  appointmentsPrepped: { at: Date }[];
};

/* -------------------------------- the rules ------------------------------- */

/**
 * How far back habit awards are computed. Existing users get a backfill the first time this runs,
 * which is the point: the journey should not start empty for somebody who has been logging for
 * months. Bounded so the backfill is a few hundred rows and not a few thousand.
 */
export const HABIT_WINDOW_DAYS = 60;

/**
 * Every threshold below is re-exported from `rules.ts` rather than written here. That is the whole
 * point of that file: one reviewable place where what counts as a reward is defined, and one
 * version number stamped onto the rows it produces.
 */
export const HABIT_XP = HABIT_RULES;
export const MOVE_MINUTES = HABIT_RULES.moveMinutes;
export const MIN_DAYS = SUFFICIENCY.minDays;
export const MIN_READINGS = SUFFICIENCY.minReadings;
export const TREND_WINDOW_DAYS = SUFFICIENCY.windowDays;

const STREAK_STEPS = STREAK_RULES;

/* ------------------------------ levels & world ----------------------------- */

/**
 * The default map. Each region opens at a level, and a theme may supply a different list of the
 * same length: the names change, the levels never do, so two people at level 7 have earned exactly
 * the same amount whatever their world is called.
 */
export const REGIONS: { level: number; name: string; blurb: string }[] = [
  { level: 1, name: "The Clearing", blurb: "Where everyone starts. Bare ground, good light." },
  { level: 2, name: "First Path", blurb: "A track worn into the grass by walking it more than once." },
  { level: 3, name: "The Grove", blurb: "The first trees you planted are taller than you now." },
  { level: 4, name: "Stone Bridge", blurb: "Something you built to get over the thing that used to stop you." },
  { level: 5, name: "Riverbend", blurb: "Water wide enough to hear from the path." },
  { level: 6, name: "The Orchard", blurb: "Things planted a while ago, bearing." },
  { level: 7, name: "Highland Trail", blurb: "The ground starts to rise. You can see where you came from." },
  { level: 8, name: "The Falls", blurb: "Loud, cold, and worth the walk." },
  { level: 9, name: "Pine Ridge", blurb: "Above the tree line of where you began." },
  { level: 10, name: "The Summit", blurb: "Not the end. A place to stand and look back from." },
  { level: 11, name: "Lake of Stars", blurb: "Still water on the far side of the summit." },
  { level: 12, name: "The Far Country", blurb: "Everything past the map you were given." },
];

/**
 * Cumulative XP needed to reach a level: 150·(L−1)² + 250·(L−1).
 *
 * A day of full logging is about 170 XP, so level 2 lands on day three and the summit is around
 * three months of consistent use. Quadratic rather than exponential because an exponential curve
 * makes the later levels unreachable, and a wall is the moment people stop.
 */
export function xpForLevel(level: number): number {
  const n = Math.max(0, level - 1);
  return 150 * n * n + 250 * n;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 99 && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export type LevelState = {
  level: number;
  xp: number;
  /** XP into the current level, and what the current level spans. */
  intoLevel: number;
  levelSpan: number;
  /** 0..1 for the progress bar. */
  progress: number;
  toNext: number;
  region: { level: number; name: string; blurb: string };
  nextRegion: { level: number; name: string; blurb: string } | null;
  unlocked: { level: number; name: string; blurb: string }[];
};

export function levelState(xp: number, regions: { level: number; name: string; blurb: string }[] = REGIONS): LevelState {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const unlocked = regions.filter((r) => r.level <= level);
  return {
    level,
    xp,
    intoLevel: xp - base,
    levelSpan: span,
    progress: span > 0 ? Math.min(1, (xp - base) / span) : 1,
    toNext: Math.max(0, next - xp),
    region: unlocked[unlocked.length - 1] ?? REGIONS[0],
    nextRegion: regions.find((r) => r.level === level + 1) ?? null,
    unlocked,
  };
}

/**
 * What the world drawing renders. Every field is derived, never stored, so the picture can never
 * disagree with the ledger.
 */
export type WorldState = {
  level: number;
  /** 0..1, how far the path has been walked across the frame. */
  path: number;
  plants: number;
  trees: number;
  /** 0 none, 1 tent, 2 cabin, 3 house, 4 house with a lit window and a fence. */
  home: number;
  /** 0..1 river width. */
  river: number;
  mountains: boolean;
  falls: boolean;
  stars: number;
  /** Gems spent on nothing; they are the count of trend milestones and they light the sky. */
  gems: number;
};

export function worldState(level: number, gems: number): WorldState {
  return {
    level,
    path: Math.min(1, level / 10),
    plants: Math.min(14, 2 + level * 2),
    trees: Math.min(16, Math.max(0, level - 2) * 2),
    home: level >= 9 ? 4 : level >= 6 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0,
    river: level >= 5 ? Math.min(1, (level - 4) / 6) : 0,
    mountains: level >= 7,
    falls: level >= 8,
    stars: level >= 11 ? 26 : Math.min(18, gems * 2),
    gems,
  };
}

/* ------------------------------ day roll-up ------------------------------- */

export type DayRoll = {
  date: string;
  readings: number;
  meals: number;
  moveMinutes: number;
  sleepLogged: boolean;
  waterMl: number;
  /** Did the day reach their own hydration goal? Carried on the roll so quest rules need no profile. */
  waterGoalMet: boolean;
  checkin: boolean;
  journal: boolean;
  /** Did they touch the app in any way that day? This is what a streak counts. */
  active: boolean;
};

function countByDay<T>(rows: T[], at: (r: T) => Date): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = dateKey(at(r));
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function sumByDay<T>(rows: T[], at: (r: T) => Date, value: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = dateKey(at(r));
    m.set(k, (m.get(k) ?? 0) + value(r));
  }
  return m;
}

/** One row per local day across the window, oldest first, including days with nothing on them. */
export function rollDays(input: JourneyInput, days = HABIT_WINDOW_DAYS): DayRoll[] {
  const waterGoal = Math.max(1, input.hydrationGoalMl);
  const readings = countByDay(input.readings, (r) => r.at);
  const meals = countByDay(input.meals, (m) => m.at);
  const move = sumByDay(input.exercise, (e) => e.at, (e) => e.minutes);
  const water = sumByDay(input.hydration, (h) => h.at, (h) => h.ml);
  const journal = countByDay(input.journal, (j) => j.at);
  const sleep = new Set(input.sleep.map((s) => s.wakeDate));
  const checkins = new Set(input.checkins.map((c) => c.date));

  const out: DayRoll[] = [];
  const today = startOfDay(input.now);
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const k = dateKey(d);
    const roll: DayRoll = {
      date: k,
      readings: readings.get(k) ?? 0,
      meals: meals.get(k) ?? 0,
      moveMinutes: move.get(k) ?? 0,
      sleepLogged: sleep.has(k),
      waterMl: water.get(k) ?? 0,
      waterGoalMet: (water.get(k) ?? 0) >= waterGoal,
      checkin: checkins.has(k),
      journal: (journal.get(k) ?? 0) > 0,
      active: false,
    };
    roll.active =
      roll.readings > 0 || roll.meals > 0 || roll.moveMinutes > 0 || roll.sleepLogged || roll.waterMl > 0 || roll.checkin || roll.journal;
    out.push(roll);
  }
  return out;
}

/**
 * The current run of consecutive active days, counted back from the most recent day.
 *
 * Today is not required to be active. A streak that dies at 9am because breakfast has not been
 * logged yet would be the most discouraging thing in the app, so the run is allowed to end
 * yesterday and today simply extends it.
 */
export function currentStreak(rolls: DayRoll[]): number {
  let i = rolls.length - 1;
  if (i >= 0 && !rolls[i].active) i--; // today still has time
  let n = 0;
  for (; i >= 0 && rolls[i].active; i--) n++;
  return n;
}

export function longestStreak(rolls: DayRoll[]): number {
  let best = 0;
  let run = 0;
  for (const r of rolls) {
    run = r.active ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/* ------------------------------ habit awards ------------------------------ */

function habitAwards(rolls: DayRoll[], input: JourneyInput): AwardDraft[] {
  const out: AwardDraft[] = [];
  const goal = Math.max(1, input.hydrationGoalMl);

  for (const d of rolls) {
    const at = parseDateKey(d.date);
    // A habit award's evidence is the day itself, so its window is that one day and its sample
    // size is what was actually logged in it. Quality is always high: there is no inference here,
    // only a count of things the person entered.
    const add = (code: string, title: string, body: string, evidence: string, xp: number, sample: number) =>
      out.push({
        key: `${code}:${d.date}`,
        code,
        kind: "habit",
        title,
        body,
        evidence,
        xp,
        gems: 0,
        at,
        provenance: provenance({ sampleSize: sample, windowFrom: at, windowTo: at, dataQuality: "high" }),
      });

    if (d.readings > 0)
      add("log", "You checked in with your numbers", "Logging is the part you control, and it is the part everything else is built on.", `${d.readings} reading${d.readings === 1 ? "" : "s"} logged`, HABIT_XP.log, d.readings);
    if (d.meals > 0)
      add("meal", "You logged what you ate", "Meals are how the app learns which foods your body answers differently.", `${d.meals} meal${d.meals === 1 ? "" : "s"} logged`, HABIT_XP.meal, d.meals);
    if (d.moveMinutes >= MOVE_MINUTES)
      add("move", "You moved", "Movement is one of the few levers that is entirely yours.", `${d.moveMinutes} minutes of activity`, HABIT_XP.move, 1);
    if (d.sleepLogged) add("sleep", "You logged last night", "Sleep shows up in the morning readings more than almost anything else.", "sleep recorded", HABIT_XP.sleep, 1);
    if (d.waterMl >= goal) add("water", "You hit your water goal", "Small, dull, and it holds the rest of the day up.", `${d.waterMl} ml of ${goal} ml`, HABIT_XP.water, 1);
    if (d.checkin) add("checkin", "You said how the day felt", "How you feel is data too, and it is the kind no meter records.", "daily check-in completed", HABIT_XP.checkin, 1);
    if (d.journal) add("journal", "You wrote something down", "The notes are what turn a number into a reason.", "journal entry written", HABIT_XP.journal, 1);

    const extras = d.moveMinutes >= MOVE_MINUTES || d.sleepLogged || d.waterMl >= goal || d.checkin;
    if (d.readings > 0 && d.meals > 0 && extras)
      add("full_day", "A whole day, all of it", "Readings, food, and one more thing you chose. That is a complete picture of a day.", "glucose, meals and at least one more log", HABIT_XP.full_day, d.readings + d.meals);
  }

  /* Weekly consistency. Awarded the moment the threshold is crossed, not at the end of the week. */
  const byWeek = new Map<string, DayRoll[]>();
  for (const d of rolls) {
    const k = weekKey(parseDateKey(d.date));
    const arr = byWeek.get(k);
    if (arr) arr.push(d);
    else byWeek.set(k, [d]);
  }
  for (const [wk, days] of byWeek) {
    const logged = days.filter((d) => d.readings > 0).length;
    const at = days[days.length - 1] ? parseDateKey(days[days.length - 1].date) : parseDateKey(wk);
    if (logged >= 5)
      out.push({
        key: `week5:${wk}`,
        code: "week5",
        kind: "habit",
        title: "Five days of showing up",
        body: "Not a perfect week. A real one, which is the kind that lasts.",
        evidence: `glucose logged on ${logged} of 7 days, week of ${wk}`,
        xp: HABIT_XP.week5,
        gems: 0,
        at,
        provenance: provenance({ sampleSize: logged, windowFrom: parseDateKey(wk), windowTo: at }),
      });
    if (logged >= 7)
      out.push({
        key: `week7:${wk}`,
        code: "week7",
        kind: "habit",
        title: "Every single day this week",
        body: "Seven for seven.",
        evidence: `glucose logged on all 7 days, week of ${wk}`,
        xp: HABIT_XP.week7,
        gems: 0,
        at,
        provenance: provenance({ sampleSize: logged, windowFrom: parseDateKey(wk), windowTo: at }),
      });
  }

  /* Streaks. Every maximal run is scanned, so a streak that breaks can be earned again. */
  let run = 0;
  for (const d of rolls) {
    if (!d.active) {
      run = 0;
      continue;
    }
    run++;
    for (const step of STREAK_STEPS) {
      if (run !== step.days) continue;
      out.push({
        key: `streak${step.days}:${d.date}`,
        code: `streak${step.days}`,
        kind: step.gems > 0 ? "milestone" : "habit",
        title: step.title,
        body: "A streak here means you opened the app and logged something. It never means your numbers behaved.",
        evidence: `${step.days} days in a row with at least one entry, ending ${d.date}`,
        xp: step.xp,
        gems: step.gems,
        at: parseDateKey(d.date),
        provenance: provenance({
          sampleSize: step.days,
          windowFrom: parseDateKey(rolls[Math.max(0, rolls.indexOf(d) - step.days + 1)].date),
          windowTo: parseDateKey(d.date),
        }),
      });
    }
  }

  /* Walking into an appointment prepared is a real act, and it is entirely theirs. */
  for (const a of input.appointmentsPrepped) {
    if (a.at.getTime() > input.now.getTime()) continue;
    out.push({
      key: `appt_prep:${dateKey(a.at)}`,
      code: "appt_prep",
      kind: "habit",
      title: "You walked in prepared",
      body: "You built a brief before the visit, so the room started from your evidence instead of your memory.",
      evidence: `appointment brief prepared for ${dateKey(a.at)}`,
      xp: HABIT_XP.appt_prep,
      gems: 0,
      at: a.at,
      provenance: provenance({ sampleSize: 1, windowFrom: a.at, windowTo: a.at }),
    });
  }

  return out;
}

/* ----------------------------- trend milestones ---------------------------- */

/**
 * The result of comparing one fortnight with the one before it.
 *
 * It is a STRUCTURED RESULT rather than a sentence, and that is the point of the layering: the
 * engine returns status, windows, sample sizes and quality, and only then does anything downstream
 * get to turn that into words. Nothing may read `recent` without also reading `status`.
 */
export type TrendCompare = {
  status: AnalysisStatus;
  /** Kept as the boolean the screens read; it is exactly `status === "VALID"`. */
  comparable: boolean;
  reason: string | null;
  dataQuality: DataQuality;
  recent: ReturnType<typeof glucoseStats>;
  prior: ReturnType<typeof glucoseStats>;
  recentFrom: Date;
  recentTo: Date;
  priorFrom: Date;
  priorTo: Date;
  /** Records consumed on each side, so a claim can always be weighed against its evidence. */
  recentN: number;
  priorN: number;
  windowDays: number;
};

/** How far a mean sits outside the person's own target band. Zero inside it. */
export function distanceFromRange(mean: number, low: number, high: number): number {
  if (mean > high) return mean - high;
  if (mean < low) return low - mean;
  return 0;
}

export function compareWindows(input: JourneyInput, windowDays = TREND_WINDOW_DAYS): TrendCompare {
  const today = startOfDay(input.now);
  const recentFrom = addDays(today, -(windowDays - 1));
  const priorFrom = addDays(recentFrom, -windowDays);
  const to = new Date(today.getTime() + DAY_MS);
  const recent = glucoseStats(between(input.readings, recentFrom, to), input.targetLow, input.targetHigh);
  const prior = glucoseStats(between(input.readings, priorFrom, recentFrom), input.targetLow, input.targetHigh);
  const thin = [
    recent.days < MIN_DAYS || recent.n < MIN_READINGS ? "the last two weeks" : null,
    prior.days < MIN_DAYS || prior.n < MIN_READINGS ? "the two weeks before that" : null,
  ].filter(Boolean) as string[];
  const status: AnalysisStatus = thin.length === 0 ? "VALID" : "INSUFFICIENT_DATA";
  return {
    status,
    comparable: status === "VALID",
    reason: thin.length
      ? `There is not enough in ${thin.join(" or ")} to compare the two honestly yet. It takes readings on ${MIN_DAYS} days in each fortnight.`
      : null,
    // Insufficient is a quality state in its own right, not a low-quality answer.
    dataQuality: status === "VALID" ? qualityFor(recent.days, prior.days, windowDays) : "insufficient",
    recent,
    prior,
    recentFrom,
    recentTo: to,
    priorFrom,
    priorTo: recentFrom,
    recentN: recent.n,
    priorN: prior.n,
    windowDays,
  };
}

/**
 * Trend milestones. One period key per calendar week, so a milestone can fire at most once a week
 * however often the page is opened, and a person cannot farm gems by reloading.
 *
 * Every rule here compares the person against their own previous fortnight. None of them compares
 * a number to a target, because hitting a target is not something a person can decide to do.
 */
function trendAwards(input: JourneyInput): AwardDraft[] {
  const cmp = compareWindows(input);
  if (!cmp.comparable) return [];
  const wk = weekKey(input.now);
  const at = input.now;
  const { recent: a, prior: b } = cmp;
  const out: AwardDraft[] = [];
  /**
   * Every milestone carries both windows, both sample sizes and the quality band. That is what
   * makes a gem awarded last spring answerable: which fortnights, how many readings, under which
   * rule version, at what confidence.
   */
  const prov = provenance({
    sampleSize: cmp.recentN + cmp.priorN,
    windowFrom: cmp.recentFrom,
    windowTo: cmp.recentTo,
    compareFrom: cmp.priorFrom,
    compareTo: cmp.priorTo,
    dataQuality: cmp.dataQuality,
  });
  const push = (code: string, title: string, body: string, evidence: string, xp: number, gems: number) =>
    out.push({ key: `${code}:${wk}`, code, kind: "milestone", title, body, evidence, xp, gems, at, provenance: prov });

  const tirGain = (a.timeInRange ?? 0) - (b.timeInRange ?? 0);
  if (tirGain >= TREND_RULES.tirGainPoints)
    push(
      "trend_tir",
      "You moved forward",
      "Compared with your own previous fortnight, more of your time is sitting inside your range. That is a trend, not a day.",
      `time in range ${a.timeInRange!.toFixed(0)}% in the last 14 days, against ${b.timeInRange!.toFixed(0)}% in the 14 before`,
      300,
      1,
    );

  const distA = distanceFromRange(a.mean!, input.targetLow, input.targetHigh);
  const distB = distanceFromRange(b.mean!, input.targetLow, input.targetHigh);
  if (distB - distA >= TREND_RULES.meanTowardRangeMgdl)
    push(
      "trend_mean",
      "Your average moved toward your range",
      "Closer to the band you and your care team chose, measured against where you were a fortnight ago.",
      `average ${Math.round(a.mean!)} mg/dL in the last 14 days, against ${Math.round(b.mean!)} mg/dL in the 14 before`,
      250,
      1,
    );

  if (a.cv !== null && b.cv !== null && b.cv - a.cv >= TREND_RULES.cvDropPoints)
    push(
      "trend_steady",
      "Your days got steadier",
      "Less distance between your highs and your lows. Steadier days are usually the ones that feel better, whatever the average says.",
      `variability ${a.cv.toFixed(0)}% in the last 14 days, against ${b.cv.toFixed(0)}% in the 14 before`,
      200,
      1,
    );

  const lowRateA = a.lowsCount / a.n;
  const lowRateB = b.lowsCount / b.n;
  if (b.lowsCount >= TREND_RULES.lowsPriorMinimum && lowRateB > 0 && lowRateA <= lowRateB * TREND_RULES.lowsRemainingFraction)
    push(
      "trend_lows",
      "Fewer lows than the fortnight before",
      "Lows are the readings that carry the most risk, so fewer of them matters more than any average.",
      `${a.lowsCount} low reading${a.lowsCount === 1 ? "" : "s"} in the last 14 days, against ${b.lowsCount} in the 14 before`,
      250,
      1,
    );

  if ((a.timeInRange ?? 0) >= TREND_RULES.holdTirFloor && Math.abs(tirGain) < TREND_RULES.tirGainPoints)
    push(
      "hold_steady",
      "You are holding it",
      "Nothing moved, and that is the achievement. Holding a good fortnight in place is harder than reaching one.",
      `time in range ${a.timeInRange!.toFixed(0)}% held from ${b.timeInRange!.toFixed(0)}% the fortnight before`,
      200,
      1,
    );

  if (a.days - b.days >= TREND_RULES.consistencyExtraDays)
    push(
      "trend_consistency",
      "You are logging more often",
      "More days with readings means everything the app tells you about yourself is standing on more evidence.",
      `readings on ${a.days} of the last 14 days, against ${b.days} of the 14 before`,
      150,
      1,
    );

  return out;
}

/* -------------------------------- chapters -------------------------------- */

export type Chapter = {
  /** "YYYY-MM" */
  month: string;
  label: string;
  /** The stage name shown on the timeline. */
  stage: string;
  glyph: string;
  daysActive: number;
  daysInMonth: number;
  readings: number;
  /** Only present when that month carried enough readings to state one. */
  tir: number | null;
};

const STAGES: { min: number; stage: string; glyph: string }[] = [
  { min: 0.75, stage: "Finding your rhythm", glyph: "🌲" },
  { min: 0.5, stage: "Growing stronger", glyph: "🌳" },
  { min: 0.25, stage: "Building momentum", glyph: "🌿" },
  { min: 0.01, stage: "Starting point", glyph: "🌱" },
  { min: 0, stage: "A quiet month", glyph: "·" },
];

/** The timeline, oldest first. One entry per calendar month that has any data in the window. */
export function chapters(input: JourneyInput, months = 6): Chapter[] {
  const rolls = rollDays(input, months * 31);
  const byMonth = new Map<string, DayRoll[]>();
  for (const d of rolls) {
    const m = d.date.slice(0, 7);
    const arr = byMonth.get(m);
    if (arr) arr.push(d);
    else byMonth.set(m, [d]);
  }
  const out: Chapter[] = [];
  for (const [month, days] of byMonth) {
    const active = days.filter((d) => d.active).length;
    if (active === 0 && out.length === 0) continue; // do not open the story on empty months
    const from = parseDateKey(`${month}-01`);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const s = glucoseStats(between(input.readings, from, to), input.targetLow, input.targetHigh);
    const frac = active / days.length;
    const stage = STAGES.find((x) => frac >= x.min) ?? STAGES[STAGES.length - 1];
    out.push({
      month,
      label: from.toLocaleDateString([], { month: "long", year: "numeric" }),
      stage: stage.stage,
      glyph: stage.glyph,
      daysActive: active,
      daysInMonth: days.length,
      readings: s.n,
      tir: s.days >= 5 && s.n >= 10 ? s.timeInRange : null,
    });
  }
  return out;
}

/* --------------------------------- story ---------------------------------- */

/**
 * The narrative, written by the engine.
 *
 * Every clause here is a fact with a number behind it, and a clause whose number is missing is
 * dropped rather than softened into something vague. When the AI narrator runs it is handed these
 * same facts and told to warm the prose without touching a figure; when there is no API key this
 * text is what the person reads, and it is complete on its own.
 */
export type StoryFacts = {
  lines: string[];
  firstDay: string | null;
  daysKnown: number;
  activeDays: number;
  totalReadings: number;
  streak: number;
  best: number;
  trend: TrendCompare;
};

export function story(input: JourneyInput): StoryFacts {
  const rolls = rollDays(input, HABIT_WINDOW_DAYS);
  const trend = compareWindows(input);
  const activeDays = rolls.filter((d) => d.active).length;
  const firstActive = rolls.find((d) => d.active) ?? null;
  const streak = currentStreak(rolls);
  const best = longestStreak(rolls);
  const lines: string[] = [];

  const recent30 = rolls.slice(-30);
  const recentActive = recent30.filter((d) => d.active).length;
  const earlier30 = rolls.slice(0, 30);
  const earlierActive = earlier30.filter((d) => d.active).length;

  if (activeDays === 0) {
    lines.push("Your journey has not started yet, and it starts with one reading. Nothing here is graded and nothing is ever taken away.");
    return { lines, firstDay: null, daysKnown: rolls.length, activeDays, totalReadings: 0, streak, best, trend };
  }

  lines.push(
    `You have logged something on ${activeDays} of the last ${rolls.length} days, ${input.readings.length} readings in all.`,
  );

  if (earlier30.length === 30 && earlierActive > 0 && recentActive > earlierActive)
    lines.push(
      `A month ago you were logging on ${earlierActive} of 30 days. Over the last 30 you have logged on ${recentActive}.`,
    );
  else if (recentActive >= 20) lines.push(`Over the last 30 days you have logged on ${recentActive} of them.`);

  if (streak >= 3) lines.push(`You are ${streak} days into your current run, and your longest so far is ${best}.`);

  if (trend.comparable) {
    const a = trend.recent;
    const b = trend.prior;
    const gain = (a.timeInRange ?? 0) - (b.timeInRange ?? 0);
    const dir = gain >= 5 ? "improved compared with" : gain <= -5 ? "sits below" : "is holding close to";
    lines.push(
      `Your time in range over the last 14 days is ${a.timeInRange!.toFixed(0)}%, which ${dir} the ${b.timeInRange!.toFixed(0)}% of the fortnight before.`,
    );
    if (gain <= -5)
      lines.push(
        "Glucose moves for reasons that are not choices, so nothing has been taken away and nothing here counts against you. The logging is what you control, and you did it.",
      );
  } else if (trend.reason) {
    lines.push(trend.reason);
  }

  return {
    lines,
    firstDay: firstActive?.date ?? null,
    daysKnown: rolls.length,
    activeDays,
    totalReadings: input.readings.length,
    streak,
    best,
    trend,
  };
}

/* --------------------------------- report --------------------------------- */

export type JourneyReport = {
  /** Everything the engine believes has been earned, deduplicated by key. */
  awards: AwardDraft[];
  rolls: DayRoll[];
  streak: number;
  best: number;
  chapters: Chapter[];
  story: StoryFacts;
  trend: TrendCompare;
};

export function buildJourney(input: JourneyInput): JourneyReport {
  const rolls = rollDays(input, HABIT_WINDOW_DAYS);
  const seen = new Set<string>();
  const awards: AwardDraft[] = [];
  for (const a of [...habitAwards(rolls, input), ...trendAwards(input)]) {
    if (seen.has(a.key)) continue;
    seen.add(a.key);
    awards.push(a);
  }
  awards.sort((x, y) => x.at.getTime() - y.at.getTime());
  return {
    awards,
    rolls,
    streak: currentStreak(rolls),
    best: longestStreak(rolls),
    chapters: chapters(input),
    story: story(input),
    trend: compareWindows(input),
  };
}

/** The ledger's totals. Kept here so the screen and the tests agree on one definition. */
export function totals(rows: { xp: number; gems: number }[]): { xp: number; gems: number } {
  let xp = 0;
  let gems = 0;
  for (const r of rows) {
    xp += r.xp;
    gems += r.gems;
  }
  return { xp, gems };
}
