import { test } from "node:test";
import assert from "node:assert/strict";
import { spikeDays, bestDays, replayDay, type ReplayInput } from "../src/lib/engines/replay";
import { dateKey } from "../src/lib/time";

/**
 * Glucose replay, tested.
 *
 * The load-bearing assertion is the definition of a BEST day. It is time in range, not a low
 * average, and the difference is not academic: a day spent at 60 mg/dL has a beautiful average and
 * is a dangerous day. A comparison that held it up as a model to copy would be actively harmful,
 * and it is the single easiest mistake to make when writing this feature.
 *
 * The rest is about the timeline being in order and honest, and about the comparison describing a
 * difference rather than a cause.
 */

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 15, 20, 0, 0);

const at = (daysAgo: number, hour: number, minute = 0) => {
  const d = new Date(NOW.getTime() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
};

function base(over: Partial<ReplayInput> = {}): ReplayInput {
  return {
    targetLow: 70,
    targetHigh: 180,
    readings: [],
    meals: [],
    insulin: [],
    exercise: [],
    sleep: [],
    ...over,
  };
}

/** A day of readings at the given values, one an hour from 07:00. */
function day(daysAgo: number, values: number[]) {
  return values.map((v, i) => ({ at: at(daysAgo, 7 + i), valueMgdl: v }));
}

/* ------------------------------- which days ------------------------------- */

test("only days that went above target are offered, worst peak first", () => {
  const input = base({
    readings: [
      ...day(1, [120, 250, 200, 140]), // a real spike
      ...day(2, [110, 120, 130, 125]), // a steady day, nothing to explain
      ...day(3, [130, 300, 220, 160]), // a worse spike
    ],
  });

  const days = spikeDays(input, NOW);
  assert.deepEqual(
    days.map((d) => d.peakMgdl),
    [300, 250],
    "steady days must not be offered, and the worst comes first",
  );
  assert.equal(days[0].date, dateKey(at(3, 7)));
});

test("a day with too few readings is not offered, because its shape cannot be drawn", () => {
  const input = base({ readings: [{ at: at(1, 9), valueMgdl: 260 }, { at: at(1, 11), valueMgdl: 240 }] });
  assert.deepEqual(spikeDays(input, NOW), [], "two readings is not a day");
});

test("the biggest rise within a day is reported alongside the peak", () => {
  const input = base({ readings: day(1, [100, 110, 260, 180]) });
  const [d] = spikeDays(input, NOW);
  assert.equal(d.peakMgdl, 260);
  assert.equal(d.biggestRise, 150, "110 to 260 is the jump worth naming");
});

/* ------------------------------ the best days ------------------------------ */

test("best means time in range, not a flattering average", () => {
  /**
   * THE test in this file. The low day has an average of 60 and would win any comparison that
   * ranked on the mean. It is a day spent hypoglycaemic and must never be offered as a model.
   */
  const input = base({
    readings: [
      ...day(1, [250, 260, 240, 230]), // the day being replayed
      ...day(2, [60, 58, 62, 59]), // low all day. Beautiful average, bad day.
      ...day(3, [110, 120, 130, 115]), // genuinely good
      ...day(4, [105, 125, 140, 120]), // genuinely good
    ],
  });

  const best = bestDays(input, NOW, dateKey(at(1, 7)));
  assert.ok(best.includes(dateKey(at(3, 7))), "an in-range day must be picked");
  assert.ok(best.includes(dateKey(at(4, 7))), "an in-range day must be picked");
  assert.equal(best.includes(dateKey(at(2, 7))), false, "a day spent low was offered as a best day");
});

test("the day being replayed is never compared against itself", () => {
  const target = dateKey(at(1, 7));
  const input = base({ readings: [...day(1, [110, 120, 115, 125]), ...day(2, [130, 120, 140, 125])] });
  assert.equal(bestDays(input, NOW, target).includes(target), false);
});

/* -------------------------------- the replay -------------------------------- */

test("the timeline runs in order and names the shape of the day", () => {
  const date = dateKey(at(1, 7));
  const input = base({
    readings: day(1, [100, 110, 250, 210, 160]),
    meals: [
      { id: "b", at: at(1, 8), name: "Toast and jam", carbsG: 48, tags: "", slot: "breakfast" },
      { id: "l", at: at(1, 13), name: "Sandwich", carbsG: 40, tags: "", slot: "lunch" },
    ],
    sleep: [{ wakeDate: date, minutes: 400, quality: 3, wakeAt: at(1, 7), bedAt: at(1, 23) }],
    exercise: [{ at: at(1, 18), minutes: 30, intensity: "moderate", kind: "walk" }],
  });

  const r = replayDay(date, input, NOW);

  // In order, which is the whole point of a replay.
  for (let i = 1; i < r.events.length; i++) {
    assert.ok(r.events[i].at.getTime() >= r.events[i - 1].at.getTime(), "the timeline is out of order");
  }

  const kinds = r.events.map((e) => e.kind);
  for (const expected of ["wake", "meal", "rise", "peak", "exercise"]) {
    assert.ok(kinds.includes(expected as never), `the timeline has no ${expected} event. got: ${kinds.join(", ")}`);
  }

  assert.equal(r.peak?.valueMgdl, 250);
  assert.ok(r.minutesFirstMealToPeak !== null, "time from the first meal to the peak is the useful figure");
  assert.equal(r.minutesFirstMealToPeak, 60, "breakfast at 8, peak at 9");
});

test("the rise is marked at the last in-range reading before the peak, not at the start of the day", () => {
  // The event began at 10am, not at 07:00 when the clock did.
  const date = dateKey(at(1, 7));
  const input = base({ readings: day(1, [100, 105, 110, 260, 200]) });
  const r = replayDay(date, input, NOW);
  const rise = r.events.find((e) => e.kind === "rise");
  assert.ok(rise, "no rise event");
  assert.equal(rise.valueMgdl, 110, "the climb starts from the last reading still in range");
});

test("a day that never went high has no rise or peak narrative forced onto it", () => {
  const date = dateKey(at(1, 7));
  const r = replayDay(date, base({ readings: day(1, [110, 120, 130, 125]) }), NOW);
  assert.equal(r.events.some((e) => e.kind === "rise"), false);
  assert.equal(r.events.some((e) => e.kind === "back_in_range"), false, "it never left range");
});

test("an event too far from any reading is not placed on the curve", () => {
  /**
   * A meal at 3am with the nearest reading at 7am must not be drawn as though glucose was at the
   * 7am value when it was eaten. It floats instead, which is honest about not knowing.
   */
  const date = dateKey(at(1, 7));
  const input = base({
    readings: day(1, [110, 120, 130, 125]),
    meals: [{ id: "n", at: at(1, 3), name: "Night snack", carbsG: 20, tags: "", slot: "snack" }],
  });
  const r = replayDay(date, input, NOW);
  const snack = r.events.find((e) => e.label === "Night snack");
  assert.ok(snack);
  assert.equal(snack.valueMgdl, null, "an unplaceable event must not borrow a distant reading's value");
});

test("insulin appears as what was recorded, never as what should have been taken", () => {
  const date = dateKey(at(1, 7));
  const input = base({
    readings: day(1, [110, 200, 160, 130]),
    insulin: [{ at: at(1, 8), kind: "bolus", units: 6 }],
  });
  const r = replayDay(date, input, NOW);
  const dose = r.events.find((e) => e.kind === "insulin");
  assert.ok(dose);
  assert.match(dose.label, /recorded/i, "the word matters: recorded, not recommended");
  assert.match(dose.detail ?? "", /6 units/);
});

/* ------------------------------ the comparison ------------------------------ */

test("the comparison names real differences and ranks them proportionally", () => {
  const date = dateKey(at(1, 7));
  const goodDays = [2, 3, 4, 5, 6].flatMap((d) => day(d, [110, 120, 125, 115]));
  const goodMeals = [2, 3, 4, 5, 6].flatMap((d) => [
    { id: `m${d}`, at: at(d, 8), name: "Oats", carbsG: 30, tags: "", slot: "breakfast" },
  ]);
  const goodMovement = [2, 3, 4, 5, 6].map((d) => ({ at: at(d, 18), minutes: 40, intensity: "moderate", kind: "walk" }));

  const input = base({
    readings: [...day(1, [120, 280, 240, 190]), ...goodDays],
    // The replayed day: far more carbohydrate, no movement at all.
    meals: [{ id: "big", at: at(1, 8), name: "Pancakes", carbsG: 120, tags: "", slot: "breakfast" }, ...goodMeals],
    exercise: goodMovement,
  });

  const r = replayDay(date, input, NOW);
  assert.ok(r.bestDays.length >= 2, `only ${r.bestDays.length} best days found`);
  assert.ok(r.differences.length > 0, "120 g against 30 g is a difference worth naming");

  const carbs = r.differences.find((d) => d.key === "carbs");
  assert.ok(carbs, `no carbohydrate difference. got: ${r.differences.map((d) => d.key).join(", ")}`);
  assert.equal(carbs.thisDay, 120);
  assert.equal(carbs.bestAverage, 30);
  assert.match(carbs.sentence, /90 g more/);

  const movement = r.differences.find((d) => d.key === "movement");
  assert.ok(movement, "no movement logged against 40 minutes is a difference");
  assert.equal(movement.better, "higher", "more movement is the better direction");
});

test("a difference too small to mean anything is not reported", () => {
  const date = dateKey(at(1, 7));
  const others = [2, 3, 4, 5, 6].flatMap((d) => day(d, [110, 120, 125, 115]));
  const input = base({
    readings: [...day(1, [120, 200, 180, 150]), ...others],
    meals: [
      { id: "a", at: at(1, 8), name: "Oats", carbsG: 42, tags: "", slot: "breakfast" },
      ...[2, 3, 4, 5, 6].map((d) => ({ id: `m${d}`, at: at(d, 8), name: "Oats", carbsG: 40, tags: "", slot: "breakfast" })),
    ],
  });
  const r = replayDay(date, input, NOW);
  // Two grams between two small samples is noise, not a finding.
  assert.equal(r.differences.some((d) => d.key === "carbs"), false, "2 g was reported as a difference");
});

test("with nothing to compare against, it says so instead of comparing", () => {
  const date = dateKey(at(1, 7));
  const r = replayDay(date, base({ readings: day(1, [120, 250, 200, 170]) }), NOW);
  assert.deepEqual(r.differences, []);
  assert.ok(r.note, "an absent comparison needs an explanation");
  assert.match(r.note, /not enough other well-logged days/i);
});

test("a day identical to the best days is reported as such, not padded with weak findings", () => {
  const date = dateKey(at(1, 7));
  const same = [2, 3, 4, 5, 6].flatMap((d) => day(d, [110, 120, 125, 115]));
  const meals = [1, 2, 3, 4, 5, 6].map((d) => ({ id: `m${d}`, at: at(d, 8), name: "Oats", carbsG: 40, tags: "", slot: "breakfast" }));
  // The replayed day peaks slightly above target so it qualifies, and is otherwise the same.
  const input = base({ readings: [...day(1, [110, 190, 125, 115]), ...same], meals });
  const r = replayDay(date, input, NOW);
  assert.deepEqual(r.differences, []);
  assert.ok(r.note);
  assert.match(r.note, /looks like your best days/i);
  assert.match(r.note, /not in the log/i, "honest about where the difference must be");
});

test("a barely-logged day says so rather than drawing a confident shape", () => {
  const date = dateKey(at(1, 7));
  const r = replayDay(date, base({ readings: [{ at: at(1, 9), valueMgdl: 240 }] }), NOW);
  assert.ok(r.note);
  assert.match(r.note, /too few to draw its shape/i);
});

/* ------------------------------- house rules ------------------------------- */

test("no replay output claims a cause, advises a dose, or uses an em-dash", () => {
  const date = dateKey(at(1, 7));
  const others = [2, 3, 4, 5, 6].flatMap((d) => day(d, [110, 120, 125, 115]));
  const input = base({
    readings: [...day(1, [120, 280, 240, 190]), ...others],
    meals: [
      { id: "big", at: at(1, 8), name: "Pancakes", carbsG: 120, tags: "", slot: "breakfast" },
      ...[2, 3, 4, 5, 6].map((d) => ({ id: `m${d}`, at: at(d, 8), name: "Oats", carbsG: 30, tags: "", slot: "breakfast" })),
    ],
    insulin: [{ at: at(1, 8), kind: "bolus", units: 8 }],
    exercise: [{ at: at(2, 18), minutes: 40, intensity: "moderate", kind: "walk" }],
    sleep: [{ wakeDate: date, minutes: 380, quality: 3, wakeAt: at(1, 7) }],
  });

  const r = replayDay(date, input, NOW);
  const strings = [
    ...(r.note ? [r.note] : []),
    ...r.events.flatMap((e) => [e.label, e.detail ?? ""]),
    ...r.differences.flatMap((d) => [d.label, d.sentence]),
  ].filter(Boolean);

  assert.ok(strings.length >= 10, `only ${strings.length} strings scanned, so this proves little`);

  const cause = /\bcaused\b|\bcause of\b|\bbecause you\b|\bthis is why\b/i;
  const advice =
    /\b(increas|decreas|reduc|lower|rais|adjust|chang|skip|tak|inject|titrat)\w*\b[^.]{0,40}\b(insulin|dose|units|basal|bolus|medication)\b/i;

  assert.deepEqual(strings.filter((s) => cause.test(s)), [], "these assert a cause");
  assert.deepEqual(strings.filter((s) => advice.test(s)), [], "these read as treatment advice");
  assert.deepEqual(strings.filter((s) => s.includes("—")), [], "no em-dashes in user-facing copy");
});
