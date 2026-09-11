"use server";
/**
 * Server actions for the /plan screens.
 *
 * Every action validates its FormData with the helpers in @/lib/actions and never trusts a field.
 * Forms post to these directly, so they return void; when validation fails the action redirects
 * back with `?error=`, which the screen renders. That keeps the failure visible without turning a
 * server component into a client one.
 */
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, mealPlan, recipes, groceryItems, GROCERY_AISLES, MEAL_SLOTS, type GroceryAisle } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { parseForm, zStr } from "@/lib/actions";
import { newId } from "@/lib/ids";
import { candidateOrder, mergeQty, parseIngredients, SLOTS, asAisle } from "./lib";

const zWeek = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a week starting Monday");
const zDay = z.coerce.number().int().min(0).max(6);
const zSlot = z.enum(MEAL_SLOTS);
const zAisle = z.enum(GROCERY_AISLES);
const zId = z.string().trim().min(1).max(64);

function backTo(path: string, week: string, error?: string): never {
  const q = new URLSearchParams({ week });
  if (error) q.set("error", error);
  redirect(`${path}?${q.toString()}`);
}

/* ------------------------------- the week ------------------------------- */

export async function clearWeek(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek }), fd);
  if ("error" in p) redirect("/plan");
  await db.delete(mealPlan).where(eq(mealPlan.weekOf, p.data.week));
  revalidatePath("/plan");
  revalidatePath("/");
  backTo("/plan", p.data.week);
  });
}

export async function clearCell(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek, day: zDay, slot: zSlot }), fd);
  if ("error" in p) redirect("/plan");
  const { week, day, slot } = p.data;
  await db.delete(mealPlan).where(and(eq(mealPlan.weekOf, week), eq(mealPlan.day, day), eq(mealPlan.slot, slot)));
  revalidatePath("/plan");
  revalidatePath("/");
  backTo("/plan", week);
  });
}

/**
 * Fill every empty cell from the recipes table.
 *
 * Deterministic: the candidate order for each slot is shuffled with a seed built from the week key
 * and the slot, so running this twice on the same week rebuilds the same week rather than
 * reshuffling it. A recipe is not used twice in one week unless the table does not hold enough
 * candidates for that slot, in which case the used set resets and recipes repeat.
 */
export async function fillWeek(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek }), fd);
  if ("error" in p) redirect("/plan");
  const week = p.data.week;

  const [all, existing] = await Promise.all([
    db.select().from(recipes),
    db.select().from(mealPlan).where(eq(mealPlan.weekOf, week)),
  ]);
  if (all.length === 0) backTo("/plan", week, "There are no recipes yet. Run npm run setup to load them.");

  const taken = new Set(existing.map((c) => `${c.day}:${c.slot}`));
  const used = new Set(existing.map((c) => c.recipeId));
  const rows: { id: string; weekOf: string; day: number; slot: (typeof MEAL_SLOTS)[number]; recipeId: string }[] = [];

  for (const slot of SLOTS) {
    const pool = all.filter((r) => r.slot === slot);
    if (pool.length === 0) continue;
    const order = candidateOrder(pool, week, slot);
    let cursor = 0;
    for (let day = 0; day <= 6; day++) {
      if (taken.has(`${day}:${slot}`)) continue;
      // Walk the ordered candidates for one not already used this week.
      let pick: (typeof order)[number] | null = null;
      for (let tries = 0; tries < order.length; tries++) {
        const cand = order[(cursor + tries) % order.length];
        if (!used.has(cand.id)) {
          pick = cand;
          cursor = (cursor + tries + 1) % order.length;
          break;
        }
      }
      if (!pick) {
        // Not enough candidates for this slot: allow repeats, starting the cycle again.
        for (const c of order) used.delete(c.id);
        pick = order[cursor % order.length];
        cursor = (cursor + 1) % order.length;
      }
      used.add(pick.id);
      rows.push({ id: newId(), weekOf: week, day, slot, recipeId: pick.id });
    }
  }

  // Only empty cells are in `rows`, so a conflict means someone wrote the cell in between: leave it.
  if (rows.length) await db.insert(mealPlan).values(rows).onConflictDoNothing();
  revalidatePath("/plan");
  revalidatePath("/");
  backTo("/plan", week);
  });
}

/** Write one cell of the plan. Upserts on the (week, day, slot) unique index. */
export async function chooseRecipe(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek, day: zDay, slot: zSlot, recipeId: zId }), fd);
  if ("error" in p) redirect("/plan");
  const { week, day, slot, recipeId } = p.data;

  const found = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  if (!found[0]) backTo("/plan/pick", week, "That recipe is no longer in your list.");

  await db
    .insert(mealPlan)
    .values({ id: newId(), weekOf: week, day, slot, recipeId })
    .onConflictDoUpdate({ target: [mealPlan.weekOf, mealPlan.day, mealPlan.slot], set: { recipeId } });

  revalidatePath("/plan");
  revalidatePath("/");
  revalidatePath("/plan/pick");
  backTo("/plan", week);
  });
}

/* ------------------------------ grocery list ----------------------------- */

/** Add one recipe's ingredients to the week, skipping names already on the list. */
export async function addRecipeIngredients(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek, recipeId: zId }), fd);
  if ("error" in p) redirect("/plan/grocery");
  const { week, recipeId } = p.data;

  const rows = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  const recipe = rows[0];
  if (!recipe) backTo("/plan/grocery", week, "That recipe is no longer in your list.");

  const existing = await db.select().from(groceryItems).where(eq(groceryItems.weekOf, week));
  const have = new Set(existing.map((i) => i.name.trim().toLowerCase()));
  const now = new Date();
  const toInsert: (typeof groceryItems.$inferInsert)[] = [];

  for (const ing of parseIngredients(recipe.ingredients)) {
    const key = ing.name.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    toInsert.push({
      id: newId(),
      weekOf: week,
      name: ing.name,
      qty: ing.qty,
      aisle: ing.aisle,
      fromRecipeId: recipe.id,
      checked: false,
      createdAt: now,
    });
  }

  if (toInsert.length) await db.insert(groceryItems).values(toInsert);
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", week);
  });
}

/**
 * Walk this week's plan, parse every recipe's ingredients, and write them to the list deduped by
 * lowercase name within the week. Quantities for the same name are joined with " + ", and running
 * this twice does not double a quantity that is already there.
 */
export async function buildGroceryFromPlan(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek }), fd);
  if ("error" in p) redirect("/plan/grocery");
  const week = p.data.week;

  const cells = await db.select().from(mealPlan).where(eq(mealPlan.weekOf, week));
  if (cells.length === 0) backTo("/plan/grocery", week, "There is nothing planned for this week yet.");

  const ids = [...new Set(cells.map((c) => c.recipeId))];
  const recipeRows = ids.length ? await db.select().from(recipes).where(inArray(recipes.id, ids)) : [];
  const byId = new Map(recipeRows.map((r) => [r.id, r]));

  // Aggregate the whole week in memory first, so two recipes needing the same thing merge once.
  type Agg = { name: string; qty: string; aisle: GroceryAisle; fromRecipeId: string };
  const agg = new Map<string, Agg>();
  const ordered = [...cells].sort((a, b) => a.day - b.day || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  for (const cell of ordered) {
    const recipe = byId.get(cell.recipeId);
    if (!recipe) continue;
    for (const ing of parseIngredients(recipe.ingredients)) {
      const key = ing.name.toLowerCase();
      const prev = agg.get(key);
      if (prev) prev.qty = mergeQty(prev.qty, ing.qty);
      else agg.set(key, { name: ing.name, qty: ing.qty, aisle: ing.aisle, fromRecipeId: recipe.id });
    }
  }
  if (agg.size === 0) backTo("/plan/grocery", week, "This week's recipes do not list any ingredients.");

  const existing = await db.select().from(groceryItems).where(eq(groceryItems.weekOf, week));
  const byName = new Map(existing.map((i) => [i.name.trim().toLowerCase(), i]));
  const now = new Date();
  const toInsert: (typeof groceryItems.$inferInsert)[] = [];

  for (const [key, item] of agg) {
    const current = byName.get(key);
    if (!current) {
      toInsert.push({
        id: newId(),
        weekOf: week,
        name: item.name,
        qty: item.qty,
        aisle: item.aisle,
        fromRecipeId: item.fromRecipeId,
        checked: false,
        createdAt: now,
      });
      continue;
    }
    const merged = mergeQty(current.qty, item.qty);
    if (merged !== current.qty) await db.update(groceryItems).set({ qty: merged }).where(eq(groceryItems.id, current.id));
  }

  if (toInsert.length) await db.insert(groceryItems).values(toInsert);
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", week);
  });
}

export async function addGroceryItem(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(
    z.object({ week: zWeek, name: zStr(120), qty: zStr(60).optional(), aisle: zAisle.optional() }),
    fd,
  );
  if ("error" in p) redirect("/plan/grocery");
  const { week, name } = p.data;
  if (!name.trim()) backTo("/plan/grocery", week, "Give the item a name.");

  const existing = await db.select().from(groceryItems).where(eq(groceryItems.weekOf, week));
  const current = existing.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  const qty = (p.data.qty ?? "").trim();

  if (current) {
    const merged = mergeQty(current.qty, qty);
    if (merged !== current.qty) await db.update(groceryItems).set({ qty: merged }).where(eq(groceryItems.id, current.id));
  } else {
    await db.insert(groceryItems).values({
      id: newId(),
      weekOf: week,
      name: name.trim(),
      qty,
      aisle: asAisle(p.data.aisle ?? "other"),
      checked: false,
      createdAt: new Date(),
    });
  }
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", week);
  });
}

export async function toggleGroceryItem(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ id: zId }), fd);
  if ("error" in p) redirect("/plan/grocery");
  const rows = await db.select().from(groceryItems).where(eq(groceryItems.id, p.data.id)).limit(1);
  const item = rows[0];
  if (!item) redirect("/plan/grocery");
  await db.update(groceryItems).set({ checked: !item.checked }).where(eq(groceryItems.id, item.id));
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", item.weekOf);
  });
}

export async function deleteGroceryItem(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ id: zId, week: zWeek }), fd);
  if ("error" in p) redirect("/plan/grocery");
  await db.delete(groceryItems).where(eq(groceryItems.id, p.data.id));
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", p.data.week);
  });
}

export async function clearCheckedGrocery(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek }), fd);
  if ("error" in p) redirect("/plan/grocery");
  await db.delete(groceryItems).where(and(eq(groceryItems.weekOf, p.data.week), eq(groceryItems.checked, true)));
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", p.data.week);
  });
}

export async function clearAllGrocery(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ week: zWeek }), fd);
  if ("error" in p) redirect("/plan/grocery");
  await db.delete(groceryItems).where(eq(groceryItems.weekOf, p.data.week));
  revalidatePath("/plan/grocery");
  backTo("/plan/grocery", p.data.week);
  });
}
