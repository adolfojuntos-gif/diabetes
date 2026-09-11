/**
 * Best meals for the week, built from the person's own readings rather than an opinion about food.
 *
 * A meal counts only when it is "covered": there is a reading just before it and a reading in the
 * 1 to 3 hour window after it, so a rise can actually be measured. Meals are grouped by name and a
 * group needs at least two logs before it appears, because one measurement of one dinner is not a
 * finding. Everything here is the engine's arithmetic: /lib/engines/mealResponse.ts.
 */
import Link from "next/link";
import { db, recipes } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { loadSnapshot } from "@/lib/data/snapshot";
import { mealResponses, rankMeals } from "@/lib/engines/mealResponse";
import { formatGlucose, unitLabel } from "@/lib/units";
import { PageHeader, Card, Stat, EmptyState, Notice } from "@/components/ui";
import {
  IDEA_TAGS,
  SLOT_LABEL,
  hasAnyTag,
  num,
  tagLabel,
  tagList,
  weekFromParam,
  weekRangeLabel,
} from "../lib";

const WINDOW_DAYS = 60;
const MIN_LOGS_PER_MEAL = 2;
const MIN_COVERED = 3;

type Search = Promise<Record<string, string | string[] | undefined>>;

type Group = {
  key: string;
  name: string;
  n: number;
  meanRise: number;
  meanCarbs: number;
  slots: string[];
};

export default async function BestMealsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const week = weekFromParam(sp.week);
  return requireAccount(async () => {

  const snap = await loadSnapshot(WINDOW_DAYS);
  const units = snap.profile.units;
  const responses = mealResponses(snap.meals, snap.readings);
  const ranking = rankMeals(responses);

  const byName = new Map<string, { name: string; rises: number[]; carbs: number[]; slots: Set<string> }>();
  for (const r of ranking.covered) {
    if (r.rise === null) continue;
    const key = r.name.trim().toLowerCase();
    if (!key) continue;
    const entry = byName.get(key) ?? { name: r.name.trim(), rises: [], carbs: [], slots: new Set<string>() };
    entry.rises.push(r.rise);
    if (Number.isFinite(r.carbsG)) entry.carbs.push(r.carbsG);
    entry.slots.add(r.slot);
    byName.set(key, entry);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const groups: Group[] = [...byName.entries()]
    .filter(([, v]) => v.rises.length >= MIN_LOGS_PER_MEAL)
    .map(([key, v]) => ({
      key,
      name: v.name,
      n: v.rises.length,
      meanRise: mean(v.rises),
      meanCarbs: v.carbs.length ? mean(v.carbs) : Number.NaN,
      slots: [...v.slots],
    }))
    .sort((a, b) => a.meanRise - b.meanRise);

  // Split the ranking down the middle so both halves exist as soon as there are two groups. No
  // meal appears in both lists: with one repeated meal there is nothing to contrast it with, and
  // the screen says so rather than printing the same line twice.
  const half = Math.min(5, Math.ceil(groups.length / 2));
  const gentlest = groups.slice(0, half);
  const tailCount = Math.min(5, groups.length - half);
  const rethink = tailCount > 0 ? groups.slice(groups.length - tailCount).reverse() : [];

  const enoughData = ranking.covered.length >= MIN_COVERED;
  const needIdeas = !enoughData || groups.length === 0;

  const allRecipes = needIdeas ? await db.select().from(recipes) : [];
  const ideas = allRecipes.filter((r) => hasAnyTag(r.tags, IDEA_TAGS)).slice(0, 6);

  const riseText = (mgdl: number) => `${formatGlucose(mgdl, units)} ${unitLabel(units)}`;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Plan"
        title="Best meals for the week"
        lede="Not a list of good foods. A list of what your own readings did after the meals you actually logged."
        action={
          <Link href={`/plan?week=${week}`} className="btn btn-secondary btn-sm">
            Back to the week
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Meals logged" value={responses.length} sub={`last ${WINDOW_DAYS} days`} />
        <Stat label="Measurable" value={ranking.covered.length} sub="a reading before and after" />
        <Stat label="Not measurable" value={ranking.uncovered} sub="readings missing around them" />
        <Stat
          label="Repeated meals"
          value={groups.length}
          sub={`logged ${MIN_LOGS_PER_MEAL} times or more`}
        />
      </div>

      <div className="mb-5">
        <Notice>
          A rise is the highest reading 1 to 3 hours after a meal minus the reading nearest the meal beforehand. A meal
          with one of those missing cannot be measured, so it is counted separately rather than guessed at.
        </Notice>
      </div>

      {enoughData && groups.length > 0 ? (
        <>
          <section className="mb-6">
            <h2 className="mb-1">What has actually worked for you</h2>
            <p className="muted prose-measure mb-3">
              Your gentlest repeated meals over the last {WINDOW_DAYS} days, smallest average rise first.
            </p>
            <div className="grid gap-3">
              {gentlest.map((g, i) => (
                <GroupRow key={g.key} g={g} rank={i + 1} riseText={riseText} />
              ))}
            </div>
          </section>

          <section className="mb-6">
            <h2 className="mb-1">Worth a rethink</h2>
            {rethink.length === 0 ? (
              <p className="muted prose-measure">
                Only one of your meals repeats often enough to rank so far, so there is nothing to set against it yet.
                Once a second meal has been logged {MIN_LOGS_PER_MEAL} times with readings around it, the other end of
                the list appears here.
              </p>
            ) : (
              <>
                <p className="muted prose-measure mb-3">
                  The same meals ranked the other way. A high rise is information, not a verdict. Portion size, the
                  time of day, how fast you ate, what else was on the plate and what you were doing afterwards all
                  move this number, so treat a line here as something to look at again rather than something to give
                  up.
                </p>
                <div className="grid gap-3">
                  {rethink.map((g, i) => (
                    <GroupRow key={g.key} g={g} rank={i + 1} riseText={riseText} />
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      ) : (
        <Card className="mb-6">
          <h2 className="text-base font-display">Not enough of your own data yet</h2>
          <p className="muted mt-2 prose-measure">
            {ranking.covered.length === 0
              ? `None of the meals logged in the last ${WINDOW_DAYS} days have a reading before and a reading 1 to 3 hours after, so no rise can be measured yet.`
              : `Only ${ranking.covered.length} meal${ranking.covered.length === 1 ? " has" : "s have"} a reading before and after in the last ${WINDOW_DAYS} days, and no meal name repeats ${MIN_LOGS_PER_MEAL} times yet. That is too little to rank anything honestly.`}
          </p>
          <p className="muted mt-2 prose-measure">
            The way to fill this screen is a reading just before a meal and another one about two hours later, a few
            times, on meals you eat often.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/log/meal" className="btn btn-secondary btn-sm">
              Log a meal
            </Link>
            <Link href="/log/glucose" className="btn btn-secondary btn-sm">
              Log a reading
            </Link>
          </div>
        </Card>
      )}

      {needIdeas ? (
        <section>
          <h2 className="mb-1">Ideas to try, since there is not enough of your own data yet</h2>
          <p className="muted prose-measure mb-3">
            Recipes from your library built around fiber or a lower carb load. These are starting points to measure,
            not claims about what they will do to you.
          </p>

          {ideas.length === 0 ? (
            <EmptyState
              title="No recipe ideas loaded"
              body="The recipe library has not been written to the database. Run npm run setup in the project folder, then come back."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {ideas.map((r) => (
                <article key={r.id} className="card p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="leading-tight">{r.name}</h3>
                    <span className="pill shrink-0">{SLOT_LABEL[r.slot]}</span>
                  </div>
                  <div className="hint num">
                    {num(r.carbsG)} g carbs · {num(r.proteinG)} g protein · {num(r.fiberG)} g fiber · {num(r.minutes)} min
                  </div>
                  {tagList(r.tags).length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tagList(r.tags).map((t) => (
                        <span key={t} className="pill">
                          {tagLabel(t)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {r.whyItWorks ? <p className="text-sm muted">{r.whyItWorks}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2 pt-1">
                    <Link
                      href={`/plan/pick?week=${week}&slot=${r.slot}&recipeId=${r.id}`}
                      className="btn btn-juniper btn-sm"
                    >
                      Add to this week
                    </Link>
                    <Link href={`/plan/recipe/${r.id}?week=${week}`} className="btn btn-ghost btn-sm">
                      See the recipe
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <p className="hint mt-6 prose-measure">
        Week of {weekRangeLabel(week)}. Rises are shown in {unitLabel(units)} because that is the unit you chose.
      </p>
    </div>
  );
  });
}

function GroupRow({
  g,
  rank,
  riseText,
}: {
  g: Group;
  rank: number;
  riseText: (mgdl: number) => string;
}) {
  const carbs = Number.isFinite(g.meanCarbs) ? `${num(g.meanCarbs)} g carbs on average` : "carbs not recorded";
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="leading-tight">
            <span className="faint num mr-2" aria-hidden="true">
              {rank}
            </span>
            {g.name}
          </h3>
          <div className="hint mt-1">
            logged {g.n} time{g.n === 1 ? "" : "s"} · {carbs}
            {g.slots.length ? ` · ${g.slots.map((s) => s.replace(/_/g, " ")).join(", ")}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="num text-xl font-display">{riseText(g.meanRise)}</div>
          <div className="hint">average rise</div>
        </div>
      </div>
    </article>
  );
}
