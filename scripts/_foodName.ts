/**
 * One answer to "are these two rows the same food?".
 *
 * It lives in its own module because two scripts need it and they had different answers, which is
 * how the duplicates got in. `dedupeFoods` normalised punctuation and preparation words but kept
 * word order, and `starterFoods` compared names exactly. The canonical reference happens to name
 * things the other way round from the old starter slice: "White rice, cooked" against "Rice, white,
 * cooked", "White bread" against "Bread, white", "Corn tortilla" against "Tortilla, corn". So the
 * seeding script inserted six duplicates and the deduplicating script then reported no duplicates,
 * each of them correct by its own rule and both of them wrong.
 *
 * The key sorts the words, which is what makes word order stop mattering, and drops the words that
 * describe preparation rather than identity.
 *
 * IT IS DELIBERATELY FUZZY, so what a caller does with a match matters. Skipping an insert on a
 * suspected duplicate is safe: the worst case is a food not added. DELETING on one is not, so
 * `dedupeFoods` reports by default and removes nothing without being asked.
 */

/**
 * Words that describe how a food was prepared or served, not which food it is.
 *
 * `whole` is here for "Egg, whole, cooked" and is safe next to "Whole wheat bread", because that
 * still leaves "wheat bread" against "white bread". `slice` and `one` are here because the starter
 * slice called a thing "Cheese pizza, one slice" where the reference calls it "Cheese pizza" and
 * carries the slice as a portion, which is the right place for it.
 */
const PREP_WORDS = new Set([
  "cooked",
  "raw",
  "plain",
  "regular",
  "prepared",
  "whole",
  "with",
  "skin",
  "one",
  "slice",
  "a",
  "and",
  "the",
]);

/**
 * A comparable key for a food name. Same key means the same food, for the purposes above.
 *
 * Numbers are KEPT. "2% milk" and "1% milk" are different foods and stripping the digits would
 * merge them, which would be a wrong deletion rather than a cosmetic miss.
 */
export function foodKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !PREP_WORDS.has(w))
    .sort()
    .join(" ");
}
