/**
 * Glucose statistics. Pure functions over readings already in mg/dL.
 *
 * Definitions follow the 2019 international consensus on time in range (Battelino et al.):
 *   very low < 54 · low 54–69 · in range 70–180 · high 181–250 · very high > 250
 * The in-range band uses the person's own target when they have set one; the outer bands are
 * fixed because they are clinical thresholds, not preferences.
 *
 * GMI (glucose management indicator, Bergenstal 2018): 3.31 + 0.02392 × mean(mg/dL).
 * SD is the sample standard deviation (n − 1). CV = SD / mean × 100; the consensus target is ≤ 36%.
 */
import { VERY_LOW_MGDL, VERY_HIGH_MGDL, LOW_MGDL, HIGH_MGDL, type Band } from "../units";
import { DAY_MS, dateKey, hourOf } from "../time";

export type ReadingLike = { at: Date; valueMgdl: number };

export type Distribution = Record<Band, number>; // percent, sums to ~100

export type GlucoseStats = {
  n: number;
  days: number; // distinct local days with at least one reading
  mean: number | null;
  sd: number | null;
  cv: number | null;
  gmi: number | null;
  min: number | null;
  max: number | null;
  counts: Record<Band, number>;
  pct: Distribution;
  /** % in the personal target band; equals pct.in_range. Kept named so screens read clearly. */
  timeInRange: number | null;
  lowsCount: number; // very_low + low
  /** GMI is only meaningful with ~14 days of dense data. */
  gmiReliable: boolean;
};

export const EMPTY_PCT: Distribution = { very_low: 0, low: 0, in_range: 0, high: 0, very_high: 0 };

export function bandWithTargets(mgdl: number, low: number, high: number): Band {
  if (mgdl < VERY_LOW_MGDL) return "very_low";
  if (mgdl < low) return "low";
  if (mgdl <= high) return "in_range";
  if (mgdl <= VERY_HIGH_MGDL) return "high";
  return "very_high";
}

export function glucoseStats(readings: ReadingLike[], low = LOW_MGDL, high = HIGH_MGDL): GlucoseStats {
  const counts: Record<Band, number> = { very_low: 0, low: 0, in_range: 0, high: 0, very_high: 0 };
  const n = readings.length;
  if (n === 0) {
    return {
      n: 0,
      days: 0,
      mean: null,
      sd: null,
      cv: null,
      gmi: null,
      min: null,
      max: null,
      counts,
      pct: { ...EMPTY_PCT },
      timeInRange: null,
      lowsCount: 0,
      gmiReliable: false,
    };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const days = new Set<string>();
  for (const r of readings) {
    sum += r.valueMgdl;
    if (r.valueMgdl < min) min = r.valueMgdl;
    if (r.valueMgdl > max) max = r.valueMgdl;
    counts[bandWithTargets(r.valueMgdl, low, high)]++;
    days.add(dateKey(r.at));
  }
  const mean = sum / n;
  let sd: number | null = null;
  if (n > 1) {
    let ss = 0;
    for (const r of readings) ss += (r.valueMgdl - mean) ** 2;
    sd = Math.sqrt(ss / (n - 1));
  }
  const pct: Distribution = {
    very_low: (counts.very_low / n) * 100,
    low: (counts.low / n) * 100,
    in_range: (counts.in_range / n) * 100,
    high: (counts.high / n) * 100,
    very_high: (counts.very_high / n) * 100,
  };
  return {
    n,
    days: days.size,
    mean,
    sd,
    cv: sd === null || mean === 0 ? null : (sd / mean) * 100,
    gmi: 3.31 + 0.02392 * mean,
    min,
    max,
    counts,
    pct,
    timeInRange: pct.in_range,
    lowsCount: counts.very_low + counts.low,
    gmiReliable: days.size >= 14 && n >= 14 * 4,
  };
}

/** Readings whose timestamp falls in [from, to). */
export function between<T extends { at: Date }>(rows: T[], from: Date, to: Date): T[] {
  const a = from.getTime();
  const b = to.getTime();
  return rows.filter((r) => {
    const t = r.at.getTime();
    return t >= a && t < b;
  });
}

export type DayBlock = "overnight" | "morning" | "midday" | "evening";
export const DAY_BLOCKS: { key: DayBlock; label: string; from: number; to: number }[] = [
  { key: "overnight", label: "Overnight (10pm–6am)", from: 22, to: 6 },
  { key: "morning", label: "Morning (6am–11am)", from: 6, to: 11 },
  { key: "midday", label: "Midday (11am–4pm)", from: 11, to: 16 },
  { key: "evening", label: "Evening (4pm–10pm)", from: 16, to: 22 },
];

export function blockOf(d: Date): DayBlock {
  const h = hourOf(d);
  if (h >= 22 || h < 6) return "overnight";
  if (h < 11) return "morning";
  if (h < 16) return "midday";
  return "evening";
}

export function statsByBlock(readings: ReadingLike[], low?: number, high?: number): Record<DayBlock, GlucoseStats> {
  const groups: Record<DayBlock, ReadingLike[]> = { overnight: [], morning: [], midday: [], evening: [] };
  for (const r of readings) groups[blockOf(r.at)].push(r);
  return {
    overnight: glucoseStats(groups.overnight, low, high),
    morning: glucoseStats(groups.morning, low, high),
    midday: glucoseStats(groups.midday, low, high),
    evening: glucoseStats(groups.evening, low, high),
  };
}

export type DailyPoint = { date: string; mean: number | null; n: number; min: number | null; max: number | null; tir: number | null };

/** One point per local day across [from, to), including empty days so charts keep their spacing. */
export function dailySeries(readings: ReadingLike[], from: Date, to: Date, low?: number, high?: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  const byDay = new Map<string, ReadingLike[]>();
  for (const r of readings) {
    const k = dateKey(r.at);
    const arr = byDay.get(k);
    if (arr) arr.push(r);
    else byDay.set(k, [r]);
  }
  for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) {
    const k = dateKey(new Date(t));
    const s = glucoseStats(byDay.get(k) ?? [], low, high);
    out.push({ date: k, mean: s.mean, n: s.n, min: s.min, max: s.max, tir: s.timeInRange });
  }
  return out;
}

/** Group lows into events: consecutive lows less than `gapMin` apart count as one episode. */
export function lowEvents(readings: ReadingLike[], low = LOW_MGDL, gapMin = 60): { start: Date; nadir: number; n: number }[] {
  const lows = readings.filter((r) => r.valueMgdl < low).sort((a, b) => a.at.getTime() - b.at.getTime());
  const events: { start: Date; nadir: number; n: number; last: number }[] = [];
  for (const r of lows) {
    const t = r.at.getTime();
    const cur = events[events.length - 1];
    if (cur && t - cur.last <= gapMin * 60_000) {
      cur.last = t;
      cur.n++;
      if (r.valueMgdl < cur.nadir) cur.nadir = r.valueMgdl;
    } else {
      events.push({ start: r.at, nadir: r.valueMgdl, n: 1, last: t });
    }
  }
  return events.map(({ start, nadir, n }) => ({ start, nadir, n }));
}

export function round(x: number | null, dp = 0): number | null {
  if (x === null || Number.isNaN(x)) return null;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
