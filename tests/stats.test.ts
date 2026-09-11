import { test } from "node:test";
import assert from "node:assert/strict";
import { glucoseStats, statsByBlock, lowEvents, dailySeries, blockOf } from "../src/lib/engines/stats";
import { mealResponse, rankMeals, mealResponses, riseBand } from "../src/lib/engines/mealResponse";

const at = (day: number, hour: number, min = 0) => new Date(2026, 8, day, hour, min);

/**
 * Worked by hand before reading the implementation.
 * Readings: 100, 120, 140, 200, 60 (mg/dL), target 70–180.
 *   n = 5, sum = 620, mean = 124
 *   deviations: -24, -4, 16, 76, -64 → squares 576, 16, 256, 5776, 4096 → sum 10720
 *   sample variance = 10720 / 4 = 2680 → SD = 51.7687...
 *   CV = 51.7687 / 124 * 100 = 41.749...%
 *   GMI = 3.31 + 0.02392 * 124 = 6.27608
 *   bands: 100/120/140 in range, 200 high, 60 low → TIR 60%, lows 1
 */
test("glucoseStats matches an independently worked example", () => {
  const rows = [
    { at: at(1, 8), valueMgdl: 100 },
    { at: at(1, 12), valueMgdl: 120 },
    { at: at(1, 16), valueMgdl: 140 },
    { at: at(1, 20), valueMgdl: 200 },
    { at: at(2, 3), valueMgdl: 60 },
  ];
  const s = glucoseStats(rows, 70, 180);
  assert.equal(s.n, 5);
  assert.equal(s.days, 2);
  assert.equal(s.mean, 124);
  assert.ok(Math.abs(s.sd! - 51.7687) < 0.001, `sd was ${s.sd}`);
  assert.ok(Math.abs(s.cv! - 41.7489) < 0.001, `cv was ${s.cv}`);
  assert.ok(Math.abs(s.gmi! - 6.27608) < 0.00001, `gmi was ${s.gmi}`);
  assert.equal(s.timeInRange, 60);
  assert.equal(s.lowsCount, 1);
  assert.equal(s.counts.high, 1);
  assert.equal(s.counts.very_low, 0);
  assert.equal(s.min, 60);
  assert.equal(s.max, 200);
});

test("SD is the sample standard deviation, not the population one", () => {
  // Two readings 100 and 140: mean 120, deviations ±20, sum of squares 800.
  // Sample (n-1): 800/1 = 800 → SD 28.284. Population (n): 400 → SD 20.
  const s = glucoseStats([
    { at: at(1, 8), valueMgdl: 100 },
    { at: at(1, 9), valueMgdl: 140 },
  ]);
  assert.ok(Math.abs(s.sd! - 28.2842) < 0.001, `sd was ${s.sd}`);
});

test("an empty list returns nulls, never NaN or zero", () => {
  const s = glucoseStats([]);
  assert.equal(s.n, 0);
  assert.equal(s.mean, null);
  assert.equal(s.timeInRange, null);
  assert.equal(s.gmi, null);
  assert.equal(s.cv, null);
  assert.equal(s.gmiReliable, false);
});

test("a single reading has no SD and therefore no CV", () => {
  const s = glucoseStats([{ at: at(1, 8), valueMgdl: 130 }]);
  assert.equal(s.mean, 130);
  assert.equal(s.sd, null);
  assert.equal(s.cv, null);
});

test("GMI is only marked reliable with 14 days and dense readings", () => {
  const sparse = Array.from({ length: 14 }, (_, i) => ({ at: at(i + 1, 9), valueMgdl: 140 }));
  assert.equal(glucoseStats(sparse).gmiReliable, false, "14 days but only 14 readings is not dense");
  const dense = Array.from({ length: 14 }, (_, i) => i).flatMap((d) =>
    [7, 11, 15, 19, 23].map((h) => ({ at: at(d + 1, h), valueMgdl: 140 })),
  );
  assert.equal(glucoseStats(dense).gmiReliable, true, "14 days x 5 readings is dense enough");
});

test("day blocks split at 6, 11, 16 and 22 hours", () => {
  assert.equal(blockOf(at(1, 23)), "overnight");
  assert.equal(blockOf(at(1, 5, 59)), "overnight");
  assert.equal(blockOf(at(1, 6)), "morning");
  assert.equal(blockOf(at(1, 10, 59)), "morning");
  assert.equal(blockOf(at(1, 11)), "midday");
  assert.equal(blockOf(at(1, 15, 59)), "midday");
  assert.equal(blockOf(at(1, 16)), "evening");
  assert.equal(blockOf(at(1, 21, 59)), "evening");
  assert.equal(blockOf(at(1, 22)), "overnight");
});

test("statsByBlock puts each reading in exactly one block", () => {
  const rows = [
    { at: at(1, 2), valueMgdl: 80 },
    { at: at(1, 8), valueMgdl: 150 },
    { at: at(1, 13), valueMgdl: 160 },
    { at: at(1, 19), valueMgdl: 200 },
  ];
  const b = statsByBlock(rows);
  assert.equal(b.overnight.n, 1);
  assert.equal(b.morning.n, 1);
  assert.equal(b.midday.n, 1);
  assert.equal(b.evening.n, 1);
  assert.equal(b.overnight.n + b.morning.n + b.midday.n + b.evening.n, rows.length);
});

test("lows within an hour of each other are one episode, not three", () => {
  const ev = lowEvents([
    { at: at(1, 3, 0), valueMgdl: 65 },
    { at: at(1, 3, 20), valueMgdl: 58 },
    { at: at(1, 3, 50), valueMgdl: 62 },
    { at: at(1, 14, 0), valueMgdl: 66 },
  ]);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].n, 3);
  assert.equal(ev[0].nadir, 58);
  assert.equal(ev[1].n, 1);
});

test("dailySeries keeps empty days so a chart does not lie about spacing", () => {
  const series = dailySeries([{ at: at(1, 9), valueMgdl: 120 }], at(1, 0), at(4, 0));
  assert.equal(series.length, 3);
  assert.equal(series[0].n, 1);
  assert.equal(series[1].n, 0);
  assert.equal(series[1].mean, null);
});

/* ------------------------------ meal response ------------------------------ */

const meal = (hour: number, carbs: number, tags = "") => ({ id: `m${hour}`, at: at(5, hour), name: `meal ${hour}`, carbsG: carbs, tags, slot: "lunch" });

test("post-meal rise uses the nearest pre reading and the highest reading 1 to 3 hours after", () => {
  const readings = [
    { at: at(5, 11, 30), valueMgdl: 110 }, // 30 min before  → pre candidate
    { at: at(5, 11, 55), valueMgdl: 105 }, // 5 min before   → nearer, wins
    { at: at(5, 12, 30), valueMgdl: 190 }, // 30 min after   → inside neither window
    { at: at(5, 13, 30), valueMgdl: 165 }, // 90 min after   → post window
    { at: at(5, 14, 30), valueMgdl: 175 }, // 150 min after  → post window, higher
    { at: at(5, 16, 30), valueMgdl: 250 }, // 4.5 h after    → outside
  ];
  const r = mealResponse(meal(12, 45), readings);
  assert.equal(r.pre, 105, "the 11:55 reading is nearer to noon than 11:30");
  assert.equal(r.peak, 175, "the 12:30 spike is before the window and the 16:30 one is after it");
  assert.equal(r.rise, 70);
  assert.equal(r.band, "spike");
});

test("a meal with no pre reading is uncovered and reports null, not zero", () => {
  const r = mealResponse(meal(12, 45), [{ at: at(5, 14), valueMgdl: 170 }]);
  assert.equal(r.pre, null);
  assert.equal(r.rise, null);
  assert.equal(r.band, null);
});

test("a meal with no post reading is uncovered", () => {
  const r = mealResponse(meal(12, 45), [{ at: at(5, 11, 45), valueMgdl: 100 }]);
  assert.equal(r.peak, null);
  assert.equal(r.rise, null);
});

test("rise bands split at 30 and 50 mg/dL", () => {
  assert.equal(riseBand(30), "gentle");
  assert.equal(riseBand(31), "moderate");
  assert.equal(riseBand(50), "moderate");
  assert.equal(riseBand(51), "spike");
});

test("rankMeals counts uncovered meals and ranks only covered ones", () => {
  const readings = [
    { at: at(5, 7, 55), valueMgdl: 100 },
    { at: at(5, 9, 30), valueMgdl: 120 }, // breakfast rise 20
    { at: at(5, 11, 55), valueMgdl: 110 },
    { at: at(5, 13, 30), valueMgdl: 190 }, // lunch rise 80
  ];
  const ranking = rankMeals(mealResponses([meal(8, 20, "eggs"), meal(12, 60, "pasta"), meal(19, 50, "rice")], readings));
  assert.equal(ranking.covered.length, 2);
  assert.equal(ranking.uncovered, 1);
  assert.equal(ranking.best[0].rise, 20);
  assert.equal(ranking.worst[0].rise, 80);
  assert.equal(ranking.spikeShare, 0.5, "one of two covered meals rose over 50");
});

test("tag and carb-bucket summaries refuse to speak with a single observation", () => {
  const readings = [
    { at: at(5, 11, 55), valueMgdl: 110 },
    { at: at(5, 13, 30), valueMgdl: 190 },
  ];
  const ranking = rankMeals(mealResponses([meal(12, 60, "pasta")], readings));
  assert.deepEqual(ranking.byTag, [], "one pasta meal is not a pasta finding");
  assert.deepEqual(ranking.byCarbBucket, []);
});
