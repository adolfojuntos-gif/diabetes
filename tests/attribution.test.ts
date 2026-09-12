import { test } from "node:test";
import assert from "node:assert/strict";
import { explainReading, type ExplainInput } from "../src/lib/engines/attribution";

/**
 * "Why did this happen", tested.
 *
 * Two kinds of assertion here and the second kind matters more.
 *
 * The first is ordinary: given a meal before a high reading, the meal is named. Given nothing, no
 * factor is invented.
 *
 * The second is about what this engine must never say. It explains glucose to somebody who has
 * diabetes, and the failure modes are not crashes. They are a confident claim about a cause, or a
 * sentence that reads as advice about insulin. Those tests scan the actual output of every branch,
 * because a phrase added to one factor in six months will not be reviewed against this file.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date(2026, 8, 15, 12, 0, 0);

const at = (daysAgo: number, hour: number, minute = 0) => {
  const d = new Date(NOW.getTime() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
};

function base(over: Partial<ExplainInput> = {}): ExplainInput {
  return {
    at: NOW,
    valueMgdl: 214,
    targetLow: 70,
    targetHigh: 180,
    usesInsulinBolus: false,
    hydrationGoalMl: 2000,
    sleepGoalMinutes: 450,
    readings: [],
    meals: [],
    insulin: [],
    exercise: [],
    sleep: [],
    hydration: [],
    ...over,
  };
}

/** A month of ordinary in-range readings, so the engine has a baseline to compare against. */
function baseline(): { at: Date; valueMgdl: number }[] {
  const out: { at: Date; valueMgdl: number }[] = [];
  for (let d = 0; d < 30; d++) {
    for (const h of [3, 8, 13, 19]) out.push({ at: at(d, h), valueMgdl: 120 });
  }
  return out;
}

const meal = (over: Partial<{ id: string; at: Date; name: string; carbsG: number; tags: string; slot: string }> = {}) => ({
  id: over.id ?? "m1",
  at: over.at ?? new Date(NOW.getTime() - 90 * 60_000),
  name: over.name ?? "Pasta bolognese",
  carbsG: over.carbsG ?? 62,
  tags: over.tags ?? "",
  slot: over.slot ?? "dinner",
});

/* ------------------------------ finding things ------------------------------ */

test("a large meal shortly before is named, with the time and the carbohydrate", () => {
  const a = explainReading(base({ readings: baseline(), meals: [meal()] }));
  const found = a.contributors.find((c) => c.key === "meal_before");
  assert.ok(found, `no meal factor. found: ${a.contributors.map((c) => c.key).join(", ")}`);
  assert.match(found.evidence, /62 g/);
  assert.match(found.evidence, /1\.5 hours/);
  assert.equal(found.confidence, "likely", "62 g an hour and a half before is not a maybe");
});

test("a meal too close to the reading to have acted is not named", () => {
  // Five minutes before. Carbohydrate has not reached the blood yet, so blaming it would be wrong.
  const a = explainReading(base({ readings: baseline(), meals: [meal({ at: new Date(NOW.getTime() - 5 * 60_000) })] }));
  assert.equal(a.contributors.some((c) => c.key === "meal_before"), false);
});

test("a meal from yesterday is not named", () => {
  const a = explainReading(base({ readings: baseline(), meals: [meal({ at: at(1, 19) })] }));
  assert.equal(a.contributors.some((c) => c.key === "meal_before"), false);
});

test("a small snack is not blamed for a spike", () => {
  const a = explainReading(base({ readings: baseline(), meals: [meal({ carbsG: 8, name: "A few almonds" })] }));
  assert.equal(a.contributors.some((c) => c.key === "meal_before"), false);
});

test("the early morning rise is named only in the morning, and only against this person's own nights", () => {
  const morning = new Date(NOW);
  morning.setHours(7, 0, 0, 0);

  // Nights sitting at 95, and a 180 at 7am. That is a real dawn rise for this person.
  const nights: { at: Date; valueMgdl: number }[] = [];
  for (let d = 0; d < 20; d++) nights.push({ at: at(d, 3), valueMgdl: 95 });

  const found = explainReading(base({ at: morning, valueMgdl: 180, readings: nights }));
  assert.ok(found.contributors.some((c) => c.key === "dawn_rise"), "a 7am rise over a 95 baseline should be named");

  // The same value in the evening is not a dawn rise.
  const evening = new Date(NOW);
  evening.setHours(20, 0, 0, 0);
  const notFound = explainReading(base({ at: evening, valueMgdl: 180, readings: nights }));
  assert.equal(notFound.contributors.some((c) => c.key === "dawn_rise"), false);
});

test("a high after a low names the low, because that sequence is the explanation", () => {
  const lowAt = new Date(NOW.getTime() - 90 * 60_000);
  const a = explainReading(base({ readings: [...baseline(), { at: lowAt, valueMgdl: 54 }] }));
  const found = a.contributors.find((c) => c.key === "after_low");
  assert.ok(found, "a 54 ninety minutes earlier is the most likely explanation of a high");
  assert.match(found.evidence, /54/);
  assert.equal(found.confidence, "likely");
});

test("a missing insulin record is reported as a gap in the log, never as a missed dose", () => {
  const a = explainReading(base({ readings: baseline(), meals: [meal()], usesInsulinBolus: true, insulin: [] }));
  const found = a.contributors.find((c) => c.key === "no_bolus_logged");
  assert.ok(found, "a 62 g meal with nothing logged is worth observing");

  // The distinction the whole feature rests on.
  assert.match(found.evidence, /gap in the log/i);
  assert.equal(found.confidence, "possible", "a logging gap is never a likely cause of anything");
  assert.match(found.because, /care team/i, "what it means has to be handed to a clinician");
});

test("a recorded bolus means no gap is reported", () => {
  const m = meal();
  const a = explainReading(
    base({
      readings: baseline(),
      meals: [m],
      usesInsulinBolus: true,
      insulin: [{ at: m.at, kind: "bolus", units: 6, mealId: m.id }],
    }),
  );
  assert.equal(a.contributors.some((c) => c.key === "no_bolus_logged"), false);
});

test("somebody who does not use mealtime insulin is never asked about a bolus", () => {
  const a = explainReading(base({ readings: baseline(), meals: [meal()], usesInsulinBolus: false }));
  assert.equal(a.contributors.some((c) => c.key === "no_bolus_logged"), false);
});

/* ---------------------------- refusing to guess ---------------------------- */

test("with nothing logged around the reading, no factor is invented", () => {
  const a = explainReading(base({ readings: baseline() }));
  assert.deepEqual(a.contributors, [], `invented: ${a.contributors.map((c) => c.key).join(", ")}`);
  assert.ok(a.note, "silence needs an explanation of its own");
  assert.match(a.note, /something this app cannot see/i);
  assert.match(a.note, /rather than something you did/i, "a person must not read silence as their fault");
});

test("a short night is only named when this person's own days show the association", () => {
  const night = { wakeDate: "2026-09-15", minutes: 300, quality: 3 };

  // Short nights that made no difference to their glucose. Nothing to say.
  const flat = explainReading(base({ readings: baseline(), sleep: [night, { wakeDate: "2026-09-14", minutes: 300, quality: 3 }] }));
  assert.equal(flat.contributors.some((c) => c.key === "short_sleep"), false, "a general rule is not evidence about this person");
});

test("an early log says so rather than presenting a guess as a pattern", () => {
  const few = [
    { at: new Date(NOW.getTime() - 2 * HOUR), valueMgdl: 130 },
    { at: new Date(NOW.getTime() - 4 * HOUR), valueMgdl: 140 },
  ];
  const a = explainReading(base({ readings: few, meals: [meal()] }));
  assert.ok(a.note, "two readings is not a basis for confidence");
  assert.match(a.note, /early/i);
});

test("a reading inside target is explained without being treated as a problem", () => {
  const a = explainReading(base({ valueMgdl: 140, readings: baseline(), meals: [meal()] }));
  assert.ok(a.note);
  assert.match(a.note, /inside your target range/i);
  assert.match(a.note, /not a problem to solve/i);
});

/* ------------------------- what it must never say ------------------------- */

/** Every sentence the engine can produce, across every branch that fires. */
function everySentence(): string[] {
  const out: string[] = [];
  const m = meal({ tags: "takeout" });
  const cases: ExplainInput[] = [
    base({ readings: baseline(), meals: [m], usesInsulinBolus: true }),
    base({ readings: [...baseline(), { at: new Date(NOW.getTime() - 60 * 60_000), valueMgdl: 52 }] }),
    base({ at: (() => { const d = new Date(NOW); d.setHours(7); return d; })(), valueMgdl: 190, readings: Array.from({ length: 20 }, (_, i) => ({ at: at(i, 3), valueMgdl: 95 })) }),
    base({ valueMgdl: 140, readings: baseline() }),
    base({ readings: baseline() }),
    base({
      readings: baseline(),
      exercise: Array.from({ length: 5 }, (_, i) => ({ at: at(i + 3, 17), minutes: 40, intensity: "moderate", kind: "walk" })),
    }),
  ];
  for (const c of cases) {
    const a = explainReading(c);
    if (a.note) out.push(a.note);
    out.push(...a.blindSpots);
    for (const f of a.contributors) out.push(f.label, f.evidence, f.because);
  }
  return out;
}

test("the sentence scan covers a real spread of output, so the checks below are not vacuous", () => {
  /**
   * Guards the three checks that follow. Each of them scans `everySentence()` for phrases that
   * must never appear, and a scan over an empty or tiny array passes every time while proving
   * nothing. This asserts the scan has something to scan.
   */
  const sentences = everySentence();
  assert.ok(sentences.length >= 40, `only ${sentences.length} sentences scanned`);
  assert.ok(
    sentences.some((s) => /g of carbohydrate|62 g/.test(s)),
    "the meal branch never fired, so its wording is unchecked",
  );
  assert.ok(sentences.some((s) => /gap in the log/i.test(s)), "the insulin-record branch never fired");
  assert.ok(sentences.some((s) => /illness/i.test(s)), "the blind spots never fired");
});

test("nothing in the output claims a cause", () => {
  /**
   * The central rule. Glucose is moved by food, activity, sleep, hormones, illness, stress,
   * absorption and things nobody has named. This app sees a fraction of that, so "may have
   * contributed" is true and "caused" is a claim about a mechanism in one person's body.
   */
  const banned = /\bcaused\b|\bcause of\b|\bbecause you\b|\bthis is why\b|\bthe reason was\b/i;
  const offenders = everySentence().filter((s) => banned.test(s));
  assert.deepEqual(offenders, [], "these assert a cause");
});

test("nothing in the output reads as advice about medication or a dose", () => {
  /**
   * Invariant 2, checked on the actual strings. The dose-language filter guards MODEL output; this
   * engine's text never passes through it, so it needs its own check.
   *
   * Verb STEMS, not whole words. The first version of this listed base forms, and a negative
   * control caught it letting through "Consider increasing your mealtime insulin dose", because
   * "increasing" is not "increase". An inflection is exactly how that sentence would get written.
   */
  const banned =
    /\b(increas|decreas|reduc|lower|rais|adjust|chang|skip|tak|inject|titrat|add|cut)\w*\b[^.]{0,40}\b(insulin|dose|units|basal|bolus|metformin|medication)\b/i;
  const offenders = everySentence().filter((s) => banned.test(s));
  assert.deepEqual(offenders, [], "these read as treatment advice");
});

test("nothing in the output blames the person", () => {
  // A person reading this has a condition they did not choose and logs imperfectly, like everybody.
  const banned = /\byou should have\b|\byou failed\b|\byour fault\b|\bmistake\b|\btoo much\b(?![^.]*than)/i;
  const offenders = everySentence().filter((s) => banned.test(s));
  assert.deepEqual(offenders, [], "these read as a telling-off");
});

test("no output uses an em-dash", () => {
  const offenders = everySentence().filter((s) => s.includes("—"));
  assert.deepEqual(offenders, [], "the house style has no em-dashes in user-facing copy");
});

/* ------------------------------ the blind spots ------------------------------ */

test("what this cannot see is always part of the answer", () => {
  /**
   * Not a disclaimer at the bottom of a page. The most likely explanation for a spike is often
   * something that was never logged, and three factors with no mention of that reads as a complete
   * account when it is not.
   */
  for (const input of [base({ readings: baseline() }), base({ readings: baseline(), meals: [meal()] })]) {
    const a = explainReading(input);
    assert.ok(a.blindSpots.length >= 4, `only ${a.blindSpots.length} blind spots`);
    const joined = a.blindSpots.join(" ").toLowerCase();
    for (const must of ["not logged", "illness", "stress"]) {
      assert.ok(joined.includes(must), `blind spots never mention ${must}`);
    }
  }
});

test("insulin absorption is named as a blind spot only for people who use insulin", () => {
  const withInsulin = explainReading(base({ readings: baseline(), usesInsulinBolus: true }));
  const without = explainReading(base({ readings: baseline(), usesInsulinBolus: false }));
  assert.ok(withInsulin.blindSpots.join(" ").match(/injection site|pump set/i), "a real and common explanation");
  assert.equal(without.blindSpots.join(" ").match(/injection site|pump set/i), null, "irrelevant, so not said");
});

/* -------------------------------- ordering -------------------------------- */

test("likely factors come before possible ones", () => {
  const a = explainReading(base({ readings: baseline(), meals: [meal()], usesInsulinBolus: true }));
  assert.ok(a.contributors.length >= 2, "this case should produce a meal factor and a logging observation");
  const firstPossible = a.contributors.findIndex((c) => c.confidence === "possible");
  const lastLikely = a.contributors.map((c) => c.confidence).lastIndexOf("likely");
  if (firstPossible !== -1 && lastLikely !== -1) {
    assert.ok(lastLikely < firstPossible, "a possible factor is sorted above a likely one");
  }
});

test("every chart a factor carries is drawable", () => {
  // The same rule the pattern charts hold to: a chart cannot carry a value that cannot be drawn.
  for (const c of explainReading(base({ readings: baseline(), meals: [meal()], usesInsulinBolus: true })).contributors) {
    if (!c.chart) continue;
    const values =
      c.chart.kind === "compare" ? c.chart.bars.map((b) => b.value) : c.chart.kind === "gauge" ? [c.chart.value] : [c.chart.count];
    for (const v of values) {
      assert.ok(Number.isFinite(v), `${c.key}: ${v}`);
      assert.ok(v >= 0, `${c.key}: negative ${v}`);
    }
    if (c.chart.kind === "gauge") {
      assert.ok(c.chart.max > 0 && c.chart.value <= c.chart.max, `${c.key}: value past the end of the track`);
    }
  }
});
