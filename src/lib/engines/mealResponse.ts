/**
 * Post-meal glucose response. Pure.
 *
 * For a meal at time t:
 *   pre  = the reading closest to t within [t − 60 min, t + 10 min]
 *   post = the highest reading within [t + 60 min, t + 180 min]
 *   rise = post − pre
 * Both must exist or the meal is "uncovered" and reports rise = null. That coverage number is
 * shown to the person, because a best-meals list built on two covered meals is not a list.
 *
 * Bands (mg/dL rise): ≤ 30 gentle · ≤ 50 moderate · > 50 spike. These are pragmatic bands for
 * ranking a person's own meals against each other, not diagnostic thresholds.
 */
import type { ReadingLike } from "./stats";

export type MealLike = { id: string; at: Date; name: string; carbsG: number; tags: string; slot: string };

export type MealResponse = {
  mealId: string;
  name: string;
  at: Date;
  slot: string;
  carbsG: number;
  tags: string[];
  pre: number | null;
  peak: number | null;
  rise: number | null;
  band: "gentle" | "moderate" | "spike" | null;
};

const PRE_BEFORE_MS = 60 * 60_000;
const PRE_AFTER_MS = 10 * 60_000;
const POST_FROM_MS = 60 * 60_000;
const POST_TO_MS = 180 * 60_000;

export function riseBand(rise: number): "gentle" | "moderate" | "spike" {
  if (rise <= 30) return "gentle";
  if (rise <= 50) return "moderate";
  return "spike";
}

export function mealResponse(meal: MealLike, readings: ReadingLike[]): MealResponse {
  const t = meal.at.getTime();
  let pre: ReadingLike | null = null;
  let preDist = Infinity;
  let peak: number | null = null;
  for (const r of readings) {
    const rt = r.at.getTime();
    if (rt >= t - PRE_BEFORE_MS && rt <= t + PRE_AFTER_MS) {
      const d = Math.abs(rt - t);
      if (d < preDist) {
        preDist = d;
        pre = r;
      }
    } else if (rt >= t + POST_FROM_MS && rt <= t + POST_TO_MS) {
      if (peak === null || r.valueMgdl > peak) peak = r.valueMgdl;
    }
  }
  const rise = pre && peak !== null ? peak - pre.valueMgdl : null;
  return {
    mealId: meal.id,
    name: meal.name,
    at: meal.at,
    slot: meal.slot,
    carbsG: meal.carbsG,
    tags: meal.tags
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    pre: pre ? pre.valueMgdl : null,
    peak,
    rise,
    band: rise === null ? null : riseBand(rise),
  };
}

export function mealResponses(meals: MealLike[], readings: ReadingLike[]): MealResponse[] {
  return meals.map((m) => mealResponse(m, readings));
}

export type MealRanking = {
  covered: MealResponse[];
  uncovered: number;
  /** Lowest rise first. */
  best: MealResponse[];
  /** Highest rise first. */
  worst: MealResponse[];
  spikeShare: number | null; // fraction of covered meals that spiked
  /** Mean rise by carb bucket, only buckets with ≥ 2 covered meals. */
  byCarbBucket: { bucket: string; n: number; meanRise: number }[];
  /** Mean rise by tag, tags with ≥ 2 covered meals, worst first. */
  byTag: { tag: string; n: number; meanRise: number }[];
};

export function rankMeals(responses: MealResponse[]): MealRanking {
  const covered = responses.filter((r) => r.rise !== null) as (MealResponse & { rise: number })[];
  const sorted = [...covered].sort((a, b) => a.rise - b.rise);
  const spikes = covered.filter((r) => r.rise > 50).length;

  const buckets: Record<string, number[]> = { "0–15 g": [], "16–30 g": [], "31–45 g": [], "46–60 g": [], "60+ g": [] };
  for (const r of covered) {
    const c = r.carbsG;
    const key = c <= 15 ? "0–15 g" : c <= 30 ? "16–30 g" : c <= 45 ? "31–45 g" : c <= 60 ? "46–60 g" : "60+ g";
    buckets[key].push(r.rise);
  }
  const byCarbBucket = Object.entries(buckets)
    .filter(([, v]) => v.length >= 2)
    .map(([bucket, v]) => ({ bucket, n: v.length, meanRise: v.reduce((a, b) => a + b, 0) / v.length }));

  const tagMap = new Map<string, number[]>();
  for (const r of covered) for (const tag of r.tags) tagMap.set(tag, [...(tagMap.get(tag) ?? []), r.rise]);
  const byTag = [...tagMap.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([tag, v]) => ({ tag, n: v.length, meanRise: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.meanRise - a.meanRise);

  return {
    covered,
    uncovered: responses.length - covered.length,
    best: sorted.slice(0, 5),
    worst: sorted.slice(-5).reverse(),
    spikeShare: covered.length ? spikes / covered.length : null,
    byCarbBucket,
    byTag,
  };
}
