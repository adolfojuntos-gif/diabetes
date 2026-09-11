/**
 * Helpers shared by the /plan screens and their server actions. Pure, no DB, no React.
 *
 * Two things here are load bearing:
 *
 * 1. JSON columns (`recipes.ingredients`, `recipes.steps`) are TEXT written by the seed script.
 *    Every parse goes through `parseIngredients` / `parseSteps`, which return an empty list on
 *    anything malformed rather than throwing. A bad row must not take a screen down.
 * 2. "Fill my week" has to be deterministic. `rngFor(weekKey)` seeds a small PRNG off the week
 *    string, so re-running the fill on the same week rebuilds the same week instead of
 *    reshuffling it.
 */
import { GROCERY_AISLES, MEAL_SLOTS, type GroceryAisle, type MealSlot } from "@/lib/db";
import { dateKey, startOfWeek, parseDateKey, addDays } from "@/lib/time";

/* ------------------------------ vocabulary ------------------------------ */

export const SLOTS: readonly MealSlot[] = MEAL_SLOTS;

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export const DAY_LABEL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Shopping order, not alphabetical: the way a person walks a store. */
export const AISLE_ORDER: readonly GroceryAisle[] = [
  "produce",
  "protein",
  "dairy",
  "grains",
  "pantry",
  "frozen",
  "snacks",
  "drinks",
  "other",
];

export const AISLE_LABEL: Record<GroceryAisle, string> = {
  produce: "Produce",
  protein: "Protein",
  dairy: "Dairy",
  grains: "Grains and bread",
  pantry: "Pantry",
  frozen: "Frozen",
  snacks: "Snacks",
  drinks: "Drinks",
  other: "Other",
};

/** Tags the fill preferers look for, in order of preference. */
export const PREFERRED_TAGS = ["high-fiber", "high-protein"] as const;
/** Tags used for "ideas to try" when there is not enough of the person's own data. */
export const IDEA_TAGS = ["high-fiber", "low-carb"] as const;

/* -------------------------------- params -------------------------------- */

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Param = string | string[] | undefined;

export function firstParam(p: Param): string | null {
  if (Array.isArray(p)) return p.length ? p[0] : null;
  return typeof p === "string" ? p : null;
}

/** Monday of the requested week, or Monday of this week. Always normalised to a Monday. */
export function weekFromParam(p: Param, now = new Date()): string {
  const raw = firstParam(p);
  if (raw && WEEK_RE.test(raw)) {
    const d = parseDateKey(raw);
    if (!Number.isNaN(d.getTime())) return dateKey(startOfWeek(d));
  }
  return dateKey(startOfWeek(now));
}

export function shiftWeek(weekOf: string, weeks: number): string {
  return dateKey(startOfWeek(addDays(parseDateKey(weekOf), weeks * 7)));
}

export function weekRangeLabel(weekOf: string): string {
  const start = parseDateKey(weekOf);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const s = start.toLocaleDateString([], sameMonth ? { month: "long", day: "numeric" } : { month: "short", day: "numeric" });
  const e = end.toLocaleDateString([], sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${s} to ${e}`;
}

export function dayOfWeek(weekOf: string, day: number): Date {
  return addDays(parseDateKey(weekOf), day);
}

export function slotFromParam(p: Param): MealSlot | null {
  const raw = firstParam(p);
  return raw && (MEAL_SLOTS as readonly string[]).includes(raw) ? (raw as MealSlot) : null;
}

export function dayFromParam(p: Param): number | null {
  const raw = firstParam(p);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
}

export function numFromParam(p: Param, min: number, max: number): number | null {
  const raw = firstParam(p);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function asAisle(v: unknown): GroceryAisle {
  return typeof v === "string" && (GROCERY_AISLES as readonly string[]).includes(v) ? (v as GroceryAisle) : "other";
}

/* --------------------------------- tags --------------------------------- */

export function tagList(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function hasAnyTag(tags: string | null | undefined, wanted: readonly string[]): boolean {
  const list = tagList(tags);
  return wanted.some((w) => list.includes(w));
}

/** Human form of a tag for a chip: "high-fiber" -> "high fiber". */
export function tagLabel(tag: string): string {
  return tag.replace(/[-_]/g, " ");
}

/* ------------------------------ JSON columns ----------------------------- */

export type Ingredient = { name: string; qty: string; aisle: GroceryAisle };

/**
 * `recipes.ingredients` is TEXT holding a JSON array of { name, qty, aisle }. Anything that is
 * not that shape is dropped silently: the screen renders one fewer line instead of crashing.
 */
export function parseIngredients(json: string | null | undefined): Ingredient[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Ingredient[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) out.push({ name, qty: "", aisle: "other" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const qtyRaw = rec.qty;
    const qty = typeof qtyRaw === "string" ? qtyRaw.trim() : typeof qtyRaw === "number" && Number.isFinite(qtyRaw) ? String(qtyRaw) : "";
    out.push({ name, qty, aisle: asAisle(rec.aisle) });
  }
  return out;
}

/** `recipes.steps` is TEXT holding a JSON array of strings. */
export function parseSteps(json: string | null | undefined): string[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s === "string" && s.trim()) out.push(s.trim());
    else if (s && typeof s === "object") {
      const t = (s as Record<string, unknown>).text;
      if (typeof t === "string" && t.trim()) out.push(t.trim());
    }
  }
  return out;
}

/* -------------------------------- numbers -------------------------------- */

/**
 * Never render NaN, null or undefined. A missing number becomes an en dash in a numeric slot,
 * which only happens when a row is corrupt: every numeric recipe column is NOT NULL.
 */
export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

/**
 * Join two quantity strings, part by part. "1 cup" + "2 tbsp" becomes "1 cup + 2 tbsp"; a part
 * already present is not added again, so rebuilding the list from the same plan twice does not
 * double a quantity. The cost is that two recipes asking for the identical string collapse to one
 * part, which is the same thing that happens within a single build.
 */
export function mergeQty(existing: string, addition: string): string {
  const parts = existing
    .split(" + ")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of addition.split(" + ")) {
    const part = raw.trim();
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(" + ");
}

/* ------------------------ deterministic week filling ---------------------- */

/** FNV-1a over the string, so the same week key always gives the same seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32. Small, deterministic, good enough for picking dinners. */
export function rngFor(seedText: string): () => number {
  let a = hashString(seedText) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with a supplied rng. Returns a new array; the input is untouched. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Candidate order for one slot: preferred recipes (high fiber or high protein) first, each group
 * shuffled with a seed derived from the week and the slot. Sorted by id before shuffling so the
 * result does not depend on the order the database happened to return rows in.
 */
export function candidateOrder<T extends { id: string; tags: string }>(
  pool: readonly T[],
  weekOf: string,
  slot: string,
): T[] {
  const stable = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const preferred = stable.filter((r) => hasAnyTag(r.tags, PREFERRED_TAGS));
  const rest = stable.filter((r) => !hasAnyTag(r.tags, PREFERRED_TAGS));
  const rng = rngFor(`${weekOf}:${slot}`);
  return [...shuffled(preferred, rng), ...shuffled(rest, rng)];
}
