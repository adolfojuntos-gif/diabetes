import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { levelForXp, levelState, xpForLevel } from "../src/lib/engines/journey";
import { THEMES, THEME_KEYS } from "../src/lib/game/themes";
import { buildRecap } from "../src/lib/engines/recap";
import type { DayRoll } from "../src/lib/engines/journey";

/**
 * THE CEREMONY AND THE MORNING.
 *
 * Both are interrupts, and an interrupt in a health app is the thing most likely to be experienced
 * as nagging. These tests pin the rules that stop that: shown once, never above safety, never a
 * gate in front of anything, and never replayed for progress that was backfilled.
 */

const NOW = new Date(2026, 8, 12, 8, 0);
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

/* ------------------------- the interrupt's own rules ----------------------- */

/**
 * Read from the source rather than rendered, because what matters is the ORDER of the guards on
 * the front door and the presence of each one. A rendering test would pass with the redirect
 * sitting above the triage check.
 */
const HOME = readFileSync("src/app/page.tsx", "utf8");

test("the ceremony never fires while triage has something to say", () => {
  const guard = HOME.match(/if \(q\.unlocked &&[^\n]*\)\s*redirect\("\/quest\/unlocked"\);/);
  assert.ok(guard, "the front door no longer guards the unlock redirect at all");
  assert.match(guard[0], /triage\.level === "general"/, "the ceremony can fire over a safety banner");
  assert.match(guard[0], /!q\.resting/, "the ceremony can fire during rest mode");
  assert.match(guard[0], /!q\.standing\.returning/, "the ceremony can fire over a welcome back");
});

test("triage is resolved before the redirect decision is made", () => {
  const triageAt = HOME.indexOf("runTriage({})");
  const redirectAt = HOME.indexOf('redirect("/quest/unlocked")');
  assert.ok(triageAt > -1 && redirectAt > -1);
  assert.ok(triageAt < redirectAt, "the ceremony is decided before triage is known");
});

test("the ceremony screen draws the safety banner itself", () => {
  const page = readFileSync("src/app/quest/unlocked/page.tsx", "utf8");
  assert.match(page, /TriageBanner/, "somebody arriving by URL gets no safety banner");
  assert.match(page, /level\.level <= player\.regionSeenLevel\) redirect/, "a stale ceremony can be replayed by URL");
});

test("both buttons on the ceremony acknowledge it, so deferring cannot become a nag", () => {
  const page = readFileSync("src/app/quest/unlocked/page.tsx", "utf8");
  const forms = page.match(/action=\{enterRegion\}/g) ?? [];
  assert.equal(forms.length, 2, "the ceremony should have exactly two acknowledging forms");
  assert.doesNotMatch(page, /<Link[^>]*href="\/today"/, "the deferral is a link and leaves the ceremony owed");
});

test("the morning greeting is acknowledged by every way out of it", () => {
  const forms = HOME.match(/action=\{dismissMorning\}/g) ?? [];
  assert.ok(forms.length >= 2, "the morning beat should acknowledge itself on both paths");
  assert.match(HOME, /q\.morning && !q\.resting/, "the morning beat shows during rest mode");
});

/* --------------------------- what a ceremony marks ------------------------- */

test("a backfilled history owes one ceremony, not one per level passed", () => {
  // Somebody whose three months land in a single write goes from 0 to level 7. The data layer
  // compares against the CURRENT level only, so exactly one region is owed.
  const level = levelForXp(7170);
  assert.equal(level, 7);
  const owed = level > 0 ? 1 : 0;
  assert.equal(owed, 1);

  const lifequest = readFileSync("src/lib/data/lifequest.ts", "utf8");
  assert.match(
    lifequest,
    /unlocked: state\.level\.level > player\.regionSeenLevel \? state\.level\.region : null/,
    "the owed region is no longer the current one only",
  );
});

test("marking a region seen only ever moves forward", () => {
  const lifequest = readFileSync("src/lib/data/lifequest.ts", "utf8");
  assert.match(lifequest, /Math\.max\(p\.regionSeenLevel, level\)/, "a seen level could go backwards and replay a ceremony");
});

/* ------------------------------ region integrity --------------------------- */

test("every theme has a region for every level, so no theme can skip a ceremony", () => {
  for (const k of THEME_KEYS) {
    const t = THEMES[k];
    assert.equal(t.regions.length, 12, `${k} has the wrong number of regions`);
    for (let l = 1; l <= 12; l++) {
      assert.ok(t.regions.find((r) => r.level === l), `${k} has no region at level ${l}`);
    }
  }
});

test("a level means the same amount of work in every theme", () => {
  // The regions differ; the curve they hang on does not.
  for (const k of THEME_KEYS) {
    const s = levelState(xpForLevel(5), THEMES[k].regions);
    assert.equal(s.level, 5, `${k} changed what level 5 costs`);
    assert.equal(s.region.level, 5);
  }
  const names = THEME_KEYS.map((k) => levelState(xpForLevel(5), THEMES[k].regions).region.name);
  assert.equal(new Set(names).size, THEME_KEYS.length, "themes should name their regions differently");
});

/* -------------------------- the recap's honesty ---------------------------- */

test("days before somebody's first entry are not called a gap", () => {
  // Joined 20 days into a 60 day window, then logged every day since.
  const rolls = [...Array.from({ length: 40 }, (_, i) => roll(59 - i, false)), ...Array.from({ length: 20 }, (_, i) => roll(19 - i, true))];
  const beats = buildRecap({
    now: NOW,
    days: 60,
    rolls,
    awards: [],
    levelNow: 3,
    levelThen: 1,
    totalXp: 800,
    gems: 0,
    name: "Alex",
  });
  assert.equal(beats.filter((b) => b.kind === "gap").length, 0, "silence before the first entry was called a gap");
  assert.equal(beats.filter((b) => b.kind === "start").length, 1);
});

test("a real gap in the middle is shown, and so is the return", () => {
  const rolls = [
    ...Array.from({ length: 10 }, (_, i) => roll(59 - i, true)),
    ...Array.from({ length: 10 }, (_, i) => roll(49 - i, false)),
    ...Array.from({ length: 40 }, (_, i) => roll(39 - i, true)),
  ];
  const beats = buildRecap({ now: NOW, days: 60, rolls, awards: [], levelNow: 4, levelThen: 1, totalXp: 2000, gems: 1, name: "" });
  const gap = beats.find((b) => b.kind === "gap");
  const back = beats.find((b) => b.kind === "return");
  assert.ok(gap, "a ten day gap in the middle was not shown");
  assert.ok(back, "the return after the gap was not shown");
  assert.match(gap!.line, /nothing was lost/i);
  assert.doesNotMatch(`${gap!.headline} ${gap!.line}`, /streak|failed|missed|should/i);
});

test("a recap of an empty window produces nothing rather than a consoling story", () => {
  const rolls = Array.from({ length: 30 }, (_, i) => roll(29 - i, false));
  const beats = buildRecap({ now: NOW, days: 30, rolls, awards: [], levelNow: 1, levelThen: 1, totalXp: 0, gems: 0, name: "Alex" });
  assert.deepEqual(beats, []);
});
