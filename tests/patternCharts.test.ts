import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPatterns, type Snapshot, type Pattern, type PatternChart } from "../src/lib/engines/patterns";

/**
 * The charts on the pattern cards.
 *
 * One rule carries all of these: A CHART MAY NOT SHOW A NUMBER ITS OWN EVIDENCE SENTENCE DOES NOT
 * STATE. A chart is read faster and trusted harder than a sentence, so a picture that disagreed with
 * the words beneath it would be worse than no picture, and the disagreement would be invisible in
 * review because the two are written 400 lines apart.
 *
 * The rule applies to MEASURED values: bar heights, the gauge's needle, the tally's count and total.
 * It does not apply to thresholds (a gauge's good zone and its maximum), which are published
 * clinical constants used throughout this app rather than measurements of this person.
 *
 * Everything here runs against real `detectPatterns` output built from synthetic readings, not
 * against hand-written chart specs, so a pattern added later is covered the moment it fires.
 */

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 15, 12, 0, 0);

function reading(daysAgo: number, hour: number, valueMgdl: number) {
  const d = new Date(NOW.getTime() - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return { at: d, valueMgdl };
}

function baseSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW,
    windowDays: 14,
    targetLow: 70,
    targetHigh: 180,
    hydrationGoalMl: 2000,
    sleepGoalMinutes: 450,
    usesInsulinBolus: true,
    readings: [],
    meals: [],
    exercise: [],
    sleep: [],
    hydration: [],
    insulin: [],
    ...over,
  };
}

/**
 * Several snapshots, each shaped to fire a different family of patterns, so the assertions below
 * run over as much of the engine as synthetic data can reach.
 */
function everyPattern(): Pattern[] {
  const out: Pattern[] = [];

  // Lows, very lows and overnight lows, plus a poor time in range.
  const lows: { at: Date; valueMgdl: number }[] = [];
  for (let d = 0; d < 14; d++) {
    lows.push(reading(d, 3, 48));
    lows.push(reading(d, 4, 61));
    lows.push(reading(d, 10, 210));
    lows.push(reading(d, 20, 240));
  }
  out.push(...detectPatterns(baseSnapshot({ readings: lows })).patterns);

  // A dawn rise, good time in range, and a weekend effect.
  const dawn: { at: Date; valueMgdl: number }[] = [];
  for (let d = 0; d < 14; d++) {
    const weekend = [0, 6].includes(new Date(NOW.getTime() - d * DAY).getDay());
    dawn.push(reading(d, 3, 105));
    dawn.push(reading(d, 7, 150));
    dawn.push(reading(d, 13, weekend ? 165 : 120));
    dawn.push(reading(d, 19, weekend ? 170 : 125));
  }
  out.push(...detectPatterns(baseSnapshot({ readings: dawn })).patterns);

  // Sleep, hydration, exercise and logging gaps.
  const sleep = Array.from({ length: 10 }, (_, i) => ({
    wakeDate: new Date(NOW.getTime() - i * DAY).toISOString().slice(0, 10),
    minutes: i % 2 === 0 ? 320 : 470,
    quality: 3,
  }));
  const hydration = Array.from({ length: 8 }, (_, i) => ({ at: new Date(NOW.getTime() - i * DAY), ml: 900 }));
  const exercise = Array.from({ length: 5 }, (_, i) => ({
    at: new Date(NOW.getTime() - i * DAY - 6 * 3_600_000),
    minutes: 35,
    intensity: "moderate",
    kind: "walk",
  }));
  out.push(
    ...detectPatterns(
      baseSnapshot({
        readings: dawn,
        sleep,
        hydration,
        exercise,
      }),
    ).patterns,
  );

  // Almost no readings, which is what produces the logging patterns.
  out.push(...detectPatterns(baseSnapshot({ readings: [reading(0, 9, 120), reading(1, 9, 130)] })).patterns);

  return out;
}

const ALL = everyPattern();
const CHARTED = ALL.filter((p) => p.chart);

/** Every number written in a sentence, including decimals. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n));
}

/**
 * Is `value` present in the sentence, allowing for the rounding the sentence does?
 *
 * The evidence rounds to zero or one decimal place, so an exact match is the wrong test. Minutes are
 * also written as hours in prose ("7.5 hours a night"), so that conversion is accepted too. Glucose
 * is compared in mg/dL because that is what both the engine and the sentence use; the conversion to
 * mmol happens in the component, at display time, and is covered by `tests/units.test.ts`.
 */
function statedIn(value: number, unit: string, evidence: string): boolean {
  const candidates = numbersIn(evidence);
  const forms = unit === "minutes" ? [value, value / 60, Math.round((value / 60) * 10) / 10] : [value];
  return forms.some((form) =>
    candidates.some((n) => Math.abs(n - form) <= 0.51 || Math.abs(n - Math.round(form * 10) / 10) <= 0.051),
  );
}

/** The values a chart claims to have measured. Thresholds are excluded by design. */
function measuredValues(chart: PatternChart): { value: number; what: string }[] {
  if (chart.kind === "compare") return chart.bars.map((b) => ({ value: b.value, what: `bar "${b.label}"` }));
  if (chart.kind === "gauge") return [{ value: chart.value, what: "gauge value" }];
  const out = [{ value: chart.count, what: "tally count" }];
  if (chart.of !== null) out.push({ value: chart.of, what: "tally total" });
  return out;
}

/* ------------------------------ the harness itself ------------------------------ */

test("the synthetic data actually fires a useful spread of charted patterns", () => {
  // A test suite that silently covered two patterns would pass every assertion below and prove
  // nothing, so the coverage is asserted first.
  assert.ok(CHARTED.length >= 10, `only ${CHARTED.length} charted patterns fired`);
  const kinds = new Set(CHARTED.map((p) => p.chart!.kind));
  assert.deepEqual([...kinds].sort(), ["compare", "gauge", "tally"], `kinds covered: ${[...kinds].join(", ")}`);
});

/* ------------------------------- the central rule ------------------------------- */

test("every number a chart shows is stated in its own evidence sentence", () => {
  const drift: string[] = [];
  for (const p of CHARTED) {
    const chart = p.chart!;
    const unit = chart.kind === "tally" ? "count" : chart.unit;
    for (const { value, what } of measuredValues(chart)) {
      if (!statedIn(value, unit, p.evidence)) {
        drift.push(`${p.key}: ${what} is ${value} but the evidence says "${p.evidence}"`);
      }
    }
  }
  assert.deepEqual(drift, [], "a chart is showing a figure the sentence underneath it does not");
});

/* ---------------------------- nothing undrawable ---------------------------- */

test("no chart carries a value that cannot be drawn", () => {
  for (const p of CHARTED) {
    for (const { value, what } of measuredValues(p.chart!)) {
      assert.ok(Number.isFinite(value), `${p.key}: ${what} is ${value}`);
      // A negative bar would render backwards out of its track rather than fail.
      assert.ok(value >= 0, `${p.key}: ${what} is negative (${value})`);
    }
  }
});

test("a gauge's track and its good zone are coherent", () => {
  const gauges = CHARTED.filter((p) => p.chart!.kind === "gauge");
  assert.ok(gauges.length > 0, "no gauges fired, so this is checking nothing");
  for (const p of gauges) {
    const c = p.chart as Extract<PatternChart, { kind: "gauge" }>;
    // A zero maximum divides by zero when a value becomes a position.
    assert.ok(c.max > 0, `${p.key}: gauge max is ${c.max}`);
    assert.ok(c.good.from <= c.good.to, `${p.key}: good zone runs backwards`);
    assert.ok(c.good.from >= 0 && c.good.to <= c.max, `${p.key}: good zone falls outside the track`);
    /**
     * The value has to fit on the track, or the needle sits at the end and the reader is told
     * something false by omission. Caught a real case: variability above 60% is possible and the
     * track only went to 60.
     */
    assert.ok(c.value <= c.max, `${p.key}: value ${c.value} is past the end of a track of ${c.max}`);
  }
});

test("a comparison compares at least two things", () => {
  const compares = CHARTED.filter((p) => p.chart!.kind === "compare");
  assert.ok(compares.length > 0, "no comparisons fired");
  for (const p of compares) {
    const c = p.chart as Extract<PatternChart, { kind: "compare" }>;
    assert.ok(c.bars.length >= 2, `${p.key}: a comparison of ${c.bars.length}`);
    assert.ok(c.bars.length <= 3, `${p.key}: ${c.bars.length} bars is a chart, not a card`);
    const labels = c.bars.map((b) => b.label);
    assert.equal(new Set(labels).size, labels.length, `${p.key}: two bars share a label`);
    for (const b of c.bars) assert.ok(b.label.trim().length > 0, `${p.key}: a bar has no label`);
  }
});

test("a tally never counts past its own total", () => {
  const tallies = CHARTED.filter((p) => p.chart!.kind === "tally");
  assert.ok(tallies.length > 0, "no tallies fired");
  for (const p of tallies) {
    const c = p.chart as Extract<PatternChart, { kind: "tally" }>;
    assert.ok(Number.isInteger(c.count), `${p.key}: a count of ${c.count}`);
    if (c.of !== null) {
      assert.ok(Number.isInteger(c.of), `${p.key}: a total of ${c.of}`);
      // "12 of 8 days" draws four dots that cannot exist and reads as a bug in the app.
      assert.ok(c.count <= c.of, `${p.key}: ${c.count} of ${c.of}`);
    }
    assert.ok(c.noun.trim().length > 0, `${p.key}: a tally with no noun`);
    // The noun follows a number in a sentence, so a leading capital reads as a new sentence.
    assert.equal(c.noun[0], c.noun[0].toLowerCase(), `${p.key}: noun "${c.noun}" should not be capitalised`);
  }
});

/* -------------------------- the house rules, on charts -------------------------- */

test("no chart label uses an em-dash or restates its own unit", () => {
  for (const p of CHARTED) {
    const chart = p.chart!;
    const labels = chart.kind === "compare" ? chart.bars.map((b) => b.label) : chart.kind === "tally" ? [chart.noun] : [];
    for (const l of labels) {
      assert.doesNotMatch(l, /—/, `${p.key}: em-dash in "${l}"`);
      // The component appends the unit, so a label carrying one produces "120 mg/dL mg/dL".
      assert.doesNotMatch(l, /mg\/dL|mmol/i, `${p.key}: label "${l}" repeats the unit`);
    }
  }
});

test("a pattern with no chart is a deliberate choice, not a forgotten one", () => {
  /**
   * Not every finding is clearer as a picture, so `chart` is optional. This asserts the ones left
   * bare are the ones intended to be bare, which is the only way an accidental omission shows up:
   * a missing chart renders a perfectly normal card.
   */
  const BARE_BY_DESIGN = new Set<string>([]);
  const bare = ALL.filter((p) => !p.chart).map((p) => p.key);
  const unexpected = [...new Set(bare)].filter((k) => !BARE_BY_DESIGN.has(k));
  assert.deepEqual(unexpected, [], "these patterns fired with no chart and are not on the expected list");
});

test("a tally's noun agrees with the number in front of it", () => {
  /**
   * "1 readings under 54" was on screen. The count is computed and the word was a fixed string,
   * which reads fine until the count is one. Asserted by generating the singular case for every
   * tally rather than by checking the strings that happen to fire today.
   */
  const singulars = [
    // One very low reading, one logged session, one missing day.
    baseSnapshot({ readings: [reading(0, 3, 48), ...Array.from({ length: 12 }, (_, i) => reading(i, 12, 120))] }),
    baseSnapshot({
      readings: Array.from({ length: 12 }, (_, i) => reading(i, 12, 120)),
      exercise: [{ at: new Date(NOW.getTime() - 3_600_000), minutes: 30, intensity: "moderate", kind: "walk" }],
    }),
  ];

  const offenders: string[] = [];
  for (const snap of singulars) {
    for (const p of detectPatterns(snap).patterns) {
      const c = p.chart;
      if (!c || c.kind !== "tally") continue;
      // The word agrees with the total when there is one, and with the count when there is not.
      const governing = c.of ?? c.count;
      const looksPlural = /s\b/.test(c.noun.split(" ")[0]);
      if (governing === 1 && looksPlural) offenders.push(`${p.key}: "${governing} ${c.noun}"`);
      if (governing !== 1 && !looksPlural) offenders.push(`${p.key}: "${governing} ${c.noun}"`);
    }
  }
  assert.deepEqual(offenders, [], "these read wrongly next to their own number");
});
