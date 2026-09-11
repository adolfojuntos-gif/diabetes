/**
 * Seeds the carbohydrate reference. Idempotent: existing rows are left alone, so it is safe to
 * re-run after the reference list grows. Custom foods the person added are never touched.
 *
 * Kept separate from `seed.ts` because the reference is the one seeded table that will keep
 * growing, and re-running it should not mean re-running everything else.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, foods, foodPortions } from "../src/lib/db";
import { SEED_FOODS } from "../src/lib/data/seed/foods";
import { newId } from "../src/lib/ids";

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

  // A reference value people make decisions on should not disagree with itself.
  const bad: string[] = [];
  for (const f of SEED_FOODS) {
    const implied = 4 * f.carbsG + 4 * f.proteinG + 9 * f.fatG;
    if (f.caloriesKcal > 20 && Math.abs(implied - f.caloriesKcal) / f.caloriesKcal > 0.25) {
      bad.push(`${f.id}: states ${f.caloriesKcal} kcal, macros imply ${Math.round(implied)}`);
    }
    if (f.portions.length === 0) bad.push(`${f.id}: no portions`);
  }
  if (bad.length) {
    console.log(`\n${bad.length} entries look internally inconsistent and are worth checking:`);
    for (const b of bad.slice(0, 15)) console.log(`  ${b}`);
  } else {
    console.log("energy check: every entry's calories agree with its macros");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
