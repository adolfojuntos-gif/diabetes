/**
 * Links existing fictional demo meals to reference foods, so the "what your own readings did after
 * this food" panel has real computed rises to show. Part of the demo data, removed by demo:clear
 * along with the meals it points at.
 */
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const newId = (n = 14) => Array.from(randomBytes(n), (b) => A[b & 63]).join("");

const client = createClient({ url: process.env.DATABASE_URL ?? "file:./data/steady.db" });

/** Which demo meal names contain which reference food, and roughly how much of it. */
const LINKS = [
  { match: "Salmon, rice and broccoli", foodId: "rice-white-cooked", name: "Rice, white, cooked", portion: "1 cup cooked", grams: 158 },
  { match: "Pasta bolognese", foodId: "spaghetti-meat-sauce", name: "Spaghetti with meat sauce", portion: "restaurant plate", grams: 450 },
  { match: "Takeout pizza", foodId: "pizza-cheese-slice", name: "Cheese pizza, one slice", portion: "2 slices", grams: 214 },
  { match: "Overnight oats with chia", foodId: "oatmeal-cooked", name: "Oatmeal, cooked", portion: "1 cup", grams: 234 },
];

const foods = new Map(
  (await client.execute("select id,carbs_g,protein_g,fat_g,fiber_g,calories_kcal from foods")).rows.map((r) => [
    String(r.id),
    { carbs: Number(r.carbs_g), protein: Number(r.protein_g), fat: Number(r.fat_g), fiber: Number(r.fiber_g), kcal: Number(r.calories_kcal) },
  ]),
);

const existing = new Set((await client.execute("select meal_id from meal_items")).rows.map((r) => String(r.meal_id)));
const r1 = (n) => Math.round(n * 10) / 10;
let added = 0;

for (const link of LINKS) {
  const food = foods.get(link.foodId);
  if (!food) {
    console.log(`skipped ${link.foodId}, not in the reference yet`);
    continue;
  }
  const meals = (await client.execute({ sql: "select id from meals where name = ? and note = 'demo'", args: [link.match] })).rows;
  const k = link.grams / 100;
  for (const m of meals) {
    const mealId = String(m.id);
    if (existing.has(mealId)) continue;
    await client.execute({
      sql:
        "insert into meal_items (id,meal_id,food_id,name,portion_label,grams,carbs_g,protein_g,fat_g,fiber_g,calories_kcal,basis)" +
        " values (?,?,?,?,?,?,?,?,?,?,?,'reference')",
      args: [newId(), mealId, link.foodId, link.name, link.portion, link.grams, r1(food.carbs * k), r1(food.protein * k), r1(food.fat * k), r1(food.fiber * k), Math.round(food.kcal * k)],
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
