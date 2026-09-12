/**
 * Load a restaurant's published nutrition data into one account's food reference.
 *
 * WHY THIS IS AN IMPORTER AND NOT A BUILT-IN DATABASE.
 *
 * Somebody with diabetes doses insulin against a carbohydrate figure. A figure that was recalled,
 * inferred from a similar dish, or averaged across a category is a made-up number wearing the
 * clothes of a measurement, and it is worse than no number at all, because the person will trust it
 * more than their own estimate. So nothing in this app ships chain menu data that was not read from
 * a real published source.
 *
 * That is what this script is for. Most chains of any size publish a nutrition file, because in the
 * United States the FDA menu labelling rule requires it of chains with twenty or more locations.
 * Convert that file to the shape below, once, and this loads it with the restaurant's name and the
 * date attached to every row.
 *
 * WHAT IT CHECKS, and each one has caught real bad data somewhere:
 *
 *  - Carbohydrate, protein and fat cannot exceed the serving weight. A dish cannot contain more
 *    carbohydrate than it weighs, and this catches a per-100g figure pasted into a per-serving
 *    column, which is the single most common conversion mistake.
 *  - Calories have to agree with the macros to within a quarter. Protein and carbohydrate carry
 *    about 4 kcal a gram and fat about 9, so a row where they disagree badly has a typo in it.
 *  - Fibre cannot exceed carbohydrate.
 *  - A serving weight is required. Without one, a per-serving figure cannot be converted to the
 *    per-100g basis this table stores, and guessing the weight would invent the number.
 *
 * A row that fails is reported and skipped. The import continues, because one bad row in a chain's
 * file should not cost you the other two hundred.
 *
 *   npm run foods:restaurant -- you@example.com ./chipotle-2026-09.json
 *
 * The file: { "restaurant": "...", "sourceDate": "YYYY-MM-DD", "items": [ ... ] }
 * Each item: { "name", "servingGrams", "carbsG", "proteinG", "fatG", "fiberG", "caloriesKcal",
 *              "servingLabel"?, "note"? }  with every figure PER SERVING.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { runForAccount } from "./_account";
import { eq } from "drizzle-orm";
import { db, foods, foodPortions } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { caloriesBelowFloor } from "../src/lib/engines/foods";

const USAGE = "npm run foods:restaurant -- you@example.com ./their-published-file.json";

const Item = z.object({
  name: z.string().min(1).max(160),
  /** Per serving, in grams. Required: it is what converts the figures to this table's basis. */
  servingGrams: z.number().positive().max(5000),
  carbsG: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(5000).default(0),
  fatG: z.number().min(0).max(5000).default(0),
  fiberG: z.number().min(0).max(5000).default(0),
  caloriesKcal: z.number().min(0).max(20000).default(0),
  servingLabel: z.string().max(80).optional(),
  note: z.string().max(400).optional(),
});

const File = z.object({
  restaurant: z.string().min(1).max(120),
  /** The day the figures were read from the restaurant, not the day of the import. */
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "sourceDate must be YYYY-MM-DD"),
  items: z.array(Item).min(1),
});

type Row = z.infer<typeof Item>;

/** Problems that mean a row's numbers cannot be trusted. Empty means it is usable. */
function problemsWith(r: Row): string[] {
  const out: string[] = [];

  const massOfMacros = r.carbsG + r.proteinG + r.fatG;
  if (massOfMacros > r.servingGrams) {
    out.push(
      `macros total ${Math.round(massOfMacros)} g in a ${Math.round(r.servingGrams)} g serving, which is impossible. Are these per 100 g rather than per serving?`,
    );
  }
  if (r.fiberG > r.carbsG) out.push(`fibre ${r.fiberG} g exceeds carbohydrate ${r.carbsG} g`);

  /**
   * Only a SHORTFALL is an error. Macros set a floor on energy, and a stated value above the floor
   * is ordinary: the table has no column for alcohol, which carries about 7 kcal a gram. A
   * symmetric check flagged regular beer and raw spinach as broken when both were correct.
   */
  const energy = caloriesBelowFloor(r);
  if (energy.below) {
    out.push(
      `states ${Math.round(r.caloriesKcal)} kcal, but its macros account for at least ${Math.round(energy.implied)}`,
    );
  }
  return out;
}

/** A stable id, so re-importing an updated file replaces rows rather than duplicating them. */
function idFor(restaurant: string, name: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  return `rest-${slug(restaurant)}-${slug(name)}`;
}

async function main() {
  const path = process.argv.slice(2).find((a) => !a.includes("@") && /\.json$/i.test(a));
  if (!path) {
    console.error(`Which file? Pass a path to the published data.\n  ${USAGE}`);
    process.exit(2);
  }

  const parsed = File.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    console.error(`That file is not in the expected shape:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    process.exit(2);
  }
  const { restaurant, sourceDate, items } = parsed.data;

  /**
   * A date in the future is a typo. It would make every figure look permanently fresh, which is the
   * opposite of what the date is for.
   */
  if (new Date(`${sourceDate}T00:00:00`).getTime() > Date.now()) {
    console.error(`sourceDate ${sourceDate} is in the future. Use the day you read the figures.`);
    process.exit(2);
  }

  console.log(`${restaurant}, ${items.length} items, published figures read ${sourceDate}\n`);

  let added = 0;
  let replaced = 0;
  const skipped: string[] = [];

  for (const r of items) {
    const problems = problemsWith(r);
    if (problems.length) {
      skipped.push(`${r.name}: ${problems.join("; ")}`);
      continue;
    }

    // Per serving to per 100 g, which is the only basis this table stores.
    const k = 100 / r.servingGrams;
    const per100 = {
      carbsG: Math.round(r.carbsG * k * 10) / 10,
      proteinG: Math.round(r.proteinG * k * 10) / 10,
      fatG: Math.round(r.fatG * k * 10) / 10,
      fiberG: Math.round(r.fiberG * k * 10) / 10,
      caloriesKcal: Math.round(r.caloriesKcal * k),
    };

    const id = idFor(restaurant, r.name);
    const existing = await db.select({ id: foods.id }).from(foods).where(eq(foods.id, id)).limit(1);
    const now = new Date();

    const row = {
      name: r.name,
      brand: restaurant,
      category: "restaurant dishes",
      ...per100,
      // The restaurant name is searchable too, so one word finds everything they published.
      aliases: [r.name.toLowerCase(), restaurant.toLowerCase()].join(","),
      source: "Restaurant published data" as const,
      sourceDate,
      aisle: "other" as const,
      note: r.note ?? "",
      custom: false,
    };

    if (existing[0]) {
      await db.update(foods).set(row).where(eq(foods.id, id));
      // Portions are rewritten rather than merged, so a resized serving does not leave the old one.
      await db.delete(foodPortions).where(eq(foodPortions.foodId, id));
      replaced++;
    } else {
      await db.insert(foods).values({ id, ...row, timesUsed: 0, lastUsedAt: null, createdAt: now });
      added++;
    }

    await db.insert(foodPortions).values({
      id: newId(),
      foodId: id,
      label: r.servingLabel || "1 serving as published",
      grams: r.servingGrams,
      sort: 0,
      custom: false,
    });
  }

  console.log(`added ${added}, updated ${replaced}, skipped ${skipped.length}`);
  if (skipped.length) {
    console.error(`\nskipped, because their numbers do not hold together:`);
    for (const s of skipped) console.error(`  ${s}`);
    /**
     * Non-zero, because a silent partial import of clinical figures is the thing to avoid. The rows
     * that passed are in; the exit code is what makes somebody look at the ones that did not.
     */
    process.exit(1);
  }
}

/**
 * Only run the command-line path when this file IS the command, so importing it for a test does not
 * resolve an account from `process.argv` and exit the process.
 */
if (process.argv[1]?.endsWith("importRestaurant.ts")) {
  runForAccount(USAGE, () => main())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { problemsWith, idFor, File as RestaurantFile };
