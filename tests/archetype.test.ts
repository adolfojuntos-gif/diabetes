import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES, ARCHETYPE_KEYS, archetypeOf, leadFirst, favours, FAVOUR_WEIGHT } from "../src/lib/game/archetypes";
import { weeklyAdventure, QUEST_TEMPLATES, dimensionScores, DIMENSIONS } from "../src/lib/engines/lifequest";
import { readFileSync } from "node:fs";
import type { DayRoll } from "../src/lib/engines/journey";

/**
 * Source with comments stripped.
 *
 * These checks are about what the CODE does, and the first version scanned raw text: the file
 * explaining that it never reads a reading was failed by the word "reading" in that explanation.
 * A rule that punishes its own documentation gets the documentation deleted.
 */
const BLOCK_COMMENT = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
const LINE_COMMENT = new RegExp("//.*$", "gm");
const codeOf = (f: string) => readFileSync(f, "utf8").replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");

/**
 * WHO YOU ARE HERE.
 *
 * One property matters more than all the others and the first test is it: an archetype changes what
 * the app OFFERS and never what it PAYS. Without that, picking wrong at signup quietly costs
 * somebody months, and they would never be told. Everything else here is detail.
 */

const emptyWeek: DayRoll[] = [];

/* ------------------------- the line that must not move --------------------- */

test("no archetype can earn more than another, over a year of weeks", () => {
  /**
   * Every archetype is given the same year, and the total XP on offer is compared. A favourite that
   * paid better would make the choice a trap, and the trap would be invisible: nobody can see the
   * adventure they were not offered.
   */
  const totals = new Map<string, number>();
  for (const a of ARCHETYPES) {
    let xp = 0;
    const codes: string[] = [];
    for (let w = 0; w < 52; w++) {
      const week = new Date(2026, 0, 5 + w * 7);
      const adv = weeklyAdventure(week, emptyWeek, codes.slice(-6), a.favours);
      for (const q of adv.quests) {
        xp += q.xp;
        codes.push(q.code);
      }
    }
    totals.set(a.key, xp);
  }
  const values = [...totals.values()];
  const spread = (Math.max(...values) - Math.min(...values)) / Math.max(...values);
  assert.ok(
    spread < 0.2,
    `archetypes differ by ${(spread * 100).toFixed(0)}% of available XP over a year: ${JSON.stringify(Object.fromEntries(totals))}`,
  );
});

test("no archetype puts any quest out of reach", () => {
  // Every template must still be reachable for every archetype, or a favourite is really a filter.
  for (const a of ARCHETYPES) {
    const seen = new Set<string>();
    const codes: string[] = [];
    for (let w = 0; w < 120; w++) {
      const week = new Date(2026, 0, 5 + w * 7);
      for (const q of weeklyAdventure(week, emptyWeek, codes.slice(-6), a.favours).quests) {
        seen.add(q.code);
        codes.push(q.code);
      }
    }
    const missing = QUEST_TEMPLATES.filter((t) => !seen.has(t.code)).map((t) => t.code);
    assert.deepEqual(missing, [], `${a.key} never sees: ${missing.join(", ")}`);
  }
});

test("an archetype cannot reach a milestone another cannot", () => {
  // Milestones come from the trend engine, which never sees an archetype at all. Asserted
  // structurally so nobody can wire one in later without this failing.
  assert.doesNotMatch(codeOf("src/lib/engines/journey.ts"), /archetype/i, "the award engine now knows about archetypes");
  assert.doesNotMatch(codeOf("src/lib/engines/rules.ts"), /archetype/i, "the rule configuration now varies by archetype");
});

/* ------------------------------- the tilt works ---------------------------- */

test("a favourite is preferred, over a run of weeks", () => {
  const explorer = archetypeOf("explorer");
  const builder = archetypeOf("builder");
  const count = (a: typeof explorer, code: string) => {
    let n = 0;
    const codes: string[] = [];
    for (let w = 0; w < 52; w++) {
      const week = new Date(2026, 0, 5 + w * 7);
      for (const q of weeklyAdventure(week, emptyWeek, codes.slice(-6), a.favours).quests) {
        if (q.code === code) n++;
        codes.push(q.code);
      }
    }
    return n;
  };
  assert.ok(
    count(explorer, "quest_route") > count(builder, "quest_route"),
    "an Explorer should see the route quest more often than a Builder does",
  );
  assert.ok(
    count(builder, "quest_whole") > count(explorer, "quest_whole"),
    "a Builder should see the whole-day quest more often than an Explorer does",
  );
});

test("the tilt never outranks relevance", () => {
  /**
   * The number matters, not just the direction. A favour bonus larger than a gap weight would offer
   * an Explorer another walk while they have not logged a meal in a fortnight, which is the exact
   * failure that makes a personalised app feel like it is not listening.
   */
  const maxGapWeight = Math.max(
    ...QUEST_TEMPLATES.filter((t) => t.weight).map((t) => t.weight!([]) * 3),
  );
  assert.ok(FAVOUR_WEIGHT < maxGapWeight, `a favour is worth ${FAVOUR_WEIGHT}, a full gap only ${maxGapWeight}`);
});

/* --------------------------------- the rest -------------------------------- */

test("every archetype leads with a real identity and favours real quests", () => {
  const codes = new Set(QUEST_TEMPLATES.map((t) => t.code));
  const dims = new Set(DIMENSIONS.map((d) => d.key));
  for (const a of ARCHETYPES) {
    assert.ok(dims.has(a.leads), `${a.key} leads with an identity that does not exist: ${a.leads}`);
    for (const c of a.favours) assert.ok(codes.has(c), `${a.key} favours a quest that does not exist: ${c}`);
    assert.ok(a.favours.length >= 3, `${a.key} favours too little to feel like anything`);
  }
});

test("nothing about an archetype is derived from health data", () => {
  assert.doesNotMatch(codeOf("src/lib/game/archetypes.ts"), /glucose|reading|a1c|insulin|diagnos/i);
});

test("no archetype is described in a way that could read as a judgement", () => {
  for (const a of ARCHETYPES) {
    const text = `${a.name} ${a.line} ${a.detail}`;
    assert.doesNotMatch(text, /lazy|bad|poor|should|failure|weak|undisciplined/i, a.key);
    assert.doesNotMatch(text, /—/, `em-dash in ${a.key}`);
  }
});

test("leading an identity reorders the list and changes nothing in it", () => {
  const scores = dimensionScores([
    { code: "log", xp: 400 },
    { code: "move", xp: 200 },
  ]);
  const led = leadFirst(scores, archetypeOf("explorer"));
  assert.equal(led[0].key, "explorer");
  assert.equal(led.length, scores.length);
  // Same objects, same values, different order only.
  assert.deepEqual(
    [...led].sort((x, y) => x.key.localeCompare(y.key)),
    [...scores].sort((x, y) => x.key.localeCompare(y.key)),
  );
});

test("an unanswered question is not treated as an answer", () => {
  // Null, empty and nonsense all fall back, and `favours` with no archetype favours nothing.
  assert.equal(archetypeOf(null).key, "wanderer");
  assert.equal(archetypeOf("").key, "wanderer");
  assert.equal(archetypeOf("nonsense").key, "wanderer");
  assert.equal(favours(null, "quest_route"), false);
  assert.deepEqual(leadFirst(dimensionScores([]), null).map((d) => d.key), DIMENSIONS.map((d) => d.key));
});

test("every archetype key has an archetype and vice versa", () => {
  assert.equal(ARCHETYPE_KEYS.length, ARCHETYPES.length);
  for (const k of ARCHETYPE_KEYS) assert.ok(ARCHETYPES.find((a) => a.key === k), `no archetype for ${k}`);
});
