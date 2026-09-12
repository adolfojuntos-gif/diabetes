import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader, Card, Notice, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { findFoods, recentFoods, historyForFood, logPlate, addCustomFood, foodCount, type FoodWithPortions } from "@/lib/data/foods";
import { figuresFor, gramsForCarbs, carbWeight, figureAge, sourceLabel } from "@/lib/engines/foods";
import { getProfile } from "@/lib/data/snapshot";
import { parseForm, zLocalDateTime, zNum, zStr } from "@/lib/actions";
import { toDateTimeInput, dateKey } from "@/lib/time";
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

/**
 * A figure the person has to type, validated as a string first.
 *
 * `zNum` alone coerces an empty box to 0, which passes a `min(0)` check. For a restaurant dish
 * that is the worst possible outcome: the dish saves with 0 g of carbohydrate and then sits in the
 * search results looking like a published fact. So a blank box is an error, not a zero.
 */
function zTypedNum(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(1, "needs a number, and an empty box is not a zero")
    .refine((s) => Number.isFinite(Number(s)), "must be a number")
    .transform((s) => Number(s))
    .refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`);
}

/**
 * The day the figures were read. A date ahead of today is a typo, and `figureAge` treats a future
 * date as undated, so accepting one would quietly erase the age of the figure. Rejected here
 * instead, where it can be said out loud.
 */
const zReadOn = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "needs a date in the form YYYY-MM-DD")
  .refine((s) => s <= dateKey(new Date()), { message: "cannot be later than today" });

/**
 * Per serving to per 100 g.
 *
 * Restaurants publish per serving. The `foods` table stores one basis only, per 100 g, and every
 * figure on this screen is that basis multiplied by a portion weight. So the conversion happens
 * once, here, before anything is written: per 100 g = per serving / serving grams * 100.
 *
 * It is done on the server rather than in the browser so the number stored and the number the
 * person was shown come out of the same arithmetic. The caller guarantees a positive weight
 * (`zTypedNum(1, ...)` rejects both a blank box and a zero), so there is no divide by zero here.
 */
function per100From(perServing: number, servingGrams: number): number {
  return Math.round((perServing / servingGrams) * 1000) / 10;
}

async function createRestaurantFood(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  /**
   * Maxima are per SERVING, not per 100 g, so they are much wider than the own-food form's. A
   * single published platter can carry a few hundred grams of carbohydrate. The per-100g bounds
   * are checked after the conversion instead, where they mean something.
   */
  const schema = z.object({
    restaurant: zStr(80),
    name: zStr(120),
    servingGrams: zTypedNum(1, 5000),
    carbsG: zTypedNum(0, 500),
    proteinG: zTypedNum(0, 300),
    fatG: zTypedNum(0, 300),
    fiberG: zTypedNum(0, 200),
    caloriesKcal: zTypedNum(0, 6000),
    sourceDate: zReadOn,
  });
  const parsed = parseForm(schema, fd);
  if ("error" in parsed) redirect(`/log/food?e=${encodeURIComponent(parsed.error)}&tab=restaurant`);
  const d = parsed.data;
  if (!d.restaurant) redirect(`/log/food?e=${encodeURIComponent("Name the restaurant. Whose figure it is, is the point.")}&tab=restaurant`);
  if (!d.name) redirect(`/log/food?e=${encodeURIComponent("Give the dish a name.")}&tab=restaurant`);

  const per100 = {
    carbsG: per100From(d.carbsG, d.servingGrams),
    proteinG: per100From(d.proteinG, d.servingGrams),
    fatG: per100From(d.fatG, d.servingGrams),
    fiberG: per100From(d.fiberG, d.servingGrams),
    caloriesKcal: per100From(d.caloriesKcal, d.servingGrams),
  };

  /**
   * The conversion is where a mistyped serving weight shows itself. Typing the weight of one
   * tortilla under the figures for the whole plate makes a food denser than any food is, and it
   * would then be wrong for every portion, not just this one. So say so rather than store it.
   */
  if (per100.carbsG > 100 || per100.proteinG > 100 || per100.fatG > 100 || per100.fiberG > 100) {
    redirect(
      `/log/food?e=${encodeURIComponent("Those figures work out heavier than the serving itself. Check the serving weight in grams.")}&tab=restaurant`,
    );
  }
  if (per100.caloriesKcal > 900) {
    redirect(
      `/log/food?e=${encodeURIComponent("Those figures work out to more calories per 100 grams than any food holds. Check the serving weight.")}&tab=restaurant`,
    );
  }

  const id = await addCustomFood({
    name: d.name,
    ...per100,
    /** The published serving becomes the portion, so the figures as published are one tap away. */
    portionLabel: "1 serving as published",
    portionGrams: d.servingGrams,
    restaurant: d.restaurant,
    fromRestaurantData: true,
    sourceDate: d.sourceDate,
  });
  revalidatePath("/log/food");
  /**
   * The arithmetic is handed back in words. Somebody who typed the serving weight wrong should be
   * able to see it in the confirmation rather than on a plate three weeks later.
   */
  const conv = `${d.carbsG} g of carbohydrate in a ${d.servingGrams} g serving is ${per100.carbsG} g per 100 g.`;
  redirect(`/log/food?q=${encodeURIComponent(d.name)}&added=${id}&conv=${encodeURIComponent(conv)}`);
  });
}

/* ----------------------------------- page ----------------------------------- */

export default async function FoodSearch({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; e?: string; saved?: string; tab?: string; target?: string; conv?: string }>;
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
      {sp.conv ? (
        <div className="mb-4">
          <Notice>
            Saved from the restaurant&apos;s own figures. {sp.conv} The serving weight is kept as the
            portion, so you can pick it as published or weigh your own.
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

      <details className="mt-8" open={sp.tab === "own" || sp.tab === "restaurant"}>
        <summary className="cursor-pointer font-display text-xl">Add a food, or a restaurant dish</summary>
        <Card className="mt-3">
          <h3 className="mb-1">Your own food</h3>
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

        <Card className="mt-3">
          <h3 className="mb-1">A restaurant dish</h3>
          <p className="hint mb-2">
            For a dish where the restaurant publishes the figures itself, on a menu, a tray liner or
            its website. Copy them as published. Steady saves the restaurant&apos;s name and the day you
            read them, and shows both wherever the dish appears.
          </p>
          <p className="text-sm mb-3 prose-measure">
            A published figure describes the restaurant&apos;s standard recipe and standard serving. It
            does not describe the plate in front of you, because kitchens vary. Treat it as the
            restaurant&apos;s number, and watch what your own readings do.
          </p>
          <p className="hint mb-3 prose-measure">
            Restaurants publish per serving, and this table stores every food per 100 grams. So each
            figure is divided by the serving weight and multiplied by 100, and the serving weight is
            kept as the portion. If the restaurant does not publish a weight in grams for the
            serving, this mode cannot be used. A guessed weight would move every figure on the
            plate, so add the dish as your own food instead.
          </p>
          <form action={createRestaurantFood} className="grid gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="rf-restaurant">
                  Restaurant
                </label>
                <input id="rf-restaurant" name="restaurant" className="input" maxLength={80} required placeholder="The name on the sign" />
              </div>
              <div className="field">
                <label className="label" htmlFor="rf-name">
                  Dish
                </label>
                <input id="rf-name" name="name" className="input" maxLength={120} required placeholder="The name on the menu" />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { id: "carbsG", label: "Carbs / serving", max: 500 },
                { id: "proteinG", label: "Protein", max: 300 },
                { id: "fatG", label: "Fat", max: 300 },
                { id: "fiberG", label: "Fibre", max: 200 },
                { id: "caloriesKcal", label: "Calories", max: 6000 },
              ].map((f) => (
                <div className="field" key={f.id}>
                  <label className="label" htmlFor={`rf-${f.id}`}>
                    {f.label}
                  </label>
                  {/* No default and no example value. A number sitting in one of these boxes would be
                      read as what the restaurant published, and nothing here knows that. */}
                  <input
                    id={`rf-${f.id}`}
                    name={f.id}
                    className="input num"
                    inputMode="decimal"
                    step="0.1"
                    min={0}
                    max={f.max}
                    required
                    placeholder="as published"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="rf-servingGrams">
                  The serving weighs
                </label>
                <input
                  id="rf-servingGrams"
                  name="servingGrams"
                  className="input num"
                  inputMode="numeric"
                  min={1}
                  max={5000}
                  required
                  placeholder="grams, as published"
                />
                <span className="hint">grams, as the restaurant states it</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="rf-sourceDate">
                  Figures read on
                </label>
                {/* Defaults to today because that is when somebody copying a menu is doing it. The
                    box stays editable for figures written down on an earlier visit. */}
                <input
                  id="rf-sourceDate"
                  name="sourceDate"
                  type="date"
                  className="input"
                  defaultValue={dateKey(now)}
                  max={dateKey(now)}
                  required
                />
                <span className="hint">Shown as an age once the dish is a few months old</span>
              </div>
            </div>
            <SubmitButton className="btn btn-secondary">Save this dish</SubmitButton>
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
    /**
     * Whose figure it is, and how old it is, worked out here rather than in the browser. The same
     * reason the nutrition arithmetic is done here: one place decides, so a card and a plate row
     * can never disagree about where a number came from.
     *
     * `note` is empty for anything undated and for a recent restaurant figure. An empty string
     * means there is nothing to say, and the component draws nothing.
     */
    const provenance = { who: sourceLabel(f.source, f.brand), ageNote: figureAge(f.sourceDate, now).note };
    return {
      id: f.id,
      name: f.name,
      brand: f.brand,
      category: f.category,
      source: f.source,
      provenance,
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
