/**
 * One recipe.
 *
 * "Why it works" describes how this dish is built (fiber, protein, the order things are eaten in).
 * It never says a food is good or bad for diabetes. What a meal does to this person is a question
 * only their own readings answer, and that lives on /plan/best.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, recipes } from "@/lib/db";
import { PageHeader, Card, Stat, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import { addRecipeIngredients } from "../../actions";
import {
  AISLE_LABEL,
  AISLE_ORDER,
  SLOT_LABEL,
  firstParam,
  num,
  parseIngredients,
  parseSteps,
  tagLabel,
  tagList,
  weekFromParam,
  weekRangeLabel,
  type Ingredient,
} from "../../lib";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Search;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const week = weekFromParam(sp.week);
  const error = firstParam(sp.error);
  return requireAccount(async () => {

  const rows = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
  const recipe = rows[0];
  if (!recipe) notFound();

  const tags = tagList(recipe.tags);
  const ingredients = parseIngredients(recipe.ingredients);
  const steps = parseSteps(recipe.steps);

  const grouped = AISLE_ORDER.map((aisle) => ({
    aisle,
    items: ingredients.filter((i) => i.aisle === aisle),
  })).filter((g) => g.items.length > 0);

  const logHref = `/log/meal?recipeId=${encodeURIComponent(recipe.id)}&name=${encodeURIComponent(
    recipe.name,
  )}&carbs=${encodeURIComponent(String(Math.round(recipe.carbsG)))}`;

  return (
    <div className="page">
      <PageHeader
        eyebrow={SLOT_LABEL[recipe.slot]}
        title={recipe.name}
        lede={recipe.whyItWorks || undefined}
        action={
          <Link href={`/plan?week=${week}`} className="btn btn-secondary btn-sm">
            Back to the week
          </Link>
        }
      />

      {error ? (
        <div className="mb-4">
          <Notice>{error}</Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Carbs" value={num(recipe.carbsG)} unit="g" sub="per serving" />
        <Stat label="Protein" value={num(recipe.proteinG)} unit="g" sub="per serving" />
        <Stat label="Fiber" value={num(recipe.fiberG)} unit="g" sub="per serving" />
        <Stat label="Time" value={num(recipe.minutes)} unit="min" sub="start to plate" />
      </div>

      {tags.length ? (
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((t) => (
            <Link key={t} href={`/plan/pick?week=${week}&tag=${encodeURIComponent(t)}`} className="pill">
              {tagLabel(t)}
            </Link>
          ))}
        </div>
      ) : null}

      <Card className="mb-4">
        <h2 className="text-base font-display">What you can do with this</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <Link href={`/plan/pick?week=${week}&slot=${recipe.slot}&recipeId=${recipe.id}`} className="btn btn-juniper">
            Add to this week
          </Link>
          <form action={addRecipeIngredients}>
            <input type="hidden" name="week" value={week} />
            <input type="hidden" name="recipeId" value={recipe.id} />
            <SubmitButton className="btn btn-secondary" pendingText="Adding…">
              Add ingredients to grocery list
            </SubmitButton>
          </form>
          <Link href={logHref} className="btn btn-secondary">
            I ate this
          </Link>
        </div>
        <p className="hint mt-3">
          Ingredients go to the list for the week of {weekRangeLabel(week)}. Anything already on that list is left as
          it is. Logging it opens a meal entry with the name and carbs filled in, which you can correct before saving.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="text-base font-display">Ingredients</h2>
          {grouped.length === 0 ? (
            <p className="muted mt-2 text-sm">No ingredient list was saved with this recipe.</p>
          ) : (
            <div className="grid gap-4 mt-3">
              {grouped.map((g) => (
                <div key={g.aisle}>
                  <div className="eyebrow mb-1">{AISLE_LABEL[g.aisle]}</div>
                  <ul className="grid gap-1">
                    {g.items.map((item: Ingredient, i: number) => (
                      <li key={`${item.name}-${i}`} className="flex justify-between gap-3 text-sm">
                        <span>{item.name}</span>
                        {item.qty ? <span className="muted num shrink-0">{item.qty}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-base font-display">Steps</h2>
          {steps.length === 0 ? (
            <p className="muted mt-2 text-sm">No method was saved with this recipe.</p>
          ) : (
            <ol className="grid gap-3 mt-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="eyebrow num shrink-0 pt-0.5" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <span className="sr-only">{`Step ${i + 1}. `}</span>
                    {s}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <p className="hint mt-4 prose-measure">
        Numbers are per serving as written. If you change the portion, the carbs change with it.
      </p>
    </div>
  );
  });
}
