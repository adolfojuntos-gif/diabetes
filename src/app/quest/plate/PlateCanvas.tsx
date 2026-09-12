"use client";
/**
 * The plate itself: four quarters, what is in them, and what the numbers cannot tell you.
 *
 * The arithmetic is `engines/plate.ts`, imported and run here rather than duplicated. It is pure
 * and free of `server-only` precisely so the board can recompute as somebody adds a portion without
 * a round trip, and so the figure on screen and the figure in the test come from the same function.
 *
 * A food is PLACED by its macros, never dragged. Dragging reads well in a design and is worse in
 * every way that counts: poor on a phone, close to unusable with a keyboard or a screen reader, and
 * it would let somebody file a food in the wrong quarter, which turns the plate into a record of
 * what they believed rather than what they ate. Being told where a food actually sits is also the
 * entire insight.
 */
import { useEffect, useMemo, useState } from "react";
import { SubmitButton } from "@/components/Form";
import { explorePlate, quarterOf, shapeLine, QUARTERS, QUARTER_INFO, type PlateItem } from "@/lib/engines/plate";

export type PlatePortion = {
  id: string;
  label: string;
  grams: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fiberG: number;
  caloriesKcal: number;
};

export type PlateCard = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  source: string;
  /** Worded by the server. Empty when there is nothing worth saying about the figure's age. */
  ageNote: string;
  per100: { carbsG: number; proteinG: number; fatG: number; fiberG: number; category: string };
  portions: PlatePortion[];
};

/** Scoped to this feature so nothing else in the app can collide with it. */
const STORE_KEY = "steady:plate";

export function PlateCanvas({
  cards,
  action,
  defaultAt,
  slots,
  justSaved,
}: {
  cards: PlateCard[];
  action: (fd: FormData) => Promise<void>;
  defaultAt: string;
  slots: { value: string; label: string }[];
  /** True on the render straight after a save, so the plate can be put down. */
  justSaved: boolean;
}) {
  const [items, setItems] = useState<PlateItem[]>([]);
  const reading = useMemo(() => explorePlate(items), [items]);

  /*
   * THE PLATE HAS TO SURVIVE A SEARCH.
   *
   * Searching is a server navigation, so without this the plate emptied every time somebody looked
   * up a second food. Building a meal out of more than one thing was therefore impossible, which
   * is most meals.
   *
   * `sessionStorage` rather than `localStorage`: a half-built plate is scratch work for this sitting,
   * not something to find again next week, and a stale plate reappearing days later would be worse
   * than none. Every access is wrapped, because private windows and blocked site data make these
   * throw rather than return null, and an unbuildable plate is not worth a broken page.
   */
  const [restored, setRestored] = useState(false);
  /*
   * `set-state-in-effect` is a good rule and this is the case it does not cover, so it is turned
   * off for this effect only and turned straight back on.
   *
   * Restoring persisted state after mount is exactly what an effect is for. The alternative the
   * rule wants, a lazy useState initialiser, would read sessionStorage during the server render
   * where it does not exist, and the server HTML would then disagree with the first client render.
   * An empty first paint followed by the restored plate is the correct behaviour here.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    /*
     * A SAVED PLATE IS PUT DOWN. Persistence exists so a plate survives a SEARCH, and carrying it
     * past the save turns the same meal into something somebody can log twice without noticing,
     * which is worse than losing it. The redirect carries the saved flag, so this is the one
     * restore that deliberately does not happen.
     */
    if (justSaved) {
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
        const parsed = JSON.parse(raw) as PlateItem[];
        if (Array.isArray(parsed)) setItems(parsed.filter((i) => i && typeof i.key === "string" && i.count > 0));
      }
    } catch {
      /* no stored plate, or storage is unavailable. Starting empty is correct either way. */
    }
    setRestored(true);
  }, [justSaved]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // Never write before the restore has run, or an empty first render wipes the stored plate.
    if (!restored) return;
    try {
      if (items.length === 0) sessionStorage.removeItem(STORE_KEY);
      else sessionStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch {
      /* Nothing to do. The plate still works for this page. */
    }
  }, [items, restored]);

  function add(card: PlateCard, portion: PlatePortion) {
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
          per100: card.per100,
          source: card.source,
          ageNote: card.ageNote,
        },
      ];
    });
  }

  function bump(key: string, by: number) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, count: i.count + by } : i)).filter((i) => i.count > 0));
  }

  /** What the save action needs: the food id and the total grams for each line. */
  const lines = JSON.stringify(items.map((i) => ({ foodId: i.key.split(":")[0], grams: i.grams * i.count })));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div>
        {/* ------------------------------- the board ------------------------------- */}
        <div className="plate-board">
          {QUARTERS.map((q) => {
            const share = reading.quarters.find((x) => x.quarter === q)!;
            const info = QUARTER_INFO[q];
            return (
              <section key={q} className={`plate-quarter ${share.items.length ? "" : "plate-quarter-empty"}`} aria-label={info.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="eyebrow">
                    {info.glyph} {info.name}
                  </div>
                  {share.grams > 0 ? <span className="hint num">{Math.round(share.grams)} g</span> : null}
                </div>

                {share.items.length === 0 ? (
                  <p className="hint mt-2">{info.holds}</p>
                ) : (
                  <ul className="grid gap-1.5 mt-2">
                    {share.items.map((i) => (
                      <li key={i.key} className="plate-chip">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{i.name}</span>
                          <span className="hint">
                            {i.count > 1 ? `${i.count} × ` : ""}
                            {i.portionLabel} · {Math.round(i.carbsG * i.count)} g carbs
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
              </section>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="prose-measure">{shapeLine(reading)}</p>
          {items.length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setItems([])}>
              Clear the plate
            </button>
          ) : null}
        </div>

        {/* ------------------------------ the reference ---------------------------- */}
        <h2 className="mt-8 mb-3">Add something</h2>
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
                  <span className="pill" title={c.source}>
                    {QUARTER_INFO[quarterOf(c.per100)].glyph} {QUARTER_INFO[quarterOf(c.per100)].name}
                  </span>
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

      {/* ---------------------------- explore your meal --------------------------- */}
      <aside className="grid gap-4 content-start">
        <div className="card p-4">
          <div className="eyebrow">Explore your meal</div>
          <p className="hint mt-1">Here is what you are working with. Nothing on this screen is a verdict.</p>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="card-sunk p-3">
              <div className="eyebrow">Carbohydrate</div>
              <div className="num text-2xl font-display mt-1">
                {reading.carbsG}
                <span className="text-sm font-body muted ml-1">g</span>
              </div>
              <div className="hint mt-1 num">{reading.netCarbsG} g without the fibre</div>
            </div>
            <div className="card-sunk p-3">
              <div className="eyebrow">Energy</div>
              <div className="num text-2xl font-display mt-1">
                {reading.caloriesKcal}
                <span className="text-sm font-body muted ml-1">kcal</span>
              </div>
            </div>
          </div>

          <dl className="grid gap-1 mt-3 text-sm">
            {[
              ["Protein", `${reading.proteinG} g`],
              ["Fat", `${reading.fatG} g`],
              ["Fibre", `${reading.fiberG} g`],
              ["On the plate", `${Math.round(reading.grams)} g of food`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="muted">{k}</dt>
                <dd className="num">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/*
          The uncertainty list is the most useful thing here and it is never empty. A carbohydrate
          total with no caveat invites a precision it does not have, and somebody dosing against it
          deserves to see the doubts a dietitian would say out loud.
        */}
        <div className="card p-4">
          <div className="eyebrow">What these numbers do not know</div>
          <ul className="grid gap-2 mt-2 text-sm">
            {reading.uncertainty.map((u) => (
              <li key={u} className="prose-measure">
                {u}
              </li>
            ))}
          </ul>
        </div>

        {items.length > 0 ? (
          <form action={action} className="card p-4 grid gap-3">
            <div className="eyebrow">Log it, if you want to</div>
            <input type="hidden" name="lines" value={lines} />
            <div className="field">
              <label className="label" htmlFor="plate-at">
                When
              </label>
              <input id="plate-at" name="at" type="datetime-local" className="input" defaultValue={defaultAt} required />
            </div>
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
              <label className="label" htmlFor="plate-name">
                Call it something
              </label>
              <input id="plate-name" name="name" className="input" maxLength={200} placeholder="Chicken and rice" />
            </div>
            <SubmitButton>Save this plate</SubmitButton>
          </form>
        ) : null}
      </aside>
    </div>
  );
}
