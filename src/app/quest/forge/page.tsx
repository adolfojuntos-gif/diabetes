import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { db, foods, foodPortions } from "@/lib/db";
import { forgeRecipe } from "@/lib/data/forge";
import { parseForm, zStr } from "@/lib/actions";
import { searchFoods, figuresFor, figureAge, sourceLabel } from "@/lib/engines/foods";
import { forge, type ForgeIngredient } from "@/lib/engines/forge";
import { ForgeBench, type ForgeCard } from "./ForgeBench";

export const dynamic = "force-dynamic";

/**
 * Forge the recipe.
 *
 * The ingredients arrive from the bench, and every figure in them came off the reference on the way
 * out. They are recomputed here rather than trusted: a hidden field is a field, and a carbohydrate
 * figure that somebody else could set is a carbohydrate figure somebody doses against.
 */
async function forgeAction(fd: FormData) {
  "use server";
  return requireAccount(async () => {
    const parsed = parseForm(
      z.object({
        name: z.string().trim().min(1, "a recipe needs a name").max(80),
        servings: z.coerce.number().int().min(1).max(60),
        finishedGrams: z.coerce.number().min(0).max(20000).optional(),
        ingredients: zStr(20000),
      }),
      fd,
    );
    if ("error" in parsed) redirect(`/quest/forge?e=${encodeURIComponent(parsed.error)}`);

    let sent: { foodId: string; portionId: string; count: number }[] = [];
    try {
      const raw = JSON.parse(parsed.data.ingredients) as unknown;
      if (!Array.isArray(raw)) throw new Error("not a list");
      sent = raw
        .map((x) => {
          const o = x as { key?: unknown; count?: unknown };
          const [foodId = "", portionId = ""] = String(o.key ?? "").split(":");
          return { foodId, portionId, count: Math.round(Number(o.count)) };
        })
        .filter((l) => l.foodId && l.portionId && Number.isFinite(l.count) && l.count > 0 && l.count <= 200);
    } catch {
      redirect(`/quest/forge?e=${encodeURIComponent("Could not read the crucible. Try adding the ingredients again.")}`);
    }
    if (sent.length === 0) redirect(`/quest/forge?e=${encodeURIComponent("Put something in the crucible first.")}`);

    const [foodRows, portionRows] = await Promise.all([db.select().from(foods), db.select().from(foodPortions)]);
    const foodById = new Map(foodRows.map((f) => [f.id, f]));
    const portionById = new Map(portionRows.map((p) => [p.id, p]));

    const now = new Date();
    const ingredients: ForgeIngredient[] = [];
    for (const s of sent) {
      const food = foodById.get(s.foodId);
      const portion = portionById.get(s.portionId);
      if (!food || !portion || portion.foodId !== food.id) continue;
      const fig = figuresFor(food, portion.grams);
      ingredients.push({
        key: `${food.id}:${portion.id}`,
        name: food.name,
        portionLabel: portion.label,
        grams: portion.grams,
        count: s.count,
        carbsG: fig.carbsG,
        proteinG: fig.proteinG,
        fatG: fig.fatG,
        fiberG: fig.fiberG,
        caloriesKcal: fig.caloriesKcal,
        source: sourceLabel(food.source, food.brand),
        ageNote: figureAge(food.sourceDate, now).note,
      });
    }
    if (ingredients.length === 0) {
      redirect(`/quest/forge?e=${encodeURIComponent("None of those ingredients are in the reference any more. Try adding them again.")}`);
    }

    const forged = forge(ingredients, {
      servings: parsed.data.servings,
      finishedGrams: parsed.data.finishedGrams && parsed.data.finishedGrams > 0 ? parsed.data.finishedGrams : null,
    });
    await forgeRecipe({ name: parsed.data.name, ingredients, forged, now });

    for (const p of ["/", "/log", "/log/food", "/quest/forest", "/quest/plate"]) revalidatePath(p);
    redirect(`/quest/forge?forged=${encodeURIComponent(parsed.data.name)}&c=${forged.serving.carbsG}`);
  });
}

/**
 * THE FUEL FORGE.
 *
 * A workshop that turns a recipe into a food. Put in what goes in the pot, say how many it makes,
 * and it comes out as one of your foods with a carbohydrate figure per serving that never has to be
 * worked out again.
 *
 * NOTHING HERE IS GRADED. There is no target shape for a recipe on this screen and no combination
 * is better than another. The mark a recipe gets describes how its energy is split, which is a fact
 * about the food and not an opinion about the cook.
 */
export default async function FuelForge({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; forged?: string; c?: string; e?: string }>;
}) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const now = new Date();

    let cards: ForgeCard[] = [];
    if (q.length >= 2) {
      const [foodRows, portionRows] = await Promise.all([db.select().from(foods), db.select().from(foodPortions)]);
      const byFood = new Map<string, typeof portionRows>();
      for (const p of portionRows) {
        const arr = byFood.get(p.foodId);
        if (arr) arr.push(p);
        else byFood.set(p.foodId, [p]);
      }
      cards = searchFoods(foodRows, q, 8).map(({ food: f }) => ({
        id: f.id,
        name: f.name,
        brand: f.brand,
        source: sourceLabel(f.source, f.brand),
        ageNote: figureAge(f.sourceDate, now).note,
        portions: (byFood.get(f.id) ?? [])
          .sort((a, b) => a.sort - b.sort || a.grams - b.grams)
          .map((p) => {
            const fig = figuresFor(f, p.grams);
            return {
              id: p.id,
              label: p.label,
              grams: p.grams,
              carbsG: fig.carbsG,
              proteinG: fig.proteinG,
              fatG: fig.fatG,
              fiberG: fig.fiberG,
              caloriesKcal: fig.caloriesKcal,
            };
          }),
      }));
    }

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="The Fuel Forge"
          lede="Work a recipe out once and keep it. Put in what goes in the pot, say how many it makes, and it comes back as one of your foods."
          action={
            <Link href="/quest/plate" className="btn btn-secondary btn-sm">
              Build your plate
            </Link>
          }
        />

        {sp.forged ? (
          <div className="mb-4">
            <Notice tone="juniper">
              {sp.forged} is forged. One serving is {sp.c} g of carbohydrate, and it is in your foods now. Search for it
              anywhere in Steady and it will be there.
            </Notice>
          </div>
        ) : null}
        {sp.e ? (
          <div className="mb-4">
            <Notice tone="amber">{sp.e}</Notice>
          </div>
        ) : null}

        <form method="get" className="flex flex-wrap gap-2 mb-5">
          <input
            name="q"
            className="input"
            style={{ maxWidth: "22rem" }}
            defaultValue={q}
            placeholder="Search the reference: beans, rice, ground beef"
            aria-label="Search for an ingredient"
          />
          <button className="btn btn-secondary" type="submit">
            Search
          </button>
        </form>

        <ForgeBench cards={cards} action={forgeAction} justForged={Boolean(sp.forged)} />

        <div className="mt-6">
          <Notice>
            Every figure here comes from Steady&apos;s carbohydrate reference for the portions you picked, added up and
            divided. A serving is the batch divided by the number you gave, so it assumes the servings come out the same
            size. Nothing on this screen is a verdict on a recipe and none of it is advice about what to cook.
          </Notice>
        </div>
      </div>
    );
  });
}
