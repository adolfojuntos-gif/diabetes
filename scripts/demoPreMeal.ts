/**
 * Adds a before-meal reading to the fictional demo meals that are linked to reference foods.
 *
 * Without one, a meal is "uncovered" and the app correctly refuses to report a rise, which is the
 * right behaviour and a poor demonstration of it. A person who checks before eating has these
 * readings, so the demo should too. Values are derived from the same crude curve the demo
 * generator uses: a plausible pre-meal number for the time of day, with a little variation.
 *
 * Takes an ACCOUNT. It used to open `data/steady.db`, which since the split is only the
 * pre-migration backup, so it wrote readings nothing would ever display.
 *
 *   npm run demo:premeal -- you@example.com
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import type { Client } from "@libsql/client";
import { clientFromArgv } from "./_account";

const USAGE = "npm run demo:premeal -- you@example.com";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");

let seed = 77771;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

// Meals that now carry a reference food, and a plausible pre-meal level for that time of day.
const TARGETS = [
  { name: "Salmon, rice and broccoli", base: 118 },
  { name: "Pasta bolognese", base: 132 },
  { name: "Takeout pizza", base: 126 },
  { name: "Overnight oats with chia", base: 104 },
];

/**
 * Adds a before-meal reading to each linked demo meal. Takes a client so the deployment bootstrap
 * can call it without spawning a subprocess.
 */
export async function addPreMealReadings(client: Client) {
  {
    let added = 0;
    let skipped = 0;
    let matchedMeals = 0;

    for (const t of TARGETS) {
      const meals = (await client.execute({ sql: "select id, at from meals where name = ? and note = 'demo'", args: [t.name] })).rows;
      matchedMeals += meals.length;
      for (const m of meals) {
        const mealAt = Number(m.at);
        // 12 minutes before the meal, which is inside the pre-meal window the engine looks in.
        const at = mealAt - 12 * 60;
        const value = Math.round(t.base + (rnd() - 0.5) * 26);
        try {
          await client.execute({
            sql:
              "insert into glucose_readings (id,at,value_mgdl,source,context,note,import_batch,created_at)" +
              " values (?,?,?,'manual','before_meal',null,'demo',?)",
            args: [newId(), at, value, at],
          });
          added++;
        } catch {
          skipped++; // a reading already exists at that exact minute
        }
      }
    }

    const n = (await client.execute("select count(*) n from glucose_readings where context = 'before_meal'")).rows[0].n;
    console.log(`added ${added} before-meal readings, skipped ${skipped} that already existed`);
    console.log(`this account now holds ${n} before-meal readings`);

    if (matchedMeals === 0) {
      console.log(`\nNo demo meals found in this account. Run this first:  npm run demo -- <email>`);
    }
  }
}

async function main() {
  const { client } = await clientFromArgv(USAGE);
  try {
    await addPreMealReadings(client);
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
if (process.argv[1]?.endsWith("demoPreMeal.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
