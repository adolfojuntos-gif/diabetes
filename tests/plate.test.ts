import { test } from "node:test";
import assert from "node:assert/strict";
import { quarterOf, explorePlate, uncertaintyOf, shapeLine, QUARTERS, QUARTER_INFO, type PlateItem } from "../src/lib/engines/plate";

/**
 * BUILD YOUR PLATE.
 *
 * A screen that shows somebody the shape of their dinner is one bad sentence away from grading it,
 * and a graded dinner is a dinner people stop logging honestly. Most of these tests are about what
 * the plate declines to say.
 *
 * The rest are about the thing that makes it useful: weight and energy tell different stories, and
 * the uncertainty list is never empty, because a carbohydrate total with no caveat invites a
 * precision it does not have.
 */

const item = (over: Partial<PlateItem> = {}): PlateItem => ({
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
  per100: { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0 },
  source: "USDA FoodData Central (SR Legacy)",
  ageNote: "",
  ...over,
});

/* ============================ nothing is graded =========================== */

test("no quarter is described as better than another", () => {
  for (const q of QUARTERS) {
    const info = QUARTER_INFO[q];
    assert.doesNotMatch(`${info.name} ${info.holds}`, /good|bad|better|best|healthy|unhealthy|should|ideal|balanced|too much/i, q);
  }
});

test("the shape line reports and never recommends", () => {
  const plates: PlateItem[][] = [
    [item({ name: "Oil", grams: 30, fatG: 30, caloriesKcal: 270, per100: { carbsG: 0, proteinG: 0, fatG: 100, fiberG: 0 } })],
    [item({ name: "Rice", grams: 300, carbsG: 85, caloriesKcal: 390, per100: { carbsG: 28, proteinG: 3, fatG: 0.3, fiberG: 0.4 } })],
    [
      item({ name: "Lettuce", grams: 200, carbsG: 3, caloriesKcal: 30, per100: { carbsG: 1.5, proteinG: 1, fatG: 0.2, fiberG: 1, category: "vegetables" } }),
      item({ name: "Oil", grams: 20, fatG: 20, caloriesKcal: 180, per100: { carbsG: 0, proteinG: 0, fatG: 100, fiberG: 0 } }),
    ],
  ];
  for (const p of plates) {
    const line = shapeLine(explorePlate(p));
    assert.doesNotMatch(line, /should|try|reduce|more|less|too|need|aim|better|worse|swap|instead/i, line);
    assert.doesNotMatch(line, /—/, line);
  }
});

test("an empty plate is an invitation, not an empty score", () => {
  const r = explorePlate([]);
  assert.equal(r.items, 0);
  assert.equal(r.carbsG, 0);
  assert.match(shapeLine(r), /fills in/i);
  assert.deepEqual(uncertaintyOf([]), ["Nothing on the plate yet."]);
});

/* ============================== placement ================================= */

test("vegetables are named, because a lettuce has almost no macros to infer from", () => {
  assert.equal(quarterOf({ carbsG: 1.5, proteinG: 1, fatG: 0.2, fiberG: 1, category: "vegetables" }), "vegetables");
  // Without the category it would fall to whatever rounding said, which is not a useful answer.
  assert.equal(quarterOf({ carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0 }), "other");
});

test("the dominant macro is decided by energy, not by grams", () => {
  /**
   * Peanut butter: about 20 g carbohydrate, 25 g protein and 50 g fat per 100 g. By raw grams the
   * other two outweigh the fat; by energy, at nine calories a gram, the fat wins, which is what
   * anybody looking at the jar would also say.
   */
  assert.equal(quarterOf({ carbsG: 20, proteinG: 25, fatG: 50, fiberG: 5 }), "other");
  assert.equal(quarterOf({ carbsG: 45, proteinG: 8, fatG: 3, fiberG: 2 }), "carbohydrate");
  assert.equal(quarterOf({ carbsG: 0, proteinG: 26, fatG: 3, fiberG: 0 }), "protein");
});

test("fruit and grains both sit in carbohydrate, which is what a plate means by it", () => {
  assert.equal(quarterOf({ carbsG: 23, proteinG: 1, fatG: 0.3, fiberG: 2.6, category: "fruit" }), "carbohydrate");
  assert.equal(quarterOf({ carbsG: 28, proteinG: 2.7, fatG: 0.3, fiberG: 0.4, category: "grains and starches" }), "carbohydrate");
});

test("beans land in carbohydrate here even though the Food Forest calls them a forest", () => {
  /**
   * Two models, two questions, and both answers are right for what they are for. `fuel.ts` asks
   * what a food GROWS and gives fibre its own kind; a plate asks what a meal is MADE OF, where the
   * split people recognise is greens, protein, starch and the rest.
   */
  assert.equal(quarterOf({ carbsG: 21, proteinG: 9, fatG: 0.5, fiberG: 8, category: "beans and legumes" }), "carbohydrate");
});

test("every food lands in exactly one quarter, including nonsense", () => {
  const weird = [
    { carbsG: -5, proteinG: -5, fatG: -5, fiberG: -5 },
    { carbsG: Number.NaN, proteinG: 0, fatG: 0, fiberG: 0 },
    { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0, category: null },
  ];
  for (const f of weird) assert.ok(QUARTERS.includes(quarterOf(f)), JSON.stringify(f));
});

/* ============================== the reading =============================== */

test("totals multiply by the count and add up across quarters", () => {
  const r = explorePlate([
    item({ key: "a", name: "Rice", grams: 158, count: 2, carbsG: 44.6, proteinG: 4.3, caloriesKcal: 205, per100: { carbsG: 28.2, proteinG: 2.7, fatG: 0.3, fiberG: 0.4 } }),
    item({ key: "b", name: "Chicken", grams: 120, carbsG: 0, proteinG: 31, fatG: 4, caloriesKcal: 165, per100: { carbsG: 0, proteinG: 26, fatG: 3.6, fiberG: 0 } }),
  ]);
  assert.equal(r.grams, 436);
  assert.equal(r.carbsG, 89.2);
  assert.equal(r.caloriesKcal, 575);
  const carbQuarter = r.quarters.find((q) => q.quarter === "carbohydrate")!;
  const proteinQuarter = r.quarters.find((q) => q.quarter === "protein")!;
  assert.equal(carbQuarter.grams, 316);
  assert.equal(proteinQuarter.grams, 120);
  // Shares of weight across all quarters describe the whole plate.
  assert.ok(Math.abs(r.quarters.reduce((a, q) => a + q.shareOfWeight, 0) - 1) < 0.001);
});

test("net carbohydrate is offered but never negative", () => {
  const r = explorePlate([item({ carbsG: 3, fiberG: 9, per100: { carbsG: 3, proteinG: 1, fatG: 0, fiberG: 9 } })]);
  assert.equal(r.netCarbsG, 0, "fibre above total carbohydrate must not produce a negative");
});

test("weight and energy are reported separately, because they disagree", () => {
  /**
   * THE POINT OF THE SCREEN. A plate that is mostly salad by weight can be mostly oil by energy,
   * and seeing both is the insight. Neither figure is a criticism of the other.
   */
  const r = explorePlate([
    item({ key: "l", name: "Lettuce", grams: 300, carbsG: 4, caloriesKcal: 45, per100: { carbsG: 1.5, proteinG: 1, fatG: 0.2, fiberG: 1, category: "vegetables" } }),
    item({ key: "o", name: "Olive oil", grams: 25, fatG: 25, caloriesKcal: 221, per100: { carbsG: 0, proteinG: 0, fatG: 100, fiberG: 0 } }),
  ]);
  const veg = r.quarters.find((q) => q.quarter === "vegetables")!;
  const other = r.quarters.find((q) => q.quarter === "other")!;
  assert.ok(veg.shareOfWeight > other.shareOfWeight, "salad should dominate the weight");
  assert.ok(other.shareOfEnergy > veg.shareOfEnergy, "oil should dominate the energy");
  assert.match(shapeLine(r), /by weight/i);
  assert.match(shapeLine(r), /both are true/i);
});

/* ============================= the uncertainty ============================ */

test("the uncertainty list is never empty for a plate with anything on it", () => {
  const notes = uncertaintyOf([item()]);
  assert.ok(notes.length > 0);
  assert.match(notes.join(" "), /reference portion/i);
});

test("a stale source is named, because a chain can change a recipe quietly", () => {
  const notes = uncertaintyOf([item({ source: "Restaurant published data", ageNote: "read 14 months ago" })]);
  assert.match(notes.join(" "), /14 months ago/);
});

test("a missing fat figure is called out, because it lowers everything downstream", () => {
  const notes = uncertaintyOf([item({ per100: { carbsG: 30, proteinG: 10, fatG: 0, fiberG: 2 } })]);
  assert.match(notes.join(" "), /no fat recorded/i);
  assert.match(notes.join(" "), /lower than the real thing/i);
});

test("multiplied portions are flagged as an assumption", () => {
  assert.match(uncertaintyOf([item({ count: 3 })]).join(" "), /assumes each one was the same size/i);
});

test("no uncertainty note is written as advice or blame", () => {
  const notes = uncertaintyOf([
    item({ count: 2, source: "Restaurant published data", ageNote: "read 14 months ago", per100: { carbsG: 30, proteinG: 10, fatG: 0, fiberG: 2 } }),
  ]);
  for (const n of notes) {
    assert.doesNotMatch(n, /you should|be careful|avoid|too much|wrong|mistake|failed/i, n);
    assert.doesNotMatch(n, /—/, n);
  }
});
