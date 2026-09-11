/**
 * The grocery list for one week, in shopping order rather than alphabetical order.
 *
 * Each checkbox is a one-field form posting to a server action, so the list works with no client
 * JavaScript. Building from the plan merges by lowercase name within the week, which means running
 * it twice does not double anything.
 */
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, groceryItems, recipes, GROCERY_AISLES, type GroceryAisle } from "@/lib/db";
import { PageHeader, Card, Stat, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import {
  addGroceryItem,
  buildGroceryFromPlan,
  clearAllGrocery,
  clearCheckedGrocery,
  deleteGroceryItem,
  toggleGroceryItem,
} from "../actions";
import { AISLE_LABEL, AISLE_ORDER, firstParam, shiftWeek, weekFromParam, weekRangeLabel } from "../lib";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function GroceryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const week = weekFromParam(sp.week);
  const error = firstParam(sp.error);
  return requireAccount(async () => {

  const rows = await db
    .select({ item: groceryItems, recipeName: recipes.name })
    .from(groceryItems)
    .leftJoin(recipes, eq(groceryItems.fromRecipeId, recipes.id))
    .where(eq(groceryItems.weekOf, week));

  const items = [...rows].sort((a, b) => a.item.name.localeCompare(b.item.name));
  const unchecked = items.filter((r) => !r.item.checked).length;
  const checked = items.length - unchecked;

  const groups = AISLE_ORDER.map((aisle) => ({
    aisle,
    rows: items.filter((r) => r.item.aisle === aisle),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Week of ${weekRangeLabel(week)}`}
        title="Grocery list"
        lede="Grouped the way a store is laid out, so you walk it once."
        action={
          <div className="flex gap-2">
            <Link href={`/plan/grocery?week=${shiftWeek(week, -1)}`} className="btn btn-secondary btn-sm">
              Previous
            </Link>
            <Link href={`/plan/grocery?week=${shiftWeek(week, 1)}`} className="btn btn-secondary btn-sm">
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Stat label="Still to buy" value={unchecked} sub={items.length ? `of ${items.length} items` : "nothing on the list"} />
        <Stat label="In the basket" value={checked} sub="ticked off" />
        <Stat label="Aisles" value={groups.length} sub="with something in them" />
      </div>

      <Card className="mb-4">
        <h2 className="text-base font-display">Fill the list</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <form action={buildGroceryFromPlan}>
            <input type="hidden" name="week" value={week} />
            <SubmitButton className="btn btn-juniper" pendingText="Building…">
              Build from this week&apos;s plan
            </SubmitButton>
          </form>
          <Link href={`/plan?week=${week}`} className="btn btn-secondary">
            See the week&apos;s plan
          </Link>
          {checked > 0 ? (
            <form action={clearCheckedGrocery}>
              <input type="hidden" name="week" value={week} />
              <SubmitButton className="btn btn-secondary" pendingText="Clearing…">
                Clear checked
              </SubmitButton>
            </form>
          ) : null}
          {items.length > 0 ? (
            <form action={clearAllGrocery}>
              <input type="hidden" name="week" value={week} />
              <SubmitButton className="btn btn-danger" pendingText="Clearing…">
                Clear all
              </SubmitButton>
            </form>
          ) : null}
        </div>
        <p className="hint mt-3">
          Building walks every meal planned for this week and adds its ingredients. Two recipes needing the same thing
          become one line with both quantities.
        </p>
      </Card>

      <Card className="mb-4">
        <h2 className="text-base font-display">Add something</h2>
        <form action={addGroceryItem} className="grid gap-3 sm:grid-cols-4 mt-3 items-end">
          <input type="hidden" name="week" value={week} />
          <div className="field sm:col-span-2">
            <label className="label" htmlFor="g-name">
              Item
            </label>
            <input id="g-name" name="name" className="input" maxLength={120} required placeholder="Greek yogurt" />
          </div>
          <div className="field">
            <label className="label" htmlFor="g-qty">
              Quantity
            </label>
            <input id="g-qty" name="qty" className="input" maxLength={60} placeholder="500 g" />
          </div>
          <div className="field">
            <label className="label" htmlFor="g-aisle">
              Aisle
            </label>
            <select id="g-aisle" name="aisle" className="select" defaultValue="other">
              {(GROCERY_AISLES as readonly GroceryAisle[]).map((a) => (
                <option key={a} value={a}>
                  {AISLE_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <SubmitButton className="btn" pendingText="Adding…">
              Add to the list
            </SubmitButton>
          </div>
        </form>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing on the list yet"
          body="Plan some meals for this week and build the list from them, or add items by hand above. If the recipe library is empty, run npm run setup first."
          cta="Plan this week"
          href={`/plan?week=${week}`}
        />
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <section key={g.aisle} className="card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-display">{AISLE_LABEL[g.aisle]}</h2>
                <span className="hint num">
                  {g.rows.filter((r) => !r.item.checked).length} of {g.rows.length} left
                </span>
              </div>
              <ul className="grid gap-1 mt-3">
                {g.rows.map(({ item, recipeName }) => (
                  <li key={item.id} className="flex items-center gap-3 py-1">
                    <form action={toggleGroceryItem} className="shrink-0 flex">
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        role="checkbox"
                        aria-checked={item.checked}
                        aria-label={`${item.name}${item.qty ? `, ${item.qty}` : ""}`}
                        className="w-11 h-11 flex items-center justify-center rounded-lg"
                        style={{ border: "1px solid var(--line-strong)" }}
                      >
                        <span aria-hidden="true" className={item.checked ? "" : "opacity-0"}>
                          ✓
                        </span>
                      </button>
                    </form>

                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${item.checked ? "faint line-through" : ""}`}>{item.name}</div>
                      <div className="hint">
                        {item.qty ? <span className="num">{item.qty}</span> : null}
                        {item.qty && recipeName ? " · " : null}
                        {recipeName ? <span>from {recipeName}</span> : null}
                      </div>
                    </div>

                    <form action={deleteGroceryItem} className="shrink-0">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="week" value={week} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                        <span aria-hidden="true">×</span>
                        <span className="sr-only">{`Remove ${item.name} from the list`}</span>
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
  });
}
