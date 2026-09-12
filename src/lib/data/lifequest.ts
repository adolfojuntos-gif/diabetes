import "server-only";
/**
 * LIFE QUEST's data layer: this week's quests, the Explorer Journal, rest mode, and the one call
 * the screen makes to assemble the whole game.
 *
 * The bridge between health data and game data runs one way and only through here. Nothing in
 * `src/lib/engines/journey.ts` or `lifequest.ts` can read the database, and nothing in the game
 * tables can write a glucose reading, a meal or a dose. A health event becomes a game event by
 * passing through `grantAwards`, and there is no other route.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  journeyQuests,
  journeyAwards,
  discoveries,
  playerState,
  type JourneyQuest,
  type Discovery,
  type Profile,
} from "../db";
import { newId } from "../ids";
import { weekKey, dateKey } from "../time";
import { getProfile } from "./snapshot";
import { grantAwards, journeyState, unseenAwards, type JourneyState } from "./journey";
import { rollDays, type DayRoll, type JourneyReport } from "../engines/journey";
import { provenance, HABIT_RULES } from "../engines/rules";
import { archetypeOf, leadFirst, type Archetype, type ArchetypeKey } from "../game/archetypes";
import { narrateAward, engineCelebration, type Narration } from "../ai/gamemaster";
import { tickAndRecord, unseenEvents, extras as worldExtrasFor, newsLine } from "./world";
import { worldState } from "../engines/journey";
import type { WorldEvent } from "../db";
import {
  weeklyAdventure,
  NOVELTY_WEEKS,
  autoQuestDone,
  todaysQuest,
  thisWeek,
  standing,
  beginAgainAward,
  guardianFor,
  guardianLine,
  dimensionScores,
  achievementFor,
  type Adventure,
  type DimensionScore,
  type Guardian,
  type Standing,
} from "../engines/lifequest";
import { loadJourneyInput } from "./journey";

/* ------------------------------ player state ------------------------------ */

export async function getPlayer(now = new Date()) {
  const rows = await db.select().from(playerState).where(eq(playerState.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(playerState).values({ id: 1, createdAt: now, updatedAt: now }).onConflictDoNothing();
  return (await db.select().from(playerState).where(eq(playerState.id, 1)).limit(1))[0];
}

export function isResting(p: { restUntil: Date | null }, now = new Date()): boolean {
  return Boolean(p.restUntil && p.restUntil.getTime() > now.getTime());
}

/**
 * Rest Mode. The world goes quiet for a stretch the person chooses: no quests, no asks, nothing
 * counting down. It costs nothing and it is not a pause on their progress, because there is nothing
 * to pause. Everything already earned stays earned whether they rest for a day or a month.
 */
export async function startRest(days: number, now = new Date()): Promise<void> {
  const until = new Date(now.getTime() + Math.max(1, Math.min(30, days)) * 86_400_000);
  await getPlayer(now);
  await db.update(playerState).set({ restUntil: until, updatedAt: now }).where(eq(playerState.id, 1));
}

/**
 * Change which world the drawing shows. Nothing in the ledger is touched, because nothing in the
 * ledger knows what a theme is.
 */
/**
 * Choose, or change, who they are here. Free and reversible: what somebody wants out of this in
 * March is not what they wanted in January, and nothing about the ledger depends on the answer.
 */
export async function setArchetype(key: ArchetypeKey, now = new Date()): Promise<void> {
  await getPlayer(now);
  await db.update(playerState).set({ archetype: key, updatedAt: now }).where(eq(playerState.id, 1));
}

export async function setWorldTheme(theme: "forest" | "coast" | "city", now = new Date()): Promise<void> {
  await getPlayer(now);
  await db.update(playerState).set({ worldTheme: theme, updatedAt: now }).where(eq(playerState.id, 1));
}

export async function endRest(now = new Date()): Promise<void> {
  await getPlayer(now);
  await db.update(playerState).set({ restUntil: null, updatedAt: now }).where(eq(playerState.id, 1));
}

/**
 * Record that the ceremony for a region has been shown, so it is a moment and not a loop.
 *
 * Always clamped UP and never down: a person who somehow arrives with a higher seen level than
 * their current one has seen more, not less, and re-showing an old ceremony because a column
 * went backwards would be worse than showing none.
 */
export async function markRegionSeen(level: number, now = new Date()): Promise<void> {
  const p = await getPlayer(now);
  const seen = Math.max(p.regionSeenLevel, level);
  await db.update(playerState).set({ regionSeenLevel: seen, updatedAt: now }).where(eq(playerState.id, 1));
}

/** Record that today's morning greeting has been shown. */
export async function markMorningSeen(date: string, now = new Date()): Promise<void> {
  await getPlayer(now);
  await db.update(playerState).set({ morningSeenDate: date, updatedAt: now }).where(eq(playerState.id, 1));
}

async function touchVisit(now = new Date()): Promise<void> {
  await db.update(playerState).set({ lastVisitAt: now, updatedAt: now }).where(eq(playerState.id, 1));
}

/* --------------------------------- quests --------------------------------- */

/**
 * Provenance for the awards this file writes itself.
 *
 * A quest, a discovery and a return are all single events the person performed on a known day, so
 * the window is that day, the sample is one, and the quality is high: nothing was inferred. They
 * still carry the version stamps, because the question of which rules were in force has to be
 * answerable for every row in the ledger and not only for the interesting ones.
 */
function prov(sampleSize: number, at: Date) {
  const p = provenance({ sampleSize, windowFrom: at, windowTo: at, dataQuality: "high" });
  return {
    engineVersion: p.engineVersion,
    ruleVersion: p.ruleVersion,
    metricVersion: p.metricVersion,
    sampleSize: p.sampleSize,
    windowFrom: p.windowFrom,
    windowTo: p.windowTo,
    compareFrom: p.compareFrom,
    compareTo: p.compareTo,
    dataQuality: p.dataQuality,
  };
}

/**
 * Make sure this week's three quests exist, then mark any that the logs now satisfy.
 *
 * Quests are written once and never rewritten. If a template's wording changes in a deploy, the
 * person keeps the quest they were given on Monday, because a quest that silently becomes a
 * different quest halfway through the week is the same as no quest at all.
 */
export async function syncQuests(rolls: DayRoll[], now = new Date()): Promise<{ adventure: Adventure; rows: JourneyQuest[] }> {
  const week = thisWeek(rolls, now);
  const wk = weekKey(now);
  /*
   * What was offered recently, so the picker can avoid repeating it. Read from the quest rows
   * themselves rather than kept as a separate list: the rows ARE the history, and a second copy
   * of the same fact is a second thing that can be wrong.
   */
  const recentRows = await db
    .select({ code: journeyQuests.code, weekKey: journeyQuests.weekKey })
    .from(journeyQuests)
    .orderBy(desc(journeyQuests.weekKey))
    .limit(NOVELTY_WEEKS * 4);
  const recentWeeks = [...new Set(recentRows.map((r) => r.weekKey))].filter((w) => w !== wk).slice(0, NOVELTY_WEEKS);
  const recent = recentRows.filter((r) => recentWeeks.includes(r.weekKey)).map((r) => r.code);

  const player = await getPlayer(now);
  const chosen = player.archetype ? archetypeOf(player.archetype) : null;
  const adventure = weeklyAdventure(now, week, recent, chosen?.favours ?? []);

  /*
   * A WEEK IS WRITTEN ONCE AND THEN LEFT ALONE, and the check is on the WEEK rather than on each
   * key, which is the part the first version got wrong.
   *
   * Inserting by key is idempotent for identical picks and useless for different ones: the moment
   * anything upstream changes what is chosen, a mid-week visit adds a second set of quests beside
   * the first. Somebody on Wednesday was shown five quests under a heading that said three, which
   * is what rendering the page rather than reading the code caught.
   *
   * Changing archetype, tuning the picker, adding a template: none of them may reach into a week
   * already underway. The quest somebody was given on Monday is the quest they finish on Sunday.
   */
  const already = await db.select({ id: journeyQuests.id }).from(journeyQuests).where(eq(journeyQuests.weekKey, wk)).limit(1);
  const weekIsOpen = already.length === 0;

  for (const q of weekIsOpen ? adventure.quests : []) {
    await db
      .insert(journeyQuests)
      .values({
        id: newId(),
        key: q.key,
        weekKey: wk,
        code: q.code,
        slot: q.slot,
        adventure: adventure.name,
        title: q.title,
        ask: q.ask,
        why: q.why,
        xp: q.xp,
        kind: q.kind,
        dimension: q.dimension,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  const rows = await db.select().from(journeyQuests).where(eq(journeyQuests.weekKey, wk)).orderBy(asc(journeyQuests.slot));

  for (const row of rows) {
    if (row.completedAt || row.kind !== "auto") continue;
    if (!autoQuestDone(row.code, week)) continue;
    await db.update(journeyQuests).set({ completedAt: now, verifiedBy: "engine" }).where(eq(journeyQuests.id, row.id));
    await awardForQuest(row, now);
    row.completedAt = now;
    row.verifiedBy = "engine";
  }
  return { adventure, rows };
}

/** A completed quest becomes a ledger row like anything else, so the XP has one home. */
async function awardForQuest(q: JourneyQuest, now: Date): Promise<void> {
  await db
    .insert(journeyAwards)
    .values({
      id: newId(),
      key: `quest:${q.key}`,
      code: q.code,
      kind: "habit",
      title: q.title,
      body: q.ask,
      evidence: `quest completed, week of ${q.weekKey}${q.verifiedBy === "person" ? ", marked done by you" : ", confirmed from your logs"}`,
      xp: q.xp,
      gems: 0,
      earnedAt: now,
      createdAt: now,
      seenAt: null,
      ...prov(1, now),
    })
    .onConflictDoNothing();
}

/** Mark a manual quest done. Only manual quests: an auto quest is decided by the logs, not a tap. */
export async function completeQuest(key: string, now = new Date()): Promise<boolean> {
  const rows = await db.select().from(journeyQuests).where(eq(journeyQuests.key, key)).limit(1);
  const q = rows[0];
  if (!q || q.completedAt || q.kind !== "manual") return false;
  await db.update(journeyQuests).set({ completedAt: now, verifiedBy: "person" }).where(eq(journeyQuests.id, q.id));
  await awardForQuest({ ...q, verifiedBy: "person" }, now);
  return true;
}

/* ----------------------------- explorer journal ---------------------------- */

export async function addDiscovery(name: string, note: string, place: string, now = new Date()): Promise<string> {
  const id = newId();
  await db.insert(discoveries).values({ id, at: now, name, note, place, createdAt: now });
  await db
    .insert(journeyAwards)
    .values({
      id: newId(),
      key: `discovery:${id}`,
      code: "discovery",
      kind: "habit",
      title: "A new entry in your Explorer Journal",
      body: `You found ${name} and wrote it down.`,
      evidence: `discovery recorded${place ? ` at ${place}` : ""}`,
      xp: HABIT_RULES.discovery,
      gems: 0,
      earnedAt: now,
      createdAt: now,
      seenAt: null,
      ...prov(1, now),
    })
    .onConflictDoNothing();
  return id;
}

export async function journal(limit = 40): Promise<Discovery[]> {
  return db.select().from(discoveries).orderBy(desc(discoveries.at)).limit(limit);
}

export async function discoveryCount(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(discoveries);
  return Number(rows[0]?.n ?? 0);
}

/* --------------------------------- the hub --------------------------------- */

export type LifeQuest = {
  profile: Profile;
  state: JourneyState;
  report: JourneyReport;
  rolls: DayRoll[];
  today: DayRoll;
  adventure: Adventure;
  quests: JourneyQuest[];
  guardian: Guardian;
  guardianLine: string;
  standing: Standing;
  resting: boolean;
  restUntil: Date | null;
  dimensions: DimensionScore[];
  /**
   * A region reached whose ceremony has not been shown yet, or null. The screen decides whether
   * to interrupt with it; this only says that one is owed.
   */
  unlocked: { level: number; name: string; blurb: string } | null;
  /** True on the first visit of a morning, before noon. The greeting beat. */
  morning: boolean;
  todayQuest: ReturnType<typeof todaysQuest>;
  fresh: { title: string; body: string; evidence: string; xp: number; gems: number; achievement: { title: string; line: string } | null }[];
  /** The guardian's line about what just landed. Written by the engine, warmed by the model. */
  celebration: Narration | null;
  discoveries: number;
  /** What has changed in the world since they last looked, newest first. */
  news: WorldEvent[];
  /** One line summarising that, or null when there is honestly nothing to say. */
  newsLine: string | null;
  /** Who they chose to be here, or null if they have not been asked yet. */
  archetype: Archetype | null;
};

/**
 * Everything the game screen needs, in one call.
 *
 * Order matters here and it is not arbitrary. Awards are granted BEFORE state is read, so the level
 * on screen already includes what was just earned, and the "here is what landed" list is read after
 * that so it cannot show an award the totals do not yet include.
 */
export async function loadLifeQuest(now = new Date()): Promise<LifeQuest> {
  const profile = await getProfile();
  const player = await getPlayer(now);

  const { report } = await grantAwards(now, profile);
  const input = await loadJourneyInput(now, profile);
  const rolls = rollDays(input);

  // Coming back after time away is itself worth something, and it is granted here rather than in
  // the journey engine because "away" is a property of the person, not of the data.
  const back = beginAgainAward(rolls);
  if (back) {
    await db
      .insert(journeyAwards)
      .values({
        id: newId(),
        key: back.key,
        code: back.code,
        kind: "milestone",
        title: "Begin Again",
        body: "You came back. That is the hardest single thing anybody does in an app like this, and it is worth more than a perfect week.",
        evidence: "returned after time away",
        xp: back.xp,
        gems: 1,
        earnedAt: now,
        createdAt: now,
        seenAt: null,
        ...prov(1, now),
      })
      .onConflictDoNothing();
  }

  /*
   * THE WORLD TICKS BEFORE ANYTHING IS READ.
   *
   * Same discipline as the award ledger: whatever happened today is written first, so the drawing
   * below already includes it and What's New cannot announce an event the picture does not yet
   * reflect.
   *
   * It runs even in Rest Mode. Rest silences what the app ASKS of somebody; it does not stop the
   * world existing, and a person coming back from a quiet fortnight should find that things
   * carried on without them. That is the entire point of the growth event.
   */
  const levelNow = (await journeyState(player.worldTheme)).level.level;
  await tickAndRecord({ now, level: levelNow, rolls, away: standing(rolls).away, theme: player.worldTheme });

  const resting = isResting(player, now);
  const { adventure, rows } = resting
    ? { adventure: weeklyAdventure(now, thisWeek(rolls, now)), rows: [] as JourneyQuest[] }
    : await syncQuests(rolls, now);

  const [state, fresh, awardCodes, discovered, wExtras, news, line] = await Promise.all([
    journeyState(player.worldTheme),
    unseenAwards(8),
    db.select({ code: journeyAwards.code, xp: journeyAwards.xp }).from(journeyAwards),
    discoveryCount(),
    worldExtrasFor(now),
    unseenEvents(8),
    newsLine(),
  ]);

  // The drawing is rebuilt from the world's own history, not from the level alone.
  state.world = worldState(state.level.level, state.gems, wExtras);

  await touchVisit(now);

  /*
   * The celebration is generated LAST, from awards that are already written and already counted.
   * Nothing downstream of this line can change a total, so a model that misbehaves costs a nice
   * sentence and nothing else. When there is no API key the engine's own sentence is used and the
   * screen is complete without it.
   */
  const guardian = guardianFor(state.level.level);
  const earned = fresh.map((a) => ({ title: a.title, evidence: a.evidence, xp: a.xp, gems: a.gems }));
  const celebration = earned.length
    ? await narrateAward({
        guardian: { name: guardian.name, animal: guardian.animal, voice: guardian.voice },
        region: state.level.region.name,
        level: state.level.level,
        earned,
        fallback: engineCelebration(guardian, state.level.region.name, earned),
        playerName: profile.name,
      })
    : null;

  const today = rolls[rolls.length - 1];
  return {
    profile,
    state,
    report,
    rolls,
    today,
    adventure,
    quests: rows,
    guardian,
    guardianLine: guardianLine(guardian, today.date),
    standing: standing(rolls),
    resting,
    restUntil: player.restUntil,
    // Their own identity reads first. The scores are untouched; only the order changes.
    dimensions: leadFirst(dimensionScores(awardCodes), player.archetype ? archetypeOf(player.archetype) : null),
    /*
     * Only the region they are standing in now, never the ones passed on the way. Somebody whose
     * three months of history was backfilled jumps from nothing to level 7 in one write, and
     * seven ceremonies in a row is not seven moments, it is a queue.
     */
    unlocked: state.level.level > player.regionSeenLevel ? state.level.region : null,
    morning: now.getHours() < 12 && player.morningSeenDate !== dateKey(now),
    todayQuest: todaysQuest(today, profile.hydrationGoalMl),
    fresh: fresh.map((a) => ({
      title: a.title,
      body: a.body,
      evidence: a.evidence,
      xp: a.xp,
      gems: a.gems,
      achievement: achievementFor(a.code),
    })),
    discoveries: discovered,
    celebration,
    news,
    newsLine: line,
    archetype: player.archetype ? archetypeOf(player.archetype) : null,
  };
}

/** How many things are waiting to be celebrated, for the badge in the nav. */
export async function pendingCount(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(journeyAwards).where(isNull(journeyAwards.seenAt));
  const q = await db
    .select({ n: sql<number>`count(*)` })
    .from(journeyQuests)
    .where(and(eq(journeyQuests.weekKey, weekKey(new Date())), isNull(journeyQuests.completedAt)));
  return Number(rows[0]?.n ?? 0) + Number(q[0]?.n ?? 0);
}
