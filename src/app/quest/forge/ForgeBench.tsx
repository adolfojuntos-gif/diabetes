"use client";
/**
 * The bench: what is in the crucible, what one serving of it comes to, and what it cannot tell you.
 *
 * The arithmetic is `engines/forge.ts`, imported and run here rather than restated. It is pure and
 * free of `server-only` on purpose, so the figure that moves as somebody adds a portion and the
 * figure a test asserts come from the same function.
 */
import { useEffect, useMemo, useState } from "react";
import { SubmitButton } from "@/components/Form";
import { forge, type ForgeIngredient } from "@/lib/engines/forge";

export type ForgePortion = {
  id: string;
  label: string;
  grams: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
};

export type ForgeCard = {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  /** Worded by the server. Empty when there is nothing worth saying about the figure's age. */
  ageNote: string;
  portions: ForgePortion[];
};

/** Scoped to this feature so nothing else in the app can collide with it. */
const STORE_KEY = "steady:forge";

export function ForgeBench({
  cards,
  action,
  justForged,
}: {
  cards: ForgeCard[];
  action: (fd: FormData) => Promise<void>;
  /** True on the render straight after a recipe was forged, so the bench can be cleared down. */
  justForged: boolean;
}) {
  const [items, setItems] = useState<ForgeIngredient[]>([]);
  const [servings, setServings] = useState(4);
  const [finished, setFinished] = useState("");

  const finishedGrams = finished.trim() === "" ? null : Number(finished);
  const forged = useMemo(
    () => forge(items, { servings, finishedGrams: Number.isFinite(finishedGrams as number) ? finishedGrams : null }),
    [items, servings, finishedGrams],
  );

  /*
   * THE CRUCIBLE HAS TO SURVIVE A SEARCH, for the same reason the plate does: searching is a server
   * navigation, and a recipe is several ingredients by definition. `sessionStorage` rather than
   * `localStorage`, because a half-built recipe is scratch work for this sitting and one
   * reappearing next week would be worse than none. Every access is wrapped, because a private
   * window or blocked site data makes these throw rather than return null.
   */
  const [restored, setRestored] = useState(false);
  /*
   * `set-state-in-effect` is a good rule and this is the case it does not cover, so it is off for
   * this effect only. Restoring persisted state after mount is what an effect is for; the lazy
   * useState initialiser the rule wants would read sessionStorage during the server render, where
   * it does not exist, and the server HTML would then disagree with the first client render.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // A forged recipe is put down. Carrying it past the save is how the same pot gets filed twice.
    if (justForged) {
      try {
        sessionStorage.removeItem(STORE_KEY);
      } catch {
        /* nothing to clear */
      }
      setRestored(true);
      return;
    }
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { items?: ForgeIngredient[]; servings?: number; finished?: string };
        if (Array.isArray(parsed.items)) setItems(parsed.items.filter((i) => i && typeof i.key === "string" && i.count > 0));
        if (typeof parsed.servings === "number" && parsed.servings > 0) setServings(Math.round(parsed.servings));
        if (typeof parsed.finished === "string") setFinished(parsed.finished);
      }
    } catch {
      /* nothing stored, or storage is unavailable. An empty bench is correct either way. */
    }
    setRestored(true);
  }, [justForged]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // Never write before the restore has run, or an empty first render wipes the stored recipe.
    if (!restored) return;
    try {
      if (items.length === 0) sessionStorage.removeItem(STORE_KEY);
      else sessionStorage.setItem(STORE_KEY, JSON.stringify({ items, servings, finished }));
    } catch {
      /* Nothing to do. The bench still works for this page. */
    }
  }, [items, servings, finished, restored]);

  function add(card: ForgeCard, portion: ForgePortion) {
    setItems((prev) => {
      const key = `${card.id}:${portion.id}`;
      const found = prev.find((i) => i.key === key);
      if (found) return prev.map((i) => (i.key === key ? { ...i, count: i.count + 1 } : i));
      return [
        ...prev,
        {
          key,
          name: card.name,
          portionLabel: portion.label,
          grams: portion.grams,
          count: 1,
          carbsG: portion.carbsG,
          proteinG: portion.proteinG,
          fatG: portion.fatG,
          fiberG: portion.fiberG,
          caloriesKcal: portion.caloriesKcal,
          source: card.source,
          ageNote: card.ageNote,
        },
      ];
    });
  }

  function bump(key: string, by: number) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, count: i.count + by } : i)).filter((i) => i.count > 0));
  }

  const share = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div>
        {/* ------------------------------ the crucible ----------------------------- */}
        <div className="forge-crucible">
          <div className="flex items-baseline justify-between gap-3">
            <div className="eyebrow">In the crucible</div>
            {items.length > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setItems([])}>
                Empty it
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="hint mt-3">Nothing yet. Search below and add what goes in the pot, in the amounts you actually cook.</p>
          ) : (
            <ul className="grid gap-1.5 mt-3">
              {items.map((i) => (
                <li key={i.key} className="forge-line">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.name}</span>
                    <span className="hint">
                      {i.count > 1 ? `${i.count} × ` : ""}
                      {i.portionLabel} · {Math.round(i.grams * i.count)} g · {Math.round(i.carbsG * i.count)} g carbs
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => bump(i.key, -1)} aria-label={`One less ${i.name}`}>
                      −
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => bump(i.key, 1)} aria-label={`One more ${i.name}`}>
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* ------------------------------- the mark ------------------------------ */}
          <div className="forge-mark mt-4">
            <span className="forge-glyph" aria-hidden>
              {forged.mark.glyph}
            </span>
            <div className="min-w-0">
              <div className="font-display text-lg">{forged.mark.name}</div>
              <p className="hint">{forged.mark.line}</p>
            </div>
          </div>

          {items.length > 0 ? (
            <div className="forge-shares mt-3" role="img" aria-label={`Energy: carbohydrate ${share(forged.shares.carbohydrate)}, protein ${share(forged.shares.protein)}, fat ${share(forged.shares.fat)}`}>
              {([
                ["carbohydrate", forged.shares.carbohydrate],
                ["protein", forged.shares.protein],
                ["fat", forged.shares.fat],
              ] as const).map(([k, v]) =>
                v > 0 ? (
                  <span key={k} className={`forge-share forge-share-${k}`} style={{ flexGrow: v }} title={`${k} ${share(v)}`}>
                    {/*
                      A small share gets a segment and no label. Printing one anyway either spills
                      out of a sliver or forces the sliver wider than its share, and a bar that
                      disagrees with its own number is worse than a bar with a gap in it. The whole
                      split is on the container's aria-label and on each segment's title.
                    */}
                    {v >= 0.14 ? (
                      <span className="forge-share-label">
                        {k} {share(v)}
                      </span>
                    ) : null}
                  </span>
                ) : null,
              )}
            </div>
          ) : null}
        </div>

        {/* ------------------------------ the reference ---------------------------- */}
        <h2 className="mt-8 mb-3">Add an ingredient</h2>
        {cards.length === 0 ? (
          <p className="muted">Search above to find a food. Every figure comes from the carbohydrate reference.</p>
        ) : (
          <ul className="grid gap-2">
            {cards.map((c) => (
              <li key={c.id} className="card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-display text-lg">{c.name}</span>
                    {c.brand ? <span className="hint ml-2">{c.brand}</span> : null}
                  </div>
                  <span className="hint">{c.source}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {c.portions.map((p) => (
                    <button key={p.id} type="button" className="btn btn-secondary btn-sm" onClick={() => add(c, p)}>
                      {p.label}
                      <span className="num opacity-70">{p.carbsG} g</span>
                    </button>
                  ))}
                </div>
                {c.ageNote ? <p className="hint mt-2">{c.ageNote}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --------------------------------- the yield ------------------------------ */}
      <aside className="grid gap-4 content-start">
        <div className="card p-4">
          <div className="eyebrow">One serving</div>
          <p className="hint mt-1">The batch divided by how many it makes. This is the figure that follows the recipe everywhere.</p>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="card-sunk p-3">
              <div className="eyebrow">Carbohydrate</div>
              <div className="num text-2xl font-display mt-1">
                {forged.serving.carbsG}
                <span className="text-sm font-body muted ml-1">g</span>
              </div>
            </div>
            <div className="card-sunk p-3">
              <div className="eyebrow">Energy</div>
              <div className="num text-2xl font-display mt-1">
                {forged.serving.caloriesKcal}
                <span className="text-sm font-body muted ml-1">kcal</span>
              </div>
            </div>
          </div>

          <dl className="grid gap-1 mt-3 text-sm">
            {[
              ["Protein", `${forged.serving.proteinG} g`],
              ["Fat", `${forged.serving.fatG} g`],
              ["Fibre", `${forged.serving.fiberG} g`],
              ["A serving weighs", `${Math.round(forged.servingGrams)} g`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="muted">{k}</dt>
                <dd className="num">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="divider my-3" />
          <div className="eyebrow">The whole batch</div>
          <dl className="grid gap-1 mt-2 text-sm">
            {[
              ["Carbohydrate", `${forged.batch.carbsG} g`],
              ["Energy", `${forged.batch.caloriesKcal} kcal`],
              ["Weight", `${Math.round(forged.basisGrams)} g`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="muted">{k}</dt>
                <dd className="num">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/*
          Never empty. A recipe's doubts travel further than a plate's, because this figure gets
          divided and then reused for months.
        */}
        <div className="card p-4">
          <div className="eyebrow">What this cannot tell you</div>
          <ul className="grid gap-2 mt-2 text-sm">
            {forged.uncertainty.map((u) => (
              <li key={u} className="prose-measure">
                {u}
              </li>
            ))}
          </ul>
        </div>

        <form action={action} className="card p-4 grid gap-3">
          <div className="eyebrow">Forge it</div>
          <input type="hidden" name="ingredients" value={JSON.stringify(items)} />

          <div className="field">
            <label className="label" htmlFor="forge-name">
              Call it something
            </label>
            <input id="forge-name" name="name" className="input" maxLength={80} placeholder="Sunday chili" required disabled={items.length === 0} />
          </div>

          <div className="field">
            <label className="label" htmlFor="forge-servings">
              How many servings it makes
            </label>
            <input
              id="forge-servings"
              name="servings"
              type="number"
              min={1}
              max={60}
              step={1}
              className="input"
              value={servings}
              onChange={(e) => setServings(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="forge-finished">
              What the finished pot weighs, if you weighed it
            </label>
            <input
              id="forge-finished"
              name="finishedGrams"
              type="number"
              min={0}
              max={20000}
              step={1}
              className="input"
              value={finished}
              onChange={(e) => setFinished(e.target.value)}
              placeholder={`${Math.round(forged.batch.grams)} g went in`}
            />
            <p className="hint mt-1">
              Optional. It does not change what a serving contains, only what 100 g of the finished food does.
            </p>
          </div>

          <SubmitButton disabled={items.length === 0}>Forge this recipe</SubmitButton>
          <p className="hint">
            It becomes one of your foods. After this it is in the search box everywhere, and logging it is one tap.
          </p>
        </form>
      </aside>
    </div>
  );
}
