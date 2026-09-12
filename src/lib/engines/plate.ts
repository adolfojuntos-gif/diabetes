/**
 * BUILD YOUR PLATE — where a food actually sits, and what you are working with.
 *
 * Four quarters: vegetables, protein, carbohydrate, and everything else. A food lands in the one
 * its macros put it in, and the person can see where their plate is heavy without being told that
 * is wrong.
 *
 * NOTHING HERE GRADES A PLATE. There is no target shape, no ideal split, no "balanced" and no
 * arrows. The plate method some people are taught is a real thing and it is a conversation with a
 * dietitian, not a rule an app enforces on a Tuesday night, and a screen that scores dinner is a
 * screen people start lying to. This says what is on the plate and stops.
 *
 * WHY THE FOOD IS PLACED RATHER THAN DRAGGED. Dragging looks better in a design and is worse in
 * every other way: it is poor on a phone, it is close to unusable with a keyboard or a screen
 * reader, and it lets somebody file a food in the wrong quarter, which quietly turns the plate into
 * a record of what they believed instead of what they ate. Placing it by its macros is also the
 * whole insight, because the interesting moment is finding out that the thing you thought was
 * protein is mostly starch.
 *
 * WHY THESE QUARTERS ARE NOT THE FOOD FOREST'S BIOMES. `fuel.ts` asks what a food GROWS and treats
 * fibre as its own kind, because a forest is a nice thing to have. A plate asks what a meal is MADE
 * OF, where the useful split is the one a person recognises: greens, the protein, the starch, and
 * the oils and extras. Beans are a forest in one model and carbohydrate on a plate, and both are
 * right for what they are for. Two questions, two answers, one shared method for reading macros.
 *
 * Pure functions over rows already loaded.
 */

/** Bumped when placement or the uncertainty rules change. */
export const PLATE_ENGINE_VERSION = "1.0.0";

export const QUARTERS = ["vegetables", "protein", "carbohydrate", "other"] as const;
export type Quarter = (typeof QUARTERS)[number];

export const QUARTER_INFO: Record<Quarter, { name: string; glyph: string; holds: string }> = {
  vegetables: { name: "Vegetables", glyph: "🥦", holds: "the green half, and anything that grows like it" },
  protein: { name: "Protein", glyph: "🍗", holds: "meat, fish, eggs, tofu, whatever is carrying the protein" },
  carbohydrate: { name: "Carbohydrate", glyph: "🌾", holds: "grains, starches, bread, fruit" },
  other: { name: "Everything else", glyph: "🥑", holds: "oils, fats, sauces, and anything that is mostly none of the above" },
};

export type PlateMacros = {
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  category?: string | null;
};

/**
 * Which quarter a food belongs to.
 *
 * Vegetables are named rather than inferred, because a lettuce has barely any macros at all and
 * would otherwise fall into "everything else" on a rounding error. After that it is the dominant
 * macro BY ENERGY, never by grams: fat carries roughly nine calories a gram against four for the
 * other two, so comparing raw grams buries every oil and nut under whatever carbohydrate it
 * happens to hold.
 *
 * A food with no figures at all goes to "everything else", which is the quarter that claims the
 * least about it.
 */
export function quarterOf(f: PlateMacros): Quarter {
  const cat = (f.category ?? "").toLowerCase();
  if (cat.includes("vegetable")) return "vegetables";

  const carb = Math.max(0, f.carbsG) * 4;
  const protein = Math.max(0, f.proteinG) * 4;
  const fat = Math.max(0, f.fatG) * 9;
  const total = carb + protein + fat;
  if (total <= 0) return "other";

  if (carb >= protein && carb >= fat) return "carbohydrate";
  if (protein >= fat) return "protein";
  return "other";
}

/* ------------------------------- the plate -------------------------------- */

export type PlateItem = {
  key: string;
  name: string;
  portionLabel: string;
  grams: number;
  count: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  /** Per-100 g macros and the category, for placement. */
  per100: PlateMacros;
  /** Where the figures came from, and how stale that source may be. */
  source: string;
  ageNote: string;
};

export type QuarterShare = {
  quarter: Quarter;
  items: PlateItem[];
  grams: number;
  carbsG: number;
  caloriesKcal: number;
  /** Share of the plate's WEIGHT, which is what a plate looks like. */
  shareOfWeight: number;
  /** Share of the plate's ENERGY, which is usually a very different picture. */
  shareOfEnergy: number;
};

export type PlateReading = {
  items: number;
  grams: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  /** Total carbohydrate minus fibre, never below zero. Shown as an option, never as the headline. */
  netCarbsG: number;
  quarters: QuarterShare[];
  /**
   * What this reading cannot tell you. Always at least one entry, because there is always at least
   * one thing a reference figure does not know about a real plate.
   */
  uncertainty: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function explorePlate(items: PlateItem[]): PlateReading {
  const sum = (f: (i: PlateItem) => number) => items.reduce((a, i) => a + f(i) * i.count, 0);
  const grams = sum((i) => i.grams);
  const carbsG = sum((i) => i.carbsG);
  const proteinG = sum((i) => i.proteinG);
  const fatG = sum((i) => i.fatG);
  const fiberG = sum((i) => i.fiberG);
  const caloriesKcal = sum((i) => i.caloriesKcal);
  const energy = Math.max(1, caloriesKcal);

  const quarters: QuarterShare[] = QUARTERS.map((quarter) => {
    const mine = items.filter((i) => quarterOf(i.per100) === quarter);
    const g = mine.reduce((a, i) => a + i.grams * i.count, 0);
    const kcal = mine.reduce((a, i) => a + i.caloriesKcal * i.count, 0);
    return {
      quarter,
      items: mine,
      grams: r1(g),
      carbsG: r1(mine.reduce((a, i) => a + i.carbsG * i.count, 0)),
      caloriesKcal: Math.round(kcal),
      shareOfWeight: grams > 0 ? g / grams : 0,
      shareOfEnergy: kcal / energy,
    };
  });

  return {
    items: items.length,
    grams: r1(grams),
    carbsG: r1(carbsG),
    proteinG: r1(proteinG),
    fatG: r1(fatG),
    fiberG: r1(fiberG),
    caloriesKcal: Math.round(caloriesKcal),
    netCarbsG: r1(Math.max(0, carbsG - fiberG)),
    quarters,
    uncertainty: uncertaintyOf(items),
  };
}

/**
 * What the numbers do not know.
 *
 * This list is the most useful thing on the screen and it is deliberately never empty. A
 * carbohydrate total presented with no caveat invites a precision it does not have, and somebody
 * dosing against it deserves to see the same doubts a dietitian would name out loud.
 */
export function uncertaintyOf(items: PlateItem[]): string[] {
  const out: string[] = [];
  if (items.length === 0) return ["Nothing on the plate yet."];

  out.push(
    "These are reference figures for the portions you picked. A real plate is never exactly a reference portion, and that difference is usually bigger than anything else here.",
  );

  const stale = items.filter((i) => i.ageNote);
  if (stale.length > 0) {
    out.push(
      `${stale.length === 1 ? "One figure has" : `${stale.length} figures have`} a date on the source: ${[...new Set(stale.map((i) => i.ageNote))].join("; ")}.`,
    );
  }

  const missingFat = items.filter((i) => i.per100.fatG <= 0 && i.per100.carbsG + i.per100.proteinG > 0);
  if (missingFat.length > 0) {
    out.push(
      `${missingFat.length === 1 ? "One item has" : `${missingFat.length} items have`} no fat recorded, so the calories and the shape of the plate below are lower than the real thing.`,
    );
  }

  if (items.some((i) => i.count > 1)) {
    out.push("Anything you added more than once is multiplied from a single reference portion, so it assumes each one was the same size.");
  }

  out.push("Nothing here knows about oil in the pan, a sauce, or how the food was cooked.");
  return out;
}

/**
 * One line describing the plate's shape, with no verdict in it.
 *
 * It reports weight and energy separately and on purpose. Those two pictures usually disagree, and
 * the disagreement is the thing worth seeing: a plate that is three quarters vegetables by weight
 * can be mostly oil by energy, and neither of those facts is a criticism.
 */
export function shapeLine(reading: PlateReading): string {
  if (reading.items === 0) return "Add something and this fills in.";
  const byWeight = [...reading.quarters].filter((q) => q.grams > 0).sort((a, b) => b.shareOfWeight - a.shareOfWeight)[0];
  const byEnergy = [...reading.quarters].filter((q) => q.caloriesKcal > 0).sort((a, b) => b.shareOfEnergy - a.shareOfEnergy)[0];
  if (!byWeight) return "Add something and this fills in.";
  if (!byEnergy || byWeight.quarter === byEnergy.quarter) {
    return `Most of this plate is ${QUARTER_INFO[byWeight.quarter].name.toLowerCase()}, by weight and by energy.`;
  }
  return `By weight most of this plate is ${QUARTER_INFO[byWeight.quarter].name.toLowerCase()}. By energy most of it is ${QUARTER_INFO[byEnergy.quarter].name.toLowerCase()}. Both are true and they usually differ.`;
}
