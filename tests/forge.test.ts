import { test } from "node:test";
import assert from "node:assert/strict";
import { forge, markFor, energyShares, uncertaintyOf, recipeNote, type ForgeIngredient } from "../src/lib/engines/forge";
import { figuresFor } from "../src/lib/engines/foods";

/**
 * THE FUEL FORGE.
 *
 * The Forge makes a food that outlives the sitting, which means its mistakes outlive it too. A
 * plate that is wrong is wrong once; a recipe that is wrong is wrong every Tuesday for a year, and
 * somebody doses against it. So most of these tests are about the arithmetic holding exactly, and
 * the rest are about the marks refusing to grade anybody's cooking.
 */

const ing = (over: Partial<ForgeIngredient> = {}): ForgeIngredient => ({
  key: "k",
  name: "Thing",
  portionLabel: "1 serving",
  grams: 100,
  count: 1,
  carbsG: 0,
  proteinG: 0,
  fatG: 0,
  fiberG: 0,
  caloriesKcal: 0,
  source: "USDA FoodData Central (SR Legacy)",
  ageNote: "",
  ...over,
});

/** A pot of rice and chicken: the case the Forge exists for. */
const POT = [
  ing({ key: "rice", name: "White rice, cooked", portionLabel: "1 cup", grams: 158, count: 4, carbsG: 44.6, proteinG: 4.3, fatG: 0.4, fiberG: 0.6, caloriesKcal: 205 }),
  ing({ key: "chicken", name: "Chicken breast", portionLabel: "1 breast", grams: 120, count: 3, carbsG: 0, proteinG: 31.2, fatG: 4.3, fiberG: 0, caloriesKcal: 198 }),
  ing({ key: "oil", name: "Olive oil", portionLabel: "1 tbsp", grams: 14, count: 2, carbsG: 0, proteinG: 0, fatG: 14, fiberG: 0, caloriesKcal: 124 }),
];

/* ============================ nothing is graded =========================== */

test("no mark ranks a recipe, and the word balanced appears nowhere", () => {
  const shapes: Parameters<typeof markFor>[0][] = [
    { carbohydrate: 1, protein: 0, fat: 0 },
    { carbohydrate: 0.5, protein: 0.5, fat: 0 },
    { carbohydrate: 0.34, protein: 0.33, fat: 0.33 },
    { carbohydrate: 0, protein: 0, fat: 1 },
    { carbohydrate: 0, protein: 0, fat: 0 },
  ];
  for (const s of shapes) {
    const m = markFor(s);
    const text = `${m.name} ${m.line}`;
    assert.doesNotMatch(text, /good|bad|better|best|worse|healthy|unhealthy|should|ideal|balanced|too much|too little|perfect/i, text);
    assert.doesNotMatch(text, /—/, text);
  }
});

test("no uncertainty note is written as advice or blame", () => {
  const notes = uncertaintyOf(POT, { servings: 4, weighed: false });
  for (const n of notes) {
    assert.doesNotMatch(n, /you should|be careful|avoid|too much|wrong|mistake|failed|make sure/i, n);
    assert.doesNotMatch(n, /—/, n);
  }
});

test("an empty crucible claims nothing", () => {
  const f = forge([], { servings: 4 });
  assert.equal(f.ingredients, 0);
  assert.equal(f.batch.carbsG, 0);
  assert.deepEqual(f.uncertainty, ["Nothing in the crucible yet."]);
  assert.match(f.mark.line, /takes shape/i);
});

/* ============================== the division ============================== */

test("the batch adds up across counts", () => {
  const f = forge(POT, { servings: 4 });
  assert.equal(f.batch.grams, 4 * 158 + 3 * 120 + 2 * 14);
  assert.equal(f.batch.carbsG, 178.4);
  assert.equal(f.batch.proteinG, 110.8);
  assert.equal(f.batch.caloriesKcal, 4 * 205 + 3 * 198 + 2 * 124);
});

test("a serving is the batch divided, exactly", () => {
  const f = forge(POT, { servings: 4 });
  assert.equal(f.serving.carbsG, 44.6);
  assert.equal(f.serving.proteinG, 27.7);
  assert.equal(f.serving.caloriesKcal, Math.round((4 * 205 + 3 * 198 + 2 * 124) / 4));
});

test("servings are whole and never below one, whatever the form sends", () => {
  for (const [given, want] of [
    [0, 1],
    [-3, 1],
    [2.4, 2],
    [Number.NaN, 1],
  ] as const) {
    assert.equal(forge(POT, { servings: given }).servings, want, String(given));
  }
});

test("a serving does not change when the pot is weighed, because a sixth is a sixth", () => {
  /**
   * THE REASON THE TWO FIGURES ARE COMPUTED SEPARATELY. Water boiling off changes what 100 g of the
   * finished food contains and cannot change what a quarter of the pot contains. Somebody dosing
   * against a serving should not need a kitchen scale to get the same answer.
   */
  const dry = forge(POT, { servings: 4 });
  const weighed = forge(POT, { servings: 4, finishedGrams: 820 });
  assert.deepEqual(weighed.serving, dry.serving);
  assert.notEqual(weighed.per100.carbsG, dry.per100.carbsG);
  assert.equal(weighed.weighed, true);
  assert.equal(dry.weighed, false);
});

test("what gets stored reproduces what was on the screen", () => {
  /**
   * The Forge writes per-100 g figures and a grams-per-serving into the reference, and every other
   * screen then reads them back through `figuresFor`. If that round trip does not land on the same
   * serving, the food quietly disagrees with the recipe that made it.
   */
  for (const finishedGrams of [null, 820, 400]) {
    const f = forge(POT, { servings: 4, finishedGrams });
    const back = figuresFor(f.per100, f.servingGrams);
    assert.ok(Math.abs(back.carbsG - f.serving.carbsG) < 0.5, `carbs at ${finishedGrams}: ${back.carbsG} vs ${f.serving.carbsG}`);
    assert.ok(Math.abs(back.proteinG - f.serving.proteinG) < 0.5, `protein at ${finishedGrams}`);
    assert.ok(Math.abs(back.caloriesKcal - f.serving.caloriesKcal) < 5, `energy at ${finishedGrams}`);
  }
});

test("a one-serving recipe is just the batch", () => {
  const f = forge(POT, { servings: 1 });
  assert.deepEqual(f.serving, f.batch);
});

test("weightless ingredients do not divide by zero", () => {
  const f = forge([ing({ grams: 0, carbsG: 5, caloriesKcal: 20 })], { servings: 2 });
  assert.equal(f.basisGrams, 0);
  assert.equal(f.per100.carbsG, 0);
  assert.ok(Number.isFinite(f.servingGrams));
});

/* =============================== the shares ============================== */

test("energy is split by energy, not by grams", () => {
  /**
   * 20 g of fat against 30 g of carbohydrate: more grams of carbohydrate, more energy from the fat.
   * Anything that compares raw grams buries every oil under whatever it came with.
   */
  const s = energyShares({ carbsG: 30, proteinG: 0, fatG: 20, fiberG: 0 });
  assert.ok(s.fat > s.carbohydrate);
  assert.ok(Math.abs(s.carbohydrate + s.protein + s.fat - 1) < 0.0001);
});

test("fibre is counted at two calories a gram, the same as everywhere else in the app", () => {
  const withFibre = energyShares({ carbsG: 10, proteinG: 0, fatG: 10, fiberG: 10 });
  const without = energyShares({ carbsG: 10, proteinG: 0, fatG: 10, fiberG: 0 });
  assert.ok(withFibre.carbohydrate < without.carbohydrate, "all-fibre carbohydrate carries half the energy");
});

test("a shape with nothing in it has no shares and no leader", () => {
  assert.deepEqual(energyShares({ carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0 }), { carbohydrate: 0, protein: 0, fat: 0 });
});

test("the mark counts how many macros carry the recipe", () => {
  assert.equal(markFor({ carbohydrate: 0.95, protein: 0.05, fat: 0 }).name, "Single Note");
  assert.equal(markFor({ carbohydrate: 0.55, protein: 0.45, fat: 0 }).name, "Two-Part Mix");
  assert.equal(markFor({ carbohydrate: 0.4, protein: 0.3, fat: 0.3 }).name, "Three-Part Mix");
});

test("the pot of rice, chicken and oil is a three-part mix led by carbohydrate", () => {
  const f = forge(POT, { servings: 4 });
  assert.equal(f.mark.name, "Three-Part Mix");
  assert.match(f.mark.line, /energy in this is carbohydrate/i);
});

/* ============================= the uncertainty =========================== */

test("the uncertainty list is never empty once anything is in the pot", () => {
  assert.ok(uncertaintyOf([ing()], { servings: 1, weighed: true }).length > 0);
});

test("an unweighed pot is told that simmering makes it lighter", () => {
  const notes = uncertaintyOf(POT, { servings: 4, weighed: false }).join(" ");
  assert.match(notes, /simmers finishes lighter/i);
  assert.doesNotMatch(uncertaintyOf(POT, { servings: 4, weighed: true }).join(" "), /simmers finishes lighter/i);
});

test("dividing by hand is named as an assumption, and is not for a single serving", () => {
  assert.match(uncertaintyOf(POT, { servings: 6, weighed: true }).join(" "), /divided by 6/);
  assert.doesNotMatch(uncertaintyOf(POT, { servings: 1, weighed: true }).join(" "), /divided by/);
});

test("a dated source and a missing fat figure are both named", () => {
  const notes = uncertaintyOf(
    [ing({ source: "Restaurant published data", ageNote: "read 14 months ago" }), ing({ key: "b", carbsG: 30, proteinG: 10, fatG: 0 })],
    { servings: 2, weighed: true },
  ).join(" ");
  assert.match(notes, /14 months ago/);
  assert.match(notes, /no fat recorded/i);
});

test("cooking oil that was never added is accounted for by saying so", () => {
  assert.match(uncertaintyOf([ing()], { servings: 1, weighed: true }).join(" "), /oil in the pan/i);
});

/* =============================== provenance ============================== */

test("the note a recipe carries can account for itself months later", () => {
  const f = forge(POT, { servings: 4, finishedGrams: 820 });
  const note = recipeNote(POT, f);
  assert.match(note, /Makes 4 servings/);
  assert.match(note, /820 g finished, weighed/);
  assert.match(note, /4 × 1 cup White rice, cooked/);
  assert.match(note, /2 × 1 tbsp Olive oil/);
});

test("an unweighed recipe says where its weight came from rather than implying a scale", () => {
  assert.match(recipeNote(POT, forge(POT, { servings: 4 })), /the ingredients added together/);
});
