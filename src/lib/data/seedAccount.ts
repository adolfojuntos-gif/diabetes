/**
 * NOTE: no `server-only` import here on purpose. The migration and seeding scripts import this
 * module from plain Node, and `server-only` throws outside Next's bundler. The boundary it was
 * guarding, that a screen must never import the control plane directly, is asserted by
 * `tests/boundaries.test.ts` instead, which is a check that also catches the case where somebody
 * adds the import back.
 */
/**
 * Seeds the reference content into one account's database.
 *
 * Every account gets its own copy of the recipes, exercise ideas, packing template and food
 * reference. That is duplication, and it is the right trade: the reference is a few hundred small
 * rows, and the alternative is a shared database that every account can read, which reintroduces
 * exactly the cross-account connection this architecture exists to avoid. A copy per account also
 * means a person can edit or delete reference rows without affecting anybody else, which they can
 * already do with custom foods and packing items.
 *
 * Idempotent throughout, so it doubles as the repair path for an account whose signup died halfway.
 */
import type { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { profile, recipes, exerciseIdeas, packingItems, trips, foods, foodPortions } from "../db/schema";
import { RECIPES } from "./seed/recipes";
import { EXERCISE_IDEAS } from "./seed/exerciseIdeas";
import { PACKING_TEMPLATE } from "./seed/packing";
import { SEED_FOODS } from "./seed/foods";
import { newId } from "../ids";

type Db = ReturnType<typeof drizzle<typeof schema>>;

export type SeedReport = {
  profile: boolean;
  recipes: number;
  exerciseIdeas: number;
  packingItems: number;
  foods: number;
  portions: number;
};

export async function seedAccountReference(db: Db, now = new Date()): Promise<SeedReport> {
  const report: SeedReport = { profile: false, recipes: 0, exerciseIdeas: 0, packingItems: 0, foods: 0, portions: 0 };

  // One profile row per database, still id 1. It no longer means "the only person in the world",
  // it means "the person this database belongs to", which is what it always should have meant.
  const existingProfile = await db.select({ id: profile.id }).from(profile).where(eq(profile.id, 1)).limit(1);
  if (!existingProfile[0]) {
    await db.insert(profile).values({ id: 1, createdAt: now, updatedAt: now });
    report.profile = true;
  }

  for (const r of RECIPES) {
    const res = await db.insert(recipes).values(r).onConflictDoNothing();
    if ((res as { rowsAffected?: number }).rowsAffected) report.recipes++;
  }

  for (const idea of EXERCISE_IDEAS) {
    const res = await db.insert(exerciseIdeas).values(idea).onConflictDoNothing();
    if ((res as { rowsAffected?: number }).rowsAffected) report.exerciseIdeas++;
  }

  // Packing rows carry generated ids, so absence is checked by label.
  const havePacking = new Set((await db.select({ label: packingItems.label }).from(packingItems)).map((x) => x.label.toLowerCase()));
  for (const item of PACKING_TEMPLATE) {
    if (havePacking.has(item.label.toLowerCase())) continue;
    await db.insert(packingItems).values({ ...item, id: newId() });
    report.packingItems++;
  }

  const existingTrip = await db.select({ id: trips.id }).from(trips).where(eq(trips.id, 1)).limit(1);
  if (!existingTrip[0]) await db.insert(trips).values({ id: 1, name: "", days: 7, spareFraction: 0.5, updatedAt: now });

  const haveFoods = new Set((await db.select({ id: foods.id }).from(foods)).map((x) => x.id));
  for (const f of SEED_FOODS) {
    if (haveFoods.has(f.id)) continue;
    await db.insert(foods).values({
      id: f.id,
      name: f.name,
      brand: f.brand,
      category: f.category,
      carbsG: f.carbsG,
      proteinG: f.proteinG,
      fatG: f.fatG,
      fiberG: f.fiberG,
      caloriesKcal: f.caloriesKcal,
      aliases: f.aliases,
      source: f.source,
      aisle: f.aisle,
      note: f.note,
      custom: false,
      timesUsed: 0,
      lastUsedAt: null,
      createdAt: now,
    });
    report.foods++;
    let sort = 0;
    for (const p of f.portions) {
      await db.insert(foodPortions).values({ id: newId(), foodId: f.id, label: p.label, grams: p.grams, sort: sort++, custom: false });
      report.portions++;
    }
  }

  return report;
}
