import "server-only";
/**
 * Materialise nudges from the engines into the nudges table (deduped), and read the inbox.
 */
import { and, desc, eq, gte, isNull, lt, asc } from "drizzle-orm";
import { db, nudges, glucoseReadings, meals, hydrationLogs, sleepLogs, wellbeingCheckins, appointments, doctorQuestions } from "../db";
import { newId } from "../ids";
import { loadSnapshot } from "./snapshot";
import { detectPatterns } from "../engines/patterns";
import { nudgesFromPatterns, nudgesFromToday, type NudgeDraft } from "../engines/nudges";
import { questionsFromPatterns } from "../engines/doctorQuestions";
import { rememberPatterns } from "./memory";
import { startOfDay, endOfDay, dateKey, addDays } from "../time";
import { VERY_LOW_MGDL } from "../units";

async function insertDrafts(drafts: NudgeDraft[], now: Date) {
  let added = 0;
  for (const d of drafts) {
    const r = await db
      .insert(nudges)
      .values({ id: newId(), dedupeKey: d.dedupeKey, kind: d.kind, title: d.title, body: d.body, href: d.href, createdAt: now })
      .onConflictDoNothing();
    if ((r as { rowsAffected?: number }).rowsAffected) added++;
  }
  return added;
}

/**
 * Run the engines and refresh nudges, doctor questions and memory. Cheap enough to call on every
 * home-page load; everything it writes is idempotent.
 */
export async function refreshDerived(now = new Date()) {
  const snap = await loadSnapshot(14, now);
  const report = detectPatterns(snap);
  await rememberPatterns(report.patterns, now);

  const today = startOfDay(now);
  const [readingsToday, mealsToday, waterToday, sleepToday, checkin, appt, veryLow] = await Promise.all([
    db.select().from(glucoseReadings).where(and(gte(glucoseReadings.at, today), lt(glucoseReadings.at, endOfDay(now)))).orderBy(desc(glucoseReadings.at)),
    db.select().from(meals).where(and(gte(meals.at, today), lt(meals.at, endOfDay(now)))),
    db.select().from(hydrationLogs).where(and(gte(hydrationLogs.at, today), lt(hydrationLogs.at, endOfDay(now)))),
    db.select().from(sleepLogs).where(eq(sleepLogs.wakeDate, dateKey(now))).limit(1),
    db.select().from(wellbeingCheckins).where(eq(wellbeingCheckins.date, dateKey(now))).limit(1),
    db.select().from(appointments).where(gte(appointments.at, today)).orderBy(asc(appointments.at)).limit(1),
    db.select().from(glucoseReadings).where(and(gte(glucoseReadings.at, addDays(now, -1)), lt(glucoseReadings.valueMgdl, VERY_LOW_MGDL))).limit(1),
  ]);

  const drafts = [
    ...nudgesFromToday({
      now,
      readingsToday: readingsToday.length,
      lastReadingAt: readingsToday[0]?.at ?? null,
      mealsToday: mealsToday.length,
      waterTodayMl: waterToday.reduce((a, h) => a + h.ml, 0),
      hydrationGoalMl: snap.profile.hydrationGoalMl,
      sleepLoggedForToday: sleepToday.length > 0,
      checkinDoneToday: checkin.length > 0,
      veryLowLast24h: veryLow.length > 0,
      nextAppointment: appt[0] ? { at: appt[0].at, withWhom: appt[0].withWhom } : null,
    }),
    ...nudgesFromPatterns(report.patterns, now),
  ];
  await insertDrafts(drafts, now);

  for (const q of questionsFromPatterns(report.patterns)) {
    await db
      .insert(doctorQuestions)
      .values({ id: newId(), text: q.text, evidence: q.evidence, source: "pattern", patternKey: q.patternKey, createdAt: now })
      .onConflictDoNothing();
  }
  return report;
}

export async function inbox(limit = 20) {
  return db.select().from(nudges).where(isNull(nudges.dismissedAt)).orderBy(desc(nudges.createdAt)).limit(limit);
}

export async function unreadCount() {
  const rows = await db.select({ id: nudges.id }).from(nudges).where(and(isNull(nudges.dismissedAt), isNull(nudges.readAt)));
  return rows.length;
}
