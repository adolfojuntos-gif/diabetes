import "server-only";
/**
 * The journey's data layer: load the evidence, run the engine, write what was earned.
 *
 * The one rule this file exists to enforce is that awarding is IDEMPOTENT. `journey_awards.key` is
 * unique and every insert is `onConflictDoNothing`, so the engine can run on every page load, on
 * every retry, and on two requests at the same instant, and the totals do not move. That is why
 * there is no stored balance anywhere: the ledger is the balance.
 */
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  journeyAwards,
  glucoseReadings,
  meals,
  exerciseSessions,
  sleepLogs,
  hydrationLogs,
  wellbeingCheckins,
  journalEntries,
  appointments,
  type JourneyAward,
  type Profile,
} from "../db";
import { newId } from "../ids";
import { themeOf, type Theme } from "../game/themes";
import { getProfile } from "./snapshot";
import { addDays, startOfDay, endOfDay } from "../time";
import {
  buildJourney,
  levelState,
  worldState,
  totals,
  HABIT_WINDOW_DAYS,
  type JourneyInput,
  type JourneyReport,
  type LevelState,
  type WorldState,
} from "../engines/journey";

/** Enough history for the six-month timeline; the habit rules only look at the last 60 days. */
const LOAD_DAYS = 190;

export async function loadJourneyInput(now = new Date(), p?: Profile): Promise<JourneyInput & { profile: Profile }> {
  const prof = p ?? (await getProfile());
  const from = addDays(startOfDay(now), -LOAD_DAYS);
  const to = endOfDay(now);
  const [readings, mealRows, ex, sleep, hyd, checkins, journal, appts] = await Promise.all([
    db.select().from(glucoseReadings).where(and(gte(glucoseReadings.at, from), lt(glucoseReadings.at, to))).orderBy(asc(glucoseReadings.at)),
    db.select({ at: meals.at }).from(meals).where(and(gte(meals.at, from), lt(meals.at, to))),
    db.select({ at: exerciseSessions.at, minutes: exerciseSessions.minutes }).from(exerciseSessions).where(and(gte(exerciseSessions.at, from), lt(exerciseSessions.at, to))),
    db.select({ wakeDate: sleepLogs.wakeDate }).from(sleepLogs),
    db.select({ at: hydrationLogs.at, ml: hydrationLogs.ml }).from(hydrationLogs).where(and(gte(hydrationLogs.at, from), lt(hydrationLogs.at, to))),
    db.select({ date: wellbeingCheckins.date }).from(wellbeingCheckins),
    db.select({ at: journalEntries.at }).from(journalEntries).where(and(gte(journalEntries.at, from), lt(journalEntries.at, to))),
    db.select({ at: appointments.at, brief: appointments.brief }).from(appointments).where(and(gte(appointments.at, from), lt(appointments.at, to))),
  ]);
  return {
    profile: prof,
    now,
    targetLow: prof.targetLowMgdl,
    targetHigh: prof.targetHighMgdl,
    hydrationGoalMl: prof.hydrationGoalMl,
    readings: readings.map((r) => ({ at: r.at, valueMgdl: r.valueMgdl })),
    meals: mealRows,
    exercise: ex,
    sleep,
    hydration: hyd,
    checkins,
    journal,
    // "Prepared" means a brief was actually built, not that an appointment exists.
    appointmentsPrepped: appts.filter((a) => (a.brief ?? "").trim().length > 0).map((a) => ({ at: a.at })),
  };
}

/**
 * Run the engine and write anything newly earned. Safe to call on every page load.
 *
 * THE BACKFILL. Somebody who has been using Steady for three months before this feature existed
 * earns their whole history the first time this runs, which is the point, but a celebration feed of
 * four hundred items is not a celebration. So on the very first run everything is marked as already
 * seen except the last handful, and they get their level, their world and their timeline straight
 * away with a short list of what just landed.
 */
export async function grantAwards(now = new Date(), p?: Profile): Promise<{ report: JourneyReport; granted: number }> {
  const input = await loadJourneyInput(now, p);
  const report = buildJourney(input);
  const existing = await db.select({ id: journeyAwards.id }).from(journeyAwards).limit(1);
  const firstRun = existing.length === 0;

  // Oldest first, so "the last handful" of a backfill is genuinely the most recent things earned.
  const ordered = [...report.awards].sort((a, b) => a.at.getTime() - b.at.getTime());
  const unseenFrom = firstRun ? Math.max(0, ordered.length - 5) : 0;

  let granted = 0;
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const r = await db
      .insert(journeyAwards)
      .values({
        id: newId(),
        key: a.key,
        code: a.code,
        kind: a.kind,
        title: a.title,
        body: a.body,
        evidence: a.evidence,
        xp: a.xp,
        gems: a.gems,
        earnedAt: a.at,
        createdAt: now,
        seenAt: firstRun && i < unseenFrom ? now : null,
        engineVersion: a.provenance.engineVersion,
        ruleVersion: a.provenance.ruleVersion,
        metricVersion: a.provenance.metricVersion,
        sampleSize: a.provenance.sampleSize,
        windowFrom: a.provenance.windowFrom,
        windowTo: a.provenance.windowTo,
        compareFrom: a.provenance.compareFrom,
        compareTo: a.provenance.compareTo,
        dataQuality: a.provenance.dataQuality,
      })
      .onConflictDoNothing();
    if ((r as { rowsAffected?: number }).rowsAffected) granted++;
  }
  return { report, granted };
}

export type JourneyState = {
  xp: number;
  gems: number;
  level: LevelState;
  world: WorldState;
  awardCount: number;
  theme: Theme;
};

/** Totals, summed from the ledger. There is no other definition of them anywhere. */
export async function journeyState(themeKey?: string | null): Promise<JourneyState> {
  const theme = themeOf(themeKey);
  const rows = await db
    .select({ xp: sql<number>`coalesce(sum(${journeyAwards.xp}), 0)`, gems: sql<number>`coalesce(sum(${journeyAwards.gems}), 0)`, n: sql<number>`count(*)` })
    .from(journeyAwards);
  const xp = Number(rows[0]?.xp ?? 0);
  const gems = Number(rows[0]?.gems ?? 0);
  const level = levelState(xp, theme.regions);
  return { xp, gems, level, world: worldState(level.level, gems), awardCount: Number(rows[0]?.n ?? 0), theme };
}

/** Cheap enough for the layout: how many awards are waiting to be celebrated. */
export async function unseenCount(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(journeyAwards).where(isNull(journeyAwards.seenAt));
  return Number(rows[0]?.n ?? 0);
}

export async function unseenAwards(limit = 12): Promise<JourneyAward[]> {
  return db.select().from(journeyAwards).where(isNull(journeyAwards.seenAt)).orderBy(desc(journeyAwards.earnedAt)).limit(limit);
}

export async function recentAwards(limit = 40): Promise<JourneyAward[]> {
  return db.select().from(journeyAwards).orderBy(desc(journeyAwards.earnedAt), desc(journeyAwards.createdAt)).limit(limit);
}

/** Every milestone ever earned, newest first. These are the ones worth a page of their own. */
export async function milestones(limit = 60): Promise<JourneyAward[]> {
  return db.select().from(journeyAwards).where(eq(journeyAwards.kind, "milestone")).orderBy(desc(journeyAwards.earnedAt)).limit(limit);
}

export async function markSeen(now = new Date()): Promise<void> {
  await db.update(journeyAwards).set({ seenAt: now }).where(isNull(journeyAwards.seenAt));
}

/** XP earned inside a month, for the timeline. Keyed "YYYY-MM". */
export async function xpByMonth(): Promise<Map<string, number>> {
  const rows = await db.select({ at: journeyAwards.earnedAt, xp: journeyAwards.xp }).from(journeyAwards);
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.at.getFullYear()}-${String(r.at.getMonth() + 1).padStart(2, "0")}`;
    m.set(k, (m.get(k) ?? 0) + r.xp);
  }
  return m;
}

export { HABIT_WINDOW_DAYS, totals };
