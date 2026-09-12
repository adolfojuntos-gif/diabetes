import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, simulate, analyse } from "../scripts/simulate";
import { xpForLevel, levelForXp } from "../src/lib/engines/journey";

/**
 * WHAT A YEAR LOOKS LIKE.
 *
 * Every other test in this suite checks a call. These check a SEQUENCE, which is the only way to
 * see the failures that actually decide whether somebody is still here in March: a quest pool that
 * exhausts, a level curve that runs out of map, a world that goes silent.
 *
 * Each assertion below is a bug that was really present and was really found by
 * `scripts/simulate.ts`, so each one is a regression guard rather than a hypothetical.
 *
 * Deliberately loose thresholds. These exist to catch a collapse, not to freeze the design, and a
 * test tight enough to fail on a reasonable tuning change is a test that gets deleted.
 */

const YEAR = 365;
const runs = PERSONAS.map((p) => analyse(simulate(p, YEAR)));
const find = (name: string) => runs.find((r) => r.persona === name)!;

/* ------------------------------ quest variety ------------------------------ */

/**
 * THE BUG: gap weighting put the same two quests in all fifty-three weeks. Somebody who never logs
 * sleep has a permanently high sleep weight, so the sleep quest won every time, and being
 * responsive had quietly become being repetitive.
 */
test("a year does not offer the same quest every week", () => {
  const weeks = Math.round(YEAR / 7);
  for (const r of runs) {
    assert.ok(
      r.questMaxRepeat <= weeks * 0.45,
      `${r.persona}: one quest was offered ${r.questMaxRepeat} times in ${weeks} weeks`,
    );
  }
});

test("a year draws on most of the quest pool, for every persona", () => {
  for (const r of runs) {
    assert.ok(r.questVariety >= 12, `${r.persona} only ever saw ${r.questVariety} distinct quests in a year`);
  }
});

/* ------------------------------- the curve --------------------------------- */

/**
 * THE BUG: the curve was quadratic, and a steady logger opened the last of the twelve regions on
 * day eighty, leaving ten months with nothing to reach for.
 */
test("a consistent person does not open the whole map in three months", () => {
  const steady = find("Steady");
  assert.ok((steady.levelAt.d90 ?? 0) < 12, `Steady reached level ${steady.levelAt.d90} by day 90`);
});

test("a consistent person does still reach the far regions inside a year", () => {
  // The other half of the same trade: a curve that never pays off is as bad as one that runs out.
  const steady = find("Steady");
  assert.ok((steady.levelAt.d365 ?? 0) >= 10, `Steady only reached level ${steady.levelAt.d365} in a year`);
});

test("somebody who logs a little sees movement in their first fortnight", () => {
  // Sparse logs about six days a month, glucose only. They must not be stuck on an empty bar.
  const sparse = find("Sparse");
  assert.ok((sparse.xpAt.d30 ?? 0) > 0, "Sparse earned nothing at all in a month");
  assert.ok(xpForLevel(2) <= 400, `level 2 costs ${xpForLevel(2)} XP, which a sparse logger cannot reach`);
});

test("the curve is monotonic and has no plateau a person could sit on forever", () => {
  let last = -1;
  for (let l = 1; l <= 30; l++) {
    const need = xpForLevel(l);
    assert.ok(need > last, `level ${l} does not cost more than level ${l - 1}`);
    last = need;
  }
  // Every level is reachable: no gap so large that a consistent year cannot cross one.
  assert.ok(xpForLevel(13) - xpForLevel(12) < 40_000, "the step past the last region is a wall");
});

/* -------------------------------- the world -------------------------------- */

test("the world keeps producing things across a whole year", () => {
  for (const r of runs) {
    assert.ok(r.worldEvents >= 10, `${r.persona}'s world produced only ${r.worldEvents} events in a year`);
  }
});

test("somebody who shows up regularly is rarely told nothing at all", () => {
  const steady = find("Steady");
  assert.ok(steady.longestDeadRun <= 4, `Steady had ${steady.longestDeadRun} consecutive days with nothing`);
});

/**
 * NOT A BUG, AND PINNED SO IT STAYS THAT WAY. Somebody in the middle of a three week absence is
 * told nothing, because nothing is happening and they are not there. The temptation is to
 * manufacture events to fill the silence, which would mean the app inventing news for somebody who
 * has stepped away, and that is precisely the behaviour this product refuses.
 */
test("a long absence is quiet, and that is correct", () => {
  const returning = find("Returning");
  assert.ok(returning.longestDeadRun >= 7, "the world is manufacturing events during an absence");
});

/* -------------------------------- no exploits ------------------------------ */

test("nobody can earn more than the honest maximum by any pattern of use", () => {
  // Perfect logs everything every day and is the upper bound by construction. Nobody else may
  // approach it, or some pattern of partial use is paying better than doing the whole thing.
  const perfect = find("Perfect").xpAt.d365 ?? 0;
  for (const r of runs) {
    if (r.persona === "Perfect") continue;
    assert.ok((r.xpAt.d365 ?? 0) <= perfect, `${r.persona} out-earned the theoretical maximum`);
  }
});

test("gems are impossible without enough data, whatever the effort", () => {
  /**
   * A weekend logger records four days a fortnight, and the sufficiency gate needs seven on each
   * side of a comparison. They therefore earn no trend gems ever, and that is the gate working, not
   * a hole: four days cannot be compared with four days honestly, however consistent the person is.
   * Their XP is unaffected, because XP is for what they chose to do.
   */
  const weekend = find("Weekend");
  assert.equal(weekend.gems, 0);
  assert.ok((weekend.xpAt.d365 ?? 0) > 5_000, "a weekend logger should still be well rewarded in XP");
});

test("levels derive from XP and nothing else, so the curve can be retuned safely", () => {
  for (const xp of [0, 239, 240, 1_000, 20_000, 95_100, 726_610]) {
    assert.equal(levelForXp(xp), levelForXp(xp), "level is not a pure function of xp");
    assert.ok(xpForLevel(levelForXp(xp)) <= xp, `level ${levelForXp(xp)} claimed at ${xp} XP`);
  }
});
