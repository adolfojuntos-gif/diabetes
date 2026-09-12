/**
 * Links existing fictional demo meals to reference foods, so the "what your own readings did after
 * this food" panel has real computed rises to show. Part of the demo data, removed by
 * `npm run demo -- <email> --clear` along with the meals it points at.
 *
 * Takes an ACCOUNT. It used to open `data/steady.db`, which since the split is only the
 * pre-migration backup, so it linked meals in a database the app never reads and said it had
 * worked. Run it after `npm run demo -- <email>`, which creates the meals this looks for.
 *
 *   npm run demo:links -- you@example.com
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import type { Client } from "@libsql/client";
import { clientFromArgv } from "./_account";

const USAGE = "npm run demo:links -- you@example.com";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");

/**
 * Which demo meal names contain which reference food, and roughly how much of it.
 *
 * The ids and portion labels are the CANONICAL ones from `src/lib/data/seed/foods.ts`, which is
 * what every account is seeded with. Three of the four used to be the ids from the old starter
 * slice, whose word order was the other way round: `rice-white-cooked` against the canonical
 * `white-rice-cooked`, `spaghetti-meat-sauce` against `spaghetti-with-meat-sauce`, and
 * `pizza-cheese-slice` against `cheese-pizza-slice`. So three of the four links resolved to nothing
 * and only the oats were ever linked. That was invisible while the script also wrote to the wrong
 * database, because everything it did was invisible.
 *
 * The grams come from a real portion of that food, so the carbohydrate figures the panel shows are
 * the reference's own arithmetic rather than numbers chosen to look right.
 */
const LINKS = [
  { match: "Salmon, rice and broccoli", foodId: "white-rice-cooked", name: "White rice, cooked", portion: "1 cup cooked", grams: 158 },
  { match: "Pasta bolognese", foodId: "spaghetti-with-meat-sauce", name: "Spaghetti with meat sauce", portion: "restaurant portion", grams: 400 },
  { match: "Takeout pizza", foodId: "cheese-pizza-slice", name: "Cheese pizza", portion: "2 slices", grams: 214 },
  { match: "Overnight oats with chia", foodId: "oatmeal-cooked", name: "Oatmeal, cooked with water", portion: "1 cup cooked", grams: 234 },
];

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Links the demo meals to reference foods. Takes a client so the deployment bootstrap can call it
 * without spawning a subprocess.
 */
export async function linkDemoFoods(client: Client) {
  {
    const foods = new Map(
      (await client.execute("select id,carbs_g,protein_g,fat_g,fiber_g,calories_kcal from foods")).rows.map((r) => [
        String(r.id),
        {
          carbs: Number(r.carbs_g),
          protein: Number(r.protein_g),
          fat: Number(r.fat_g),
          fiber: Number(r.fiber_g),
          kcal: Number(r.calories_kcal),
        },
      ]),
    );

    const existing = new Set((await client.execute("select meal_id from meal_items")).rows.map((r) => String(r.meal_id)));
    let added = 0;
    let matchedMeals = 0;
    const missingFoods: string[] = [];

    for (const link of LINKS) {
      const food = foods.get(link.foodId);
      if (!food) {
        // A stale id is how this script quietly did a quarter of its job for weeks. Collected and
        // reported at the end as a failure rather than printed once in the middle and scrolled past.
        missingFoods.push(link.foodId);
        continue;
      }
      const meals = (await client.execute({ sql: "select id from meals where name = ? and note = 'demo'", args: [link.match] })).rows;
      matchedMeals += meals.length;
      const k = link.grams / 100;
      for (const m of meals) {
        const mealId = String(m.id);
        if (existing.has(mealId)) continue;
        await client.execute({
          sql:
            "insert into meal_items (id,meal_id,food_id,name,portion_label,grams,carbs_g,protein_g,fat_g,fiber_g,calories_kcal,basis)" +
            " values (?,?,?,?,?,?,?,?,?,?,?,'reference')",
          args: [
            newId(),
            mealId,
            link.foodId,
            link.name,
            link.portion,
            link.grams,
            r1(food.carbs * k),
            r1(food.protein * k),
            r1(food.fat * k),
            r1(food.fiber * k),
            Math.round(food.kcal * k),
          ],
        });
        added++;
      }
      await client.execute({
        sql: "update foods set times_used = (select count(*) from meal_items where food_id = ?), last_used_at = ? where id = ?",
        args: [link.foodId, Math.floor(Date.now() / 1000), link.foodId],
      });
    }

    console.log(`linked ${added} demo meals to reference foods`);
    for (const link of LINKS) {
      const n = (await client.execute({ sql: "select count(*) n from meal_items where food_id = ?", args: [link.foodId] })).rows[0].n;
      console.log(`  ${link.name}: ${n} meals`);
    }

    /**
     * Zero matched meals means the demo data is not there, and saying so beats "linked 0 meals",
     * which is exactly what the old version printed against the wrong database.
     */
    if (matchedMeals === 0) {
      console.log(`\nNo demo meals found in this account. Run this first:  npm run demo -- <email>`);
    }

    /**
     * A missing food id is a bug in this script, not a state of the account, so it exits non-zero.
     * Every id in LINKS is supposed to be in the reference every account is seeded with, and if one
     * is not then the reference was renamed and this list was not updated with it.
     */
    if (missingFoods.length) {
      console.error(`\n${missingFoods.length} food id(s) are not in the reference: ${missingFoods.join(", ")}`);
      console.error(`Check them against src/lib/data/seed/foods.ts. This list is meant to match it.`);
      process.exit(1);
    }
  }
}

async function main() {
  const { client } = await clientFromArgv(USAGE);
  try {
    await linkDemoFoods(client);
  } finally {
    try {
      client.close();
    } catch {
      /* a handle that will not close is not worth failing over */
    }
  }
}

/**
 * Only run the command-line path when this file IS the command.
 *
 * Without the guard, importing it for its exported function runs the CLI wrapper as a side effect
 * of the import, which resolves an account from `process.argv` and exits the whole process with
 * "Which account?" before the caller gets anywhere. That is what the deployment bootstrap does, so
 * the boot would have died on an import.
 */
if (process.argv[1]?.endsWith("demoFoodLinks.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
