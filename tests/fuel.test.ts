import { test } from "node:test";
import assert from "node:assert/strict";
import {
  biomeOf,
  biomeLevel,
  buildEcosystem,
  carbCompass,
  fuelProfile,
  BIOMES,
  BIOME_INFO,
  type MealItemLike,
} from "../src/lib/engines/fuel";

/**
 * FUEL.
 *
 * Two things are being protected here and they pull in opposite directions.
 *
 * The Food Forest has to file EVERY food somewhere, including ones nobody has thought of, because a
 * meal that grows nothing reads as the app ignoring it. So the mapping is tested against the real
 * seventeen-value category vocabulary out of a live database, plus the shapes that break naive
 * rules: oil, which is pure fat; lettuce, which is almost nothing; and beans, which are protein and
 * fibre and starch at once.
 *
 * The Carb Compass has to describe without ever prescribing. The tests that matter most are the
 * ones asserting what it does NOT say.
 */

const food = (over: Partial<Parameters<typeof biomeOf>[0]> = {}) => ({
  carbsG: 0,
  proteinG: 0,
  fatG: 0,
  fiberG: 0,
  ...over,
});

/* -------------------------- everything lands somewhere --------------------- */

test("every category in the real database maps to a biome", () => {
  // Taken from `SELECT category, count(*) FROM foods GROUP BY category` on a live account.
  const real = [
    "mexican dishes",
    "prepared dishes",
    "fruit",
    "vegetables",
    "grains and starches",
    "protein and meat",
    "drinks",
    "dairy",
    "snacks and sweets",
    "breads and tortillas",
    "asian dishes",
    "nuts and fats",
    "fast food",
    "breakfast",
    "beans and legumes",
    "fish",
    "condiments",
  ];
  for (const category of real) {
    const b = biomeOf(food({ category, carbsG: 20, proteinG: 5, fatG: 3, fiberG: 1 }));
    assert.ok(BIOMES.includes(b), `${category} produced ${b}`);
  }
});

test("a food with no figures at all still lands somewhere harmless", () => {
  assert.equal(biomeOf(food()), "garden");
  assert.equal(biomeOf(food({ category: "" })), "garden");
  assert.equal(biomeOf(food({ category: null })), "garden");
});

test("negative or corrupt figures cannot throw or escape the biome list", () => {
  const b = biomeOf(food({ carbsG: -50, proteinG: -1, fatG: -3, fiberG: -9 }));
  assert.ok(BIOMES.includes(b));
});

/* ------------------------- the mapping is actually right ------------------- */

test("fruit and vegetables are named, not inferred", () => {
  // A banana is mostly starch by macro. Filing it under fields would be true and useless.
  assert.equal(biomeOf(food({ category: "fruit", carbsG: 23, fiberG: 2.6 })), "orchard");
  assert.equal(biomeOf(food({ category: "vegetables", carbsG: 3, fiberG: 1 })), "garden");
});

test("real fibre outranks everything that is not fruit or vegetable", () => {
  // Beans: protein and starch and fibre at once. Fibre is the property worth surfacing.
  assert.equal(biomeOf(food({ category: "beans and legumes", carbsG: 21, proteinG: 9, fiberG: 8 })), "forest");
});

test("fat is compared by energy, not by grams", () => {
  /**
   * THE BUG THIS PREVENTS. Olive oil is 100 g fat and 0 g carbohydrate, so any rule is fine. Peanut
   * butter is about 50 g fat, 20 g carbohydrate and 25 g protein: by raw grams carbohydrate and
   * protein together bury the fat, and every nut, oil and cheese quietly files under fields. By
   * energy, fat carries nine calories a gram and wins, which is what somebody looking at the jar
   * would say too.
   */
  assert.equal(biomeOf(food({ category: "nuts and fats", carbsG: 20, proteinG: 25, fatG: 50, fiberG: 5 })), "springs");
  assert.equal(biomeOf(food({ category: "nuts and fats", carbsG: 0, fatG: 100 })), "springs");
});

test("protein beats carbohydrate only when it genuinely dominates", () => {
  assert.equal(biomeOf(food({ category: "protein and meat", carbsG: 0, proteinG: 26, fatG: 3 })), "pasture");
  assert.equal(biomeOf(food({ category: "fish", carbsG: 0, proteinG: 22, fatG: 5 })), "pasture");
  // A tortilla is mostly starch with real protein in it, and it is still a field.
  assert.equal(biomeOf(food({ category: "breads and tortillas", carbsG: 45, proteinG: 8, fatG: 3, fiberG: 2 })), "fields");
});

test("a mixed dish files by what is actually in it", () => {
  assert.equal(biomeOf(food({ category: "mexican dishes", carbsG: 30, proteinG: 12, fatG: 8, fiberG: 3 })), "fields");
  assert.equal(biomeOf(food({ category: "prepared dishes", carbsG: 8, proteinG: 20, fatG: 6 })), "pasture");
});

/* -------------------------------- the ecosystem ---------------------------- */

const item = (over: Partial<MealItemLike>): MealItemLike => ({
  name: "thing",
  grams: 100,
  carbsG: 0,
  proteinG: 0,
  fatG: 0,
  fiberG: 0,
  ...over,
});

test("an empty journal builds an empty world without failing", () => {
  const e = buildEcosystem([]);
  assert.equal(e.totalGrams, 0);
  assert.equal(e.foodsTried, 0);
  for (const b of BIOMES) {
    assert.equal(e.grams[b], 0);
    assert.equal(e.level[b], 0);
  }
});

test("food grows the biome it belongs to, by grams", () => {
  const e = buildEcosystem([
    item({ name: "Apple", category: "fruit", grams: 180, carbsG: 14 }),
    item({ name: "Apple", category: "fruit", grams: 180, carbsG: 14 }),
    item({ name: "Chicken", category: "protein and meat", grams: 120, proteinG: 27 }),
  ]);
  assert.equal(e.grams.orchard, 360);
  assert.equal(e.grams.pasture, 120);
  assert.equal(e.variety.orchard, 1, "the same food twice is one food, not two");
  assert.equal(e.foodsTried, 2);
});

test("variety counts distinct foods and volume counts grams, and they are different questions", () => {
  const e = buildEcosystem([
    item({ name: "Rice", category: "grains and starches", grams: 1000, carbsG: 28 }),
    item({ name: "Oats", category: "grains and starches", grams: 40, carbsG: 60, fiberG: 10 }),
  ]);
  assert.ok(e.grams.fields > e.grams.forest, "a kilo of rice is more grams than 40 g of oats");
  assert.equal(e.variety.fields, 1);
  assert.equal(e.variety.forest, 1);
});

test("biome level rises with grams and never falls", () => {
  let last = -1;
  for (const g of [0, 1, 149, 150, 899, 900, 4_000, 15_000, 50_000, 900_000]) {
    const l = biomeLevel(g);
    assert.ok(l >= last, `level fell between ${g} and the previous step`);
    last = l;
  }
  assert.equal(biomeLevel(0), 0);
  assert.ok(biomeLevel(150) > 0, "a first real meal must visibly change something");
  assert.equal(biomeLevel(900_000), 5, "the scale has a top so one obsessive week cannot max it");
});

test("every biome has copy and nothing is described as better than another", () => {
  for (const b of BIOMES) {
    const info = BIOME_INFO[b];
    assert.ok(info, `${b} has no description`);
    const text = `${info.name} ${info.grows} ${info.from}`;
    assert.doesNotMatch(text, /good|bad|better|best|healthy|unhealthy|clean|treat|cheat|guilt/i, b);
  }
});

/* ------------------------------- the compass ------------------------------- */

const meal = (slot: string, carbsG: number, day = 12): { at: Date; carbsG: number; slot: string; name: string } => ({
  at: new Date(2026, 8, day, 12),
  carbsG,
  slot,
  name: slot,
});

test("the compass never produces a remaining budget, whatever it is given", () => {
  /**
   * THE LINE. "You have 80 g left" turns a meal into an overdraft, and in front of somebody with a
   * history of disordered eating it is actively harmful. The engine has no subtraction in it, and
   * the person's own figure is reported beside what they logged rather than against it.
   */
  const c = carbCompass([meal("breakfast", 40), meal("lunch", 60), meal("dinner", 50)], 150);
  assert.equal(c.ownTargetG, 150);
  assert.equal(c.carbsG, 150);
  const text = [...c.notes, c.thin ?? ""].join(" ");
  assert.doesNotMatch(text, /left|remaining|budget|allowance|over|under|exceed|limit/i);
});

test("a target is only ever reported when the person actually set one", () => {
  assert.equal(carbCompass([meal("lunch", 50)], null).ownTargetG, null);
  assert.equal(carbCompass([meal("lunch", 50)], 0).ownTargetG, null);
  assert.equal(carbCompass([meal("lunch", 50)], 200).ownTargetG, 200);
});

test("one lunch is never called a pattern", () => {
  const c = carbCompass([meal("lunch", 50)], null);
  assert.deepEqual(c.notes, []);
  assert.ok(c.thin, "a single meal should say why it cannot describe anything");
  assert.match(c.thin!, /Three meals/);
});

test("the spread describes where carbohydrate sat, and the shares add up", () => {
  const c = carbCompass([meal("breakfast", 20), meal("lunch", 30), meal("dinner", 50)], null);
  assert.equal(c.carbsG, 100);
  assert.equal(c.perMeal, 33);
  assert.deepEqual(c.spread.map((s) => s.slot), ["breakfast", "lunch", "dinner"]);
  const sum = c.spread.reduce((a, s) => a + s.share, 0);
  assert.ok(Math.abs(sum - 1) < 0.001, `shares summed to ${sum}`);
  assert.match(c.notes.join(" "), /50% of the carbohydrate you logged sat at dinner/);
});

test("an unknown slot is counted rather than dropped", () => {
  const c = carbCompass([meal("brunch", 30), meal("lunch", 30), meal("dinner", 30)], null);
  assert.equal(c.carbsG, 90);
  assert.equal(c.spread.reduce((a, s) => a + s.carbsG, 0), 90, "a meal fell out of the spread entirely");
});

test("no note in the compass reads as advice or as a judgement", () => {
  const c = carbCompass(
    [meal("breakfast", 90), meal("lunch", 10), meal("dinner", 10, 13), meal("snack", 5, 14), meal("lunch", 20, 15)],
    120,
  );
  for (const n of c.notes) {
    assert.doesNotMatch(n, /should|try to|too much|too many|high|low|reduce|cut down|avoid|better|worse|careful/i, n);
    assert.doesNotMatch(n, /—/, `em-dash in: ${n}`);
  }
});

test("nothing divides by zero on an empty window", () => {
  const c = carbCompass([], null);
  assert.equal(c.meals, 0);
  assert.equal(c.carbsG, 0);
  assert.equal(c.perMeal, null);
  assert.deepEqual(c.spread, []);
  assert.ok(c.thin);
});

/* ------------------------------- fuel profile ------------------------------ */

test("no fuel profile can be ranked against another", () => {
  const shapes = [
    { carbsG: 80, proteinG: 5, fatG: 2, fiberG: 2 },
    { carbsG: 5, proteinG: 40, fatG: 5, fiberG: 0 },
    { carbsG: 2, proteinG: 3, fatG: 40, fiberG: 0 },
    { carbsG: 30, proteinG: 25, fatG: 15, fiberG: 5 },
    { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0 },
  ];
  for (const s of shapes) {
    const p = fuelProfile(s);
    assert.ok(p.name.length > 0);
    assert.doesNotMatch(`${p.name} ${p.note}`, /good|bad|better|worse|balanced|poor|ideal|optimal|healthy/i, p.key);
  }
});

test("a dominant macro names the fuel, and a mixed meal is just mixed", () => {
  assert.equal(fuelProfile({ carbsG: 80, proteinG: 4, fatG: 1, fiberG: 2 }).key, "quick");
  assert.equal(fuelProfile({ carbsG: 2, proteinG: 40, fatG: 3, fiberG: 0 }).key, "steady");
  assert.equal(fuelProfile({ carbsG: 2, proteinG: 3, fatG: 40, fiberG: 0 }).key, "slow");
  assert.equal(fuelProfile({ carbsG: 30, proteinG: 25, fatG: 12, fiberG: 4 }).key, "mixed");
  assert.equal(fuelProfile({ carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0 }).key, "unknown");
});

/**
 * A meal logged as a carbohydrate figure and nothing else is a perfectly ordinary way to log a
 * meal, and it is not a meal made entirely of carbohydrate. Treating the absent macros as zeroes
 * gave carbohydrate an automatic win, and the app stated in the game's own voice that a Greek salad
 * with chicken was mostly starch. Found by reading the rendered page, not the code.
 */
test("a meal with no protein or fat recorded has an unknown shape, not a carbohydrate one", () => {
  const p = fuelProfile({ carbsG: 16, proteinG: null, fatG: null, fiberG: null });
  assert.equal(p.key, "unknown");
  assert.doesNotMatch(p.name, /field|pasture|spring|mixed/i);
  assert.match(p.note, /unknown/i);
});

test("a shape needs all three macros, because a missing fat figure biases the answer", () => {
  /**
   * The real row that exposed this: 16 g carbohydrate, 12 g protein, fat blank. By energy that is
   * 57% carbohydrate and the app called a Greek salad with chicken mostly starch. Fat is nine
   * calories a gram; leaving it out does not add noise, it tilts the result.
   */
  assert.equal(fuelProfile({ carbsG: 16, proteinG: 12, fatG: null, fiberG: 4 }).key, "unknown");
  assert.equal(fuelProfile({ carbsG: 80, proteinG: null, fatG: 2, fiberG: null }).key, "unknown");
  // With all three present the same plate can be described.
  assert.equal(fuelProfile({ carbsG: 16, proteinG: 12, fatG: 18, fiberG: 4 }).key, "slow");
});

test("missing is never silently read as zero anywhere in the profile", () => {
  const absent = fuelProfile({ carbsG: 60, proteinG: null, fatG: null, fiberG: null });
  const actualZero = fuelProfile({ carbsG: 60, proteinG: 0, fatG: 0, fiberG: 0 });
  assert.notEqual(absent.key, actualZero.key, "recorded zeroes and missing values must not agree");
  assert.equal(actualZero.key, "quick", "a meal genuinely measured as all carbohydrate is field fuel");
});
