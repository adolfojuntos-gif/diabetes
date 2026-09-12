import "server-only";
/**
 * The fuel layer's data access: what has been eaten, filed into biomes, and the carbohydrate story
 * for a window.
 *
 * ONE THING TO KNOW ABOUT THE JOIN. `meal_items` denormalises the figures at the moment of logging,
 * on purpose, so a deleted or edited food never rewrites a historical meal. Those stored figures are
 * PER SERVING, while the biome rules are written against per-100 g macros, which is the basis the
 * food table uses. Dividing back out is therefore required rather than cosmetic: an item logged at
 * 300 g would otherwise look like three times the fat it has, and half the kitchen would migrate to
 * the springs.
 */
import { and, desc, gte, lt } from "drizzle-orm";
import { db, meals, mealItems, foods } from "../db";
import { addDays, startOfDay, endOfDay } from "../time";
import {
  buildEcosystem,
  carbCompass,
  biomeOf,
  fuelProfile,
  energyOf,
  type Ecosystem,
  type Compass,
  type Biome,
  type FuelProfile,
} from "../engines/fuel";
import { getProfile } from "./snapshot";

/** Per-100 g macros from a serving's stored figures. Zero grams yields zeroes rather than NaN. */
function per100(grams: number, value: number): number {
  if (!Number.isFinite(grams) || grams <= 0) return 0;
  return (value / grams) * 100;
}

export async function ecosystem(): Promise<Ecosystem> {
  const items = await db
    .select({
      name: mealItems.name,
      foodId: mealItems.foodId,
      grams: mealItems.grams,
      carbsG: mealItems.carbsG,
      proteinG: mealItems.proteinG,
      fatG: mealItems.fatG,
      fiberG: mealItems.fiberG,
    })
    .from(mealItems);

  // One read of the food table rather than a join per item: the reference is small and this keeps
  // the query count flat however many meals somebody has logged.
  const cats = new Map<string, string>();
  for (const f of await db.select({ id: foods.id, category: foods.category }).from(foods)) cats.set(f.id, f.category);

  return buildEcosystem(
    items.map((i) => ({
      name: i.name,
      grams: i.grams,
      carbsG: per100(i.grams, i.carbsG),
      proteinG: per100(i.grams, i.proteinG),
      fatG: per100(i.grams, i.fatG),
      fiberG: per100(i.grams, i.fiberG),
      category: i.foodId ? (cats.get(i.foodId) ?? null) : null,
    })),
  );
}

/** The carbohydrate story for a window ending now. */
export async function compass(days: number, now = new Date()): Promise<Compass> {
  const profile = await getProfile();
  const from = days <= 1 ? startOfDay(now) : addDays(startOfDay(now), -(days - 1));
  const rows = await db
    .select({ at: meals.at, carbsG: meals.carbsG, slot: meals.slot, name: meals.name })
    .from(meals)
    .where(and(gte(meals.at, from), lt(meals.at, endOfDay(now))))
    .orderBy(desc(meals.at));
  return carbCompass(rows, profile.dailyCarbTargetG);
}

export type LastMeal = {
  name: string;
  at: Date;
  energy: number;
  carbsG: number;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
  profile: FuelProfile;
  /** True when the meal carries only carbohydrate, so the profile is honestly unknown. */
  thin: boolean;
};

/**
 * The last meal, in the game's language.
 *
 * Read from the meal row rather than recomputed from its items, because the row is what every
 * other screen in the app already shows. Two places deriving the same figure differently is how a
 * person ends up seeing 62 g here and 61 g on the next screen and trusting neither.
 *
 * Protein and fat are nullable on a meal, and a shape claim needs both. `thin` says so, and the
 * engine independently refuses to name a dominant macro without them: the page cannot accidentally
 * present a profile the engine would not stand behind.
 */
export async function lastMeal(): Promise<LastMeal | null> {
  const rows = await db
    .select({
      name: meals.name,
      at: meals.at,
      carbsG: meals.carbsG,
      proteinG: meals.proteinG,
      fatG: meals.fatG,
      fiberG: meals.fiberG,
      caloriesKcal: meals.caloriesKcal,
    })
    .from(meals)
    .orderBy(desc(meals.at))
    .limit(1);
  const m = rows[0];
  if (!m) return null;
  const thin = m.proteinG === null || m.fatG === null;
  return {
    name: m.name,
    at: m.at,
    energy: energyOf(m.caloriesKcal ?? 0),
    carbsG: Math.round(m.carbsG),
    proteinG: m.proteinG,
    fatG: m.fatG,
    fiberG: m.fiberG,
    // Nulls passed through, not coalesced: the engine has to see what is missing to say so.
    profile: fuelProfile({ carbsG: m.carbsG, proteinG: m.proteinG, fatG: m.fatG, fiberG: m.fiberG }),
    thin,
  };
}

/** The most recent things logged into each biome, for the Food Forest's own page. */
export async function recentByBiome(limit = 6): Promise<Record<Biome, string[]>> {
  const rows = await db
    .select({
      name: mealItems.name,
      foodId: mealItems.foodId,
      grams: mealItems.grams,
      carbsG: mealItems.carbsG,
      proteinG: mealItems.proteinG,
      fatG: mealItems.fatG,
      fiberG: mealItems.fiberG,
      mealId: mealItems.mealId,
    })
    .from(mealItems)
    .orderBy(desc(mealItems.mealId))
    .limit(400);

  const cats = new Map<string, string>();
  for (const f of await db.select({ id: foods.id, category: foods.category }).from(foods)) cats.set(f.id, f.category);

  const out: Record<Biome, string[]> = { orchard: [], garden: [], forest: [], fields: [], pasture: [], springs: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const b = biomeOf({
      carbsG: per100(r.grams, r.carbsG),
      proteinG: per100(r.grams, r.proteinG),
      fatG: per100(r.grams, r.fatG),
      fiberG: per100(r.grams, r.fiberG),
      category: r.foodId ? (cats.get(r.foodId) ?? null) : null,
    });
    const key = `${b}:${r.name.toLowerCase()}`;
    if (seen.has(key) || out[b].length >= limit) continue;
    seen.add(key);
    out[b].push(r.name);
  }
  return out;
}
