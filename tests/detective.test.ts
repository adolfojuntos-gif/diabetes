import { test } from "node:test";
import assert from "node:assert/strict";
import {
  investigate,
  totals,
  coverageNote,
  countIn,
  portionMultiplier,
  searchTerms,
  matchPortion,
  singular,
  MATCH_FLOOR,
  type Identified,
} from "../src/lib/engines/detective";
import { figuresFor, type PortionLike } from "../src/lib/engines/foods";

/**
 * FOOD DETECTIVE.
 *
 * The first two tests are the whole point of the feature and everything else is support.
 *
 * The photo path used to take `carbsG` straight out of the model's JSON and hand it to somebody who
 * may be counting carbohydrate to decide an insulin dose. These tests hold the split that replaced
 * it: the model may say what it sees, and only the reference may say what is in it. An item that
 * cannot be matched carries no number rather than a plausible one.
 */

type TestFood = Parameters<typeof investigate>[0]["foods"][number];

const food = (over: Partial<TestFood> = {}): TestFood => ({
  id: "f-rice",
  name: "White rice, cooked",
  brand: null,
  aliases: "arroz,rice",
  category: "grains and starches",
  carbsG: 28.2,
  proteinG: 2.7,
  fatG: 0.3,
  fiberG: 0.4,
  caloriesKcal: 130,
  source: "USDA FoodData Central (SR Legacy)",
  aisle: "grains",
  note: "",
  timesUsed: 0,
  custom: false,
  ...over,
});

const portion = (over: Partial<PortionLike> = {}): PortionLike => ({
  id: "p1",
  foodId: "f-rice",
  label: "1 cup cooked",
  grams: 158,
  sort: 1,
  ...over,
});

const saw = (name: string, portionText = "", confidence: Identified["confidence"] = "medium"): Identified => ({
  name,
  portion: portionText,
  confidence,
});

/* ================== the rule the whole feature exists for ================== */

test("every figure comes from the reference, never from the identification", () => {
  const f = food();
  const p = portion();
  const out = investigate({ identified: [saw("white rice", "1 cup")], foods: [f], portions: [p] });
  assert.equal(out.length, 1);
  assert.ok(out[0].figures, "a matched item should carry reference figures");
  // Exactly what the shared helper produces for that weight, and nothing else.
  assert.deepEqual(out[0].figures, figuresFor(f, 158));
  assert.equal(out[0].figures!.carbsG, 44.6);
});

test("an unmatched food carries no number at all", () => {
  /**
   * THE LINE. A blank is honest and an invented 45 g is not, and the blank is the entire reason
   * this is safe in front of somebody who doses. `searchFoods` will find *something* for almost any
   * string over a large table, so the floor is what stops a plausible wrong answer.
   */
  const out = investigate({
    identified: [saw("grilled halloumi with za'atar", "a slice")],
    foods: [food({ id: "f-chick", name: "Grilled chicken breast", aliases: "pollo", category: "protein and meat", carbsG: 0 })],
    portions: [portion({ foodId: "f-chick" })],
  });
  assert.equal(out[0].match, "none");
  assert.equal(out[0].figures, null);
  assert.equal(out[0].food, null);
  assert.equal(out[0].grams, 0);
});

test("a weak match is reported as weak rather than quietly presented as certain", () => {
  const out = investigate({
    identified: [saw("rice", "")],
    foods: [food(), food({ id: "f2", name: "Brown rice, cooked", aliases: "arroz integral", carbsG: 25.6 })],
    portions: [portion(), portion({ id: "p2", foodId: "f2", grams: 195 })],
  });
  assert.ok(["weak", "good"].includes(out[0].match));
  assert.ok(out[0].figures, "a match above the floor should still carry figures");
});

/* ============================= reading the words ========================== */

test("a count in the portion words multiplies a single-item portion", () => {
  const f = food({ id: "f-tort", name: "Corn tortilla", aliases: "tortilla de maiz", category: "breads and tortillas", carbsG: 44 });
  const p = portion({ id: "pt", foodId: "f-tort", label: "1 tortilla", grams: 26 });
  const out = investigate({ identified: [saw("corn tortillas", "2 tortillas")], foods: [f], portions: [p] });
  assert.equal(out[0].count, 2);
  assert.equal(out[0].grams, 52);
  assert.deepEqual(out[0].figures, figuresFor(f, 52));
});

/**
 * FOUND BY RUNNING REAL IDENTIFICATIONS AGAINST THE REAL REFERENCE, not by reading the code.
 *
 * The model saw "2 tortillas". The reference's own portion is labelled "2 tortillas" at 52 g.
 * Multiplying gave 104 g, which is four tortillas and twice the carbohydrate, on a screen
 * somebody may dose against.
 */
test("a portion that already contains a count is not multiplied by it again", () => {
  const f = food({ id: "f-tort", name: "Corn tortilla", aliases: "tortilla de maiz", category: "breads and tortillas", carbsG: 44 });
  const p = portion({ id: "pt", foodId: "f-tort", label: "2 tortillas", grams: 52 });
  const out = investigate({ identified: [saw("corn tortillas", "2 tortillas")], foods: [f], portions: [p] });
  assert.equal(out[0].count, 1, "the label already describes two tortillas");
  assert.equal(out[0].grams, 52, "two tortillas should weigh 52 g, not 104");
});

test("the multiplier divides out whatever the label already carries", () => {
  assert.equal(portionMultiplier("2 tortillas", "2 tortillas"), 1);
  assert.equal(portionMultiplier("2 tortillas", "4 tortillas"), 2);
  assert.equal(portionMultiplier("1 tortilla", "2 tortillas"), 2);
  assert.equal(portionMultiplier("1 cup cooked", "2 cups"), 2);
  // No count in the label leaves the old behaviour exactly as it was.
  assert.equal(portionMultiplier("restaurant scoop", "a scoop"), 1);
  assert.equal(portionMultiplier("restaurant scoop", "3 scoops"), 3);
  // Never zero, whatever the arithmetic.
  assert.equal(portionMultiplier("4 tortillas", "2 tortillas"), 1);
});

test("counts are read conservatively and never run away", () => {
  assert.equal(countIn("2 tortillas"), 2);
  assert.equal(countIn("3 x tacos"), 3);
  assert.equal(countIn("a slice of toast"), 1);
  assert.equal(countIn(""), 1);
  /*
   * A weight is not a count, and the right answer is to ignore it rather than to cap it. Three
   * digits are never a count of plates, so the pattern simply does not match and the item stays
   * at one portion, which the person can then correct.
   */
  assert.equal(countIn("250 g of rice"), 1);
  // A two digit count IS plausible, so it matches, and the cap is what stops it running away.
  assert.equal(countIn("90 tortillas"), 10);
  assert.equal(countIn("0 things"), 1);
});

/**
 * THE BUG THIS CAUGHT. A vision model names food the way a person does, in the plural, and the
 * reference lists it in the singular. "corn tortillas" scored 18 against "Corn tortilla" where
 * "corn tortilla" scored 126, so nearly every identification would have come back unmatched, and
 * unmatched looks exactly like a food the reference genuinely does not hold.
 */
test("a plural identification still finds the singular reference entry", () => {
  const f = food({ id: "f-tort", name: "Corn tortilla", aliases: "tortilla de maiz", category: "breads and tortillas", carbsG: 44 });
  const p = portion({ id: "pt", foodId: "f-tort", label: "1 tortilla", grams: 26 });
  const out = investigate({ identified: [saw("corn tortillas", "2 tortillas")], foods: [f], portions: [p] });
  assert.notEqual(out[0].match, "none", "the plural failed to match the singular reference row");
  assert.equal(out[0].food!.id, "f-tort");
});

test("singularising is conservative and does not mangle real words", () => {
  assert.equal(singular("tortillas"), "tortilla");
  assert.equal(singular("berries"), "berry");
  assert.equal(singular("peaches"), "peach");
  // Short words, double s and us endings are left alone: oats, rice, hummus, couscous.
  assert.equal(singular("oats"), "oats");
  assert.equal(singular("rice"), "rice");
  assert.equal(singular("hummus"), "hummus");
  assert.equal(singular("couscous"), "couscous");
});

test("search terms drop quantities and filler so the name is what gets searched", () => {
  assert.equal(searchTerms("2 corn tortillas"), "corn tortillas");
  assert.equal(searchTerms("a large bowl of white rice"), "white rice");
  assert.equal(searchTerms("some of the chicken"), "chicken");
  assert.equal(searchTerms("!!!"), "");
});

test("a portion is matched on words, because the table owns the weight", () => {
  const ps = [
    portion({ id: "half", label: "1/2 cup cooked", grams: 79, sort: 1 }),
    portion({ id: "cup", label: "1 cup cooked", grams: 158, sort: 2 }),
    portion({ id: "scoop", label: "restaurant scoop", grams: 250, sort: 3 }),
  ];
  assert.equal(matchPortion(ps, "a restaurant scoop")!.id, "scoop");
  assert.equal(matchPortion(ps, "about a cup")!.id, "half", "the first cup-matching portion in sort order wins");
  // Nothing recognisable falls back to the first portion rather than guessing a weight.
  assert.equal(matchPortion(ps, "a big pile")!.id, "half");
  assert.equal(matchPortion([], "anything"), null);
});

/* ================================= totals ================================= */

test("the total counts only what the reference could measure", () => {
  const f = food();
  const out = investigate({
    identified: [saw("white rice", "1 cup"), saw("something nobody has ever heard of", "a bit")],
    foods: [f],
    portions: [portion()],
  });
  const t = totals(out);
  assert.equal(t.counted, 1);
  assert.equal(t.unmatched, 1);
  assert.equal(t.carbsG, 44.6);
});

test("a partial total says it is partial, and says so first", () => {
  const out = investigate({
    identified: [saw("white rice", "1 cup"), saw("mystery item", ""), saw("another mystery", "")],
    foods: [food()],
    portions: [portion()],
  });
  const note = coverageNote(out);
  assert.match(note, /1 of 3/);
  assert.match(note, /lower than the plate/i);
  assert.match(note, /before relying on it/i);
});

test("a fully matched plate says so plainly", () => {
  const out = investigate({ identified: [saw("white rice", "1 cup")], foods: [food()], portions: [portion()] });
  assert.match(coverageNote(out), /All 1 item .*reference/i);
});

test("a plate where nothing matched offers no total rather than a zero", () => {
  const out = investigate({ identified: [saw("zzzz qqqq", "")], foods: [food()], portions: [portion()] });
  assert.equal(totals(out).counted, 0);
  assert.match(coverageNote(out), /no figures to show/i);
  assert.doesNotMatch(coverageNote(out), /0 g/);
});

test("an empty photo produces nothing rather than an empty plate", () => {
  assert.equal(investigate({ identified: [], foods: [food()], portions: [portion()] }).length, 0);
  assert.match(coverageNote([]), /No food was identified/i);
});

/* ============================== robustness =============================== */

test("a food with no portions cannot produce a weight out of nowhere", () => {
  const out = investigate({ identified: [saw("white rice", "1 cup")], foods: [food()], portions: [] });
  assert.equal(out[0].portion, null);
  assert.equal(out[0].grams, 0);
  assert.equal(out[0].figures, null, "no portion means no weight, and no weight means no figure");
});

test("nonsense identification cannot throw", () => {
  const weird = [saw("", ""), saw("   ", "   "), saw("a", "999999 x")];
  const out = investigate({ identified: weird, foods: [food()], portions: [portion()] });
  assert.equal(out.length, 3);
  for (const m of out) assert.ok(m.grams >= 0);
});

test("the match floor is high enough to be worth having", () => {
  assert.ok(MATCH_FLOOR > 0, "a floor of zero would accept every best effort as a match");
});
