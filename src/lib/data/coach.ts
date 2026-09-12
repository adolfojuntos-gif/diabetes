import "server-only";
/**
 * THE DAILY COACH, SERVER SIDE.
 *
 * Everything the API routes do lives here, so the routes themselves are only auth plus JSON. The
 * shape of a coach message is:
 *
 *   engines compute the facts  →  safety engine runs  →  model narrates (or the engine writes it)
 *   →  dose filter  →  the safety banner is PREPENDED from fixed text  →  persisted  →  audited
 *
 * The banner is prepended here rather than asked for in the prompt. That is the difference between
 * invariant 4 being enforced and being requested politely.
 *
 * `getOrCreateMorning` is idempotent by (kind, date) at the database level. A cron that fires
 * twice, an HTTP retry and a manual test on the same morning all get the same message back.
 */
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  coachMessages,
  coachEvents,
  conversations,
  doctorQuestions,
  memoryFacts,
  wellbeingCheckins,
  appointments,
  type CoachAction,
  type CoachChannel,
  type CoachKind,
  type CoachMessage,
} from "../db";
import { newId } from "../ids";
import { recordAiUse } from "./aiAudit";
import { getProfile, loadReviewInput, loadSnapshot, usesInsulin } from "./snapshot";
import { runCopilotTurn, loadTriage } from "./copilotTurn";
import { detectPatterns } from "../engines/patterns";
import { weeklyReview } from "../engines/review";
import { between } from "../engines/stats";
import { rollDays } from "../engines/journey";
import { todaysQuest, guardianFor } from "../engines/lifequest";
import { loadJourneyInput, journeyState } from "./journey";
import { getPlayer } from "./lifequest";
import {
  coachDayFacts,
  coachWeekFacts,
  engineMorning,
  engineToday,
  engineWeekly,
  type CoachDayFacts,
  type CoachWeekFacts,
} from "../engines/coach";
import { coachMorningVoice, coachWeeklyVoice, type CoachVoiceInput } from "../ai/coach";
import { buildAppointmentBrief } from "../../app/toolkit/appointments/brief";
import type { TriageResult } from "../engines/triage";
import { addDays, dateKey, endOfDay, startOfDay, startOfWeek } from "../time";

/* ------------------------------ the safety banner ------------------------------ */

const ACTION_TEXT: Record<string, string> = {
  treat_low: "Treat the low the way your care team has told you to.",
  recheck_15: "Check again in about 15 minutes.",
  check_ketones: "Check ketones if you have a way to.",
  hydrate: "Take water, in small amounts and often.",
  tell_someone: "Tell someone near you what is going on.",
  do_not_drive: "Do not drive until this has settled.",
};

/**
 * Fixed wording, above anything a model wrote. Returns "" for `general`, which is the ordinary case
 * and must not put a banner on a cheerful morning message.
 */
export function safetyBanner(t: TriageResult): string {
  if (t.level === "general") return "";
  const lines = [t.headline.toUpperCase(), "", t.body];
  if (t.reasons.length) lines.push(`Why: ${t.reasons.join(" ")}`);
  const actions = t.actions.map((a) => ACTION_TEXT[a]).filter(Boolean);
  if (actions.length) lines.push(actions.join(" "));
  return lines.join("\n") + "\n\n";
}

/* --------------------------------- the events log --------------------------------- */

export async function logCoachEvent(route: string, outcome: string, detail?: string | null, ip?: string | null) {
  await db.insert(coachEvents).values({
    id: newId(),
    at: new Date(),
    route,
    outcome,
    detail: detail ? detail.slice(0, 200) : null,
    ip: ip ? ip.slice(0, 60) : null,
  });
}

export async function recentCoachEvents(limit = 40) {
  return db.select().from(coachEvents).orderBy(desc(coachEvents.at)).limit(limit);
}

/* ------------------------------ shared voice input ------------------------------ */

async function voiceInput(triage: TriageResult): Promise<CoachVoiceInput> {
  const p = await getProfile();
  const memory = await db.select().from(memoryFacts).orderBy(desc(memoryFacts.lastSeen)).limit(12);
  return {
    profile: { name: p.name, diabetesType: p.diabetesType, style: p.copilotStyle, pregnant: p.pregnant, usesInsulin: usesInsulin(p) },
    goals: p.goals,
    memory,
    triage,
  };
}

/* ---------------------------------- the morning ---------------------------------- */

/** Consecutive days ending on `lastDay` that have at least one logged row of any kind. */
function streakEndingOn(daysWithAnything: Set<string>, lastDay: Date): number {
  let n = 0;
  for (let i = 0; i < 60; i++) {
    if (!daysWithAnything.has(dateKey(addDays(lastDay, -i)))) break;
    n++;
  }
  return n;
}

export async function buildMorningFacts(now = new Date()): Promise<CoachDayFacts> {
  const p = await getProfile();
  const yStart = startOfDay(addDays(now, -1));
  const yEnd = startOfDay(now);

  // 14 days is what the pattern engine wants, and it covers the streak walk-back too.
  const snap = await loadSnapshot(14, now, p);
  const patterns = detectPatterns({ ...snap, windowDays: 14 }).patterns;

  const readings = between(snap.readings, yStart, yEnd);
  const mealRows = between(snap.meals, yStart, yEnd);
  const exercise = between(snap.exercise, yStart, yEnd);
  const hydration = between(snap.hydration, yStart, yEnd);
  const insulin = between(snap.insulin, yStart, yEnd);

  const sleepYesterday = snap.sleep.find((s) => s.wakeDate === dateKey(yStart)) ?? null;
  const sleepLastNight = snap.sleep.find((s) => s.wakeDate === dateKey(now)) ?? null;

  const [checkinRows, apptRows] = await Promise.all([
    db.select().from(wellbeingCheckins).where(eq(wellbeingCheckins.date, dateKey(yStart))).limit(1),
    db.select().from(appointments).where(gte(appointments.at, startOfDay(now))).orderBy(asc(appointments.at)).limit(1),
  ]);

  // Days with any activity at all, for the streak. Deliberately generous: a logged glass of water
  // counts, because the streak is about turning up, not about completeness.
  const daysWithAnything = new Set<string>();
  for (const r of snap.readings) daysWithAnything.add(dateKey(r.at));
  for (const m of snap.meals) daysWithAnything.add(dateKey(m.at));
  for (const e of snap.exercise) daysWithAnything.add(dateKey(e.at));
  for (const h of snap.hydration) daysWithAnything.add(dateKey(h.at));
  for (const d of snap.insulin) daysWithAnything.add(dateKey(d.at));
  for (const s of snap.sleep) daysWithAnything.add(s.wakeDate);

  const sevenAgo = addDays(startOfDay(now), -7);
  const daysLoggedLast7 = new Set(between(snap.readings, sevenAgo, yEnd).map((r) => dateKey(r.at))).size;

  return coachDayFacts({
    now,
    yesterday: yStart,
    name: p.name,
    units: p.units,
    targetLow: p.targetLowMgdl,
    targetHigh: p.targetHighMgdl,
    readings,
    meals: mealRows.map((m) => ({ at: m.at, carbsG: m.carbsG })),
    exercise: exercise.map((e) => ({ minutes: e.minutes })),
    sleep: sleepYesterday ? { minutes: sleepYesterday.minutes, quality: sleepYesterday.quality } : null,
    lastNightSleep: sleepLastNight ? { minutes: sleepLastNight.minutes, quality: sleepLastNight.quality } : null,
    checkin: checkinRows[0] ? { feeling: checkinRows[0].feeling, unusual: checkinRows[0].unusual } : null,
    hydrationMl: hydration.reduce((a, h) => a + h.ml, 0),
    hydrationGoalMl: p.hydrationGoalMl,
    usesInsulin: usesInsulin(p),
    insulinEntries: insulin.length,
    streakDays: streakEndingOn(daysWithAnything, yStart),
    daysLoggedLast7,
    patterns,
    goals: p.goals,
    nextAppointment: apptRows[0] ? { at: apptRows[0].at, withWhom: apptRows[0].withWhom } : null,
    quest: await morningQuest(now, p),
  });
}

/**
 * The game's half of the morning brief.
 *
 * READ ONLY. It does not grant an award, write a quest row or touch the ledger, and that is the
 * point: the morning brief is generated by a cron from outside this machine, and a background job
 * that silently advanced somebody's progress while they were asleep would make the ledger say
 * things they did not do.
 *
 * Returns null rather than throwing if anything about the game is unavailable. A morning message
 * is a health check-in first; it must not fail because a decorative layer did.
 */
async function morningQuest(now: Date, p: Awaited<ReturnType<typeof getProfile>>) {
  try {
    const player = await getPlayer(now);
    const [state, input] = await Promise.all([journeyState(player.worldTheme), loadJourneyInput(now, p)]);
    const rolls = rollDays(input);
    const today = rolls[rolls.length - 1];
    const q = todaysQuest(today, p.hydrationGoalMl);
    if (q.xp <= 0) return null; // nothing left to ask for today, so the brief does not ask
    return {
      region: state.level.region.name,
      level: state.level.level,
      guardian: guardianFor(state.level.level).name,
      title: q.title,
      ask: q.ask,
    };
  } catch {
    return null;
  }
}

/* ----------------------------------- the week ----------------------------------- */

export async function buildWeekFacts(now = new Date()): Promise<CoachWeekFacts> {
  const p = await getProfile();
  const weekStart = startOfWeek(now);
  const weekEndExclusive = addDays(weekStart, 7);
  const weekEndShown = addDays(weekStart, 6);

  const input = await loadReviewInput(now, weekStart);
  const review = weeklyReview(input);
  const snap = await loadSnapshot(21, now, p);

  const readings = between(snap.readings, weekStart, weekEndExclusive);
  const exercise = between(snap.exercise, weekStart, weekEndExclusive);
  const mealRows = between(snap.meals, weekStart, weekEndExclusive);
  const hydration = between(snap.hydration, weekStart, weekEndExclusive);
  const insulin = between(snap.insulin, weekStart, weekEndExclusive);

  const [checkins, questions, apptRows] = await Promise.all([
    db
      .select()
      .from(wellbeingCheckins)
      .where(and(gte(wellbeingCheckins.date, dateKey(weekStart)), lt(wellbeingCheckins.date, dateKey(weekEndExclusive)))),
    db
      .select()
      .from(doctorQuestions)
      .where(and(eq(doctorQuestions.asked, false), gte(doctorQuestions.createdAt, weekStart)))
      .orderBy(desc(doctorQuestions.createdAt))
      .limit(10),
    db.select().from(appointments).where(gte(appointments.at, startOfDay(now))).orderBy(asc(appointments.at)).limit(1),
  ]);

  const activeDays = new Set<string>();
  for (const r of readings) activeDays.add(dateKey(r.at));
  for (const m of mealRows) activeDays.add(dateKey(m.at));
  for (const e of exercise) activeDays.add(dateKey(e.at));
  for (const h of hydration) activeDays.add(dateKey(h.at));
  for (const d of insulin) activeDays.add(dateKey(d.at));
  for (const c of checkins) activeDays.add(c.date);
  const sleepNights = snap.sleep.filter((s) => s.wakeDate >= dateKey(weekStart) && s.wakeDate < dateKey(weekEndExclusive));
  for (const s of sleepNights) activeDays.add(s.wakeDate);

  return coachWeekFacts({
    weekStart,
    weekEnd: weekEndShown,
    name: p.name,
    units: p.units,
    checkinDays: checkins.length,
    activeDays: activeDays.size,
    mealsLogged: mealRows.length,
    activityDays: new Set(exercise.map((e) => dateKey(e.at))).size,
    activityMinutes: exercise.reduce((a, e) => a + e.minutes, 0),
    readings: readings.length,
    daysWithReadings: new Set(readings.map((r) => dateKey(r.at))).size,
    sleepNights: sleepNights.length,
    questionsForTeam: questions.map((q) => q.text),
    wins: review.wins,
    toDiscuss: review.toDiscuss,
    sampleNote: review.sampleNote,
    nextAppointment: apptRows[0] ? { at: apptRows[0].at, withWhom: apptRows[0].withWhom } : null,
  });
}

/* ------------------------------ generate and persist ------------------------------ */

export type CoachGenerateResult = { message: CoachMessage; alreadyExisted: boolean; triage: TriageResult };

async function generate(kind: CoachKind, now: Date): Promise<CoachGenerateResult> {
  const date = kind === "morning" ? dateKey(now) : dateKey(startOfWeek(now));

  // Idempotence first: if today's message exists, hand it back rather than spending a model call.
  const existing = await db
    .select()
    .from(coachMessages)
    .where(and(eq(coachMessages.kind, kind), eq(coachMessages.date, date)))
    .limit(1);
  if (existing[0]) {
    return { message: existing[0], alreadyExisted: true, triage: await loadTriage({ now }) };
  }

  // The safety engine runs on the data alone. No words from the person at 8am, but a very low
  // reading overnight still has to lead the message.
  const t = await loadTriage({ now });
  const v = await voiceInput(t);

  let facts: CoachDayFacts | CoachWeekFacts;
  let voiced: Awaited<ReturnType<typeof coachMorningVoice>>;
  if (kind === "morning") {
    const f = await buildMorningFacts(now);
    facts = f;
    voiced = await coachMorningVoice(f, v);
  } else {
    const f = await buildWeekFacts(now);
    facts = f;
    voiced = await coachWeeklyVoice(f, v);
  }

  const body = safetyBanner(t) + voiced.text;
  const row = {
    id: newId(),
    kind,
    date,
    body,
    facts: JSON.stringify(facts),
    triageLevel: t.level,
    responder: voiced.responder,
    model: voiced.model,
    filtered: voiced.filtered,
    conversationId: null as string | null,
    createdAt: now,
    deliveredAt: null,
    channel: null,
    readAt: null,
  };

  // The unique index is the real defence. If two requests raced, the loser reads the winner's row.
  const inserted = await db.insert(coachMessages).values(row).onConflictDoNothing();
  if (!(inserted as { rowsAffected?: number }).rowsAffected) {
    const winner = await db
      .select()
      .from(coachMessages)
      .where(and(eq(coachMessages.kind, kind), eq(coachMessages.date, date)))
      .limit(1);
    if (winner[0]) return { message: winner[0], alreadyExisted: true, triage: t };
  }

  // A scheduled check-in is an audited AI response like any other. It used to write nothing, which
  // made invariant 8 false for two of the three model paths in this codebase.
  await recordAiUse({
    feature: "coach",
    mode: "checkin",
    userQuestion: `scheduled ${kind} check-in`,
    dataAccessed:
      kind === "morning"
        ? ["glucose:yesterday", "meals:yesterday", "insulin:yesterday", "exercise:yesterday", "sleep:last-two-nights", "hydration:yesterday", "checkin:yesterday", "patterns:14d", "appointments:next"]
        : ["glucose:last-week", "meals:last-week", "exercise:last-week", "sleep:last-week", "review:last-week", "questions:open", "appointments:next"],
    safetyRules: t.rules.filter((r) => r.fired).map((r) => r.id),
    triageLevel: t.level,
    responder: voiced.responder,
    model: voiced.model,
    filtered: voiced.filtered,
    messageId: row.id,
  });

  return { message: row as CoachMessage, alreadyExisted: false, triage: t };
}

export async function getOrCreateMorning(now = new Date()): Promise<CoachGenerateResult> {
  return generate("morning", now);
}

export async function getOrCreateWeekly(now = new Date()): Promise<CoachGenerateResult> {
  return generate("weekly", now);
}

export async function markDelivered(id: string, channel: CoachChannel) {
  await db.update(coachMessages).set({ deliveredAt: new Date(), channel }).where(eq(coachMessages.id, id));
}

export async function markCoachRead(id: string) {
  await db.update(coachMessages).set({ readAt: new Date() }).where(eq(coachMessages.id, id));
}

export async function recentCoachMessages(limit = 20) {
  return db.select().from(coachMessages).orderBy(desc(coachMessages.createdAt)).limit(limit);
}

/* ------------------------------- replies and buttons ------------------------------- */

const THREAD_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Which conversation a reply continues. n8n is stateless between executions, so Steady decides:
 * the most recent coach conversation touched in the last 12 hours, otherwise a new one. This is
 * why the transport never has to remember a conversation id.
 */
async function threadFor(now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - THREAD_WINDOW_MS);
  const recent = await db
    .select({ id: coachMessages.conversationId, createdAt: coachMessages.createdAt })
    .from(coachMessages)
    .where(gte(coachMessages.createdAt, since))
    .orderBy(desc(coachMessages.createdAt))
    .limit(5);
  for (const r of recent) {
    if (!r.id) continue;
    const rows = await db.select({ id: conversations.id, updatedAt: conversations.updatedAt }).from(conversations).where(eq(conversations.id, r.id)).limit(1);
    if (rows[0] && rows[0].updatedAt.getTime() >= since.getTime()) return rows[0].id;
  }
  return null;
}

export type CoachReply = {
  text: string;
  triageLevel: TriageResult["level"];
  safety: { level: string; headline: string; body: string } | null;
  conversationId: string;
  responder: "model" | "engine";
  followUps: string[];
};

/**
 * A free-text reply from the transport. This goes through the same turn a tap in the app goes
 * through: triage, engine context, the model or the engine, the dose filter, an audit row.
 */
export async function coachTextReply(text: string, now = new Date(), conversationIdIn?: string | null): Promise<CoachReply> {
  const conversationId = conversationIdIn ?? (await threadFor(now));
  const turn = await runCopilotTurn({ body: text, mode: "talk", conversationId, origin: "coach" });

  // Attach the thread to today's morning message, so the next reply lands in the same place.
  const today = await db
    .select()
    .from(coachMessages)
    .where(and(eq(coachMessages.kind, "morning"), eq(coachMessages.date, dateKey(now))))
    .limit(1);
  if (today[0] && !today[0].conversationId) {
    await db.update(coachMessages).set({ conversationId: turn.conversationId }).where(eq(coachMessages.id, today[0].id));
  }

  const banner = safetyBanner(turn.triage);
  return {
    text: banner + turn.reply,
    triageLevel: turn.triage.level,
    safety:
      turn.triage.level === "general"
        ? null
        : { level: turn.triage.level, headline: turn.triage.headline, body: turn.triage.body },
    conversationId: turn.conversationId,
    responder: turn.result.responder,
    followUps: turn.result.followUps,
  };
}

/** "See my day". Engine only, on purpose: a number should be readable without anything narrating it. */
export async function coachTodaySummary(now = new Date()) {
  const p = await getProfile();
  const snap = await loadSnapshot(1, now, p);
  const from = startOfDay(now);
  const to = endOfDay(now);
  const readings = between(snap.readings, from, to);
  const todayMeals = between(snap.meals, from, to);
  const exercise = between(snap.exercise, from, to);
  const hydration = between(snap.hydration, from, to);
  const insulin = between(snap.insulin, from, to);

  return engineToday({
    units: p.units,
    targetLow: p.targetLowMgdl,
    targetHigh: p.targetHighMgdl,
    readings,
    meals: todayMeals.map((m) => ({ carbsG: m.carbsG })),
    exerciseMinutes: exercise.reduce((a, e) => a + e.minutes, 0),
    hydrationMl: hydration.reduce((a, h) => a + h.ml, 0),
    hydrationGoalMl: p.hydrationGoalMl,
    insulinEntries: usesInsulin(p) ? insulin.length : null,
    lastReadingAt: readings.length ? readings[readings.length - 1].at : null,
    now,
  });
}

const OPENERS: Record<Exclude<CoachAction, "day" | "appointment_brief">, string> = {
  talk: "I want to talk something through this morning.",
  encourage: "I could use some encouragement today.",
};

/**
 * A tapped button. `day` and `appointment_brief` never reach a model; `talk` and `encourage` are
 * ordinary Copilot turns, which is how they inherit triage, the filter and the audit row.
 */
export async function coachButton(action: CoachAction, now = new Date()): Promise<CoachReply> {
  if (action === "day") {
    const { text } = await coachTodaySummary(now);
    return { text, triageLevel: "general", safety: null, conversationId: "", responder: "engine", followUps: [] };
  }
  if (action === "appointment_brief") {
    const text = await buildAppointmentBrief(now);
    return { text, triageLevel: "general", safety: null, conversationId: "", responder: "engine", followUps: [] };
  }
  return coachTextReply(OPENERS[action], now);
}

/* --------------------------------- for the screen --------------------------------- */

/** Whether the coach can actually be reached, for the in-app surface to report honestly. */
export function coachConfig() {
  return {
    // Per-account now, so this is answered by the caller that knows the account, not by an env var.
    apiSecretSet: true,
    telegramChatIdSet: Boolean(process.env.COACH_TELEGRAM_CHAT_ID),
    modelKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

export { engineMorning, engineWeekly };
