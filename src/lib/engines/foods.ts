/**
 * The carbohydrate reference engine. Pure: search ranking and portion arithmetic, no database.
 *
 * Two things here are worth more than the rest of the file.
 *
 * PORTION MATH IS THE WHOLE FEATURE. A person does not eat 100 grams of rice, they eat a bowl.
 * Every figure is per 100 g in storage and is scaled once, here, so a portion can never disagree
 * with the nutrition it came from.
 *
 * TOTAL CARBOHYDRATE IS THE DEFAULT, NOT NET. Subtracting fibre is a real practice and a personal
 * one: guidelines count total carbohydrate, and whether to subtract is a decision for the person
 * and their care team, not a default this app picks for them. So both numbers are computed, total
 * leads, and `netCarbs` exists for a screen to show alongside it and label as a choice.
 */
import type { FoodSource, GroceryAisle } from "../db/schema";

export type FoodLike = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  aliases: string;
  source: FoodSource;
  aisle: GroceryAisle;
  note: string;
  custom: boolean;
  timesUsed: number;
};

export type PortionLike = { id: string; foodId: string; label: string; grams: number; sort: number };

/* ------------------------------- portion math ------------------------------- */

export type ServingFigures = {
  grams: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  /** Total carbohydrate minus fibre, never below zero. A choice, not a default. */
  netCarbsG: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Scale a per-100g food to a weight in grams. */
export function figuresFor(food: Pick<FoodLike, "carbsG" | "proteinG" | "fatG" | "fiberG" | "caloriesKcal">, grams: number): ServingFigures {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
  const k = g / 100;
  const carbsG = r1(food.carbsG * k);
  const fiberG = r1(food.fiberG * k);
  return {
    grams: r1(g),
    carbsG,
    proteinG: r1(food.proteinG * k),
    fatG: r1(food.fatG * k),
    fiberG,
    caloriesKcal: Math.round(food.caloriesKcal * k),
    netCarbsG: r1(Math.max(0, carbsG - fiberG)),
  };
}

/** Add up a plate. */
export function plateTotals(items: ServingFigures[]): ServingFigures {
  const sum = items.reduce(
    (a, i) => ({
      grams: a.grams + i.grams,
      carbsG: a.carbsG + i.carbsG,
      proteinG: a.proteinG + i.proteinG,
      fatG: a.fatG + i.fatG,
      fiberG: a.fiberG + i.fiberG,
      caloriesKcal: a.caloriesKcal + i.caloriesKcal,
      netCarbsG: a.netCarbsG + i.netCarbsG,
    }),
    { grams: 0, carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0, caloriesKcal: 0, netCarbsG: 0 },
  );
  return {
    grams: r1(sum.grams),
    carbsG: r1(sum.carbsG),
    proteinG: r1(sum.proteinG),
    fatG: r1(sum.fatG),
    fiberG: r1(sum.fiberG),
    caloriesKcal: Math.round(sum.caloriesKcal),
    netCarbsG: r1(sum.netCarbsG),
  };
}

/**
 * How much of a food gives a target number of carbs. The inverse question, and the one people
 * actually ask: "I want this to be about 30 grams of carbs, how much rice is that?"
 * Returns null for a food with no carbohydrate, because the question has no answer.
 */
export function gramsForCarbs(food: Pick<FoodLike, "carbsG">, targetCarbsG: number): number | null {
  if (!Number.isFinite(targetCarbsG) || targetCarbsG <= 0) return null;
  if (food.carbsG <= 0) return null;
  return Math.round((targetCarbsG / food.carbsG) * 100);
}

/** The nearest listed portion to a gram weight, so a typed weight still shows a human label. */
export function nearestPortion(portions: PortionLike[], grams: number): PortionLike | null {
  if (portions.length === 0) return null;
  return portions.reduce((best, p) => (Math.abs(p.grams - grams) < Math.abs(best.grams - grams) ? p : best));
}

/* --------------------------------- search --------------------------------- */

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export type SearchHit<T> = { food: T; score: number };

/**
 * Rank foods for a typed query.
 *
 * The ranking is deliberately boring and explainable: an exact name match beats a name that starts
 * with the query, which beats a word inside the name, which beats an alias, which beats a category.
 * Foods the person has logged before get a bounded nudge, so their own kitchen floats up without
 * burying the right answer. Accent-insensitive, so "platano" finds "plátano".
 */
export function searchFoods<T extends Pick<FoodLike, "name" | "brand" | "aliases" | "category" | "timesUsed" | "custom">>(
  foods: T[],
  query: string,
  limit = 40,
): SearchHit<T>[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const hits: SearchHit<T>[] = [];
  for (const food of foods) {
    const name = fold(food.name);
    const brand = fold(food.brand ?? "");
    const aliases = fold(food.aliases);
    const category = fold(food.category);
    const haystack = `${name} ${brand} ${aliases} ${category}`;

    // Every term has to appear somewhere, so "chicken rice" does not match plain rice.
    if (!terms.every((t) => haystack.includes(t))) continue;

    let score = 0;
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 60;
    else if (new RegExp(`\\b${escapeRe(q)}`).test(name)) score += 40;
    else if (name.includes(q)) score += 25;

    if (aliases.split(",").some((a) => a.trim() === q)) score += 50;
    else if (aliases.includes(q)) score += 20;
    if (brand && brand.includes(q)) score += 10;
    if (category.includes(q)) score += 5;

    // Each term that lands in the name itself is worth more than one that only lands in an alias.
    for (const t of terms) if (name.includes(t)) score += 8;

    // Their own kitchen first, but capped so it cannot outrank a genuinely better match.
    score += Math.min(15, food.timesUsed * 3);
    if (food.custom) score += 5;
    // A shorter name matching the same query is usually the more generic, more useful entry.
    score += Math.max(0, 12 - Math.floor(name.length / 6));

    hits.push({ food, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length).slice(0, limit);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------- what YOUR readings did ------------------------- */

export type FoodHistory = {
  timesLogged: number;
  /** Meals containing this food that had a reading before and 1 to 3 hours after. */
  covered: number;
  meanRise: number | null;
  meanCarbs: number | null;
  /** Lowest and highest rise seen, so a single number never stands alone. */
  minRise: number | null;
  maxRise: number | null;
};

/**
 * The one thing a nutrition database cannot tell you: what this food did to YOU.
 *
 * Takes the rises already computed by the post-meal engine for meals that contained this food.
 * Refuses to report a mean below two covered meals, for the same reason every other engine in this
 * app refuses: one observation is an anecdote, and presenting it as a personal average would be a
 * lie with a number attached.
 */
export function foodHistory(rises: (number | null)[], carbs: number[]): FoodHistory {
  const covered = rises.filter((r): r is number => r !== null);
  const enough = covered.length >= 2;
  return {
    timesLogged: rises.length,
    covered: covered.length,
    meanRise: enough ? Math.round(covered.reduce((a, b) => a + b, 0) / covered.length) : null,
    meanCarbs: carbs.length ? r1(carbs.reduce((a, b) => a + b, 0) / carbs.length) : null,
    minRise: enough ? Math.min(...covered) : null,
    maxRise: enough ? Math.max(...covered) : null,
  };
}

/** Plain label for a carbohydrate amount, so a screen never has to invent wording. */
export function carbWeight(carbsG: number): { label: string; tone: "low" | "moderate" | "high" } {
  if (carbsG <= 15) return { label: "Small amount of carbohydrate", tone: "low" };
  if (carbsG <= 45) return { label: "A moderate amount", tone: "moderate" };
  return { label: "A large amount", tone: "high" };
}

/* ------------------------------ how old a figure is ------------------------------ */

/**
 * How much a figure's age should be trusted, and what to say about it.
 *
 * Only restaurant data carries a date. The USDA references do not drift: a release is a version,
 * and cooked rice contains what it contained. A chain is different in kind. It reformulates, changes
 * a supplier, resizes a portion, and the number somebody wrote down a year ago still looks exactly
 * as authoritative as it did on the day.
 *
 * Somebody doses insulin against these figures, so the age is shown rather than implied. The bands
 * are deliberately generous: this is not a warning, it is a date.
 */
export type FigureAge = {
  /** Days since the figure was read, or null when the source carries no date. */
  days: number | null;
  /** "fresh" under six months, "aging" under eighteen, "stale" beyond it. */
  band: "undated" | "fresh" | "aging" | "stale";
  /** One short phrase for the screen. Empty when there is nothing worth saying. */
  note: string;
};

const DAY_MS = 86_400_000;

export function figureAge(sourceDate: string | null | undefined, now = new Date()): FigureAge {
  if (!sourceDate) return { days: null, band: "undated", note: "" };

  // "YYYY-MM-DD" parsed as a local date, matching how it was written.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate.trim());
  if (!m) return { days: null, band: "undated", note: "" };
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(then.getTime())) return { days: null, band: "undated", note: "" };

  const days = Math.floor((now.getTime() - then.getTime()) / DAY_MS);
  /**
   * A date in the future is a typo, not a fresher figure. Treated as undated rather than as
   * negative days, which would otherwise read as the most trustworthy number in the table.
   */
  if (days < 0) return { days: null, band: "undated", note: "" };

  const months = days / 30.4;
  if (months < 6) return { days, band: "fresh", note: "" };
  if (months < 18) {
    return { days, band: "aging", note: `Read about ${Math.round(months)} months ago. Worth a glance at the menu.` };
  }
  return {
    days,
    band: "stale",
    note: `Read over ${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? "" : "s"} ago. Restaurants change recipes, so check this one before you rely on it.`,
  };
}

/** Who a figure came from, in the fewest words that stay accurate. */
export function sourceLabel(source: string, brand: string | null | undefined): string {
  if (source === "Restaurant published data") return brand ? `Published by ${brand}` : "Published by the restaurant";
  if (source === "You") return "You added this";
  if (source === "Manufacturer label") return "From the label";
  return source;
}

/* ---------------------------- does a row hold together? ---------------------------- */

/**
 * The calories a row's macros account for.
 *
 * Fibre is counted at about 2 kcal a gram rather than 4. It is a carbohydrate and it is only
 * partly metabolised, and ignoring that overstates the energy in anything green. Raw spinach at the
 * real USDA figures is the example: 3.6 g of carbohydrate of which 2.2 g is fibre, and a flat
 * 4 kcal a gram implies 30 kcal against a true 23.
 */
export function impliedCalories(f: { carbsG: number; proteinG: number; fatG: number; fiberG: number }): number {
  const fibre = Math.min(Math.max(f.fiberG, 0), Math.max(f.carbsG, 0));
  const digestibleCarb = Math.max(0, f.carbsG - fibre);
  return digestibleCarb * 4 + fibre * 2 + Math.max(0, f.proteinG) * 4 + Math.max(0, f.fatG) * 9;
}

/**
 * Whether a row's stated calories are impossible given its macros.
 *
 * ASYMMETRIC ON PURPOSE, because the physics is asymmetric. Macros set a FLOOR on energy: a food
 * cannot contain less energy than the carbohydrate, protein and fat in it already account for, so a
 * stated value materially below the floor is a data error. Above the floor is ordinary, because the
 * table has no column for the things that also carry energy. Alcohol is the clearest case, at about
 * 7 kcal a gram: regular beer states 43 kcal per 100 g against macros implying 16, and the
 * difference is the alcohol, not a mistake.
 *
 * A symmetric check flagged both beer and spinach as broken data when both were correct, which is
 * the kind of false alarm that teaches people to ignore a validator.
 */
export function caloriesBelowFloor(
  f: { carbsG: number; proteinG: number; fatG: number; fiberG: number; caloriesKcal: number },
  tolerance = 0.25,
): { below: true; implied: number; shortfall: number } | { below: false; implied: number } {
  const implied = impliedCalories(f);
  // Nothing to check against. Plenty of published data gives carbohydrate and no energy at all.
  if (implied <= 0 || f.caloriesKcal <= 0) return { below: false, implied };
  if (f.caloriesKcal >= implied * (1 - tolerance)) return { below: false, implied };
  return { below: true, implied, shortfall: implied - f.caloriesKcal };
}
