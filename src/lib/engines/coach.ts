/**
 * THE DAILY COACH ENGINE — pure, and the only place a number in a coach message can come from.
 *
 * The model's job downstream is to put this into warm prose. It is handed the object this file
 * returns and is forbidden from arithmetic, so if a figure is wrong it is wrong here, where a test
 * can catch it. The `engineMorning` / `engineWeekly` writers below are the no-API-key path: they
 * produce a complete, honest message from the same facts, which is why invariant 7 holds.
 *
 * Tone rules, from docs/CONVENTIONS.md, enforced by how the sentences are built:
 *   - Never congratulate a number the person did not choose. "72% in range" is not a win; logging
 *     six days is, because they chose to do it.
 *   - Never imply a missed day was a failure. Absent data is described, not scored.
 *   - No dose, no medication timing, ever. The focus line is drawn from a fixed list.
 *   - No em-dashes in anything a person reads.
 */
import { glucoseStats, type GlucoseStats, type ReadingLike } from "./stats";
import type { Pattern } from "./patterns";
import { formatGlucose, unitLabel, VERY_LOW_MGDL } from "../units";
import { dateKey, fmtDayLong } from "../time";
import type { Units } from "../db/schema";

/* ------------------------------- the morning ------------------------------- */

export type CoachDayInput = {
  /** The moment the check-in is being generated, normally 8am local. */
  now: Date;
  /** The day being looked back on, and its rows. */
  yesterday: Date;
  name: string;
  units: Units;
  targetLow: number;
  targetHigh: number;
  readings: ReadingLike[];
  meals: { at: Date; carbsG: number }[];
  exercise: { minutes: number }[];
  /**
   * Two different nights, and conflating them produces a message that contradicts itself.
   * `sleep` is the night that ENDED yesterday morning: part of what they logged yesterday.
   * `lastNightSleep` is the night that just ended: what the 8am focus can still ask them to log.
   */
  sleep: { minutes: number; quality: number } | null;
  lastNightSleep: { minutes: number; quality: number } | null;
  checkin: { feeling: number; unusual: string | null } | null;
  hydrationMl: number;
  hydrationGoalMl: number;
  usesInsulin: boolean;
  insulinEntries: number;
  /** Consecutive days ending yesterday with at least one logged row of any kind. */
  streakDays: number;
  /** Days in the last 7 with at least one glucose reading. */
  daysLoggedLast7: number;
  patterns: Pattern[];
  goals: string;
  nextAppointment: { at: Date; withWhom: string } | null;
  /**
   * The game's half of the morning, or null when Life Quest has nothing to say. Deliberately
   * thin: a region name, a level, and one thing to do. No XP totals and no milestones, because a
   * morning message is for starting a day and not for reviewing a ledger.
   */
  quest: { region: string; level: number; guardian: string; title: string; ask: string } | null;
};

export type CoachFocus = {
  /** One sentence, imperative, small enough to do before lunch. */
  line: string;
  /** Where in the app it gets done. */
  href: string;
  /** The engine's reason for picking it, for the audit and the in-app surface. */
  why: string;
};

export type CoachDayFacts = {
  kind: "morning";
  /** The day summarised, "YYYY-MM-DD". */
  date: string;
  dateLong: string;
  name: string;
  glucose: GlucoseStats;
  unitLabel: string;
  /** Formatted for display in the person's own unit, so the writer never converts. */
  display: { mean: string | null; lowest: string | null; highest: string | null; targetLow: string; targetHigh: string; veryLow: string };
  readings: number;
  lows: number;
  veryLows: number;
  highs: number;
  meals: number;
  carbsG: number;
  exerciseMinutes: number;
  exerciseSessions: number;
  sleepHours: number | null;
  sleepQuality: number | null;
  checkinDone: boolean;
  feeling: number | null;
  noted: string | null;
  hydrationMl: number;
  hydrationGoalMl: number;
  insulinEntries: number | null;
  streakDays: number;
  daysLoggedLast7: number;
  /** Plain, factual list of what they did yesterday. Empty when nothing was logged. */
  showedUp: string[];
  /** True when not a single row was logged. The message changes shape, it does not scold. */
  blankDay: boolean;
  focus: CoachFocus;
  goals: string;
  appointment: string | null;
  quest: { region: string; level: number; guardian: string; title: string; ask: string } | null;
  /** Set when the sample is too small to say anything about a trend. */
  sampleNote: string | null;
};

/** The fixed focus list. Ordered: the first one whose condition holds wins. Nothing here is a dose. */
function pickFocus(i: CoachDayInput, g: GlucoseStats, veryLows: number): CoachFocus {
  if (veryLows > 0) {
    return {
      line: "Keep fast-acting carbs within reach today, and let someone near you know.",
      href: "/copilot?mode=symptoms",
      why: "A reading under 54 was logged yesterday.",
    };
  }
  if (i.readings.length === 0) {
    return {
      line: "One reading, whenever it fits into your day.",
      href: "/log/glucose",
      why: "No glucose readings were logged yesterday.",
    };
  }
  if (i.meals.length === 0) {
    return {
      line: "Take a few minutes to plan your first meal.",
      href: "/plan",
      why: "No meals were logged yesterday, so there is nothing to compare a reading against.",
    };
  }
  if (i.sleep && i.sleep.minutes < 360) {
    return {
      line: "Go gently today, and log tonight's sleep before bed.",
      href: "/log/sleep",
      why: `Last night came to ${(i.sleep.minutes / 60).toFixed(1)} hours.`,
    };
  }
  if (!i.sleep) {
    return {
      line: "Log last night's sleep while you still remember it.",
      href: "/log/sleep",
      why: "Sleep was not logged for this morning, and it is one of the few things that moves morning glucose.",
    };
  }
  const uncovered = i.patterns.find((p) => p.key.startsWith("meals_uncovered"));
  if (uncovered) {
    return {
      line: "Pick one meal today and take a reading about two hours after it.",
      href: "/log/glucose",
      why: uncovered.evidence,
    };
  }
  if (i.exercise.length === 0) {
    return {
      line: "Find ten minutes to move, at whatever pace today allows.",
      href: "/move",
      why: "No movement was logged yesterday.",
    };
  }
  if (i.hydrationMl < i.hydrationGoalMl * 0.5) {
    return {
      line: "Start with a glass of water before anything else.",
      href: "/log/water",
      why: `Yesterday came to ${i.hydrationMl} ml of a ${i.hydrationGoalMl} ml goal.`,
    };
  }
  if (g.timeInRange !== null && g.timeInRange >= 70) {
    return {
      line: "Keep doing what you did yesterday. It does not need to be more complicated than that.",
      href: "/trends",
      why: `Yesterday's readings sat in range ${g.timeInRange.toFixed(0)}% of the time, so there is nothing to change.`,
    };
  }
  return {
    line: "Write down one thing you want to ask your care team.",
    href: "/toolkit/questions",
    why: "Nothing in yesterday's data needs a change today, so the useful thing is preparing the next conversation.",
  };
}

export function coachDayFacts(i: CoachDayInput): CoachDayFacts {
  const g = glucoseStats(i.readings, i.targetLow, i.targetHigh);
  const veryLows = g.counts.very_low;
  const lows = g.counts.low + g.counts.very_low;
  const highs = g.counts.high + g.counts.very_high;
  const exerciseMinutes = i.exercise.reduce((a, e) => a + e.minutes, 0);
  const carbsG = Math.round(i.meals.reduce((a, m) => a + m.carbsG, 0));
  const fmt = (v: number | null) => (v === null ? null : formatGlucose(v, i.units));

  const showedUp: string[] = [];
  if (i.readings.length > 0) showedUp.push(`${i.readings.length} glucose reading${i.readings.length === 1 ? "" : "s"}`);
  if (i.meals.length > 0) showedUp.push(`${i.meals.length} meal${i.meals.length === 1 ? "" : "s"} logged`);
  if (i.usesInsulin && i.insulinEntries > 0) showedUp.push(`${i.insulinEntries} insulin entr${i.insulinEntries === 1 ? "y" : "ies"} recorded`);
  if (exerciseMinutes > 0) showedUp.push(`${exerciseMinutes} minutes of movement`);
  if (i.sleep) showedUp.push(`sleep logged at ${(i.sleep.minutes / 60).toFixed(1)} hours`);
  if (i.hydrationMl > 0) showedUp.push(`${i.hydrationMl} ml of water`);
  if (i.checkin) showedUp.push("a check-in");

  return {
    kind: "morning",
    date: dateKey(i.yesterday),
    dateLong: fmtDayLong(i.yesterday),
    name: i.name.trim(),
    glucose: g,
    unitLabel: unitLabel(i.units),
    display: {
      mean: fmt(g.mean),
      lowest: fmt(g.min),
      highest: fmt(g.max),
      targetLow: formatGlucose(i.targetLow, i.units),
      targetHigh: formatGlucose(i.targetHigh, i.units),
      veryLow: formatGlucose(VERY_LOW_MGDL, i.units),
    },
    readings: i.readings.length,
    lows,
    veryLows,
    highs,
    meals: i.meals.length,
    carbsG,
    exerciseMinutes,
    exerciseSessions: i.exercise.length,
    sleepHours: i.sleep ? Number((i.sleep.minutes / 60).toFixed(1)) : null,
    sleepQuality: i.sleep ? i.sleep.quality : null,
    checkinDone: Boolean(i.checkin),
    feeling: i.checkin?.feeling ?? null,
    noted: i.checkin?.unusual ?? null,
    hydrationMl: i.hydrationMl,
    hydrationGoalMl: i.hydrationGoalMl,
    insulinEntries: i.usesInsulin ? i.insulinEntries : null,
    streakDays: i.streakDays,
    daysLoggedLast7: i.daysLoggedLast7,
    showedUp,
    blankDay: showedUp.length === 0,
    focus: pickFocus(i, g, veryLows),
    goals: i.goals.trim(),
    appointment: i.nextAppointment
      ? `${fmtDayLong(i.nextAppointment.at)} with ${i.nextAppointment.withWhom || "your care team"}`
      : null,
    quest: i.quest,
    sampleNote:
      i.readings.length > 0 && i.readings.length < 3
        ? "Yesterday has too few readings to describe as a day, so treat anything about it as one moment rather than a pattern."
        : null,
  };
}

/**
 * The no-API-key morning message. Complete and warm on its own, and honest about who wrote it.
 * Paragraphs are separated by a blank line so every transport can render it.
 */
export function engineMorning(f: CoachDayFacts): string {
  const hi = f.name ? `Good morning, ${f.name}.` : "Good morning.";
  const p: string[] = [hi];

  if (f.blankDay) {
    p.push(
      `Nothing went into Steady yesterday, and that is allowed. Days like that happen, and they do not undo ${f.streakDays > 1 ? `the ${f.streakDays} days before them` : "anything"}.`,
    );
  } else {
    p.push(`Yesterday you logged ${joinList(f.showedUp)}. That is you showing up, whatever the numbers did.`);
    if (f.glucose.n > 0 && f.glucose.timeInRange !== null && !f.sampleNote) {
      p.push(
        `The readings themselves: ${f.readings} of them, sitting between ${f.display.targetLow} and ${f.display.targetHigh} ${f.unitLabel} about ${f.glucose.timeInRange.toFixed(0)} percent of the time, averaging ${f.display.mean} ${f.unitLabel}. That is information, not a grade.`,
      );
    } else if (f.sampleNote) {
      p.push(f.sampleNote);
    }
  }

  if (f.veryLows > 0) {
    p.push(
      `One thing worth naming: ${f.veryLows} reading${f.veryLows === 1 ? " was" : "s were"} under ${f.display.veryLow} ${f.unitLabel}. Readings that low are the ones your care team wants to hear about.`,
    );
  }

  if (f.noted) p.push(`You wrote down that you noticed: "${f.noted}". It is still on the record.`);

  p.push(`Today's focus: ${f.focus.line}`);
  /*
   * The game's line goes AFTER the focus and never instead of it. A quest is an invitation; the
   * focus is the thing the engine actually thinks matters this morning, and a cheerful adventure
   * hook must not displace it.
   */
  if (f.quest) {
    p.push(`In your world you are standing in ${f.quest.region}, and ${f.quest.guardian} has one thing for you: ${f.quest.title}. ${f.quest.ask}`);
  }
  p.push("Progress does not require perfection.");
  p.push(
    "This one was written by Steady's own engine from your logged rows, because no API key is set. Every number in it is yours and nothing is guessed.",
  );
  return p.join("\n\n");
}

/* -------------------------------- the week -------------------------------- */

export type CoachWeekInput = {
  weekStart: Date;
  weekEnd: Date;
  name: string;
  units: Units;
  /** Days in the week with a wellbeing check-in. */
  checkinDays: number;
  /** Days with at least one logged row of any kind. */
  activeDays: number;
  mealsLogged: number;
  activityDays: number;
  activityMinutes: number;
  readings: number;
  daysWithReadings: number;
  sleepNights: number;
  /** Open questions the person or the engine added for the care team this week. */
  questionsForTeam: string[];
  /** From the review engine, already phrased. */
  wins: string[];
  toDiscuss: string[];
  sampleNote: string | null;
  nextAppointment: { at: Date; withWhom: string } | null;
};

export type CoachWeekFacts = Omit<CoachWeekInput, "weekStart" | "weekEnd" | "units" | "nextAppointment"> & {
  kind: "weekly";
  date: string;
  rangeLong: string;
  /** The one line that closes the review. Chosen from the counts, never from a glucose value. */
  biggestWin: string;
  nextWeekFocus: string;
  appointment: string | null;
};

export function coachWeekFacts(i: CoachWeekInput): CoachWeekFacts {
  const biggestWin =
    i.activeDays >= 6
      ? "You kept showing up, on almost every day of the week."
      : i.activeDays >= 4
        ? `You logged something on ${i.activeDays} days. That is most of the week.`
        : i.activeDays > 0
          ? `You came back ${i.activeDays} time${i.activeDays === 1 ? "" : "s"} this week. Coming back is the hard part.`
          : "Nothing went in this week, and the week is still there to pick up whenever you want to.";

  const nextWeekFocus =
    i.activeDays === 0
      ? "One entry, any kind, on any day."
      : i.daysWithReadings < 4
        ? "One reading a day, at whatever time is easiest."
        : i.mealsLogged < 7
          ? "Log the meal you eat most often, so your own numbers can tell you how it treats you."
          : i.activityDays < 3
            ? "Move on one more day than last week. Ten minutes counts."
            : "Keep things simple. What you did this week is working.";

  return {
    kind: "weekly",
    date: dateKey(i.weekStart),
    rangeLong: `${fmtDayLong(i.weekStart)} to ${fmtDayLong(i.weekEnd)}`,
    name: i.name.trim(),
    checkinDays: i.checkinDays,
    activeDays: i.activeDays,
    mealsLogged: i.mealsLogged,
    activityDays: i.activityDays,
    activityMinutes: i.activityMinutes,
    readings: i.readings,
    daysWithReadings: i.daysWithReadings,
    sleepNights: i.sleepNights,
    questionsForTeam: i.questionsForTeam,
    wins: i.wins,
    toDiscuss: i.toDiscuss,
    sampleNote: i.sampleNote,
    biggestWin,
    nextWeekFocus,
    appointment: i.nextAppointment
      ? `${fmtDayLong(i.nextAppointment.at)} with ${i.nextAppointment.withWhom || "your care team"}`
      : null,
  };
}

/** The no-API-key weekly review. Counts of things the person chose to do, and nothing graded. */
export function engineWeekly(f: CoachWeekFacts): string {
  const p: string[] = [f.name ? `Your week, ${f.name}.` : "Your week."];
  p.push(f.rangeLong);
  const lines = [
    `You checked in on ${f.checkinDays} day${f.checkinDays === 1 ? "" : "s"} this week.`,
    `You logged ${f.mealsLogged} meal${f.mealsLogged === 1 ? "" : "s"}.`,
    `You recorded activity on ${f.activityDays} day${f.activityDays === 1 ? "" : "s"}${f.activityMinutes > 0 ? `, ${f.activityMinutes} minutes in total` : ""}.`,
    `You took ${f.readings} glucose reading${f.readings === 1 ? "" : "s"} across ${f.daysWithReadings} day${f.daysWithReadings === 1 ? "" : "s"}.`,
  ];
  if (f.questionsForTeam.length > 0) {
    lines.push(
      `You identified ${f.questionsForTeam.length} thing${f.questionsForTeam.length === 1 ? "" : "s"} you would like to discuss with your care team.`,
    );
  }
  p.push(lines.join("\n"));
  if (f.sampleNote) p.push(f.sampleNote);
  p.push(`Your biggest win: ${f.biggestWin}`);
  p.push(`Next week's focus: ${f.nextWeekFocus}`);
  if (f.appointment) p.push(`Coming up: ${f.appointment}.`);
  p.push(
    "This one was written by Steady's own engine from your logged rows, because no API key is set. Every count in it is yours.",
  );
  return p.join("\n\n");
}

/* ------------------------------- "see my day" -------------------------------
 * Engine only, by design. This button must never cost a model call and must never narrate, so the
 * person can check a number without anything interpreting it for them.
 */

export type TodayLine = { label: string; value: string };

export function engineToday(opts: {
  units: Units;
  targetLow: number;
  targetHigh: number;
  readings: ReadingLike[];
  meals: { carbsG: number }[];
  exerciseMinutes: number;
  hydrationMl: number;
  hydrationGoalMl: number;
  insulinEntries: number | null;
  lastReadingAt: Date | null;
  now: Date;
}): { lines: TodayLine[]; text: string } {
  const g = glucoseStats(opts.readings, opts.targetLow, opts.targetHigh);
  const u = unitLabel(opts.units);
  const lines: TodayLine[] = [];
  lines.push({
    label: "Readings today",
    value:
      g.n === 0
        ? "none yet"
        : `${g.n}, latest ${formatGlucose(opts.readings[opts.readings.length - 1].valueMgdl, opts.units)} ${u}`,
  });
  if (g.n > 0) {
    lines.push({ label: "In your range", value: `${g.timeInRange?.toFixed(0)} percent of today's readings` });
    lines.push({ label: "Average today", value: `${formatGlucose(g.mean!, opts.units)} ${u}` });
    lines.push({ label: "Lowest / highest", value: `${formatGlucose(g.min!, opts.units)} / ${formatGlucose(g.max!, opts.units)} ${u}` });
    if (g.counts.very_low > 0) lines.push({ label: "Under 54", value: `${g.counts.very_low} reading${g.counts.very_low === 1 ? "" : "s"}` });
  }
  lines.push({
    label: "Meals",
    value: opts.meals.length === 0 ? "none logged" : `${opts.meals.length}, ${Math.round(opts.meals.reduce((a, m) => a + m.carbsG, 0))} g carbs`,
  });
  if (opts.insulinEntries !== null) {
    lines.push({ label: "Insulin entries", value: opts.insulinEntries === 0 ? "none recorded" : String(opts.insulinEntries) });
  }
  lines.push({ label: "Movement", value: opts.exerciseMinutes === 0 ? "none logged" : `${opts.exerciseMinutes} minutes` });
  lines.push({ label: "Water", value: `${opts.hydrationMl} ml of ${opts.hydrationGoalMl}` });

  const text = [
    "Your day so far",
    "",
    ...lines.map((l) => `${l.label}: ${l.value}`),
    "",
    "Read straight from your own rows. Nothing here was interpreted.",
  ].join("\n");
  return { lines, text };
}

/* --------------------------------- helpers --------------------------------- */

function joinList(items: string[]): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
