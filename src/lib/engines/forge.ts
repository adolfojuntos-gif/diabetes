/**
 * THE FUEL FORGE — where a recipe becomes a food.
 *
 * The workshop takes reference ingredients, a name and a number of servings, and forges one durable
 * thing: a food the person can log with one tap for as long as they keep cooking it. A pot of chili
 * is measured once and then it is simply a food, in the same search box as everything else.
 *
 * WHY THIS IS A FORGE AND NOT ANOTHER PLATE. Build Your Plate is tonight's dinner: it reads a meal
 * and it is thrown away. The Forge makes something that OUTLIVES the sitting. That is the whole
 * difference, and it is also the thing the app was actually missing, because people eat the same
 * five dinners and were measuring them again every single time.
 *
 * IT DIVIDES, WHICH IS THE POINT. Nothing else in the app knows that a pot is six servings, so a
 * batch recipe could only ever be logged whole or guessed at. Guessing a sixth of a pot is guessing
 * a carbohydrate figure somebody doses against. Here the division is arithmetic.
 *
 * NOTHING IS GRADED. The spec that asked for this named the outputs "Balanced Meal" and the like,
 * and that is the one part not built, because "balanced" is a verdict and a verdict is the thing
 * people start cooking around. The mark a recipe gets describes its SHAPE, never its worth: how
 * many macros carry real energy and which one leads. No combination here is better than another,
 * and none of it is advice about what to cook.
 *
 * Every figure comes from the carbohydrate reference by way of the portions the person picked. The
 * Forge adds no nutrition knowledge of its own; it only adds up and divides.
 *
 * Pure. No database, no clock.
 */

/** Bumped when the mark, the basis or the uncertainty rules change. */
export const FORGE_ENGINE_VERSION = "1.0.0";

/**
 * Energy per gram, matching `impliedCalories` in `engines/foods.ts` exactly, fibre included.
 *
 * Fibre is counted at about 2 kcal rather than 4 because it is only partly metabolised, and a flat
 * 4 overstates the energy in anything green. Two places in the app must never disagree about what a
 * gram is worth, so these are the same numbers deliberately.
 */
const KCAL = { carb: 4, fibre: 2, protein: 4, fat: 9 } as const;

export type ForgeIngredient = {
  key: string;
  name: string;
  portionLabel: string;
  /** Grams of ONE of this portion. */
  grams: number;
  count: number;
  /** Figures for ONE of this portion, from the reference. */
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  /** Where the figures came from, and how stale that source may be. */
  source: string;
  ageNote: string;
};

export type Figures = {
  grams: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
};

export type EnergyShares = { carbohydrate: number; protein: number; fat: number };

export type ForgeMark = { glyph: string; name: string; line: string };

export type Forged = {
  ingredients: number;
  /** Everything that went in. */
  batch: Figures;
  /** How many servings it was told it makes. At least one, always a whole number. */
  servings: number;
  /**
   * One serving: the batch divided. EXACT, and deliberately independent of the finished weight,
   * because a fraction of a pot is a fraction of a pot however much water boiled off.
   */
  serving: Figures;
  /** Per 100 g of the finished food, which is the only basis the reference table stores. */
  per100: { carbsG: number; proteinG: number; fatG: number; fiberG: number; caloriesKcal: number };
  /** The weight the per-100 g figures are divided by. */
  basisGrams: number;
  /** True when that weight came off a scale rather than from adding the ingredients up. */
  weighed: boolean;
  /** Grams to record against one serving, so the stored food reproduces `serving` exactly. */
  servingGrams: number;
  mark: ForgeMark;
  shares: EnergyShares;
  /** What the recipe cannot tell you. Never empty once anything is in it. */
  uncertainty: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How the energy splits three ways.
 *
 * By ENERGY rather than by grams, for the same reason the plate places foods that way: fat carries
 * more than twice what the others do per gram, so comparing raw grams buries every oil under
 * whatever carbohydrate it came with.
 */
export function energyShares(f: Pick<Figures, "carbsG" | "proteinG" | "fatG" | "fiberG">): EnergyShares {
  const fibre = Math.min(Math.max(f.fiberG, 0), Math.max(f.carbsG, 0));
  const digestible = Math.max(0, f.carbsG - fibre);
  const carb = digestible * KCAL.carb + fibre * KCAL.fibre;
  const protein = Math.max(0, f.proteinG) * KCAL.protein;
  const fat = Math.max(0, f.fatG) * KCAL.fat;
  const total = carb + protein + fat;
  if (total <= 0) return { carbohydrate: 0, protein: 0, fat: 0 };
  return { carbohydrate: carb / total, protein: protein / total, fat: fat / total };
}

/** A share this size or more counts as one of the parts carrying the recipe. */
const PART_FLOOR = 0.2;

const MACRO_NAME: Record<keyof EnergyShares, string> = {
  carbohydrate: "carbohydrate",
  protein: "protein",
  fat: "fat",
};

/**
 * The mark a recipe is stamped with.
 *
 * DESCRIPTIVE, NEVER A RANK. It says how many macros carry a real share of the energy and which one
 * leads, which is a fact about the recipe rather than an opinion about the cook. A Single Note is
 * not worse than a Three-Part Mix; olive oil and a chicken breast are both single notes and neither
 * is a failure.
 */
export function markFor(shares: EnergyShares): ForgeMark {
  const entries = (Object.keys(shares) as (keyof EnergyShares)[]).map((k) => ({ k, v: shares[k] }));
  const total = entries.reduce((a, e) => a + e.v, 0);
  if (total <= 0) return { glyph: "⬚", name: "Nothing in the crucible", line: "Add an ingredient and this takes shape." };

  const parts = entries.filter((e) => e.v >= PART_FLOOR).length;
  const leader = [...entries].sort((a, b) => b.v - a.v)[0];
  const lead = `Most of the energy in this is ${MACRO_NAME[leader.k]}.`;

  if (parts <= 1) {
    return { glyph: "🔥", name: "Single Note", line: `Almost all of the energy here is ${MACRO_NAME[leader.k]}, and very little is anything else.` };
  }
  if (parts === 2) {
    const two = entries
      .filter((e) => e.v >= PART_FLOOR)
      .map((e) => MACRO_NAME[e.k])
      .join(" and ");
    return { glyph: "⚒️", name: "Two-Part Mix", line: `${lead} ${two.charAt(0).toUpperCase()}${two.slice(1)} each carry a real share of it.` };
  }
  return { glyph: "🛠️", name: "Three-Part Mix", line: `${lead} Carbohydrate, protein and fat each carry a real share of it.` };
}

export type ForgeOptions = {
  /** How many servings the batch makes. Rounded to a whole number, never below one. */
  servings: number;
  /**
   * The weight of the finished food off a scale, when the person weighed it. Null when they did
   * not, in which case the ingredients added together stand in for it.
   */
  finishedGrams?: number | null;
};

export function forge(ingredients: ForgeIngredient[], opts: ForgeOptions): Forged {
  const sum = (f: (i: ForgeIngredient) => number) => ingredients.reduce((a, i) => a + f(i) * Math.max(0, i.count), 0);
  const rawGrams = sum((i) => Math.max(0, i.grams));
  const batch: Figures = {
    grams: r1(rawGrams),
    carbsG: r1(sum((i) => i.carbsG)),
    proteinG: r1(sum((i) => i.proteinG)),
    fatG: r1(sum((i) => i.fatG)),
    fiberG: r1(sum((i) => i.fiberG)),
    caloriesKcal: Math.round(sum((i) => i.caloriesKcal)),
  };

  const servings = Math.max(1, Math.round(Number.isFinite(opts.servings) ? opts.servings : 1));
  const serving: Figures = {
    grams: r1(rawGrams / servings),
    carbsG: r1(sum((i) => i.carbsG) / servings),
    proteinG: r1(sum((i) => i.proteinG) / servings),
    fatG: r1(sum((i) => i.fatG) / servings),
    fiberG: r1(sum((i) => i.fiberG) / servings),
    caloriesKcal: Math.round(sum((i) => i.caloriesKcal) / servings),
  };

  /*
   * THE BASIS. The reference table holds one thing per food, per 100 g as eaten, so a recipe has to
   * be reduced to that. A weighed pot is the honest divisor; without one the ingredients added up
   * stand in, which is heavier than the finished food whenever anything simmered away.
   *
   * The serving figures above never touch this, and that is deliberate. A sixth of a pot is a sixth
   * of a pot however much water left it, so the number somebody doses against does not depend on
   * whether they own a scale.
   */
  const weighed = typeof opts.finishedGrams === "number" && Number.isFinite(opts.finishedGrams) && opts.finishedGrams > 0;
  const basisGrams = r1(weighed ? (opts.finishedGrams as number) : rawGrams);
  const per100 =
    basisGrams > 0
      ? {
          carbsG: r2((batch.carbsG / basisGrams) * 100),
          proteinG: r2((batch.proteinG / basisGrams) * 100),
          fatG: r2((batch.fatG / basisGrams) * 100),
          fiberG: r2((batch.fiberG / basisGrams) * 100),
          caloriesKcal: r2((batch.caloriesKcal / basisGrams) * 100),
        }
      : { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0, caloriesKcal: 0 };

  const shares = energyShares(batch);

  return {
    ingredients: ingredients.length,
    batch,
    servings,
    serving,
    per100,
    basisGrams,
    weighed,
    /*
     * One serving is its share of the BASIS weight, so that the per-100 g figures multiplied by
     * these grams give back the serving figures above. Store anything else and the food the Forge
     * makes would quietly disagree with the screen that made it.
     */
    servingGrams: r1(basisGrams / servings),
    mark: markFor(shares),
    shares,
    uncertainty: uncertaintyOf(ingredients, { servings, weighed }),
  };
}

/**
 * What a recipe does not know.
 *
 * Never empty, for the same reason the plate's list is never empty: a carbohydrate figure offered
 * with no caveat invites a precision it has not got, and this one gets divided and then reused for
 * months, so its doubts travel further than a single dinner's.
 */
export function uncertaintyOf(ingredients: ForgeIngredient[], opts: { servings: number; weighed: boolean }): string[] {
  if (ingredients.length === 0) return ["Nothing in the crucible yet."];
  const out: string[] = [];

  out.push(
    "These are reference figures for the portions you picked. What actually went in the pot was measured by eye unless you weighed it, and that difference is usually the biggest one here.",
  );

  if (opts.servings > 1) {
    out.push(
      `One serving is the batch divided by ${opts.servings}, so it assumes the servings come out the same size. Served by hand they rarely do.`,
    );
  }

  if (!opts.weighed) {
    out.push(
      "The weight is the ingredients added together. Anything that simmers finishes lighter than it started, so a 100 g figure from this is thinner than the real thing. Weighing the finished pot fixes it.",
    );
  }

  const stale = [...new Set(ingredients.filter((i) => i.ageNote).map((i) => i.ageNote))];
  if (stale.length > 0) out.push(`Some figures have a date on the source: ${stale.join("; ")}.`);

  const missingFat = ingredients.filter((i) => i.fatG <= 0 && i.carbsG + i.proteinG > 0);
  if (missingFat.length > 0) {
    out.push(
      `${missingFat.length === 1 ? "One ingredient has" : `${missingFat.length} ingredients have`} no fat recorded, so the energy figure is lower than the real thing.`,
    );
  }

  out.push("Oil in the pan, salt, a sauce and anything else added while cooking are only here if you added them above.");
  return out;
}

/**
 * The line written into the food's note, so a recipe pulled up in six months can still say what it
 * was made of. A forged food that cannot account for itself is a number with no provenance, which
 * is the thing this whole part of the app exists to avoid.
 */
export function recipeNote(ingredients: ForgeIngredient[], f: Forged): string {
  const parts = ingredients.map((i) => `${i.count > 1 ? `${i.count} × ` : ""}${i.portionLabel} ${i.name}`);
  const basis = f.weighed ? `${f.basisGrams} g finished, weighed` : `${f.basisGrams} g, the ingredients added together`;
  return `Forged in the Fuel Forge. Makes ${f.servings} ${f.servings === 1 ? "serving" : "servings"} from ${basis}. ${parts.join("; ")}.`;
}
