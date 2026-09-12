import "server-only";
/**
 * Data layer for the carbohydrate reference.
 *
 * The search itself runs in memory. The whole table is a few hundred rows and the ranking in
 * `engines/foods.ts` is a scored match over aliases and categories, which SQL `LIKE` cannot express
 * and which needs to be identical in tests and at runtime. If the table ever grows past a few
 * thousand rows this becomes a full-text index; at this size, loading it is cheaper than a query
 * per keystroke and far easier to reason about.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, foods, foodPortions, mealItems, meals, glucoseReadings, type Food, type FoodPortion } from "../db";
import { newId } from "../ids";
import { searchFoods, figuresFor, foodHistory, type FoodHistory, type SearchHit } from "../engines/foods";
import { mealResponse } from "../engines/mealResponse";
import { addDays, startOfDay } from "../time";

export type FoodWithPortions = Food & { portions: FoodPortion[] };

async function attachPortions(rows: Food[]): Promise<FoodWithPortions[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((f) => f.id);
  const portions = await db.select().from(foodPortions).where(inArray(foodPortions.foodId, ids)).orderBy(asc(foodPortions.sort));
  const byFood = new Map<string, FoodPortion[]>();
  for (const p of portions) byFood.set(p.foodId, [...(byFood.get(p.foodId) ?? []), p]);
  return rows.map((f) => ({ ...f, portions: byFood.get(f.id) ?? [] }));
}

export async function findFoods(query: string, limit = 30): Promise<FoodWithPortions[]> {
  const all = await db.select().from(foods);
  const hits: SearchHit<Food>[] = searchFoods(all, query, limit);
  return attachPortions(hits.map((h) => h.food));
}

export async function recentFoods(limit = 12): Promise<FoodWithPortions[]> {
  const rows = await db.select().from(foods).where(gte(foods.timesUsed, 1)).orderBy(desc(foods.lastUsedAt)).limit(limit);
  return attachPortions(rows);
}

export async function getFood(id: string): Promise<FoodWithPortions | null> {
  const rows = await db.select().from(foods).where(eq(foods.id, id)).limit(1);
  if (!rows[0]) return null;
  return (await attachPortions(rows))[0];
}

/**
 * What THIS person's readings did after meals containing this food. The reason the reference is
 * worth having inside the app rather than in a browser tab: a nutrition database can tell anyone
 * what is in a tortilla, and only their own log can tell them what a tortilla does to them.
 */
export async function historyForFood(foodId: string, days = 120): Promise<FoodHistory> {
  const since = addDays(startOfDay(new Date()), -days);
  const rows = await db
    .select({ mealId: mealItems.mealId, carbsG: mealItems.carbsG })
    .from(mealItems)
    .where(eq(mealItems.foodId, foodId));
  if (rows.length === 0) return foodHistory([], []);

  const mealIds = [...new Set(rows.map((r) => r.mealId))];
  const mealRows = await db.select().from(meals).where(inArray(meals.id, mealIds));
  const relevant = mealRows.filter((m) => m.at >= since);
  if (relevant.length === 0) return foodHistory([], []);

  const from = new Date(Math.min(...relevant.map((m) => m.at.getTime())) - 2 * 60 * 60_000);
  const readings = await db
    .select({ at: glucoseReadings.at, valueMgdl: glucoseReadings.valueMgdl })
    .from(glucoseReadings)
    .where(gte(glucoseReadings.at, from));

  const rises = relevant.map((m) => mealResponse({ id: m.id, at: m.at, name: m.name, carbsG: m.carbsG, tags: m.tags, slot: m.slot }, readings).rise);
  const carbs = rows.filter((r) => relevant.some((m) => m.id === r.mealId)).map((r) => r.carbsG);
  return foodHistory(rises, carbs);
}

export type PlateLine = { foodId: string; grams: number };

/**
 * Log a plate built from the reference. Writes one meal plus one `meal_items` row per food, so the
 * meal keeps its breakdown and each food's own history stays answerable later.
 */
export async function logPlate(input: {
  at: Date;
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  lines: PlateLine[];
  note?: string | null;
  tags?: string;
}): Promise<{ mealId: string; carbsG: number }> {
  const ids = input.lines.map((l) => l.foodId);
  const rows = ids.length ? await db.select().from(foods).where(inArray(foods.id, ids)) : [];
  const byId = new Map(rows.map((f) => [f.id, f]));

  const items = input.lines
    .map((line) => {
      const food = byId.get(line.foodId);
      if (!food) return null;
      const fig = figuresFor(food, line.grams);
      return { food, grams: line.grams, fig };
    })
    .filter((x): x is { food: Food; grams: number; fig: ReturnType<typeof figuresFor> } => x !== null);

  if (items.length === 0) throw new Error("nothing on the plate");

  const now = new Date();
  const mealId = newId();
  const total = items.reduce(
    (a, i) => ({
      carbsG: a.carbsG + i.fig.carbsG,
      proteinG: a.proteinG + i.fig.proteinG,
      fatG: a.fatG + i.fig.fatG,
      fiberG: a.fiberG + i.fig.fiberG,
      kcal: a.kcal + i.fig.caloriesKcal,
    }),
    { carbsG: 0, proteinG: 0, fatG: 0, fiberG: 0, kcal: 0 },
  );
  const r1 = (n: number) => Math.round(n * 10) / 10;

  await db.insert(meals).values({
    id: mealId,
    at: input.at,
    slot: input.slot,
    name: input.name || items.map((i) => i.food.name).join(", ").slice(0, 200),
    carbsG: r1(total.carbsG),
    proteinG: r1(total.proteinG),
    fatG: r1(total.fatG),
    fiberG: r1(total.fiberG),
    caloriesKcal: Math.round(total.kcal),
    tags: input.tags ?? "",
    estimateSource: "recipe",
    items: JSON.stringify(
      items.map((i) => ({ name: i.food.name, grams: i.grams, carbsG: i.fig.carbsG, source: i.food.source })),
    ),
    note: input.note ?? null,
    createdAt: now,
  });

  for (const i of items) {
    await db.insert(mealItems).values({
      id: newId(),
      mealId,
      foodId: i.food.id,
      name: i.food.name,
      portionLabel: "",
      grams: i.grams,
      carbsG: i.fig.carbsG,
      proteinG: i.fig.proteinG,
      fatG: i.fig.fatG,
      fiberG: i.fig.fiberG,
      caloriesKcal: i.fig.caloriesKcal,
      basis: "reference",
    });
    await db
      .update(foods)
      .set({ timesUsed: sql`${foods.timesUsed} + 1`, lastUsedAt: now })
      .where(eq(foods.id, i.food.id));
  }

  return { mealId, carbsG: r1(total.carbsG) };
}

/** A food the person adds themselves. Their numbers, labelled as theirs. */
/**
 * A food somebody adds themselves, including a restaurant dish copied from what the restaurant
 * publishes.
 *
 * `restaurant` and `sourceDate` are what make the restaurant case honest rather than just
 * possible. A chain reformulates a sandwich or resizes a portion whenever it likes and the old
 * figure stays true-looking, so the app records WHOSE number it is and WHEN it was read, and says
 * how old it is wherever it shows it.
 *
 * Nothing here checks the figures against the world, because it cannot. What it does is refuse to
 * present a number as more authoritative than its source.
 */
export async function addCustomFood(input: {
  name: string;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
  portionLabel: string;
  portionGrams: number;
  note?: string;
  /** The restaurant or brand this dish belongs to, when it is one. */
  restaurant?: string;
  /** Set when the figures were copied from what that restaurant publishes. */
  fromRestaurantData?: boolean;
  /** "YYYY-MM-DD", the day the figures were read. */
  sourceDate?: string;
  /**
   * Portions beyond the first. The Fuel Forge uses it to record the whole batch alongside one
   * serving, so a recipe can be logged either way without a second food and a second set of
   * figures to drift from this one.
   */
  extraPortions?: { label: string; grams: number }[];
}): Promise<string> {
  const id = `own-${newId(10)}`;
  const now = new Date();
  await db.insert(foods).values({
    id,
    name: input.name,
    brand: input.restaurant?.trim() || null,
    category: input.restaurant?.trim() ? "restaurant dishes" : "your foods",
    carbsG: input.carbsG,
    proteinG: input.proteinG,
    fatG: input.fatG,
    fiberG: input.fiberG,
    caloriesKcal: input.caloriesKcal,
    /**
     * The restaurant name joins the search terms, so "chipotle" finds the dish and not only its
     * name. `searchFoods` already scores `brand`, and putting it in both is what makes a
     * one-word search for the restaurant work.
     */
    aliases: [input.name.toLowerCase(), input.restaurant?.trim().toLowerCase() ?? ""].filter(Boolean).join(","),
    source: input.fromRestaurantData ? "Restaurant published data" : "You",
    sourceDate: input.fromRestaurantData ? (input.sourceDate || null) : null,
    aisle: "other",
    note: input.note ?? "",
    custom: true,
    timesUsed: 0,
    lastUsedAt: null,
    createdAt: now,
  });
  await db.insert(foodPortions).values({
    id: newId(),
    foodId: id,
    label: input.portionLabel || "1 serving",
    grams: input.portionGrams > 0 ? input.portionGrams : 100,
    sort: 0,
    custom: true,
  });
  const extra = (input.extraPortions ?? []).filter((p) => p.grams > 0 && p.label.trim().length > 0);
  if (extra.length > 0) {
    await db.insert(foodPortions).values(
      extra.map((p, i) => ({ id: newId(), foodId: id, label: p.label.trim(), grams: p.grams, sort: i + 1, custom: true })),
    );
  }
  return id;
}

export async function deleteCustomFood(id: string) {
  await db.delete(foodPortions).where(eq(foodPortions.foodId, id));
  await db.delete(foods).where(and(eq(foods.id, id), eq(foods.custom, true)));
}

export async function foodCount(): Promise<number> {
  return (await db.select({ id: foods.id }).from(foods)).length;
}
