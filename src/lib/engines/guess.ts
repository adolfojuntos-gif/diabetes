/**
 * GUESS THE CARBS — building a feel for portions, without turning it into a test.
 *
 * Show a food and a portion, ask for an estimate, then show what the reference says. That is the
 * whole game. Everything interesting about it is in what it refuses to do.
 *
 * XP IS FOR PLAYING, NEVER FOR ACCURACY, and this is the design rather than a detail. A game that
 * paid more for a closer guess would be a skill score, and it would pay most to the people who
 * already know, which is backwards for something whose entire purpose is learning. It would also
 * quietly become one more number in a diabetes app that somebody can be bad at, and there are
 * enough of those. Play a round, earn the round.
 *
 * NOTHING IS EVER WRONG. There is no correct answer, no streak of rightness, no score to protect.
 * The feedback describes the distance and then says what the distance is worth knowing, and the
 * furthest-out case gets the warmest line, because that is the one that taught somebody something.
 *
 * THE REFERENCE COMES FROM THE FOOD TABLE. Every figure shown is USDA or a published label, scaled
 * to a real portion weight by `figuresFor`. Nothing here estimates, and nothing here may ever be
 * generated: a made-up carbohydrate figure in a diabetes app is the most dangerous thing this
 * codebase could contain.
 *
 * IT IS NOT A DOSING TOOL, and the screens say so. Somebody who counts carbohydrate for insulin
 * works from the reference, a label or their team, never from how well they did at a game.
 *
 * Pure functions. Deterministic selection, so a round cannot be rerolled by refreshing.
 */
import { figuresFor } from "./foods";

/** Bumped when selection, banding or the amounts change. */
export const GUESS_ENGINE_VERSION = "1.0.0";

/** Fixed, and the same whatever the guess. See the note at the top of this file. */
export const GUESS_XP = 25;

/**
 * Rounds that earn XP in a day.
 *
 * Somebody may play as many as they like: the cap is on the paying, not on the playing. Three is
 * enough to be worth opening and few enough that nobody can grind a level out of a quiz.
 */
export const DAILY_ROUNDS = 3;

/**
 * How much a real portion varies from the reference weight.
 *
 * This is NOT measurement error in the figures, which are good. It is the fact that one person's
 * "medium apple" or "cup of rice" is not another's, and the band exists so that somebody who was
 * essentially right is told so rather than being told they were fifteen per cent out.
 */
export const PORTION_VARIATION = 0.15;

export type GuessFood = {
  id: string;
  name: string;
  brand: string | null;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  source: string;
  sourceDate: string | null;
};

export type GuessPortion = { id: string; foodId: string; label: string; grams: number };

export type Round = {
  food: GuessFood;
  portion: GuessPortion;
  /** The answer. Computed here and never sent to a browser before a guess is in. */
  referenceCarbsG: number;
  band: { low: number; high: number };
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Stable hash, so a day's rounds are a property of the day and not of when the page was opened. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The band a guess counts as the same ballpark within. Always at least a gram wide either side. */
export function bandFor(referenceCarbsG: number): { low: number; high: number } {
  const spread = Math.max(1, referenceCarbsG * PORTION_VARIATION);
  return { low: r1(Math.max(0, referenceCarbsG - spread)), high: r1(referenceCarbsG + spread) };
}

/**
 * Is this food worth asking about?
 *
 * Zero-carbohydrate foods are excluded because "how much carbohydrate is in this chicken breast" has
 * one boring answer and teaches nothing about portions. Very small portions go too, since being four
 * grams out on a five gram answer is noise rather than a lesson.
 */
export function isAskable(food: GuessFood, portion: GuessPortion): boolean {
  if (!Number.isFinite(food.carbsG) || food.carbsG <= 2) return false;
  if (!Number.isFinite(portion.grams) || portion.grams <= 0) return false;
  return figuresFor(food, portion.grams).carbsG >= 5;
}

/**
 * Pick a round, deterministically.
 *
 * Seeded by the day and the round number, so refreshing shows the same question. A reroll on
 * refresh would let somebody skip past anything they did not fancy, and the point of the game is
 * the foods you are least sure about.
 */
export function pickRound(foods: GuessFood[], portions: GuessPortion[], seed: string): Round | null {
  const byFood = new Map<string, GuessPortion[]>();
  for (const p of portions) {
    const arr = byFood.get(p.foodId);
    if (arr) arr.push(p);
    else byFood.set(p.foodId, [p]);
  }

  // Every askable food-and-portion pair, in a stable order so the same seed always lands the same.
  const pairs: { food: GuessFood; portion: GuessPortion }[] = [];
  for (const food of [...foods].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const portion of (byFood.get(food.id) ?? []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (isAskable(food, portion)) pairs.push({ food, portion });
    }
  }
  if (pairs.length === 0) return null;

  const chosen = pairs[hash(seed) % pairs.length];
  const referenceCarbsG = figuresFor(chosen.food, chosen.portion.grams).carbsG;
  return { food: chosen.food, portion: chosen.portion, referenceCarbsG, band: bandFor(referenceCarbsG) };
}

/* --------------------------------- the reveal ------------------------------ */

export type Closeness = "same_ballpark" | "near" | "further";

export type Reveal = {
  guessG: number;
  referenceCarbsG: number;
  band: { low: number; high: number };
  differenceG: number;
  closeness: Closeness;
  /** What to say. Descriptive, never a verdict, and never the word wrong. */
  headline: string;
  line: string;
  /** Earned for playing, identical whatever the guess. */
  xp: number;
};

/**
 * What the guess turned out to be.
 *
 * Read the three headlines together and notice that none of them ranks the person: the furthest-out
 * case is framed as the most useful one, because a guess that was a long way off is the only kind
 * that can change what somebody expects next time. A quiz that congratulates accuracy teaches
 * people who already know that they already know.
 */
export function reveal(guessG: number, round: { referenceCarbsG: number; band: { low: number; high: number } }): Reveal {
  const guess = Math.max(0, Number.isFinite(guessG) ? guessG : 0);
  const ref = round.referenceCarbsG;
  const band = round.band;
  const difference = r1(Math.abs(guess - ref));
  const spread = Math.max(1, ref - band.low);

  let closeness: Closeness;
  let headline: string;
  let line: string;

  if (guess >= band.low && guess <= band.high) {
    closeness = "same_ballpark";
    headline = "Same ballpark";
    line = `Portions of this vary by about this much anyway, so your estimate and the reference are describing the same plate.`;
  } else if (difference <= spread * 2) {
    closeness = "near";
    headline = "Near it";
    line = `About ${difference} g between your estimate and the reference, which is close enough to be a useful starting point next time.`;
  } else {
    closeness = "further";
    headline = "Further out, and that is the useful kind";
    line = `About ${difference} g between them. This is the sort that actually shifts what you expect, which is the whole point of playing.`;
  }

  return { guessG: guess, referenceCarbsG: ref, band, differenceG: difference, closeness, headline, line, xp: GUESS_XP };
}

/** Where the figure came from, for the reveal. The person can always see what they are trusting. */
export function referenceNote(food: Pick<GuessFood, "source" | "brand">): string {
  if (food.source === "You") return "This is a food you added yourself, so the figure is the one you entered.";
  if (food.source === "Restaurant published data") {
    return food.brand ? `Published by ${food.brand}, and a chain can change a recipe without saying so.` : "Published by the restaurant.";
  }
  if (food.source === "Manufacturer label") return "From the manufacturer's label.";
  return food.source;
}
