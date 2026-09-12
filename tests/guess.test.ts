import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickRound,
  reveal,
  bandFor,
  isAskable,
  referenceNote,
  GUESS_XP,
  DAILY_ROUNDS,
  type GuessFood,
  type GuessPortion,
} from "../src/lib/engines/guess";
import { figuresFor } from "../src/lib/engines/foods";

/**
 * GUESS THE CARBS.
 *
 * The first test is the one that matters. Everything else in this file is detail.
 *
 * A carbohydrate quiz inside a diabetes app is one bad decision away from being a device for making
 * people feel stupid about food, and the decision is always the same one: paying more for a better
 * guess. These tests hold that line, and hold the two next to it, which are that nothing is ever
 * called wrong and that no figure is ever invented.
 */

const food = (over: Partial<GuessFood> = {}): GuessFood => ({
  id: "f1",
  name: "White rice, cooked",
  brand: null,
  carbsG: 28.2,
  proteinG: 2.7,
  fatG: 0.3,
  fiberG: 0.4,
  caloriesKcal: 130,
  source: "USDA FoodData Central (SR Legacy)",
  sourceDate: null,
  ...over,
});

const portion = (over: Partial<GuessPortion> = {}): GuessPortion => ({
  id: "p1",
  foodId: "f1",
  label: "1 cup cooked",
  grams: 158,
  ...over,
});

/* ====================== the line this game rests on ====================== */

test("XP is identical whatever the guess, including a wild one", () => {
  /**
   * THE DESIGN, NOT A DETAIL. Paying more for a closer guess turns this into a skill score, and it
   * would pay most to the people who already know, which is backwards for a learning tool. It would
   * also add one more number in a diabetes app that somebody can be bad at, and there are enough of
   * those already.
   */
  const round = { referenceCarbsG: 45, band: bandFor(45) };
  const guesses = [0, 1, 44, 45, 46, 200, 9_999];
  const paid = new Set(guesses.map((g) => reveal(g, round).xp));
  assert.equal(paid.size, 1, `different guesses paid differently: ${[...paid].join(", ")}`);
  assert.equal([...paid][0], GUESS_XP);
});

test("nothing a person can guess is ever called wrong, or right", () => {
  const round = { referenceCarbsG: 45, band: bandFor(45) };
  for (const g of [0, 5, 44, 45, 60, 500]) {
    const r = reveal(g, round);
    const text = `${r.headline} ${r.line}`;
    assert.doesNotMatch(text, /wrong|incorrect|correct|failed|missed|bad|poor|should have|too high|too low/i, `guess ${g}: ${text}`);
    assert.doesNotMatch(text, /—/, `em-dash at guess ${g}`);
  }
});

test("the furthest guess gets the warmest framing, because it taught the most", () => {
  const round = { referenceCarbsG: 45, band: bandFor(45) };
  const far = reveal(200, round);
  assert.equal(far.closeness, "further");
  assert.match(`${far.headline} ${far.line}`, /useful|point of playing/i);
});

test("the game never earns more than a handful of rounds a day", () => {
  assert.ok(DAILY_ROUNDS <= 5, `${DAILY_ROUNDS} paying rounds a day is a grind, not a game`);
  assert.ok(DAILY_ROUNDS * GUESS_XP <= 150, "a quiz should not out-earn a day of actually logging");
});

/* ========================= the figures are never invented ================= */

test("the reference is the food table scaled to the portion, and nothing else", () => {
  const f = food();
  const p = portion();
  const round = pickRound([f], [p], "seed")!;
  assert.equal(round.referenceCarbsG, figuresFor(f, p.grams).carbsG);
  // 28.2 g per 100 g at 158 g = 44.556, rounded to one place by the shared helper.
  assert.equal(round.referenceCarbsG, 44.6);
});

test("where the figure came from is always available to the person", () => {
  assert.match(referenceNote(food()), /USDA/);
  assert.match(referenceNote(food({ source: "You" })), /you added/i);
  assert.match(referenceNote(food({ source: "Restaurant published data", brand: "Chipotle" })), /Chipotle/);
  // A restaurant figure is the one most likely to have drifted, and the note says so.
  assert.match(referenceNote(food({ source: "Restaurant published data", brand: "Chipotle" })), /change a recipe/i);
});

/* ============================== round selection =========================== */

test("the same day and round always asks the same question", () => {
  const foods = [food(), food({ id: "f2", name: "Oats", carbsG: 66 })];
  const portions = [portion(), portion({ id: "p2", foodId: "f2", label: "40 g dry", grams: 40 })];
  const a = pickRound(foods, portions, "2026-09-12:0");
  const b = pickRound(foods, portions, "2026-09-12:0");
  assert.deepEqual(a, b, "a refresh rerolled the question");
});

test("different rounds ask different questions", () => {
  const foods = Array.from({ length: 12 }, (_, i) => food({ id: `f${i}`, name: `Food ${i}`, carbsG: 20 + i }));
  const portions = foods.map((f, i) => portion({ id: `p${i}`, foodId: f.id, grams: 100 }));
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) seen.add(pickRound(foods, portions, `2026-09-12:${i}`)!.food.id);
  assert.ok(seen.size > 1, "every round of the day asked about the same food");
});

test("a food with nothing to guess is never asked about", () => {
  // Chicken breast: no carbohydrate, so the question has one boring answer.
  assert.equal(isAskable(food({ carbsG: 0, name: "Chicken breast" }), portion({ grams: 120 })), false);
  // A teaspoon of something: being 4 g out on a 5 g answer is noise, not a lesson.
  assert.equal(isAskable(food({ carbsG: 28 }), portion({ grams: 10 })), false);
  assert.equal(isAskable(food(), portion()), true);
});

test("an empty or unusable food list produces no round rather than a broken one", () => {
  assert.equal(pickRound([], [], "seed"), null);
  assert.equal(pickRound([food()], [], "seed"), null, "a food with no portions cannot be asked about");
  assert.equal(pickRound([food({ carbsG: 0 })], [portion()], "seed"), null);
});

test("a portion belonging to another food is never paired with it", () => {
  const r = pickRound([food({ id: "f1" })], [portion({ id: "p9", foodId: "OTHER", grams: 158 })], "seed");
  assert.equal(r, null, "a portion from a different food was used");
});

/* ================================= the band =============================== */

test("the band reflects how much real portions vary, and is never zero wide", () => {
  const wide = bandFor(100);
  assert.ok(wide.low < 100 && wide.high > 100);
  assert.equal(wide.high - 100, 100 - wide.low, "the band should be symmetrical");

  // A tiny reference still gets a usable band rather than demanding exactness.
  const tiny = bandFor(2);
  assert.ok(tiny.high - tiny.low >= 2, `band for 2 g was only ${tiny.high - tiny.low} g wide`);
  assert.equal(bandFor(0).low, 0, "a band can never go below zero carbohydrate");
});

test("a guess inside the band is the same ballpark, and just outside is near", () => {
  const round = { referenceCarbsG: 45, band: bandFor(45) };
  assert.equal(reveal(45, round).closeness, "same_ballpark");
  assert.equal(reveal(round.band.low, round).closeness, "same_ballpark");
  assert.equal(reveal(round.band.high, round).closeness, "same_ballpark");
  assert.equal(reveal(round.band.high + 1, round).closeness, "near");
  assert.equal(reveal(300, round).closeness, "further");
});

test("nonsense input cannot throw or produce a negative distance", () => {
  const round = { referenceCarbsG: 45, band: bandFor(45) };
  for (const g of [-50, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = reveal(g, round);
    assert.ok(r.differenceG >= 0, `guess ${g} gave a distance of ${r.differenceG}`);
    assert.equal(r.xp, GUESS_XP);
    assert.ok(r.headline.length > 0);
  }
});
