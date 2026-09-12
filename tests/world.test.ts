import { test } from "node:test";
import assert from "node:assert/strict";
import { tickWorld, worldExtras, whatsNew, gapEndingToday, seasonOf } from "../src/lib/engines/world";
import { worldState, type DayRoll } from "../src/lib/engines/journey";

/**
 * THE LIVING WORLD.
 *
 * The world is now the only part of this product that can produce something the person did not
 * cause, which makes it the only part that can lie, nag, or be farmed. These tests pin the three
 * properties that stop it: it is deterministic, it never asks for attention at a moment, and it
 * never says anything clinical or unkind.
 */

const NOW = new Date(2026, 8, 12, 9, 0);
const day = (back: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const roll = (back: number, active: boolean): DayRoll => ({
  date: day(back),
  readings: active ? 2 : 0,
  meals: 0,
  moveMinutes: 0,
  sleepLogged: false,
  waterMl: 0,
  waterGoalMet: false,
  checkin: false,
  journal: false,
  active,
});
const run = (over: Partial<Parameters<typeof tickWorld>[0]> = {}) =>
  tickWorld({
    now: NOW,
    level: 7,
    rolls: Array.from({ length: 30 }, (_, i) => roll(29 - i, true)),
    away: 0,
    theme: "forest",
    ...over,
  });

/* ------------------------------ determinism ------------------------------- */

test("the same day produces the same world, however many times it is opened", () => {
  const a = run().map((e) => e.key);
  const b = run().map((e) => e.key);
  const c = tickWorld({
    now: new Date(2026, 8, 12, 23, 30), // same day, much later
    level: 7,
    rolls: Array.from({ length: 30 }, (_, i) => roll(29 - i, true)),
    away: 0,
    theme: "forest",
  }).map((e) => e.key);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c, "the world changed between morning and night on the same day");
});

test("every key is anchored to a day, a week, a level or a season", () => {
  for (const e of run()) {
    assert.match(e.key, /:(\d{4}-\d{2}-\d{2}|\d{4}|forest:\d+)$/, `unanchored key: ${e.key}`);
  }
});

test("rare things are actually rare", () => {
  // Thirty consecutive fully logged days should not produce thirty sightings.
  let sightings = 0;
  for (let d = 0; d < 60; d++) {
    const now = new Date(2026, 6, 1 + d, 9, 0);
    const rolls = Array.from({ length: 30 }, (_, i) => ({ ...roll(29 - i, true), date: `2026-07-${String(1 + d).padStart(2, "0")}` }));
    // Anchor the last roll to "today" so the tick sees an active day.
    rolls[rolls.length - 1] = {
      ...rolls[rolls.length - 1],
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      active: true,
    };
    sightings += tickWorld({ now, level: 7, rolls, away: 0, theme: "forest" }).filter((e) => e.kind === "sighting").length;
  }
  assert.ok(sightings > 0, "sixty active days produced no sightings at all");
  assert.ok(sightings < 20, `sixty days produced ${sightings} sightings, which is not rare`);
});

/* --------------------------- the anti-nag property ------------------------- */

test("nothing is found on a day the person was not already here", () => {
  // Today inactive: the world may still turn the season and open a landmark, because neither is a
  // reward. It may not hand them a sighting, because a sighting must be found and not delivered.
  const rolls = Array.from({ length: 30 }, (_, i) => roll(29 - i, i < 29));
  const events = tickWorld({ now: NOW, level: 7, rolls, away: 1, theme: "forest" });
  assert.equal(events.filter((e) => e.kind === "sighting").length, 0);
});

test("a sighting is never produced twice for the same day", () => {
  const rolls = Array.from({ length: 30 }, (_, i) => roll(29 - i, true));
  const keys = tickWorld({ now: NOW, level: 7, rolls, away: 0, theme: "forest" }).map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
});

/* ------------------------------- coming back ------------------------------- */

test("coming back after a real absence is met with the world, not an accusation", () => {
  const rolls = [
    ...Array.from({ length: 10 }, (_, i) => roll(29 - i, true)),
    ...Array.from({ length: 19 }, (_, i) => roll(19 - i, false)),
    roll(0, true),
  ];
  const growth = tickWorld({ now: NOW, level: 7, rolls, away: 0, theme: "forest" }).find((e) => e.kind === "growth");
  assert.ok(growth, "a nineteen day absence produced no welcome at all");
  const text = `${growth!.title} ${growth!.body}`;
  /*
   * The construction, not the word. "nothing here was lost" is the sentence this feature exists
   * to say; "you lost your streak" is the sentence it exists to prevent. A regex that banned the
   * bare word would have failed the correct copy and pushed somebody to weaken it.
   */
  assert.doesNotMatch(text, /you (lost|missed|failed)|lost your|fell behind|should have|you are behind|slipped/i);
  assert.match(text, /nothing (here )?was (waiting|lost)|nothing here was lost/i);
});

test("a short gap is not narrated, because most gaps are just life", () => {
  const rolls = [...Array.from({ length: 27 }, (_, i) => roll(29 - i, true)), roll(2, false), roll(1, false), roll(0, true)];
  assert.equal(tickWorld({ now: NOW, level: 7, rolls, away: 0, theme: "forest" }).filter((e) => e.kind === "growth").length, 0);
});

test("the gap measured is the one that ended today, not the current run", () => {
  const rolls = [...Array.from({ length: 20 }, (_, i) => roll(29 - i, true)), ...Array.from({ length: 9 }, (_, i) => roll(9 - i, false)), roll(0, true)];
  assert.equal(gapEndingToday(rolls), 9);
  // With nothing logged today there is no gap "ending today" at all.
  assert.equal(gapEndingToday(rolls.slice(0, -1)), 0);
});

/* ------------------------------ nothing clinical --------------------------- */

test("no inhabitant and no sighting mentions health, in any theme", () => {
  const banned = /glucose|blood sugar|reading|insulin|dose|medication|carb|sugar level|a1c|healthy|healthier/i;
  for (const theme of ["forest", "coast", "city"] as const) {
    // Sweep a year so every visitor, sighting and landmark in the pool gets drawn at least once.
    for (let d = 0; d < 370; d++) {
      const now = new Date(2026, 0, 1 + d, 9, 0);
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const rolls = [...Array.from({ length: 29 }, (_, i) => roll(29 - i, true)), { ...roll(0, true), date: key }];
      for (const e of tickWorld({ now, level: 12, rolls, away: 0, theme })) {
        assert.doesNotMatch(`${e.title} ${e.body}`, banned, `${theme}: ${e.title}`);
        assert.doesNotMatch(`${e.title} ${e.body}`, /—/, `em-dash in ${theme}: ${e.title}`);
      }
    }
  }
});

/* ---------------------------- the world remembers -------------------------- */

test("the drawing is built from history, so two people at one level differ", () => {
  const quiet = worldState(7, 2, { visitors: 0, landmarks: 0, sightings: 0 });
  const lived = worldState(7, 2, { visitors: 4, landmarks: 5, sightings: 6 });
  assert.equal(quiet.level, lived.level);
  assert.notDeepEqual(quiet, lived);
  assert.equal(lived.visitors, 4);
  assert.equal(lived.landmarks, 5);
  assert.ok(lived.stars > quiet.stars, "things noticed should put lights in the sky");
});

test("extras are counted from everything that ever happened, not from what is unread", () => {
  const e = worldExtras(
    [{ kind: "arrival" }, { kind: "arrival" }, { kind: "sighting" }, { kind: "landmark" }, { kind: "season" }, { kind: "growth" }],
    NOW,
  );
  assert.equal(e.visitors, 2);
  assert.equal(e.sightings, 1);
  assert.equal(e.landmarks, 1);
  assert.equal(e.season, "autumn"); // 12 September
});

test("seasons are the calendar's, not a setting", () => {
  assert.equal(seasonOf(new Date(2026, 0, 15)), "winter");
  assert.equal(seasonOf(new Date(2026, 3, 15)), "spring");
  assert.equal(seasonOf(new Date(2026, 6, 15)), "summer");
  assert.equal(seasonOf(new Date(2026, 9, 15)), "autumn");
});

/* -------------------------------- what's new ------------------------------- */

test("with nothing new the world says nothing rather than inventing news", () => {
  assert.equal(whatsNew([]), null);
});

test("what's new leads with the newest thing and counts the rest", () => {
  assert.equal(whatsNew([{ kind: "arrival", title: "Odda arrived" }]), "Odda arrived");
  assert.equal(
    whatsNew([
      { kind: "arrival", title: "Odda arrived" },
      { kind: "sighting", title: "A deer on the path" },
      { kind: "season", title: "Autumn" },
    ]),
    "Odda arrived, and 2 other things",
  );
});

/* --------------------------- visitors need somewhere ----------------------- */

test("nobody arrives before there is anywhere to arrive at", () => {
  for (let level = 1; level < 6; level++) {
    const events = run({ level });
    assert.equal(events.filter((e) => e.kind === "arrival").length, 0, `somebody arrived at level ${level}`);
  }
});

test("landmarks open with the map and are anchored to the level, not the day", () => {
  const a = run({ level: 5 }).find((e) => e.kind === "landmark");
  const b = tickWorld({
    now: new Date(2027, 2, 3, 18, 0), // a completely different day, months later
    level: 5,
    rolls: Array.from({ length: 30 }, (_, i) => roll(29 - i, true)),
    away: 0,
    theme: "forest",
  }).find((e) => e.kind === "landmark");
  assert.ok(a && b);
  assert.equal(a!.key, b!.key, "the same region produced two different landmarks");
  assert.equal(run({ level: 1 }).filter((e) => e.kind === "landmark").length, 0);
});
