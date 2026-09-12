/**
 * FOOD DETECTIVE — the model says what it sees, the reference says what is in it.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE. A vision model is good at recognising a tortilla and bad at
 * knowing how many grams of carbohydrate are in one. Until now it was asked for both: the photo
 * path took `carbsG` straight out of the model's JSON, rounded it, and handed it to somebody who
 * may be counting carbohydrate to decide an insulin dose. A hallucinated figure with no reference
 * behind it is the most dangerous thing this codebase can produce, and there was nothing in the
 * pipeline that could have caught one.
 *
 * So the work is split at the only place it can honestly be split:
 *
 *   THE MODEL IDENTIFIES.   "two corn tortillas", "a scoop of white rice", low confidence.
 *   THE REFERENCE MEASURES. Those names are matched against the food table, and every gram comes
 *                           from a USDA or published figure scaled by `figuresFor`.
 *
 * An item that cannot be matched carries NO NUMBER AT ALL. It is listed, named, and handed back for
 * the person to search or add themselves. A blank is honest; an invented 45 g is not, and the blank
 * is the entire reason this is safe to put in front of somebody who doses.
 *
 * Pure functions over rows already loaded, so `tests/detective.test.ts` can work the matching by
 * hand without a database or a model.
 */
import { figuresFor, searchFoods, type FoodLike, type PortionLike, type ServingFigures } from "./foods";

/** Bumped when matching, portion resolution or the confidence rules change. */
export const DETECTIVE_ENGINE_VERSION = "1.0.0";

export type Confidence = "low" | "medium" | "high";

/** What the model is allowed to return. Note the absence of any nutrition figure. */
export type Identified = {
  /** What it thinks the food is, in plain words. */
  name: string;
  /** How much of it it thinks is there, in plain words. "2 tortillas", "a large bowl". */
  portion: string;
  confidence: Confidence;
};

export type Matched = {
  identified: Identified;
  /** The reference row this was matched to, or null when nothing in the table fits. */
  food: (FoodLike & { id: string }) | null;
  /** The portion used, when one could be resolved from the food's own list. */
  portion: PortionLike | null;
  /** How many of that portion, read out of the model's words. Always at least one. */
  count: number;
  grams: number;
  /** Figures from the reference, or null when there was no match to take them from. */
  figures: ServingFigures | null;
  /**
   * How good the match is. `none` means nothing was found and no figure is offered; the item is
   * still listed so the person can search for it themselves.
   */
  match: "none" | "weak" | "good";
};

/**
 * A name has to look genuinely like the identified food before its numbers are used.
 *
 * `searchFoods` always returns its best effort, and a best effort over a thousand-row table will
 * find something for almost any string. Without a floor, "grilled halloumi" quietly matches
 * "grilled chicken" and the person is shown a carbohydrate figure for a different food. Below the
 * floor the item is reported as unmatched rather than guessed at.
 */
export const MATCH_FLOOR = 45;
export const GOOD_MATCH = 70;

/**
 * How many of a thing the model saw. "2 corn tortillas" is two, "a slice of toast" is one.
 *
 * Capped at ten because a number larger than that in a portion phrase is almost always a weight or
 * a volume that has been misread as a count, and multiplying a portion by ninety is a worse error
 * than ignoring the number.
 */
export function countIn(portionText: string): number {
  const m = /(?:^|\s)(\d{1,2})(?:\s|x|×)/.exec(` ${portionText.toLowerCase()} `);
  if (!m) return 1;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(10, Math.round(n));
}

const STOP = new Set(["a", "an", "the", "of", "with", "and", "some", "large", "small", "medium", "serving", "portion", "plate", "bowl"]);

/**
 * Drop a plural ending, conservatively.
 *
 * Only words of five letters or more, never one already ending in a double s or in us, and never
 * turning a two-letter stem into nothing. It is not a stemmer and does not want to be: it exists
 * to turn tortillas into tortilla, and anything cleverer would start mangling words the reference
 * genuinely spells with an s.
 */
export function singular(word: string): string {
  if (word.length < 5) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && /(ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** The words worth searching on. Strips quantities and filler so "2 corn tortillas" queries "corn tortillas". */
export function searchTerms(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zÀ-ſ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ")
    .trim();
}

/**
 * Which of a food's own portions the model's words describe.
 *
 * Matched on words rather than numbers: "a cup of rice" should find the cup portion whatever weight
 * the table gives it, because the table's weight is the trustworthy half of that sentence. When
 * nothing matches, the food's first portion is used as a stated default rather than a guess, and
 * the screen shows which portion was used so it can be corrected in one tap.
 */
export function matchPortion(portions: PortionLike[], portionText: string): PortionLike | null {
  if (portions.length === 0) return null;
  const text = portionText.toLowerCase();
  const sorted = [...portions].sort((a, b) => a.sort - b.sort || a.grams - b.grams);

  let best: { p: PortionLike; score: number } | null = null;
  for (const p of sorted) {
    const label = p.label.toLowerCase();
    let score = 0;
    for (const word of label.split(/[^a-z0-9/]+/).filter((w) => w.length > 1)) {
      if (text.includes(word)) score += word.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best ? best.p : sorted[0];
}

/**
 * How many of a portion the model's words describe, given what that portion already contains.
 *
 * THE DOUBLE COUNT THIS PREVENTS, found running real identifications against the real reference.
 * The model saw "2 tortillas"; the reference's own portion is labelled "2 tortillas" and weighs
 * 52 g. Multiplying the portion by the count gave 104 g, which is four tortillas and twice the
 * carbohydrate, on a screen somebody may dose against.
 *
 * So the label's own count is divided out. A portion of "2 tortillas" against a sighting of two
 * is one portion; against a sighting of four it is two. A label with no count in it, like
 * "1 cup cooked" or "restaurant scoop", behaves exactly as before.
 */
export function portionMultiplier(portionLabel: string, portionText: string): number {
  const wanted = countIn(portionText);
  const perPortion = countIn(portionLabel);
  if (perPortion <= 1) return wanted;
  return Math.max(1, Math.round(wanted / perPortion));
}

export type DetectiveInput = {
  identified: Identified[];
  foods: (FoodLike & { id: string })[];
  /** Every portion row, keyed by food elsewhere; filtered here. */
  portions: PortionLike[];
};

/** Match everything the model saw against the reference. Never invents a figure. */
export function investigate(input: DetectiveInput): Matched[] {
  const byFood = new Map<string, PortionLike[]>();
  for (const p of input.portions) {
    const arr = byFood.get(p.foodId);
    if (arr) arr.push(p);
    else byFood.set(p.foodId, [p]);
  }

  return input.identified.map((identified) => {
    /*
     * BOTH FORMS, AND THE BETTER ONE WINS.
     *
     * `searchFoods` requires every term to appear in the row, and a vision model names things the
     * way a person would: "2 corn tortillas", plural. Against a reference that lists "Corn
     * tortilla" the plural scored 18 and the singular 126, which is the difference between a
     * match and silence. Almost every identification would have failed this way, and failed
     * quietly, since an unmatched item looks exactly like a food the reference does not hold.
     *
     * Searching both and keeping the higher score can only ever help: the raw query is still
     * tried, so nothing that matched before stops matching.
     */
    const query = searchTerms(identified.name);
    const singularQuery = query.split(" ").map(singular).join(" ");
    const candidates = query.length >= 2 ? [query, ...(singularQuery !== query ? [singularQuery] : [])] : [];
    let top: { food: (typeof input.foods)[number]; score: number } | undefined;
    for (const q of candidates) {
      const best = searchFoods(input.foods, q, 5)[0];
      if (best && (!top || best.score > top.score)) top = best;
    }

    if (!top || top.score < MATCH_FLOOR) {
      return { identified, food: null, portion: null, count: countIn(identified.portion), grams: 0, figures: null, match: "none" };
    }

    const food = top.food;
    const portion = matchPortion(byFood.get(food.id) ?? [], identified.portion);
    // The label's own quantity is divided out, so "2 tortillas" of a "2 tortillas" portion is one.
    const count = portion ? portionMultiplier(portion.label, identified.portion) : countIn(identified.portion);
    const grams = portion ? portion.grams * count : 0;

    return {
      identified,
      food,
      portion,
      count,
      grams,
      figures: grams > 0 ? figuresFor(food, grams) : null,
      match: top.score >= GOOD_MATCH ? "good" : "weak",
    };
  });
}

/** What the plate adds up to, counting only items whose numbers came from the reference. */
export function totals(matches: Matched[]): { carbsG: number; caloriesKcal: number; counted: number; unmatched: number } {
  let carbsG = 0;
  let caloriesKcal = 0;
  let counted = 0;
  let unmatched = 0;
  for (const m of matches) {
    if (m.figures) {
      carbsG += m.figures.carbsG;
      caloriesKcal += m.figures.caloriesKcal;
      counted++;
    } else unmatched++;
  }
  return { carbsG: Math.round(carbsG * 10) / 10, caloriesKcal: Math.round(caloriesKcal), counted, unmatched };
}

/**
 * One honest sentence about how much of the plate is actually accounted for.
 *
 * It leads with what is MISSING when anything is, because a total that silently omits two of five
 * items is worse than no total: it looks complete. Somebody counting carbohydrate needs to know the
 * figure is partial before they use it, not after.
 */
export function coverageNote(matches: Matched[]): string {
  const t = totals(matches);
  if (matches.length === 0) return "No food was identified in this photo.";
  if (t.unmatched === 0 && t.counted > 0) {
    return `All ${t.counted} item${t.counted === 1 ? "" : "s"} were found in the carbohydrate reference, so every figure below comes from it.`;
  }
  if (t.counted === 0) {
    return `Nothing here matched the reference, so there are no figures to show. Search for these yourself, or add them, and the numbers come from the reference as usual.`;
  }
  return `${t.counted} of ${matches.length} items were found in the reference. The total below counts only those, so it is lower than the plate: add the other ${t.unmatched} by hand before relying on it.`;
}
