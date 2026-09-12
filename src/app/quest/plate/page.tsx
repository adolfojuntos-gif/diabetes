import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { db, foods, foodPortions, MEAL_SLOTS } from "@/lib/db";
import { logPlate } from "@/lib/data/foods";
import { parseForm, zStr, zLocalDateTime } from "@/lib/actions";
import { searchFoods, figuresFor, figureAge, sourceLabel } from "@/lib/engines/foods";
import { toDateTimeInput } from "@/lib/time";
import { PlateCanvas, type PlateCard } from "./PlateCanvas";

export const dynamic = "force-dynamic";

const SLOTS = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

/**
 * Save the plate.
 *
 * Deliberately the SAME `logPlate` the food screen uses, taking the same `{foodId, grams}` lines. A
 * second way to write a meal would be a second place for the figures to drift, and the point of
 * this screen is that the numbers on it are the reference's.
 */
async function savePlate(fd: FormData) {
  "use server";
  return requireAccount(async () => {
    const parsed = parseForm(
      z.object({ at: zLocalDateTime, slot: z.enum(MEAL_SLOTS), name: zStr(200).optional(), lines: zStr(4000) }),
      fd,
    );
    if ("error" in parsed) redirect(`/quest/plate?e=${encodeURIComponent(parsed.error)}`);

    let lines: { foodId: string; grams: number }[] = [];
    try {
      const raw = JSON.parse(parsed.data.lines) as unknown;
      if (!Array.isArray(raw)) throw new Error("not a list");
      lines = raw
        .map((x) => {
          const o = x as { foodId?: unknown; grams?: unknown };
          return { foodId: String(o.foodId ?? ""), grams: Number(o.grams) };
        })
        .filter((l) => l.foodId.length > 0 && Number.isFinite(l.grams) && l.grams > 0 && l.grams <= 5000);
    } catch {
      redirect(`/quest/plate?e=${encodeURIComponent("Could not read the plate. Try adding the foods again.")}`);
    }
    if (lines.length === 0) redirect(`/quest/plate?e=${encodeURIComponent("Put something on the plate first.")}`);

    const { carbsG } = await logPlate({
      at: parsed.data.at,
      slot: parsed.data.slot,
      name: parsed.data.name ?? "",
      lines,
      note: null,
    });
    for (const p of ["/", "/log", "/quest/forest", "/quest/compass"]) revalidatePath(p);
    redirect(`/quest/plate?saved=${encodeURIComponent(String(carbsG))}`);
  });
}

/**
 * BUILD YOUR PLATE.
 *
 * Four quarters, a food placed in the one its macros put it in, and an honest account of what the
 * numbers cannot tell you.
 *
 * IT DOES NOT GRADE A PLATE. There is no target shape here, no ideal split and no arrows. The plate
 * method people are taught is a real thing and it is a conversation with a dietitian, not a rule an
 * app enforces on a Tuesday night. A screen that scores dinner is one people start lying to, and a
 * food diary nobody is honest with is worse than none.
 *
 * Everything it shows comes from the carbohydrate reference, by the same helper the food screen
 * uses, and saving goes through the same `logPlate` so a plate here and a plate there cannot
 * disagree.
 */
export default async function BuildYourPlate({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string; e?: string }> }) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const now = new Date();

    let cards: PlateCard[] = [];
    if (q.length >= 2) {
      const [foodRows, portionRows] = await Promise.all([
        db.select().from(foods),
        db.select().from(foodPortions),
      ]);
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
        category: f.category,
        source: sourceLabel(f.source, f.brand),
        ageNote: figureAge(f.sourceDate, now).note,
        per100: { carbsG: f.carbsG, proteinG: f.proteinG, fatG: f.fatG, fiberG: f.fiberG, category: f.category },
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
          title="Build your plate"
          lede="Put a meal together and see what you are working with. No part of the plate is better than another and nothing here is scored."
          action={
            <Link href="/quest/forest" className="btn btn-secondary btn-sm">
              The Food Forest
            </Link>
          }
        />

        {sp.saved ? (
          <div className="mb-4">
            <Notice tone="juniper">Saved, {sp.saved} g of carbohydrate. It is in your log and it has grown your Food Forest.</Notice>
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
            placeholder="Search the reference: rice, tortilla, apple"
            aria-label="Search for a food"
          />
          <button className="btn btn-secondary" type="submit">
            Search
          </button>
        </form>

        <PlateCanvas cards={cards} action={savePlate} defaultAt={toDateTimeInput(now)} slots={SLOTS} justSaved={Boolean(sp.saved)} />

        <div className="mt-6">
          <Notice>
            Every figure here comes from Steady&apos;s carbohydrate reference for the portions you picked, and a food
            sits in the quarter its own grams put it in rather than one you chose. There is no right shape for a plate
            on this screen, nothing is compared with a target, and none of it is advice about what to eat. If you want a
            plate shape to aim at, that is one to agree with your care team or a dietitian.
          </Notice>
        </div>
      </div>
    );
  });
}
