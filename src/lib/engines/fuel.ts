/**
 * FUEL — what food does to the world, and the Carb Compass.
 *
 * Two jobs, one file, because they read the same rows.
 *
 * THE FOOD FOREST. Every meal logged grows part of an ecosystem: fruit builds an orchard,
 * vegetables a garden, fibre-rich things a forest, starches the fields, protein the pasture, fats
 * the springs. Over months a food journal becomes a place, and that is the whole point. It is the
 * first thing in this product that makes logging lunch feel like it built something.
 *
 * THE CARB COMPASS. What this deliberately does NOT do is tell somebody they have "80 g left". A
 * remaining-budget number turns a meal into an overdraft and is the single most restrictive thing a
 * diabetes app can put on a screen, especially in front of somebody with a history of disordered
 * eating. It describes instead: how much, spread across what, and what the spread has looked like.
 *
 * BIOMES ARE DERIVED FROM MACROS, NOT FROM CATEGORY NAMES. The `foods.category` column is free text
 * and already holds seventeen different values in one database, including "mexican dishes" and
 * "breads and tortillas". A lookup table keyed on those strings would be wrong the first time
 * somebody added a food, and silently: the meal would simply grow nothing. Grams of fibre, carbs,
 * protein and fat are the same in every language, so the mapping reads those and uses the category
 * only where it genuinely disambiguates. A food with no figures at all still lands somewhere
 * harmless rather than nowhere.
 *
 * NOTHING HERE IS A JUDGEMENT. No biome is better than another, a meal cannot be "wrong", and
 * nothing in this file calls a number good, bad, high or over. The word "balanced" appears nowhere.
 * Pure functions over rows already loaded.
 */

/** Bumped when the mapping or the compass arithmetic changes. */
export const FUEL_ENGINE_VERSION = "1.0.0";

export const BIOMES = ["orchard", "garden", "forest", "fields", "pasture", "springs"] as const;
export type Biome = (typeof BIOMES)[number];

export type BiomeInfo = { key: Biome; name: string; grows: string; from: string; glyph: string };

export const BIOME_INFO: Record<Biome, BiomeInfo> = {
  orchard: { key: "orchard", name: "The Orchard", grows: "fruit trees", from: "fruit", glyph: "🍎" },
  garden: { key: "garden", name: "The Garden", grows: "beds and rows", from: "vegetables", glyph: "🥬" },
  forest: { key: "forest", name: "The Forest", grows: "trees", from: "fibre-rich food", glyph: "🌳" },
  fields: { key: "fields", name: "The Fields", grows: "crops", from: "starches and grains", glyph: "🌾" },
  pasture: { key: "pasture", name: "The Pasture", grows: "grazing land", from: "protein", glyph: "🐄" },
  springs: { key: "springs", name: "The Springs", grows: "water", from: "fats and oils", glyph: "💧" },
};

/** Per 100 g as eaten, which is the only basis the food table holds. */
export type Macros = {
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  category?: string | null;
};

/**
 * Where a food grows.
 *
 * The order of these rules is the design, not an accident, and each one is here because of what it
 * would otherwise get wrong:
 *
 *  1. Fruit and vegetables are named first, because an apple is an apple. Deciding it by macro
 *     alone would file it under starch, which is true and useless.
 *  2. Real fibre next, because that is the one property worth surfacing on its own, and a food with
 *     six grams per hundred has it whatever else it is.
 *  3. Then the dominant macro by energy, not by mass. Grams are not comparable across macros: fat
 *     carries roughly nine calories a gram against four for carbohydrate and protein, so comparing
 *     raw grams quietly buries every oil, nut and cheese under whatever carbohydrate they carry.
 *  4. Anything with no figures at all lands in the garden, because a meal that grew nothing would
 *     read as the app having ignored it.
 */
export function biomeOf(f: Macros): Biome {
  const cat = (f.category ?? "").toLowerCase();
  if (cat.includes("fruit")) return "orchard";
  if (cat.includes("vegetable")) return "garden";

  if (f.fiberG >= 6) return "forest";

  const carbEnergy = Math.max(0, f.carbsG) * 4;
  const proteinEnergy = Math.max(0, f.proteinG) * 4;
  const fatEnergy = Math.max(0, f.fatG) * 9;
  const total = carbEnergy + proteinEnergy + fatEnergy;
  if (total <= 0) return "garden";

  if (fatEnergy >= carbEnergy && fatEnergy >= proteinEnergy) return "springs";
  if (proteinEnergy >= carbEnergy) return "pasture";
  return "fields";
}

/* ------------------------------ the food forest ---------------------------- */

export type MealItemLike = Macros & { grams: number; name: string };

export type Ecosystem = {
  /** Grams of food logged into each biome, all time. Grams rather than portions: a bite is not a plate. */
  grams: Record<Biome, number>;
  /** Distinct foods seen in each biome, which is the variety rather than the volume. */
  variety: Record<Biome, number>;
  /**
   * 0..5 per biome, from grams. What the drawing reads. Logarithmic, because the difference between
   * nothing and a first meal should be visible and the difference between the ninetieth and the
   * ninety-first should not.
   */
  level: Record<Biome, number>;
  totalGrams: number;
  /** Every distinct food ever logged, which is the Food Universe in its smallest honest form. */
  foodsTried: number;
};

const EMPTY = (): Record<Biome, number> => ({ orchard: 0, garden: 0, forest: 0, fields: 0, pasture: 0, springs: 0 });

/** Thresholds in grams for each biome level. Roughly: a meal, a week, a month, a season, a year. */
const BIOME_STEPS = [0, 150, 900, 4_000, 15_000, 50_000];

export function biomeLevel(grams: number): number {
  let level = 0;
  for (let i = 1; i < BIOME_STEPS.length; i++) if (grams >= BIOME_STEPS[i]) level = i;
  return level;
}

export function buildEcosystem(items: MealItemLike[]): Ecosystem {
  const grams = EMPTY();
  const seen: Record<Biome, Set<string>> = {
    orchard: new Set(),
    garden: new Set(),
    forest: new Set(),
    fields: new Set(),
    pasture: new Set(),
    springs: new Set(),
  };
  const all = new Set<string>();

  for (const it of items) {
    const b = biomeOf(it);
    grams[b] += Math.max(0, it.grams);
    const key = it.name.trim().toLowerCase();
    if (key) {
      seen[b].add(key);
      all.add(key);
    }
  }

  const variety = EMPTY();
  const level = EMPTY();
  let total = 0;
  for (const b of BIOMES) {
    variety[b] = seen[b].size;
    level[b] = biomeLevel(grams[b]);
    total += grams[b];
  }

  return { grams, variety, level, totalGrams: total, foodsTried: all.size };
}

/* ------------------------------ the carb compass --------------------------- */

export type MealLike = { at: Date; carbsG: number; slot: string; name: string };

export type SlotShare = { slot: string; label: string; meals: number; carbsG: number; share: number };

export type Compass = {
  /** Meals logged in the window, and what they carried. */
  meals: number;
  carbsG: number;
  daysCovered: number;
  /** Carbohydrate per meal, averaged. Descriptive, never a target. */
  perMeal: number | null;
  /** How the carbohydrate sat across the day. The shape, not a score. */
  spread: SlotShare[];
  /**
   * Observations the engine can actually evidence, or an empty list. Each is a fact about their own
   * record with the figure that produced it, and none of them is advice.
   */
  notes: string[];
  /** Why nothing can be said yet, when that is the case. */
  thin: string | null;
  /** Their own number, only when they set one with their care team. Never invented. */
  ownTargetG: number | null;
};

const SLOT_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"];

/**
 * The compass. Describes a window of meals: how much carbohydrate, across how many meals, sitting
 * where in the day.
 *
 * `ownTargetG` is passed in and is null unless the person recorded a daily figure with their care
 * team. The engine NEVER derives one, never suggests one, and never subtracts to produce a
 * "remaining". When a target exists it is reported as theirs, beside what they logged, and the
 * comparison is left to them.
 */
export function carbCompass(meals: MealLike[], ownTargetG: number | null): Compass {
  const carbs = meals.reduce((a, m) => a + Math.max(0, m.carbsG), 0);
  const dayKeys = new Set(meals.map((m) => `${m.at.getFullYear()}-${m.at.getMonth()}-${m.at.getDate()}`));

  const bySlot = new Map<string, { meals: number; carbsG: number }>();
  for (const m of meals) {
    const slot = SLOT_ORDER.includes(m.slot) ? m.slot : "snack";
    const cur = bySlot.get(slot) ?? { meals: 0, carbsG: 0 };
    cur.meals++;
    cur.carbsG += Math.max(0, m.carbsG);
    bySlot.set(slot, cur);
  }

  const spread: SlotShare[] = SLOT_ORDER.filter((s) => bySlot.has(s)).map((s) => {
    const v = bySlot.get(s)!;
    return { slot: s, label: SLOT_LABEL[s] ?? s, meals: v.meals, carbsG: v.carbsG, share: carbs > 0 ? v.carbsG / carbs : 0 };
  });

  /*
   * Observations need enough meals to be observations. Three is the floor: below it every "pattern"
   * is one lunch, and a product that calls one lunch a pattern teaches people to distrust it.
   */
  const notes: string[] = [];
  let thin: string | null = null;
  if (meals.length < 3) {
    thin = `Three meals in the window is the least this can describe anything from. There ${meals.length === 1 ? "is 1" : `are ${meals.length}`} so far.`;
  } else {
    const biggest = [...spread].sort((a, b) => b.carbsG - a.carbsG)[0];
    if (biggest && biggest.share >= 0.4) {
      notes.push(`${Math.round(biggest.share * 100)}% of the carbohydrate you logged sat at ${biggest.label.toLowerCase()}.`);
    }
    const covered = dayKeys.size;
    if (covered > 0) {
      notes.push(`${meals.length} meal${meals.length === 1 ? "" : "s"} logged across ${covered} day${covered === 1 ? "" : "s"}.`);
    }
    const missing = SLOT_ORDER.filter((s) => !bySlot.has(s) && s !== "snack");
    if (missing.length > 0 && covered >= 3) {
      notes.push(
        `Nothing is logged at ${missing.map((s) => (SLOT_LABEL[s] ?? s).toLowerCase()).join(" or ")}, so this describes the rest of the day only.`,
      );
    }
  }

  return {
    meals: meals.length,
    carbsG: Math.round(carbs),
    daysCovered: dayKeys.size,
    perMeal: meals.length > 0 ? Math.round(carbs / meals.length) : null,
    spread,
    notes,
    thin,
    ownTargetG: ownTargetG && ownTargetG > 0 ? ownTargetG : null,
  };
}

/* -------------------------------- fuel framing ----------------------------- */

export type FuelProfile = { key: string; name: string; note: string };

/**
 * A meal's shape, in the game's language.
 *
 * This is a DESCRIPTION and never a verdict, which is why every name below is neutral and none of
 * them can be ranked against another. There is no "balanced", no "good" and no "poor", because the
 * moment one profile is better than another the screen has started grading somebody's dinner.
 *
 * MISSING IS NOT ZERO, and this is the whole reason the arguments are nullable.
 *
 * A dominant macro can only be named when ALL THREE are recorded. Not most of them: all of them.
 * Fat carries nine calories a gram against four for the other two, so an absent fat figure does
 * not merely add uncertainty, it systematically biases the answer toward whichever macro WAS
 * recorded.
 *
 * This was found in production data rather than reasoned about in advance. A real meal logged as
 * 16 g carbohydrate and 12 g protein with fat left blank came out as 57% carbohydrate by energy
 * and the app announced, in the game's own voice, that a Greek salad with chicken was mostly
 * starch. Add the olive oil and feta that a Greek salad actually contains and the same plate is
 * mostly fat. Every one of the hundred and twenty-two meals in that database had fat missing, so
 * the feature would have been confidently wrong every single time.
 *
 * Saying nothing is always available and is never wrong.
 */
export function fuelProfile(m: {
  carbsG: number;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
}): FuelProfile {
  if (m.proteinG === null || m.fatG === null) {
    const missing = [m.proteinG === null ? "protein" : null, m.fatG === null ? "fat" : null].filter(Boolean).join(" and ");
    return {
      key: "unknown",
      name: "Shape not recorded",
      note: `No ${missing} figure was logged for this one, so what the plate was mostly made of is unknown rather than absent.`,
    };
  }
  const carb = Math.max(0, m.carbsG) * 4;
  const protein = Math.max(0, m.proteinG ?? 0) * 4;
  const fat = Math.max(0, m.fatG ?? 0) * 9;
  const total = carb + protein + fat;
  if (total <= 0) return { key: "unknown", name: "Not enough detail yet", note: "Add what was in it and this fills in." };


  const shares = [
    { key: "carb", v: carb },
    { key: "protein", v: protein },
    { key: "fat", v: fat },
  ].sort((a, b) => b.v - a.v);
  const top = shares[0];
  const dominant = top.v / total >= 0.55;

  if (!dominant) return { key: "mixed", name: "Mixed fuel", note: "Energy from more than one source." };
  if (top.key === "carb") return { key: "quick", name: "Field fuel", note: "Mostly from starches, grains or fruit." };
  if (top.key === "protein") return { key: "steady", name: "Pasture fuel", note: "Mostly from protein." };
  return { key: "slow", name: "Spring fuel", note: "Mostly from fats and oils." };
}

/** Calories, called Energy in the game. The number is the engine's; only the label changes. */
export function energyOf(caloriesKcal: number): number {
  return Math.round(Math.max(0, caloriesKcal));
}
