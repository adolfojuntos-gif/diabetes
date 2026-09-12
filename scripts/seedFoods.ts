/**
 * Seeds the carbohydrate reference. Idempotent: existing rows are left alone, so it is safe to
 * re-run after the reference list grows. Custom foods the person added are never touched.
 *
 * Kept separate from `seed.ts` because the reference is the one seeded table that will keep
 * growing, and re-running it should not mean re-running everything else.
 *
 * Takes an ACCOUNT. The reference is copied into each account's own database rather than shared, so
 * there is no one table to seed: without an account every query here throws. Growing the reference
 * list means running this for each account that should get the new entries, or leaving them to
 * arrive with `npm run migrate:all` and the next signup.
 *
 *   npm run seed:foods -- you@example.com
 */
import "dotenv/config";
import { db, foods, foodPortions } from "../src/lib/db";
import { SEED_FOODS } from "../src/lib/data/seed/foods";
import { newId } from "../src/lib/ids";
import { runForAccount } from "./_account";
import { caloriesBelowFloor } from "../src/lib/engines/foods";

async function main() {
  const now = new Date();
  const existing = new Set((await db.select({ id: foods.id }).from(foods)).map((r) => r.id));

  let added = 0;
  let portions = 0;
  for (const f of SEED_FOODS) {
    if (existing.has(f.id)) continue;
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
    added++;
    let sort = 0;
    for (const p of f.portions) {
      await db.insert(foodPortions).values({ id: newId(), foodId: f.id, label: p.label, grams: p.grams, sort: sort++, custom: false });
      portions++;
    }
  }

  const total = (await db.select({ id: foods.id }).from(foods)).length;
  console.log(`foods: ${added} added, ${SEED_FOODS.length - added} already present`);
  console.log(`portions: ${portions} added`);
  console.log(`reference now holds ${total} foods`);

  /**
   * A reference value people make decisions on should not disagree with itself.
   *
   * This check used to be symmetric and flat: 4 kcal a gram for carbohydrate and protein, 9 for
   * fat, and a complaint whenever the stated value differed either way. It reported two entries as
   * broken and BOTH were correct.
   *
   * Raw spinach, because fibre is a carbohydrate that is only partly metabolised, so it carries
   * about 2 kcal a gram rather than 4. And regular beer, because the energy in it is mostly alcohol
   * at about 7 kcal a gram, and this table has no column for alcohol.
   *
   * Macros set a FLOOR on energy, not a target. Below the floor is a data error. Above it is
   * ordinary. `caloriesBelowFloor` is shared with the restaurant importer so the two cannot
   * disagree about what a broken row looks like.
   */
  const bad: string[] = [];
  for (const f of SEED_FOODS) {
    const energy = caloriesBelowFloor(f);
    if (energy.below) {
      bad.push(`${f.id}: states ${f.caloriesKcal} kcal, but its macros account for at least ${Math.round(energy.implied)}`);
    }
    if (f.portions.length === 0) bad.push(`${f.id}: no portions`);
  }
  if (bad.length) {
    console.log(`\n${bad.length} entries state less energy than their macros account for:`);
    for (const b of bad.slice(0, 15)) console.log(`  ${b}`);
  } else {
    console.log("energy check: no entry states less energy than its macros account for");
  }
}

runForAccount("npm run seed:foods -- you@example.com", () => main())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
