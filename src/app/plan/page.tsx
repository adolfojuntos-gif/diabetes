/**
 * The week's meal plan.
 *
 * One week at a time, Monday first, addressed by `?week=YYYY-MM-DD`. The grid is the same data
 * twice: days stacked as rows on a phone, days across as columns on a wide screen, because a
 * 7 x 4 table is unreadable at 375px and a stack of 7 cards wastes a desktop.
 */
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, mealPlan, recipes, type MealSlot, type Recipe } from "@/lib/db";
import { PageHeader, Card, Stat, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import { fillWeek, clearWeek, clearCell } from "./actions";
import {
  DAY_LABEL,
  DAY_SHORT,
  SLOTS,
  SLOT_LABEL,
  firstParam,
  num,
  shiftWeek,
  weekFromParam,
  weekRangeLabel,
} from "./lib";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PlanPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const week = weekFromParam(sp.week);
  const error = firstParam(sp.error);
  return requireAccount(async () => {

  const [cells, recipeCount] = await Promise.all([
    db
      .select({ day: mealPlan.day, slot: mealPlan.slot, recipe: recipes })
      .from(mealPlan)
      .leftJoin(recipes, eq(mealPlan.recipeId, recipes.id))
      .where(eq(mealPlan.weekOf, week)),
    db.select({ id: recipes.id }).from(recipes),
  ]);

  const byCell = new Map<string, Recipe>();
  for (const c of cells) if (c.recipe) byCell.set(`${c.day}:${c.slot}`, c.recipe);

  const planned = [...byCell.values()];
  const plannedDays = new Set([...byCell.keys()].map((k) => k.split(":")[0])).size;
  const totalCarbs = planned.reduce((a, r) => a + (Number.isFinite(r.carbsG) ? r.carbsG : 0), 0);
  const avgPerDay = plannedDays > 0 ? totalCarbs / plannedDays : null;
  const totalMinutes = planned.reduce((a, r) => a + (Number.isFinite(r.minutes) ? r.minutes : 0), 0);

  const noRecipes = recipeCount.length === 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Meal planning"
        title="Provisions"
        lede="Four slots a day, filled with recipes built around fiber and protein. Nothing here is a rule. Move anything, skip anything."
        action={
          <div className="flex gap-2">
            <Link href={`/plan?week=${shiftWeek(week, -1)}`} className="btn btn-secondary btn-sm" aria-label="Previous week">
              Previous
            </Link>
            <Link href={`/plan?week=${shiftWeek(week, 1)}`} className="btn btn-secondary btn-sm" aria-label="Next week">
              Next
            </Link>
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <Notice>{error}</Notice>
        </div>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Week of</div>
            <div className="font-display text-2xl mt-1">{weekRangeLabel(week)}</div>
            <div className="hint mt-1 num">{week}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/plan/grocery?week=${week}`} className="btn btn-secondary btn-sm">
              Grocery list
            </Link>
            <Link href="/plan/best" className="btn btn-secondary btn-sm">
              Best meals for you
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat label="Meals planned" value={planned.length} sub={`of 28 slots`} />
          <Stat label="Days with a plan" value={plannedDays} sub="of 7" />
          <Stat label="Carbs planned" value={num(totalCarbs)} unit="g" sub="across every planned meal" />
          <Stat
            label="Average per planned day"
            value={avgPerDay === null ? "None yet" : num(avgPerDay)}
            unit={avgPerDay === null ? undefined : "g"}
            sub={avgPerDay === null ? "nothing planned this week" : `over ${plannedDays} day${plannedDays === 1 ? "" : "s"}`}
          />
        </div>

        {planned.length ? (
          <p className="hint mt-3">
            About {num(totalMinutes)} minutes of cooking across the week. The average counts only the days you have
            planned, so it does not fall as you add days.
          </p>
        ) : null}

        {!noRecipes ? (
          <div className="flex flex-wrap gap-2 mt-4">
            <form action={fillWeek}>
              <input type="hidden" name="week" value={week} />
              <SubmitButton className="btn btn-juniper" pendingText="Filling…">
                Fill my week
              </SubmitButton>
            </form>
            <form action={clearWeek}>
              <input type="hidden" name="week" value={week} />
              <SubmitButton className="btn btn-danger" pendingText="Clearing…">
                Clear this week
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </Card>

      {noRecipes ? (
        <EmptyState
          title="No recipes loaded yet"
          body="The recipe library has not been written to the database. Run npm run setup in the project folder, then come back and fill your week."
        />
      ) : null}

      {/* Phone: days as rows. */}
      <div className="grid gap-3 md:hidden">
        {DAY_LABEL.map((dayName, day) => (
          <section key={day} className="card p-3">
            <h2 className="text-base font-display mb-2">{dayName}</h2>
            <div className="grid grid-cols-2 gap-2">
              {SLOTS.map((slot) => (
                <PlanCell key={slot} week={week} day={day} slot={slot} recipe={byCell.get(`${day}:${slot}`) ?? null} showSlot />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Wide: days as columns. */}
      <div className="hidden md:block overflow-x-auto">
        <div className="grid gap-2 min-w-[52rem]" style={{ gridTemplateColumns: "6rem repeat(7, minmax(0, 1fr))" }}>
          <div />
          {DAY_SHORT.map((d, i) => (
            <div key={d} className="eyebrow pb-1 text-center">
              {d}
              <span className="sr-only">{DAY_LABEL[i]}</span>
            </div>
          ))}
          {SLOTS.map((slot) => (
            <SlotRow key={slot} slot={slot} week={week} byCell={byCell} />
          ))}
        </div>
      </div>

      <p className="hint mt-4 prose-measure">
        Carbs and minutes are per serving, as written in the recipe. What a meal does to your own readings is on the
        best meals screen, built from what you have logged.
      </p>
    </div>
  );
  });
}

function SlotRow({ slot, week, byCell }: { slot: MealSlot; week: string; byCell: Map<string, Recipe> }) {
  return (
    <>
      <div className="eyebrow flex items-center">{SLOT_LABEL[slot]}</div>
      {DAY_LABEL.map((_, day) => (
        <PlanCell key={day} week={week} day={day} slot={slot} recipe={byCell.get(`${day}:${slot}`) ?? null} />
      ))}
    </>
  );
}

function PlanCell({
  week,
  day,
  slot,
  recipe,
  showSlot = false,
}: {
  week: string;
  day: number;
  slot: MealSlot;
  recipe: Recipe | null;
  showSlot?: boolean;
}) {
  const where = `${SLOT_LABEL[slot].toLowerCase()} on ${DAY_LABEL[day]}`;

  if (!recipe) {
    return (
      <Link
        href={`/plan/pick?week=${week}&day=${day}&slot=${slot}`}
        className="card-quiet flex flex-col items-center justify-center gap-1 p-3 min-h-[4.5rem] text-center hover:bg-sunk"
        aria-label={`Add ${where}`}
      >
        {showSlot ? <span className="eyebrow">{SLOT_LABEL[slot]}</span> : null}
        <span className="text-xl leading-none faint" aria-hidden="true">
          +
        </span>
      </Link>
    );
  }

  return (
    <div className="card-sunk p-2 min-h-[4.5rem] flex flex-col justify-between gap-1">
      {showSlot ? <span className="eyebrow">{SLOT_LABEL[slot]}</span> : null}
      <Link href={`/plan/recipe/${recipe.id}?week=${week}`} className="text-sm font-medium leading-tight">
        {recipe.name}
      </Link>
      <div className="flex items-end justify-between gap-1">
        <span className="hint num">
          {num(recipe.carbsG)} g · {num(recipe.minutes)} min
        </span>
        <form action={clearCell}>
          <input type="hidden" name="week" value={week} />
          <input type="hidden" name="day" value={day} />
          <input type="hidden" name="slot" value={slot} />
          <SubmitButton className="btn btn-ghost btn-sm px-2" pendingText="…">
            <span aria-hidden="true">×</span>
            <span className="sr-only">{`Remove ${recipe.name} from ${where}`}</span>
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
