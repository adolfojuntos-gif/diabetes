/**
 * Adds a before-meal reading to the fictional demo meals that are linked to reference foods.
 *
 * Without one, a meal is "uncovered" and the app correctly refuses to report a rise, which is the
 * right behaviour and a poor demonstration of it. A person who checks before eating has these
 * readings, so the demo should too. Values are derived from the same crude curve the demo
 * generator uses: a plausible pre-meal number for the time of day, with a little variation.
 */
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");

const client = createClient({ url: process.env.DATABASE_URL ?? "file:./data/steady.db" });

let seed = 77771;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

// Meals that now carry a reference food, and a plausible pre-meal level for that time of day.
const TARGETS = [
  { name: "Salmon, rice and broccoli", base: 118 },
  { name: "Pasta bolognese", base: 132 },
  { name: "Takeout pizza", base: 126 },
  { name: "Overnight oats with chia", base: 104 },
];

let added = 0;
let skipped = 0;

for (const t of TARGETS) {
  const meals = (await client.execute({ sql: "select id, at from meals where name = ? and note = 'demo'", args: [t.name] })).rows;
  for (const m of meals) {
    const mealAt = Number(m.at);
    // 12 minutes before the meal, which is inside the pre-meal window the engine looks in.
    const at = mealAt - 12 * 60;
    const value = Math.round(t.base + (rnd() - 0.5) * 26);
    try {
      await client.execute({
        sql: "insert into glucose_readings (id,at,value_mgdl,source,context,note,import_batch,created_at) values (?,?,?,'manual','before_meal',null,'demo',?)",
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
console.log(`the demo now holds ${n} before-meal readings`);
