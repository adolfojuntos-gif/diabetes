import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildJourney,
  rollDays,
  currentStreak,
  longestStreak,
  levelForXp,
  xpForLevel,
  levelState,
  worldState,
  compareWindows,
  distanceFromRange,
  chapters,
  story,
  totals,
  HABIT_XP,
  type JourneyInput,
  type DayRoll,
} from "../src/lib/engines/journey";
import {
  weeklyAdventure,
  autoQuestDone,
  todaysQuest,
  standing,
  beginAgainAward,
  guardianFor,
  dimensionScores,
  thisWeek,
  QUEST_TEMPLATES,
} from "../src/lib/engines/lifequest";

/** A fixed "now": Friday 12 September 2026, 18:00 local. */
const NOW = new Date(2026, 8, 12, 18, 0);
const day = (back: number, hour = 9) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - back);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const key = (back: number) => {
  const d = day(back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function input(over: Partial<JourneyInput> = {}): JourneyInput {
  return {
    now: NOW,
    targetLow: 70,
    targetHigh: 180,
    hydrationGoalMl: 2000,
    readings: [],
    meals: [],
    exercise: [],
    sleep: [],
    hydration: [],
    checkins: [],
    journal: [],
    appointmentsPrepped: [],
    ...over,
  };
}

/* ============================== the safety rule ============================= */

/**
 * THE INVARIANT THIS WHOLE FEATURE RESTS ON. Two people log exactly the same behaviour; one has
 * readings of 90 and the other of 320. They must earn identical XP, because the only thing either
 * of them chose was to log it.
 */
test("a high reading and an in-range reading earn exactly the same", () => {
  const behaviour = { meals: [{ at: day(1, 12) }], exercise: [{ at: day(1, 17), minutes: 30 }] };
  const good = buildJourney(input({ ...behaviour, readings: [{ at: day(1), valueMgdl: 95 }] }));
  const rough = buildJourney(input({ ...behaviour, readings: [{ at: day(1), valueMgdl: 320 }] }));
  assert.equal(totals(good.awards).xp, totals(rough.awards).xp);
  assert.deepEqual(
    good.awards.map((a) => a.code),
    rough.awards.map((a) => a.code),
  );
});

test("nothing the engine can produce is ever negative", () => {
  // Three weeks of steeply worsening readings, which under any scoring system would be a penalty.
  const readings = Array.from({ length: 60 }, (_, i) => ({ at: day(59 - i, 8 + (i % 8)), valueMgdl: 90 + i * 4 }));
  const r = buildJourney(input({ readings }));
  for (const a of r.awards) {
    assert.ok(a.xp >= 0, `${a.code} awarded ${a.xp} xp`);
    assert.ok(a.gems >= 0, `${a.code} awarded ${a.gems} gems`);
  }
  assert.ok(totals(r.awards).xp > 0);
});

/* ================================ day rules ================================ */

/**
 * Worked by hand. One day with a reading, a meal and 30 minutes of movement earns:
 *   log 20 + meal 15 + move 25 + full_day 50 = 110 XP, four awards.
 * `full_day` needs glucose, a meal and one more thing, and movement is that third thing.
 */
test("a complete day earns log, meal, move and full_day, and nothing else", () => {
  const r = buildJourney(
    input({
      readings: [{ at: day(1), valueMgdl: 120 }],
      meals: [{ at: day(1, 13) }],
      exercise: [{ at: day(1, 18), minutes: 30 }],
    }),
  );
  const codes = r.awards.map((a) => a.code).sort();
  assert.deepEqual(codes, ["full_day", "log", "meal", "move"]);
  assert.equal(totals(r.awards).xp, HABIT_XP.log + HABIT_XP.meal + HABIT_XP.move + HABIT_XP.full_day);
  assert.equal(totals(r.awards).xp, 110);
});

test("movement under the threshold does not count, and does not make a full day", () => {
  const r = buildJourney(
    input({ readings: [{ at: day(1), valueMgdl: 120 }], meals: [{ at: day(1, 13) }], exercise: [{ at: day(1, 18), minutes: 10 }] }),
  );
  const codes = r.awards.map((a) => a.code).sort();
  assert.deepEqual(codes, ["log", "meal"]);
});

test("water only counts against the person's own goal", () => {
  const under = buildJourney(input({ hydrationGoalMl: 2500, hydration: [{ at: day(1, 11), ml: 2000 }] }));
  const over = buildJourney(input({ hydrationGoalMl: 1500, hydration: [{ at: day(1, 11), ml: 2000 }] }));
  assert.equal(under.awards.filter((a) => a.code === "water").length, 0);
  assert.equal(over.awards.filter((a) => a.code === "water").length, 1);
});

test("awarding is idempotent: the same input twice produces the same keys", () => {
  const i = input({ readings: [{ at: day(2), valueMgdl: 110 }, { at: day(1), valueMgdl: 130 }] });
  const a = buildJourney(i).awards.map((x) => x.key).sort();
  const b = buildJourney(i).awards.map((x) => x.key).sort();
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, "keys must be unique within one run");
});

/* ================================= streaks ================================= */

test("a streak counts back from the last active day and today is not required", () => {
  // Logged on days 1..5 back, nothing today. The run is 5 and today has not broken it.
  const readings = [1, 2, 3, 4, 5].map((b) => ({ at: day(b), valueMgdl: 110 }));
  const rolls = rollDays(input({ readings }));
  assert.equal(currentStreak(rolls), 5);
});

test("a broken streak can be earned again", () => {
  // Days 20..14 back (7 days), a four-day gap, then days 9..1 back (9 days). Two runs, so the
  // three-day and seven-day steps are reached twice.
  const backs = [20, 19, 18, 17, 16, 15, 14, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const r = buildJourney(input({ readings: backs.map((b) => ({ at: day(b), valueMgdl: 110 })) }));
  assert.equal(r.awards.filter((a) => a.code === "streak3").length, 2);
  assert.equal(r.awards.filter((a) => a.code === "streak7").length, 2);
  assert.equal(longestStreak(r.rolls), 9);
});

/* ================================== levels ================================= */

/**
 * The curve is cubic: 40·(L−1)³ + 200·(L−1). It was quadratic until a year of simulation showed a
 * steady logger opening the whole twelve region map on day eighty, and a sparse one stuck on
 * level one for two months. A cube is cheap early and expensive late, which is the shape needed.
 */
test("the level curve is cubic and never goes backwards", () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 240);
  assert.equal(xpForLevel(3), 720);
  assert.equal(xpForLevel(12), 55_440);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(239), 1);
  assert.equal(levelForXp(240), 2);
  assert.equal(levelForXp(719), 2);
  assert.equal(levelForXp(720), 3);
  let last = 0;
  for (let xp = 0; xp < 40000; xp += 137) {
    const l = levelForXp(xp);
    assert.ok(l >= last, "level fell as xp rose");
    last = l;
  }
});

test("level state reports progress inside the level, not overall", () => {
  const s = levelState(1200); // level 3, base 720, next 1680, span 960
  assert.equal(s.level, 3);
  assert.equal(s.intoLevel, 480);
  assert.equal(s.levelSpan, 960);
  assert.equal(s.progress, 0.5);
  assert.equal(s.toNext, 480);
  assert.equal(s.region.name, "The Grove");
});

test("the world only ever grows with the level", () => {
  let prevTrees = -1;
  let prevPlants = -1;
  for (let l = 1; l <= 12; l++) {
    const w = worldState(l, 0);
    assert.ok(w.trees >= prevTrees, `trees shrank at level ${l}`);
    assert.ok(w.plants >= prevPlants, `plants shrank at level ${l}`);
    prevTrees = w.trees;
    prevPlants = w.plants;
  }
  assert.equal(worldState(1, 0).home, 0);
  assert.equal(worldState(9, 0).home, 4);
  assert.equal(worldState(7, 0).mountains, true);
});

/* =============================== trend rules =============================== */

/** Dense readings across a window, so both sides of a comparison clear the data gate. */
function dense(fromBack: number, toBack: number, value: (i: number) => number) {
  const out: { at: Date; valueMgdl: number }[] = [];
  for (let b = fromBack; b >= toBack; b--) for (const h of [8, 12, 16, 21]) out.push({ at: day(b, h), valueMgdl: value(b) });
  return out;
}

test("no trend milestone is awarded without enough data on both sides", () => {
  // Only the recent fortnight has readings; the prior one is empty.
  const r = buildJourney(input({ readings: dense(13, 0, () => 150) }));
  assert.equal(r.awards.filter((a) => a.kind === "milestone" && a.code.startsWith("trend")).length, 0);
  assert.equal(r.trend.comparable, false);
  assert.match(r.trend.reason ?? "", /two weeks before/);
});

test("a sustained improvement in time in range earns one gem, once", () => {
  // Prior fortnight all 250 (out of range), recent fortnight all 120 (in range).
  const readings = [...dense(27, 14, () => 250), ...dense(13, 0, () => 120)];
  const r = buildJourney(input({ readings }));
  const tir = r.awards.filter((a) => a.code === "trend_tir");
  assert.equal(tir.length, 1);
  assert.equal(tir[0].gems, 1);
  assert.equal(tir[0].xp, 300);
  assert.match(tir[0].evidence, /100% in the last 14 days, against 0%/);
});

test("a worsening fortnight earns no milestone and costs nothing", () => {
  const readings = [...dense(27, 14, () => 120), ...dense(13, 0, () => 250)];
  const r = buildJourney(input({ readings }));
  assert.equal(r.awards.filter((a) => a.code.startsWith("trend_")).length, 0);
  // The habit XP for logging every one of those days is untouched.
  assert.ok(r.awards.filter((a) => a.code === "log").length >= 28);
  assert.ok(totals(r.awards).xp > 0);
});

test("holding an already-good fortnight is itself a milestone", () => {
  const readings = [...dense(27, 14, () => 120), ...dense(13, 0, () => 125)];
  const r = buildJourney(input({ readings }));
  const hold = r.awards.filter((a) => a.code === "hold_steady");
  assert.equal(hold.length, 1);
  assert.equal(hold[0].gems, 1);
});

test("distance from range is measured in both directions", () => {
  assert.equal(distanceFromRange(200, 70, 180), 20);
  assert.equal(distanceFromRange(50, 70, 180), 20);
  assert.equal(distanceFromRange(120, 70, 180), 0);
});

test("a trend milestone can fire at most once per week however often it is run", () => {
  const readings = [...dense(27, 14, () => 250), ...dense(13, 0, () => 120)];
  const a = buildJourney(input({ readings, now: new Date(2026, 8, 12, 9) }));
  const b = buildJourney(input({ readings, now: new Date(2026, 8, 12, 23) }));
  const ka = a.awards.filter((x) => x.code === "trend_tir").map((x) => x.key);
  const kb = b.awards.filter((x) => x.code === "trend_tir").map((x) => x.key);
  assert.deepEqual(ka, kb);
});

/* ============================ story and chapters =========================== */

test("the story never scolds a fortnight that went the other way", () => {
  const readings = [...dense(27, 14, () => 120), ...dense(13, 0, () => 250)];
  const s = story(input({ readings }));
  const text = s.lines.join(" ");
  assert.doesNotMatch(text, /lost|failed|missed|slipped|should have|bad/i);
  assert.match(text, /nothing has been taken away/i);
});

test("a person with no data is told the journey has not started, not that it went wrong", () => {
  const s = story(input());
  assert.match(s.lines.join(" "), /has not started yet/);
  assert.doesNotMatch(s.lines.join(" "), /lost|failed/i);
});

test("chapters never grade a quiet month", () => {
  const readings = [...dense(120, 118, () => 130), ...dense(5, 0, () => 130)];
  const cs = chapters(input({ readings }));
  assert.ok(cs.length >= 1);
  for (const c of cs) assert.doesNotMatch(`${c.stage}`, /poor|bad|failed|behind/i);
});

/* ================================= quests ================================== */

test("no quest template asks for a glucose number", () => {
  for (const t of QUEST_TEMPLATES) {
    const text = `${t.title} ${t.ask} ${t.why}`.toLowerCase();
    assert.doesNotMatch(text, /\bmg\/dl\b|\bmmol\b|\bunder \d|\bbelow \d|\bin range\b/);
  }
});

test("the weekly adventure is stable within a week and weights the gaps", () => {
  const rolls = rollDays(input({ readings: [{ at: day(1), valueMgdl: 110 }] }));
  const week = thisWeek(rolls, NOW);
  const a = weeklyAdventure(NOW, week);
  const b = weeklyAdventure(new Date(2026, 8, 12, 23, 30), week);
  assert.deepEqual(a.quests.map((q) => q.key), b.quests.map((q) => q.key));
  assert.equal(a.quests.length, 3);
  assert.equal(a.quests.filter((q) => q.kind === "manual").length, 1);
});

test("an auto quest is satisfied only by the logs", () => {
  const none: DayRoll[] = [];
  assert.equal(autoQuestDone("quest_move", none), false);
  const moved = rollDays(
    input({ exercise: [0, 1, 2].map((b) => ({ at: day(b, 17), minutes: 30 })) }),
  );
  assert.equal(autoQuestDone("quest_move", thisWeek(moved, NOW)), true);
  // A manual quest can never be ticked off by the engine.
  assert.equal(autoQuestDone("quest_explore", moved), false);
});

test("today's quest picks the gap, and finishing everything is not an empty screen", () => {
  const empty = rollDays(input())[rollDays(input()).length - 1];
  assert.equal(todaysQuest(empty, 2000).href, "/log/glucose");
  const full: DayRoll = {
    date: key(0),
    readings: 3,
    meals: 2,
    moveMinutes: 30,
    sleepLogged: true,
    waterMl: 2000,
    waterGoalMet: true,
    checkin: true,
    journal: true,
    active: true,
  };
  assert.equal(todaysQuest(full, 2000).xp, 0);
  assert.match(todaysQuest(full, 2000).title, /done/i);
});

/* ============================== rest and return ============================ */

test("somebody returning is welcomed, never told what they lost", () => {
  const rolls = rollDays(input({ readings: [{ at: day(30), valueMgdl: 110 }] }));
  const s = standing(rolls);
  assert.ok(s.away >= 21);
  assert.equal(s.headline, "Welcome back");
  assert.doesNotMatch(`${s.headline} ${s.body}`, /streak|lost|failed|missed/i);
});

test("coming back after a gap earns Begin Again, and only on the day of return", () => {
  const back = beginAgainAward(rollDays(input({ readings: [{ at: day(9), valueMgdl: 110 }, { at: day(0), valueMgdl: 110 }] })));
  assert.ok(back);
  assert.equal(back!.code, "begin_again");
  // Second day back: the gap no longer ends today, so it is not awarded twice.
  const again = beginAgainAward(
    rollDays(input({ readings: [{ at: day(9), valueMgdl: 110 }, { at: day(1), valueMgdl: 110 }, { at: day(0), valueMgdl: 110 }] })),
  );
  assert.equal(again, null);
});

test("nobody who has never logged is told they are returning", () => {
  const s = standing(rollDays(input()));
  assert.equal(s.returning, false);
  assert.match(s.headline, /waiting to be started/);
});

/* ============================ identity, not score ========================== */

test("dimensions are separate and none of them can be lowered by a reading", () => {
  const scores = dimensionScores([
    { code: "log", xp: 400 },
    { code: "move", xp: 200 },
    { code: "discovery", xp: 100 },
  ]);
  const byKey = Object.fromEntries(scores.map((s) => [s.key, s]));
  assert.equal(byKey.consistency.xp, 400);
  assert.equal(byKey.explorer.xp, 300); // move + discovery
  assert.equal(byKey.learner.xp, 0);
  assert.equal(byKey.learner.rank, 1);
  assert.equal(byKey.learner.rankName, "Setting out");
  // There is no overall score anywhere in the return value.
  assert.equal(scores.length, 7);
  for (const s of scores) assert.ok(s.xp >= 0);
});

test("the guardian follows the region, and there is always one", () => {
  assert.equal(guardianFor(1).name, "Wren");
  assert.equal(guardianFor(6).name, "Calla");
  assert.equal(guardianFor(8).name, "Ridge");
  assert.equal(guardianFor(12).name, "Vesper");
  assert.ok(guardianFor(99).name);
});

test("no guardian line mentions a treatment, a dose or a medication", () => {
  for (const g of [guardianFor(1), guardianFor(5), guardianFor(7), guardianFor(10)]) {
    const text = [...g.greeting, g.onRest, g.onReturn].join(" ").toLowerCase();
    assert.doesNotMatch(text, /dose|insulin|medication|units|mg\b|tablet|inject/);
  }
});

/* ================================ comparison =============================== */

test("the comparison windows are two clean fortnights that do not overlap", () => {
  const c = compareWindows(input({ readings: [...dense(27, 14, () => 200), ...dense(13, 0, () => 100)] }));
  assert.equal(c.comparable, true);
  assert.equal(c.recent.mean, 100);
  assert.equal(c.prior.mean, 200);
  assert.equal(c.recent.days, 14);
  assert.equal(c.prior.days, 14);
});
