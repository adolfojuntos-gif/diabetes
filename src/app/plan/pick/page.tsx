/**
 * Recipe picker. Reached from a "+" in the week grid, or from a recipe's "Add to this week".
 *
 * Filters are plain GET fields on this URL, so a filtered list is a link the person can go back
 * to. The tag chips are built from the tags actually present in the recipes table, never from a
 * hard-coded list, so the seed content decides what is offered.
 */
import Link from "next/link";
import { db, recipes, type MealSlot } from "@/lib/db";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import { chooseRecipe } from "../actions";
import {
  DAY_LABEL,
  SLOTS,
  SLOT_LABEL,
  dayFromParam,
  firstParam,
  num,
  numFromParam,
  slotFromParam,
  tagLabel,
  tagList,
  weekFromParam,
  weekRangeLabel,
} from "../lib";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PickPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const week = weekFromParam(sp.week);
  const day = dayFromParam(sp.day);
  const slot = slotFromParam(sp.slot);
  const tag = firstParam(sp.tag);
  const maxMinutes = numFromParam(sp.maxMinutes, 1, 600);
  const maxCarbs = numFromParam(sp.maxCarbs, 0, 400);
  const error = firstParam(sp.error);
  const preselectId = firstParam(sp.recipeId);
  return requireAccount(async () => {

  const all = await db.select().from(recipes);

  const allTags = [...new Set(all.flatMap((r) => tagList(r.tags)))].sort();
  const activeTag = tag && allTags.includes(tag.toLowerCase()) ? tag.toLowerCase() : null;

  const matches = all
    .filter((r) => (slot ? r.slot === slot : true))
    .filter((r) => (activeTag ? tagList(r.tags).includes(activeTag) : true))
    .filter((r) => (maxMinutes === null ? true : r.minutes <= maxMinutes))
    .filter((r) => (maxCarbs === null ? true : r.carbsG <= maxCarbs))
    .sort((a, b) => a.name.localeCompare(b.name));

  const preselect = preselectId ? all.find((r) => r.id === preselectId) ?? null : null;

  const heading =
    day !== null && slot
      ? `Choose ${SLOT_LABEL[slot].toLowerCase()} for ${DAY_LABEL[day]}`
      : preselect
        ? `Where does ${preselect.name} go?`
        : "Choose a recipe";

  const chipHref = (params: Record<string, string | null>) => {
    const q = new URLSearchParams();
    q.set("week", week);
    if (day !== null) q.set("day", String(day));
    if (slot) q.set("slot", slot);
    if (preselectId) q.set("recipeId", preselectId);
    if (activeTag) q.set("tag", activeTag);
    if (maxMinutes !== null) q.set("maxMinutes", String(maxMinutes));
    if (maxCarbs !== null) q.set("maxCarbs", String(maxCarbs));
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/plan/pick?${q.toString()}`;
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Week of ${weekRangeLabel(week)}`}
        title={heading}
        lede="Carbs, protein and fiber are per serving. Why it works explains how the recipe is put together, not what it will do to you."
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

      {all.length === 0 ? (
        <EmptyState
          title="No recipes loaded yet"
          body="The recipe library has not been written to the database. Run npm run setup in the project folder, then come back."
        />
      ) : (
        <>
          <Card className="mb-4">
            <h2 className="text-base font-display">Narrow it down</h2>
            <form className="grid gap-3 sm:grid-cols-3 mt-3">
              <input type="hidden" name="week" value={week} />
              {day !== null ? <input type="hidden" name="day" value={day} /> : null}
              {preselectId ? <input type="hidden" name="recipeId" value={preselectId} /> : null}
              {activeTag ? <input type="hidden" name="tag" value={activeTag} /> : null}

              <div className="field">
                <label className="label" htmlFor="slot">
                  Slot
                </label>
                <select id="slot" name="slot" className="select" defaultValue={slot ?? ""}>
                  <option value="">Any slot</option>
                  {SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {SLOT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="maxMinutes">
                  Ready within (minutes)
                </label>
                <input
                  id="maxMinutes"
                  name="maxMinutes"
                  type="number"
                  min={1}
                  max={600}
                  step={5}
                  className="input"
                  defaultValue={maxMinutes ?? ""}
                  placeholder="any"
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="maxCarbs">
                  Carbs at most (g)
                </label>
                <input
                  id="maxCarbs"
                  name="maxCarbs"
                  type="number"
                  min={0}
                  max={400}
                  step={5}
                  className="input"
                  defaultValue={maxCarbs ?? ""}
                  placeholder="any"
                />
              </div>

              <div className="sm:col-span-3 flex gap-2">
                <SubmitButton className="btn btn-secondary" pendingText="Filtering…">
                  Apply filters
                </SubmitButton>
                <Link href={chipHref({ tag: null, maxMinutes: null, maxCarbs: null })} className="btn btn-ghost">
                  Reset
                </Link>
              </div>
            </form>

            {allTags.length ? (
              <div className="mt-4">
                <div className="eyebrow mb-2">Tags in your recipes</div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={chipHref({ tag: null })}
                    className={`pill ${activeTag === null ? "pill-juniper" : ""}`}
                    aria-current={activeTag === null ? "true" : undefined}
                  >
                    Any tag
                  </Link>
                  {allTags.map((t) => (
                    <Link
                      key={t}
                      href={chipHref({ tag: t })}
                      className={`pill ${activeTag === t ? "pill-juniper" : ""}`}
                      aria-current={activeTag === t ? "true" : undefined}
                    >
                      {tagLabel(t)}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <p className="muted mb-3">
            {matches.length} recipe{matches.length === 1 ? "" : "s"} match.
          </p>

          {matches.length === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              body="Try a longer cooking time, a higher carb limit, or any tag."
              cta="Reset the filters"
              href={chipHref({ tag: null, maxMinutes: null, maxCarbs: null })}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {matches.map((r) => {
                const tags = tagList(r.tags);
                const cellSlot: MealSlot = slot ?? r.slot;
                return (
                  <article key={r.id} className="card p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="leading-tight">{r.name}</h3>
                      <span className="pill shrink-0">{SLOT_LABEL[r.slot]}</span>
                    </div>

                    <div className="hint num">
                      {num(r.carbsG)} g carbs · {num(r.proteinG)} g protein · {num(r.fiberG)} g fiber · {num(r.minutes)}{" "}
                      min
                    </div>

                    {tags.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((t) => (
                          <span key={t} className="pill">
                            {tagLabel(t)}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {r.whyItWorks ? <p className="text-sm muted">{r.whyItWorks}</p> : null}

                    <form action={chooseRecipe} className="mt-auto flex flex-wrap items-end gap-2 pt-1">
                      <input type="hidden" name="week" value={week} />
                      <input type="hidden" name="recipeId" value={r.id} />
                      <input type="hidden" name="slot" value={cellSlot} />
                      {day !== null ? (
                        <input type="hidden" name="day" value={day} />
                      ) : (
                        <div className="field">
                          <label className="label" htmlFor={`day-${r.id}`}>
                            Day
                          </label>
                          <select id={`day-${r.id}`} name="day" className="select" defaultValue="0">
                            {DAY_LABEL.map((d, i) => (
                              <option key={d} value={i}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <SubmitButton className="btn btn-juniper" pendingText="Adding…">
                        Choose
                      </SubmitButton>
                      <Link href={`/plan/recipe/${r.id}?week=${week}`} className="btn btn-ghost btn-sm">
                        See the recipe
                      </Link>
                    </form>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
  });
}
