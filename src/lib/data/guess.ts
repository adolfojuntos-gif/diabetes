import "server-only";
/**
 * Guess the Carbs: serving a round, recording an answer, paying for the play.
 *
 * THE ANSWER NEVER REACHES A BROWSER BEFORE THE GUESS IS IN. `roundFor` returns the food, the
 * portion and the weight; the reference carbohydrate stays on the server. The form posts back the
 * round key and a number, and `answer` recomputes the reference from the database rather than
 * trusting anything that came from the page. A client that never receives the answer cannot leak
 * it, and a server that never trusts the client cannot be handed a forged one.
 */
import { asc, desc, eq, gte, sql } from "drizzle-orm";
import { db, carbGuesses, foods, foodPortions, journeyAwards, type CarbGuess } from "../db";
import { newId } from "../ids";
import { dateKey, startOfDay } from "../time";
import { provenance } from "../engines/rules";
import {
  pickRound,
  reveal,
  bandFor,
  referenceNote,
  GUESS_XP,
  DAILY_ROUNDS,
  GUESS_ENGINE_VERSION,
  type Round,
  type Reveal,
} from "../engines/guess";

/** What the page may safely render before a guess: everything except the answer. */
export type ServedRound = {
  roundKey: string;
  foodName: string;
  brand: string | null;
  portionLabel: string;
  grams: number;
  source: string;
  note: string;
  /** Which of the day's paying rounds this is, and how many there are. */
  index: number;
  ofPaying: number;
  /** False once the day's paying rounds are used up. Play continues; the paying stops. */
  paying: boolean;
};

async function playedToday(now: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(carbGuesses)
    .where(gte(carbGuesses.at, startOfDay(now)));
  return Number(rows[0]?.n ?? 0);
}

/** The full round, answer included. Server side only; never returned to a page before a guess. */
async function buildRound(roundKey: string): Promise<Round | null> {
  const [foodRows, portionRows] = await Promise.all([
    db
      .select({
        id: foods.id,
        name: foods.name,
        brand: foods.brand,
        carbsG: foods.carbsG,
        proteinG: foods.proteinG,
        fatG: foods.fatG,
        fiberG: foods.fiberG,
        caloriesKcal: foods.caloriesKcal,
        source: foods.source,
        sourceDate: foods.sourceDate,
      })
      .from(foods)
      .orderBy(asc(foods.id)),
    db.select({ id: foodPortions.id, foodId: foodPortions.foodId, label: foodPortions.label, grams: foodPortions.grams }).from(foodPortions),
  ]);
  return pickRound(foodRows, portionRows, roundKey);
}

/**
 * The next round to show.
 *
 * The round number is how many have been answered today, so a refresh returns the same question and
 * answering moves on. Beyond the paying cap it keeps serving rounds and stops paying for them,
 * which is the right way round: the cap exists to stop a quiz out-earning a day of actually
 * logging, not to stop somebody who is enjoying it.
 */
export async function nextRound(now = new Date()): Promise<ServedRound | null> {
  const played = await playedToday(now);
  const roundKey = `${dateKey(now)}:${played}`;
  const round = await buildRound(roundKey);
  if (!round) return null;
  return {
    roundKey,
    foodName: round.food.name,
    brand: round.food.brand,
    portionLabel: round.portion.label,
    grams: round.portion.grams,
    source: round.food.source,
    note: referenceNote(round.food),
    index: played + 1,
    ofPaying: DAILY_ROUNDS,
    paying: played < DAILY_ROUNDS,
  };
}

export type AnsweredRound = Reveal & {
  foodName: string;
  portionLabel: string;
  grams: number;
  note: string;
  /** False when the day's paying rounds were already used. The round still counts and still stands. */
  paid: boolean;
};

/**
 * Record a guess and reveal.
 *
 * Idempotent on the round key: a double submit or a refreshed POST answers once. The reference is
 * recomputed here from the database, so the number a person is shown cannot be influenced by
 * anything the browser sent.
 */
export async function answer(roundKey: string, guessG: number, now = new Date()): Promise<AnsweredRound | null> {
  const existing = await db.select().from(carbGuesses).where(eq(carbGuesses.roundKey, roundKey)).limit(1);
  if (existing[0]) return revealFromRow(existing[0]);

  const round = await buildRound(roundKey);
  if (!round) return null;

  const paying = (await playedToday(now)) < DAILY_ROUNDS;
  const out = reveal(guessG, round);

  await db
    .insert(carbGuesses)
    .values({
      id: newId(),
      at: now,
      roundKey,
      foodId: round.food.id,
      foodName: round.food.name,
      portionLabel: round.portion.label,
      grams: round.portion.grams,
      referenceCarbsG: round.referenceCarbsG,
      guessG: out.guessG,
      source: round.food.source,
      engineVersion: GUESS_ENGINE_VERSION,
    })
    .onConflictDoNothing();

  /*
   * Paid for the PLAY. The award key is the round, so the amount cannot depend on the guess even by
   * accident, and answering the same round twice cannot pay twice.
   */
  if (paying) {
    const prov = provenance({ sampleSize: 1, windowFrom: now, windowTo: now, dataQuality: "high" });
    await db
      .insert(journeyAwards)
      .values({
        id: newId(),
        key: `guess:${roundKey}`,
        code: "guess",
        kind: "habit",
        title: "You had a go at guessing",
        body: "Getting a feel for what is in a portion is the part that stays with you. Being close is not the point.",
        evidence: `guessed ${out.guessG} g against a reference of ${out.referenceCarbsG} g for ${round.portion.label} of ${round.food.name}`,
        xp: GUESS_XP,
        gems: 0,
        earnedAt: now,
        createdAt: now,
        seenAt: null,
        engineVersion: prov.engineVersion,
        ruleVersion: prov.ruleVersion,
        metricVersion: prov.metricVersion,
        sampleSize: prov.sampleSize,
        windowFrom: prov.windowFrom,
        windowTo: prov.windowTo,
        compareFrom: prov.compareFrom,
        compareTo: prov.compareTo,
        dataQuality: prov.dataQuality,
      })
      .onConflictDoNothing();
  }

  return { ...out, foodName: round.food.name, portionLabel: round.portion.label, grams: round.portion.grams, note: referenceNote(round.food), paid: paying };
}

/**
 * Re-derive a reveal from a stored round, so a refreshed result page shows what it showed before.
 *
 * The band is recomputed by the engine rather than written out here. A second copy of that
 * arithmetic would drift the first time the variation figure was tuned, and the stored round would
 * quietly start reading differently from the one just played.
 */
function revealFromRow(row: CarbGuess): AnsweredRound {
  const r = reveal(row.guessG, { referenceCarbsG: row.referenceCarbsG, band: bandFor(row.referenceCarbsG) });
  return {
    ...r,
    foodName: row.foodName,
    portionLabel: row.portionLabel,
    grams: row.grams,
    note: referenceNote({ source: row.source, brand: null }),
    paid: true,
  };
}

/** Rounds played, newest first, for looking back at what you used to think. */
export async function history(limit = 30): Promise<CarbGuess[]> {
  return db.select().from(carbGuesses).orderBy(desc(carbGuesses.at)).limit(limit);
}

export async function playedCount(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(carbGuesses);
  return Number(rows[0]?.n ?? 0);
}

/** How many rounds have been answered today. Also what decides the next round's seed. */
export async function answeredToday(now = new Date()): Promise<number> {
  return playedToday(now);
}
