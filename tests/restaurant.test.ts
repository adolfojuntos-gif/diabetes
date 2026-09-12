import { test } from "node:test";
import assert from "node:assert/strict";
import { problemsWith, idFor, RestaurantFile } from "../scripts/importRestaurant";
import { figureAge, sourceLabel } from "../src/lib/engines/foods";

/**
 * Restaurant nutrition data: the validator that decides what gets in, and the age that decides how
 * much it should be trusted once it is.
 *
 * Somebody doses insulin against a carbohydrate figure, so the thing worth testing is not that good
 * data loads. It is that bad data does not. Every check here corresponds to a mistake that produces
 * a plausible-looking wrong number rather than an error, which is the only kind that reaches a
 * person's plate.
 */

const good = {
  name: "Chicken burrito bowl",
  servingGrams: 500,
  carbsG: 60,
  proteinG: 40,
  fatG: 20,
  fiberG: 8,
  caloriesKcal: 580,
};

/* ------------------------------ the validator ------------------------------ */

test("a coherent row passes", () => {
  // 60*4 + 40*4 + 20*9 = 580. The stated calories agree exactly.
  assert.deepEqual(problemsWith(good), []);
});

test("a per-100g figure pasted into a per-serving column is caught", () => {
  /**
   * THE mistake this validator exists for, and the reason it is a mass check rather than a range
   * check. Somebody copies a column headed "per 100 g" into a file the importer reads as per
   * serving. Every number is individually plausible. The row is only wrong in relation to the
   * serving weight, so nothing but the weight can catch it.
   */
  const row = { ...good, servingGrams: 55, carbsG: 60, proteinG: 40, fatG: 20 };
  const problems = problemsWith(row);
  assert.ok(problems.length > 0, "120 g of macros in a 55 g serving was accepted");
  assert.match(problems[0], /impossible/);
  assert.match(problems[0], /per 100 g/, "the message should name the likely cause");
});

test("calories that disagree with the macros are caught", () => {
  // 60*4 + 40*4 + 20*9 = 580, so 200 is a typo somewhere.
  const problems = problemsWith({ ...good, caloriesKcal: 200 });
  assert.ok(problems.some((p) => /kcal/.test(p)), `not caught: ${problems.join("; ")}`);
});

test("small rounding differences in calories are tolerated", () => {
  /**
   * A published file rounds, and its own arithmetic rarely closes exactly. A validator that
   * rejected a 5% difference would reject most real data and teach whoever ran it to ignore the
   * output, which is worse than a looser check.
   */
  for (const kcal of [560, 600, 620]) {
    assert.deepEqual(problemsWith({ ...good, caloriesKcal: kcal }), [], `${kcal} kcal should be tolerated`);
  }
});

test("fibre larger than carbohydrate is caught", () => {
  // Fibre is a carbohydrate, so it cannot exceed the total. Usually a column swap.
  const problems = problemsWith({ ...good, fiberG: 70 });
  assert.ok(problems.some((p) => /fibre/.test(p)), `not caught: ${problems.join("; ")}`);
});

test("a row with no calories at all is still usable", () => {
  // Plenty of published files give carbohydrate and nothing else. Carbohydrate is what matters here.
  assert.deepEqual(problemsWith({ ...good, caloriesKcal: 0 }), []);
});

test("a zero serving weight is refused by the schema, never divided by", () => {
  /**
   * The importer converts per serving to per 100 g by dividing by this. A zero would produce
   * Infinity for every figure, and an Infinity carbohydrate value would render as something
   * nonsensical rather than failing.
   */
  const r = RestaurantFile.safeParse({
    restaurant: "Somewhere",
    sourceDate: "2026-09-01",
    items: [{ ...good, servingGrams: 0 }],
  });
  assert.equal(r.success, false, "a zero serving weight was accepted");
});

test("a missing serving weight is refused, because guessing it would invent the number", () => {
  const { servingGrams: _omitted, ...noWeight } = good;
  const r = RestaurantFile.safeParse({ restaurant: "Somewhere", sourceDate: "2026-09-01", items: [noWeight] });
  assert.equal(r.success, false);
});

test("the file needs a restaurant and a real date", () => {
  const base = { items: [good] };
  assert.equal(RestaurantFile.safeParse({ ...base, sourceDate: "2026-09-01" }).success, false, "no restaurant");
  assert.equal(RestaurantFile.safeParse({ ...base, restaurant: "X" }).success, false, "no date");
  assert.equal(RestaurantFile.safeParse({ ...base, restaurant: "X", sourceDate: "Sept 2026" }).success, false, "loose date");
  assert.equal(RestaurantFile.safeParse({ ...base, restaurant: "X", sourceDate: "2026-09-01" }).success, true);
});

test("the id is stable, so re-importing an updated file replaces rather than duplicates", () => {
  assert.equal(idFor("Chipotle", "Chicken burrito bowl"), idFor("Chipotle", "Chicken burrito bowl"));
  assert.equal(idFor("Chipotle", "Chicken Burrito Bowl"), idFor("chipotle", "chicken burrito bowl"), "case must not fork the id");
  assert.notEqual(idFor("Chipotle", "Chicken bowl"), idFor("Qdoba", "Chicken bowl"), "two restaurants are two foods");
  assert.match(idFor("Chipotle", "Chicken burrito bowl"), /^rest-/, "the prefix marks where it came from");
});

/* ------------------------------ how old it is ------------------------------ */

const NOW = new Date(2026, 8, 15);
const ago = (days: number) => {
  const d = new Date(NOW.getTime() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("a recent figure is shown without comment", () => {
  const a = figureAge(ago(30), NOW);
  assert.equal(a.band, "fresh");
  assert.equal(a.note, "", "nothing useful to say about a figure read last month");
});

test("an older figure says how old, and why that matters here", () => {
  const aging = figureAge(ago(300), NOW);
  assert.equal(aging.band, "aging");
  assert.match(aging.note, /months ago/);

  const stale = figureAge(ago(800), NOW);
  assert.equal(stale.band, "stale");
  assert.match(stale.note, /change recipes/, "the reason is the point, not the age");
  assert.match(stale.note, /check this one/);
});

test("an undated figure is undated, not fresh", () => {
  /**
   * The USDA references carry no date because a release is a version and cooked rice does not
   * drift. Treating a missing date as new would put a reassuring "read recently" on data that has
   * no such claim.
   */
  for (const value of [null, undefined, "", "not a date", "2026-13-45"]) {
    const a = figureAge(value as string | null, NOW);
    assert.equal(a.band, "undated", `should be undated: ${String(value)}`);
    assert.equal(a.days, null);
    assert.equal(a.note, "");
  }
});

test("a date in the future is a typo and never reads as the freshest figure in the table", () => {
  const a = figureAge(ago(-60), NOW);
  assert.equal(a.band, "undated", "a future date was treated as a real reading");
  assert.equal(a.days, null);
});

/* -------------------------------- provenance -------------------------------- */

test("a figure says whose it is, in the fewest accurate words", () => {
  assert.equal(sourceLabel("Restaurant published data", "Chipotle"), "Published by Chipotle");
  assert.equal(sourceLabel("Restaurant published data", null), "Published by the restaurant");
  assert.equal(sourceLabel("You", null), "You added this");
  assert.equal(sourceLabel("Manufacturer label", "Quaker"), "From the label");
  // A government reference already reads as itself and does not need rewording.
  assert.equal(sourceLabel("USDA FoodData Central (SR Legacy)", null), "USDA FoodData Central (SR Legacy)");
});

test("no provenance or age wording claims a figure describes the plate in front of you", () => {
  /**
   * A published figure describes a standard recipe and portion. It does not know how much rice the
   * kitchen put in your bowl, and nothing in this wording may imply that it does.
   */
  const strings = [
    sourceLabel("Restaurant published data", "Chipotle"),
    sourceLabel("You", null),
    figureAge(ago(300), NOW).note,
    figureAge(ago(800), NOW).note,
  ].filter(Boolean);

  assert.ok(strings.length >= 3, "too few strings to be checking anything");
  const banned = /\bexact\b|\baccurate\b|\bprecise\b|\byour plate\b|\bverified\b|\bconfirmed\b/i;
  assert.deepEqual(strings.filter((s) => banned.test(s)), [], "these overstate what a published figure knows");
});
