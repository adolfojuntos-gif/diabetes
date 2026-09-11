import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader, Card, Notice, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { findFoods, recentFoods, historyForFood, logPlate, addCustomFood, foodCount, type FoodWithPortions } from "@/lib/data/foods";
import { figuresFor, gramsForCarbs, carbWeight } from "@/lib/engines/foods";
import { getProfile } from "@/lib/data/snapshot";
import { parseForm, zLocalDateTime, zNum, zStr } from "@/lib/actions";
import { toDateTimeInput } from "@/lib/time";
import { MEAL_SLOTS } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { PlateBuilder } from "./PlateBuilder";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<(typeof MEAL_SLOTS)[number], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/* ---------------------------------- actions ---------------------------------- */

async function logFromSearch(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const schema = z.object({
    at: zLocalDateTime,
    slot: z.enum(MEAL_SLOTS),
    name: zStr(200).optional(),
    note: zStr(500).optional(),
    lines: zStr(4000),
  });
  const parsed = parseForm(schema, fd);
  if ("error" in parsed) redirect(`/log/food?e=${encodeURIComponent(parsed.error)}`);

  let lines: { foodId: string; grams: number }[] = [];
  try {
    const raw = JSON.parse(parsed.data.lines) as unknown;
    if (!Array.isArray(raw)) throw new Error("not a list");
    lines = raw
      .map((x) => {
        const o = x as { foodId?: unknown; grams?: unknown };
        const grams = Number(o.grams);
        return { foodId: String(o.foodId ?? ""), grams };
      })
      .filter((l) => l.foodId.length > 0 && Number.isFinite(l.grams) && l.grams > 0 && l.grams <= 5000);
  } catch {
    redirect("/log/food?e=" + encodeURIComponent("Could not read the plate. Try adding the foods again."));
  }
  if (lines.length === 0) redirect("/log/food?e=" + encodeURIComponent("Add at least one food to the plate first."));

  try {
    const { mealId, carbsG } = await logPlate({
      at: parsed.data.at,
      slot: parsed.data.slot,
      name: parsed.data.name ?? "",
      lines,
      note: parsed.data.note ?? null,
    });
    revalidatePath("/log");
    revalidatePath("/log/food");
    revalidatePath("/");
    redirect(`/log/food?saved=${encodeURIComponent(String(carbsG))}&meal=${mealId}`);
  } catch (err) {
    if (err instanceof Error && err.message === "nothing on the plate") {
      redirect("/log/food?e=" + encodeURIComponent("None of those foods could be found."));
    }
    throw err;
  }
  });
}

async function createCustomFood(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const schema = z.object({
    name: zStr(120),
    carbsG: zNum(0, 100),
    proteinG: zNum(0, 100),
    fatG: zNum(0, 100),
    fiberG: zNum(0, 100),
    caloriesKcal: zNum(0, 900),
    portionLabel: zStr(60),
    portionGrams: zNum(1, 5000),
  });
  const parsed = parseForm(schema, fd);
  if ("error" in parsed) redirect(`/log/food?e=${encodeURIComponent(parsed.error)}&tab=own`);
  if (!parsed.data.name) redirect(`/log/food?e=${encodeURIComponent("Give the food a name.")}&tab=own`);
  const id = await addCustomFood(parsed.data);
  revalidatePath("/log/food");
  redirect(`/log/food?q=${encodeURIComponent(parsed.data.name)}&added=${id}`);
  });
}

/* ----------------------------------- page ----------------------------------- */

export default async function FoodSearch({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; e?: string; saved?: string; tab?: string; target?: string }>;
}) {
  const sp = await searchParams;
  return requireAccount(async () => {
  const q = (sp.q ?? "").trim();
  const profile = await getProfile();
  const total = await foodCount();

  const [results, recent] = await Promise.all([q.length >= 2 ? findFoods(q, 25) : Promise.resolve([]), recentFoods(10)]);

  // Their own measured response, for the foods actually on screen. This is the part a nutrition
  // database cannot do, so it is worth the queries.
  const histories = new Map(
    await Promise.all(
      (results.length ? results : recent).slice(0, 12).map(async (f) => [f.id, await historyForFood(f.id)] as const),
    ),
  );

  const target = Number(sp.target) > 0 ? Number(sp.target) : null;
  const now = new Date();

  return (
    <div className="page">
      <PageHeader
        eyebrow="Carbohydrate reference"
        title="What is on the plate?"
        lede="Search a food or a whole dish, pick the portion you actually ate, and see the carbohydrate before you log it. Where you have logged a food before, it also shows what your own readings did afterwards."
        action={
          <Link href="/log/meal" className="btn btn-secondary btn-sm">
            Log a meal by hand
          </Link>
        }
      />

      {sp.e ? <p className="error mb-4">{sp.e}</p> : null}
      {sp.saved ? (
        <div className="mb-4">
          <Notice tone="juniper">
            Logged, {sp.saved} g of carbohydrate.{" "}
            <Link href="/log" className="underline">
              See today
            </Link>
            .
          </Notice>
        </div>
      ) : null}

      <form method="GET" className="flex flex-wrap gap-2 items-end mb-5">
        <div className="field flex-1 min-w-[16rem]">
          <label className="label" htmlFor="q">
            Search {total} foods and dishes
          </label>
          <input
            id="q"
            name="q"
            className="input"
            defaultValue={q}
            placeholder="rice, burrito, pad thai, arroz, frijoles"
            autoComplete="off"
            autoFocus={!q}
          />
        </div>
        <div className="field w-36">
          <label className="label" htmlFor="target">
            Aiming for
          </label>
          <input id="target" name="target" className="input num" inputMode="numeric" defaultValue={sp.target ?? ""} placeholder="g carbs" />
        </div>
        <button className="btn">Search</button>
      </form>

      {q.length >= 2 && results.length === 0 ? (
        <EmptyState
          title={`Nothing found for "${q}"`}
          body="Try a simpler word, or the Spanish name. If it is a food you eat often and it is not here, add it once at the bottom of this page and it will be there from now on."
        />
      ) : null}

      {(results.length > 0 || recent.length > 0) ? (
        <>
          <h2 className="mb-3">{results.length > 0 ? "Results" : "Foods you have logged before"}</h2>
          <PlateBuilder
            action={logFromSearch}
            foods={(results.length ? results : recent).map((f) => serialiseFood(f, target))}
            defaultAt={toDateTimeInput(now)}
            slots={MEAL_SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))}
            dailyCarbTarget={profile.dailyCarbTargetG}
          />
        </>
      ) : null}

      <div className="mt-6 grid gap-3 prose-measure">
        <Notice>
          <strong>A reference value is not a measurement of your plate.</strong> The database knows
          what 100 grams of cooked rice contains. It does not know how much rice is in your bowl, so
          the portion is the part you have to judge, and every number here can be corrected before
          you log it. Each figure shows where it came from.
        </Notice>
        <Notice tone="amber">
          Carbohydrate counting is only useful next to what your own readings do. Steady never
          suggests an insulin dose or a medication change from these numbers, and it never will.
          That is a conversation for you and your prescriber.
        </Notice>
      </div>

      <details className="mt-8" open={sp.tab === "own"}>
        <summary className="cursor-pointer font-display text-xl">Add a food of your own</summary>
        <Card className="mt-3">
          <p className="hint mb-3">
            For something homemade, or a local dish the database does not have. Enter the figures per
            100 grams, the way a label states them. It will be saved as yours, marked as your own
            numbers, and will show up in every search from now on.
          </p>
          <form action={createCustomFood} className="grid gap-3">
            <div className="field">
              <label className="label" htmlFor="cf-name">
                Name
              </label>
              <input id="cf-name" name="name" className="input" maxLength={120} required placeholder="Grandma's caldo" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { id: "carbsG", label: "Carbs / 100 g", max: 100 },
                { id: "proteinG", label: "Protein", max: 100 },
                { id: "fatG", label: "Fat", max: 100 },
                { id: "fiberG", label: "Fibre", max: 100 },
                { id: "caloriesKcal", label: "Calories", max: 900 },
              ].map((f) => (
                <div className="field" key={f.id}>
                  <label className="label" htmlFor={`cf-${f.id}`}>
                    {f.label}
                  </label>
                  <input id={`cf-${f.id}`} name={f.id} className="input num" inputMode="decimal" step="0.1" min={0} max={f.max} defaultValue={0} required />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="cf-portionLabel">
                  Usual portion
                </label>
                <input id="cf-portionLabel" name="portionLabel" className="input" maxLength={60} defaultValue="1 bowl" required />
              </div>
              <div className="field">
                <label className="label" htmlFor="cf-portionGrams">
                  Weighs about
                </label>
                <input id="cf-portionGrams" name="portionGrams" className="input num" inputMode="numeric" min={1} max={5000} defaultValue={250} required />
                <span className="hint">grams</span>
              </div>
            </div>
            <SubmitButton className="btn btn-secondary">Save this food</SubmitButton>
          </form>
        </Card>
      </details>
    </div>
  );

  /** Flatten a food and its portions into what the client component needs, figures precomputed. */
  function serialiseFood(f: FoodWithPortions, targetCarbs: number | null) {
    const portions = f.portions.length > 0 ? f.portions : [{ id: `${f.id}-100`, foodId: f.id, label: "100 g", grams: 100, sort: 0, custom: false }];
    const h = histories.get(f.id);
    const forTarget = targetCarbs ? gramsForCarbs(f, targetCarbs) : null;
    return {
      id: f.id,
      name: f.name,
      brand: f.brand,
      category: f.category,
      source: f.source,
      note: f.note,
      custom: f.custom,
      per100: { carbsG: f.carbsG, proteinG: f.proteinG, fatG: f.fatG, fiberG: f.fiberG, caloriesKcal: f.caloriesKcal },
      portions: portions.map((p) => {
        const fig = figuresFor(f, p.grams);
        return { id: p.id, label: p.label, grams: p.grams, carbsG: fig.carbsG, netCarbsG: fig.netCarbsG, fiberG: fig.fiberG, proteinG: fig.proteinG, caloriesKcal: fig.caloriesKcal, weight: carbWeight(fig.carbsG).label };
      }),
      /** Grams of this food that would give the carbohydrate target typed in the header. */
      gramsForTarget: forTarget,
      history: h && h.meanRise !== null ? { meanRise: h.meanRise, minRise: h.minRise!, maxRise: h.maxRise!, covered: h.covered } : null,
      timesLogged: h?.timesLogged ?? 0,
    };
  }
  });
}
