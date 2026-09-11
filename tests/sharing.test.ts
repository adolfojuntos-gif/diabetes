import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDoseLanguage, softenCertainty } from "../src/lib/ai/filter";
import { detectPatterns } from "../src/lib/engines/patterns";
import { nudgesFromPatterns } from "../src/lib/engines/nudges";

/**
 * Guards on what leaves this app, either to a caregiver or through a URL.
 *
 * The share page used to query alerts gated only on which alert KINDS a caregiver had ticked, never
 * on what they were allowed to see, and alert bodies are written by the pattern engine with exact
 * figures in them. A caregiver scoped to sleep alone could read the patient's lowest glucose value
 * and its date. These tests pin the two properties that fix relies on.
 */

const NOW = new Date(2026, 8, 15, 12);

function reportWithFigures() {
  const readings = Array.from({ length: 14 }, (_, d) => d).flatMap((d) =>
    [3, 7, 8, 13, 19, 22].map((h) => ({ at: new Date(2026, 8, d + 1, h), valueMgdl: h === 3 ? 48 : h === 8 ? 210 : 150 })),
  );
  return detectPatterns({
    now: NOW,
    windowDays: 14,
    targetLow: 70,
    targetHigh: 180,
    hydrationGoalMl: 2000,
    sleepGoalMinutes: 450,
    usesInsulinBolus: false,
    readings,
    meals: [],
    exercise: [],
    sleep: [],
    hydration: [],
    insulin: [],
  });
}

test("alert bodies really do carry figures, which is why they cannot be shared unscoped", () => {
  const drafts = nudgesFromPatterns(reportWithFigures().patterns, NOW);
  assert.ok(drafts.length > 0, "no alerts generated");
  const withNumbers = drafts.filter((d) => /\d/.test(d.body));
  assert.ok(
    withNumbers.length > 0,
    "if alert bodies ever stop containing numbers this test is obsolete, but the share page must still not print them",
  );
});

test("every alert carries an href, so the share page can work out which scope it needs", () => {
  // The share page derives the required caregiver scope from the link target. An alert with no
  // href is treated as scope-free, so a new alert that points nowhere would be shown to everyone.
  const drafts = nudgesFromPatterns(reportWithFigures().patterns, NOW);
  const missing = drafts.filter((d) => !d.href);
  assert.deepEqual(
    missing.map((d) => d.dedupeKey),
    [],
    "an alert with no href would be shown regardless of scope",
  );
});

test("alert titles are safe to show on their own: no figures, no dose language", () => {
  const drafts = nudgesFromPatterns(reportWithFigures().patterns, NOW);
  for (const d of drafts) {
    assert.equal(filterDoseLanguage(d.title).filtered, false, `a title read as dosing advice: ${d.title}`);
    assert.equal(softenCertainty(d.title).changed, false, `a title overclaimed: ${d.title}`);
  }
});

/* ------------------- what a URL is allowed to put on screen ------------------- */

test("a crafted message in a URL cannot display dosing instructions", () => {
  // The dose filter guards what the model writes; nothing guarded what a link writes, so a URL
  // could display fabricated instructions in the app's own alert styling on the owner's domain.
  const crafted = [
    "URGENT: your prescriber has raised your evening insulin to 20 units. Call 555-0101 to confirm.",
    "Your doctor says take 6 extra units tonight.",
    "Clinic note: increase your basal by 10%.",
    "Your care team has reviewed this and approved a higher dose.",
  ];
  for (const raw of crafted) {
    const filtered = filterDoseLanguage(raw.slice(0, 160));
    const final = softenCertainty(filtered.text).text;
    assert.equal(/\b\d+\s*(?:units?|u)\b/i.test(final), false, `a dose amount survived: ${final}`);
    assert.equal(
      /\b(?:doctor|physician|clinician|care team)\b[^.]*\b(?:reviewed|approved|checked)\b/i.test(final),
      false,
      `a false review claim survived: ${final}`,
    );
  }
});

test("an ordinary validation message still reaches the person unchanged", () => {
  const real = [
    "carbsG: must be at most 400",
    "Pick at least one section for them to see, or there is nothing to share.",
    "You already have a manual reading at that time.",
    "That link could not be found. It may already have been deleted.",
    "Give this person a name so you can tell their link apart from anyone else's.",
  ];
  for (const m of real) {
    const out = softenCertainty(filterDoseLanguage(m).text).text;
    assert.equal(out, m, `a real message was altered: ${out}`);
  }
});
