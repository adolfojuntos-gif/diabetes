import { test } from "node:test";
import assert from "node:assert/strict";
import { figuresFor, plateTotals, gramsForCarbs, nearestPortion, searchFoods, foodHistory, carbWeight } from "../src/lib/engines/foods";

/**
 * Portion arithmetic is the whole feature, so it is worked by hand here before being asserted.
 *
 * Cooked white rice, USDA per 100 g: 28.0 g carbohydrate, 0.4 g fibre.
 *   half a cup, 79 g   → 28.0 × 0.79 = 22.12 → 22.1
 *   one cup, 158 g     → 28.0 × 1.58 = 44.24 → 44.2
 *   a 250 g restaurant scoop → 28.0 × 2.5 = 70.0
 */
const rice = { carbsG: 28, proteinG: 2.7, fatG: 0.3, fiberG: 0.4, caloriesKcal: 130 };

test("a portion scales the per-100g figures exactly", () => {
  const half = figuresFor(rice, 79);
  assert.equal(half.carbsG, 22.1);
  assert.equal(half.caloriesKcal, 103); // 130 × 0.79 = 102.7
  const cup = figuresFor(rice, 158);
  assert.equal(cup.carbsG, 44.2);
  assert.equal(figuresFor(rice, 250).carbsG, 70);
  // Doubling the weight doubles the carbohydrate, which is the property that must never break.
  assert.equal(figuresFor(rice, 200).carbsG, figuresFor(rice, 100).carbsG * 2);
});

test("net carbs subtract fibre and never go below zero", () => {
  const cup = figuresFor(rice, 158);
  // 44.2 total, fibre 0.4 × 1.58 = 0.632 → 0.6, so net 43.6
  assert.equal(cup.fiberG, 0.6);
  assert.equal(cup.netCarbsG, 43.6);
  // A food whose fibre exceeds its digestible carbohydrate cannot have negative net carbs.
  const psyllium = { carbsG: 8, proteinG: 0, fatG: 0, fiberG: 12, caloriesKcal: 30 };
  assert.equal(figuresFor(psyllium, 100).netCarbsG, 0);
});

test("total carbohydrate is reported alongside net, never replaced by it", () => {
  const f = figuresFor({ carbsG: 30, proteinG: 0, fatG: 0, fiberG: 10, caloriesKcal: 120 }, 100);
  assert.equal(f.carbsG, 30, "total must stay total");
  assert.equal(f.netCarbsG, 20);
});

test("a zero or nonsense weight yields zeros, not NaN", () => {
  for (const g of [0, -50, NaN, Infinity]) {
    const f = figuresFor(rice, g);
    assert.equal(f.carbsG, 0);
    assert.equal(f.caloriesKcal, 0);
    assert.ok(Number.isFinite(f.netCarbsG));
  }
});

test("a plate adds up to the sum of its parts", () => {
  const plate = plateTotals([
    figuresFor(rice, 158), // 44.2
    figuresFor({ carbsG: 0, proteinG: 31, fatG: 3.6, fiberG: 0, caloriesKcal: 165 }, 120), // chicken, 0
    figuresFor({ carbsG: 7, proteinG: 2.8, fatG: 0.4, fiberG: 2.6, caloriesKcal: 35 }, 90), // broccoli, 6.3
  ]);
  assert.equal(plate.carbsG, 50.5); // 44.2 + 0 + 6.3
  assert.equal(plate.grams, 368);
  assert.equal(plate.proteinG, 44); // 4.3 + 37.2 + 2.5
  assert.equal(plate.caloriesKcal, 435); // 205 + 198 + 32
  // Fibre carries through, so net is the sum of the parts' net, not recomputed from the total.
  assert.equal(plate.fiberG, 2.9);
  assert.equal(plate.netCarbsG, 47.6);
});

test("the inverse question has an answer, and refuses when it cannot", () => {
  // 30 g of carbohydrate from rice at 28 g per 100 g is 107 g of rice.
  assert.equal(gramsForCarbs(rice, 30), 107);
  assert.equal(gramsForCarbs({ carbsG: 0 }, 30), null, "a food with no carbohydrate has no answer");
  assert.equal(gramsForCarbs(rice, 0), null);
  assert.equal(gramsForCarbs(rice, -5), null);
});

test("a typed weight still shows the nearest human portion", () => {
  const portions = [
    { id: "a", foodId: "rice", label: "1/2 cup cooked", grams: 79, sort: 0 },
    { id: "b", foodId: "rice", label: "1 cup cooked", grams: 158, sort: 1 },
    { id: "c", foodId: "rice", label: "restaurant scoop", grams: 250, sort: 2 },
  ];
  assert.equal(nearestPortion(portions, 150)?.label, "1 cup cooked");
  assert.equal(nearestPortion(portions, 90)?.label, "1/2 cup cooked");
  assert.equal(nearestPortion(portions, 400)?.label, "restaurant scoop");
  assert.equal(nearestPortion([], 100), null);
});

/* --------------------------------- search --------------------------------- */

const CORPUS = [
  { name: "Rice, white, cooked", brand: null, aliases: "arroz,arroz blanco,white rice", category: "grains and starches", timesUsed: 0, custom: false },
  { name: "Chicken fried rice", brand: null, aliases: "arroz frito con pollo,fried rice", category: "asian dishes", timesUsed: 0, custom: false },
  { name: "Rice, brown, cooked", brand: null, aliases: "arroz integral,brown rice", category: "grains and starches", timesUsed: 0, custom: false },
  { name: "Banana", brand: null, aliases: "platano,banana,guineo", category: "fruit", timesUsed: 0, custom: false },
  { name: "Black beans, cooked", brand: null, aliases: "frijoles negros,frijol", category: "beans and legumes", timesUsed: 0, custom: false },
  { name: "Bean and cheese burrito", brand: null, aliases: "burrito de frijol con queso", category: "mexican dishes", timesUsed: 0, custom: false },
];

test("an exact name beats a partial, and both beat a dish that merely contains the word", () => {
  const hits = searchFoods(CORPUS, "rice");
  assert.ok(hits.length >= 3);
  assert.ok(hits[0].food.name.startsWith("Rice"), `got ${hits[0].food.name}`);
  const names = hits.map((h) => h.food.name);
  assert.ok(names.indexOf("Rice, white, cooked") < names.indexOf("Chicken fried rice"));
});

test("every term must appear, so two words narrow instead of widen", () => {
  const hits = searchFoods(CORPUS, "fried rice");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].food.name, "Chicken fried rice");
});

test("Spanish finds the food, with or without the accent", () => {
  assert.equal(searchFoods(CORPUS, "arroz")[0].food.name.startsWith("Rice"), true);
  assert.equal(searchFoods(CORPUS, "platano")[0].food.name, "Banana");
  assert.equal(searchFoods(CORPUS, "plátano")[0].food.name, "Banana");
  assert.equal(searchFoods(CORPUS, "frijoles")[0].food.name, "Black beans, cooked");
});

test("a one-character query returns nothing rather than everything", () => {
  assert.deepEqual(searchFoods(CORPUS, "r"), []);
  assert.deepEqual(searchFoods(CORPUS, ""), []);
  assert.deepEqual(searchFoods(CORPUS, "   "), []);
});

test("foods you have logged rise, but cannot outrank a better match", () => {
  const used = CORPUS.map((f) => (f.name === "Chicken fried rice" ? { ...f, timesUsed: 40 } : f));
  const hits = searchFoods(used, "rice");
  assert.ok(hits[0].food.name.startsWith("Rice"), `a 40-times-logged dish outranked the exact match: ${hits[0].food.name}`);
});

test("a query matching nothing returns nothing", () => {
  assert.deepEqual(searchFoods(CORPUS, "zzzzz"), []);
});

/* ------------------------------- own history ------------------------------- */

test("a personal average needs two covered meals, not one", () => {
  const one = foodHistory([42, null, null], [45, 50, 44]);
  assert.equal(one.timesLogged, 3);
  assert.equal(one.covered, 1);
  assert.equal(one.meanRise, null, "one observation must not be reported as a personal average");

  const two = foodHistory([42, 58, null], [45, 50, 44]);
  assert.equal(two.covered, 2);
  assert.equal(two.meanRise, 50);
  assert.equal(two.minRise, 42);
  assert.equal(two.maxRise, 58);
});

test("no covered meals means no numbers at all", () => {
  const none = foodHistory([null, null], [30, 30]);
  assert.equal(none.meanRise, null);
  assert.equal(none.minRise, null);
  assert.equal(none.meanCarbs, 30, "carbs are known even when the glucose response is not");
});

test("carb weight labels split at 15 and 45 grams", () => {
  assert.equal(carbWeight(15).tone, "low");
  assert.equal(carbWeight(15.1).tone, "moderate");
  assert.equal(carbWeight(45).tone, "moderate");
  assert.equal(carbWeight(45.1).tone, "high");
});
