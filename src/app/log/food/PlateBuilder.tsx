"use client";
/**
 * Build a plate from reference foods, see the carbohydrate as it grows, then log it.
 *
 * All the arithmetic that matters was done on the server by `engines/foods.ts` and arrives
 * precomputed per portion. This component only picks portions, multiplies by a count, and adds up.
 * Keeping the maths on one side of the wire is what stops a displayed number and a logged number
 * from ever disagreeing.
 */
import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/Form";

type Portion = {
  id: string;
  label: string;
  grams: number;
  carbsG: number;
  netCarbsG: number;
  fiberG: number;
  proteinG: number;
  caloriesKcal: number;
  weight: string;
};

export type FoodCard = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  source: string;
  note: string;
  custom: boolean;
  per100: { carbsG: number; proteinG: number; fatG: number; fiberG: number; caloriesKcal: number };
  portions: Portion[];
  gramsForTarget: number | null;
  history: { meanRise: number; minRise: number; maxRise: number; covered: number } | null;
  timesLogged: number;
};

type Line = { key: string; foodId: string; name: string; portionLabel: string; grams: number; carbsG: number; count: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A signed change, written the way a person reads it. Prefixing a raw number with "+" produced
 * "+-32" for a meal that ended lower than it started, which is the second time that exact bug has
 * appeared in this codebase, so the formatting lives in one place now.
 */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "no change";
}

export function PlateBuilder({
  action,
  foods,
  defaultAt,
  slots,
  dailyCarbTarget,
}: {
  action: (fd: FormData) => Promise<void>;
  foods: FoodCard[];
  defaultAt: string;
  slots: { value: string; label: string }[];
  dailyCarbTarget: number | null;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [showNet, setShowNet] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const totals = useMemo(() => {
    const carbsG = lines.reduce((a, l) => a + l.carbsG * l.count, 0);
    const grams = lines.reduce((a, l) => a + l.grams * l.count, 0);
    return { carbsG: r1(carbsG), grams: r1(grams), count: lines.length };
  }, [lines]);

  function add(food: FoodCard, portion: Portion) {
    setLines((prev) => {
      const key = `${food.id}:${portion.id}`;
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, count: l.count + 1 } : l));
      return [
        ...prev,
        {
          key,
          foodId: food.id,
          name: food.name,
          portionLabel: portion.label,
          grams: portion.grams,
          carbsG: showNet ? portion.netCarbsG : portion.carbsG,
          count: 1,
        },
      ];
    });
  }

  function bump(key: string, by: number) {
    setLines((prev) => prev.flatMap((l) => (l.key === key ? (l.count + by <= 0 ? [] : [{ ...l, count: l.count + by }]) : [l])));
  }

  const payload = JSON.stringify(lines.flatMap((l) => Array.from({ length: l.count }, () => ({ foodId: l.foodId, grams: l.grams }))));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] items-start">
      {/* ------------------------------- results ------------------------------- */}
      <div className="grid gap-3 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} />
            <span>
              Show carbohydrate with fibre subtracted
              <span className="hint block">
                Guidelines count total carbohydrate. Subtracting fibre is a personal choice to make with your care team, so total is the default here.
              </span>
            </span>
          </label>
        </div>

        {foods.map((food) => {
          const selected = chosen[food.id] ?? food.portions[0].id;
          const portion = food.portions.find((p) => p.id === selected) ?? food.portions[0];
          const carbs = showNet ? portion.netCarbsG : portion.carbsG;
          return (
            <article key={food.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate">{food.name}</h3>
                  <div className="hint">
                    {food.brand ? `${food.brand} · ` : ""}
                    {food.category}
                    {food.custom ? " · your own entry" : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-display text-3xl">
                    {carbs}
                    <span className="text-sm font-body muted ml-1">g carbs</span>
                  </div>
                  <div className="hint">{portion.label}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {food.portions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`pill ${p.id === selected ? "pill-slate" : ""}`}
                    onClick={() => setChosen((c) => ({ ...c, [food.id]: p.id }))}
                  >
                    {p.label}
                    <span className="num opacity-70">{showNet ? p.netCarbsG : p.carbsG} g</span>
                  </button>
                ))}
              </div>

              <div className="hint mt-2">
                {portion.grams} g · {portion.proteinG} g protein · {portion.fiberG} g fibre · {portion.caloriesKcal} kcal · {portion.weight.toLowerCase()}
              </div>

              {food.gramsForTarget !== null ? (
                <div className="mt-2 text-sm">
                  For your carbohydrate target, about <strong className="num">{food.gramsForTarget} g</strong> of this.
                </div>
              ) : null}

              {food.history ? (
                <div className="mt-3 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--slate-soft)" }}>
                  <strong>Your own readings after this food.</strong> Average change{" "}
                  <span className="num">{signed(food.history.meanRise)} mg/dL</span> across {food.history.covered} meals, ranging from{" "}
                  <span className="num">{signed(food.history.minRise)}</span> to <span className="num">{signed(food.history.maxRise)}</span>.
                  That is your history, not a prediction.
                </div>
              ) : food.timesLogged > 0 ? (
                <div className="hint mt-3">
                  Logged {food.timesLogged} time{food.timesLogged === 1 ? "" : "s"}, but not yet with a reading before and after, so there is no personal average to show.
                </div>
              ) : null}

              {food.note ? <p className="muted text-sm mt-2">{food.note}</p> : null}
              <div className="flex items-center justify-between gap-3 mt-3">
                <span className="hint">Source: {food.source}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(food, portion)}>
                  Add to plate
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* -------------------------------- plate -------------------------------- */}
      <form action={action} className="card p-4 lg:sticky lg:top-4 grid gap-3">
        <div>
          <div className="eyebrow">This plate</div>
          <div className="num font-display text-4xl mt-1">
            {totals.carbsG}
            <span className="text-base font-body muted ml-1">g carbs</span>
          </div>
          <div className="hint">
            {showNet ? "fibre subtracted" : "total carbohydrate"}
            {totals.grams > 0 ? ` · ${totals.grams} g of food` : ""}
            {dailyCarbTarget ? ` · your daily target is ${dailyCarbTarget} g` : ""}
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="hint">Nothing added yet. Pick a portion on the left and add it.</p>
        ) : (
          <ul className="grid gap-2">
            {lines.map((l) => (
              <li key={l.key} className="card-sunk p-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{l.name}</div>
                  <div className="hint">
                    {l.count} × {l.portionLabel} · <span className="num">{r1(l.carbsG * l.count)} g</span>
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => bump(l.key, -1)} aria-label={`One less ${l.name}`}>
                  −
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => bump(l.key, 1)} aria-label={`One more ${l.name}`}>
                  +
                </button>
              </li>
            ))}
          </ul>
        )}

        <input type="hidden" name="lines" value={payload} />
        <div className="field">
          <label className="label" htmlFor="plate-name">
            Call it
          </label>
          <input id="plate-name" name="name" className="input" maxLength={200} placeholder={lines.map((l) => l.name).join(", ").slice(0, 60) || "Lunch"} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="field">
            <label className="label" htmlFor="plate-slot">
              Which meal
            </label>
            <select id="plate-slot" name="slot" className="select" defaultValue="lunch">
              {slots.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="plate-at">
              When
            </label>
            <input id="plate-at" name="at" type="datetime-local" className="input" defaultValue={defaultAt} required />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="plate-note">
            Note
          </label>
          <input id="plate-note" name="note" className="input" maxLength={500} placeholder="Ate out, bigger portion than usual" />
        </div>
        <SubmitButton className="btn" pendingText="Logging…">
          Log this plate
        </SubmitButton>
        {lines.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines([])}>
            Clear the plate
          </button>
        ) : null}
      </form>
    </div>
  );
}
