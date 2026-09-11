import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictFor, usageSummary, PLAN_LIMITS, windowsFor, ROUGH_COST_USD } from "../src/lib/ai/limits";

/**
 * These exercise the paid plan, because it is the one with every window shape: an hour, a day and a
 * month. The free plan's own behaviour, including a zero allowance, is covered in
 * `tests/billing.test.ts` alongside the entitlement rules that decide which plan applies.
 */
const PLAN = "plus" as const;
const LIMITS = PLAN_LIMITS[PLAN];

/**
 * Caps are read from the table, never written into the test.
 *
 * The first version of these tests had "10" and "40" in the assertions and in the reasoning of the
 * comments, so tightening a cap for the paid plan failed four of them for no reason other than the
 * arithmetic being restated in two places. A test that has to be rewritten every time a number it
 * does not own changes is a test nobody trusts.
 */
const capOf = (feature: "photo" | "copilot" | "coach", label: string) =>
  windowsFor(PLAN, feature).find((w) => w.label === label)!.max;

const NOW = new Date(2026, 8, 15, 14, 0, 0);
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60_000);

/**
 * The limiter guards money, so both directions matter: it must not let a script spend, and it must
 * not stop a person mid-conversation over an off-by-one. The window arithmetic is worked by hand
 * here before being asserted.
 */

test("an empty history is allowed and reports zero used", () => {
  const v = verdictFor("photo", PLAN, [], NOW);
  assert.equal(v.allowed, true);
  assert.equal(v.used, 0);
  assert.equal(v.max, LIMITS.photo[0].max);
  assert.equal(v.message, "");
});

test("the hourly cap blocks at the limit, not one past it", () => {
  const max = LIMITS.photo[0].max; // 10
  const justUnder = Array.from({ length: max - 1 }, (_, i) => minsAgo(i + 1));
  assert.equal(verdictFor("photo", PLAN, justUnder, NOW).allowed, true, `${max - 1} should be allowed`);

  const atCap = Array.from({ length: max }, (_, i) => minsAgo(i + 1));
  const blocked = verdictFor("photo", PLAN, atCap, NOW);
  assert.equal(blocked.allowed, false, `${max} should be blocked`);
  assert.equal(blocked.used, max);
  assert.equal(blocked.blockedBy?.label, "hour");
});

test("calls outside the window do not count", () => {
  // Ten photo estimates, all more than an hour ago. The hourly window is clear.
  const old = Array.from({ length: 10 }, (_, i) => minsAgo(61 + i));
  const v = verdictFor("photo", PLAN, old, NOW);
  assert.equal(v.allowed, true, "an hour-old burst must not block a new call");
  assert.equal(v.used, 0, "nothing is inside the hourly window");
});

test("the reset time is when the OLDEST call in the window ages out", () => {
  // Ten calls, the oldest 50 minutes ago. A slot frees 10 minutes from now.
  const times = [minsAgo(50), ...Array.from({ length: 9 }, (_, i) => minsAgo(40 - i * 2))];
  const v = verdictFor("photo", PLAN, times, NOW);
  assert.equal(v.allowed, false);
  const expected = new Date(minsAgo(50).getTime() + 60 * 60_000);
  assert.equal(v.resetsAt?.getTime(), expected.getTime());
  assert.equal(v.resetsAt!.getTime() - NOW.getTime(), 10 * 60_000, "ten minutes from now");
});

test("the daily cap catches a burst spread out to dodge the hourly one", () => {
  /**
   * One under the hourly cap, repeated over enough hours to pass the daily cap. That is the shape of
   * the evasion the second window exists to catch, and both figures come from the table so the
   * scenario stays valid whatever the caps become.
   */
  const perHour = capOf("photo", "hour") - 1;
  const hours = Math.ceil((capOf("photo", "day") + 1) / perHour);
  const times: Date[] = [];
  for (let h = 0; h < hours; h++) {
    for (let i = 0; i < perHour; i++) times.push(new Date(hoursAgo(h).getTime() - i * 6 * 60_000));
  }
  assert.ok(times.length > capOf("photo", "day"), "the scenario has to exceed the daily cap");

  /**
   * No single hour is over its cap, so an hourly window alone would allow every one of these. The
   * window is one-sided, matching what the limiter actually does: a span of plus-or-minus an hour
   * is two hours wide and counts neighbouring buckets, which made this check fail a scenario that
   * was correct.
   */
  for (let h = 0; h < hours; h++) {
    const end = hoursAgo(h).getTime();
    const inThatHour = times.filter((t) => t.getTime() > end - 60 * 60_000 && t.getTime() <= end);
    assert.ok(inThatHour.length <= capOf("photo", "hour"), "the scenario must not trip the hourly cap");
  }

  const v = verdictFor("photo", PLAN, times, NOW);
  assert.equal(v.allowed, false, "a spread-out burst over the daily cap must be blocked");
  assert.equal(v.blockedBy?.label, "day");
});

test("a message names the count, the cap, the reset time and the free fallback", () => {
  const max = capOf("photo", "hour");
  const atCap = Array.from({ length: max }, (_, i) => minsAgo(i + 1));
  const v = verdictFor("photo", PLAN, atCap, NOW);
  assert.match(v.message, new RegExp(`\\b${max} of ${max}\\b`));
  assert.match(v.message, /this hour/);
  assert.match(v.message, /by hand|carbohydrate reference/i);
  assert.ok(/\d/.test(v.message), "the reset time is stated");
  /**
   * An hourly block frees up within the day, so the sentence has to name a time and not a date.
   * This caught a real bug: the wording was chosen by comparing the reset against the real clock
   * instead of against the moment the verdict was for, so a test dated in the future got "on
   * September 15" for a window that frees up in an hour.
   */
  assert.match(v.message, /frees up again at \d/);
  assert.doesNotMatch(v.message, /January|February|March|April|May|June|July|August|September|October|November|December/);
});

test("a monthly block names a date, because a time of day would be meaningless", () => {
  const max = capOf("photo", "month");
  const spread = Array.from({ length: max }, (_, i) => hoursAgo(i * 5));
  const v = verdictFor("photo", PLAN, spread, NOW);
  assert.equal(v.allowed, false);
  assert.equal(v.blockedBy?.label, "month");
  assert.match(v.message, /frees up again on \w+ \d/);
});

test("each feature has its own allowance", () => {
  // A Copilot burst at its own cap does not touch the photo allowance.
  const copilotBurst = Array.from({ length: capOf("copilot", "hour") }, (_, i) => minsAgo(i + 1));
  assert.equal(verdictFor("copilot", PLAN, copilotBurst, NOW).allowed, false);
  assert.equal(verdictFor("photo", PLAN, [], NOW).allowed, true);

  // The check-in's daily cap has to leave room for both legitimate calls: a morning brief and a
  // weekly review can fall on the same day, and then a retry after a failure.
  assert.ok(capOf("coach", "day") >= 3, "a morning brief, a weekly review and one retry must fit");
  const coachBurst = Array.from({ length: capOf("coach", "day") }, (_, i) => hoursAgo(i));
  assert.equal(verdictFor("coach", PLAN, coachBurst, NOW).allowed, false);
});

test("a future-dated call cannot manufacture headroom or block a real one", () => {
  // The same class of bug that switched the safety engine off: a timestamp ahead of now.
  const real = capOf("photo", "hour") - 1;
  const withFuture = [new Date(NOW.getTime() + 60 * 60_000), ...Array.from({ length: real }, (_, i) => minsAgo(i + 1))];
  const v = verdictFor("photo", PLAN, withFuture, NOW);
  assert.equal(v.used, real, "the future-dated row is ignored rather than counted");
  assert.equal(v.allowed, true);
});

test("nonsense timestamps are ignored", () => {
  const bad = [new Date(NaN), new Date("nonsense"), ...Array.from({ length: 3 }, (_, i) => minsAgo(i + 1))];
  const v = verdictFor("photo", PLAN, bad, NOW);
  assert.equal(v.used, 3);
  assert.equal(v.allowed, true);
});

test("every feature's windows go smallest to largest, so the tightest one reports the block", () => {
  // Both plans, because a free tier with a longer window carrying a smaller cap would make the
  // reported block arbitrary: whichever window happened to be checked first would win.
  const all = Object.entries(PLAN_LIMITS).flatMap(([plan, features]) =>
    Object.entries(features).map(([feature, windows]) => [`${plan}/${feature}`, windows] as const),
  );
  for (const [feature, windows] of all) {
    for (let i = 1; i < windows.length; i++) {
      assert.ok(windows[i].ms > windows[i - 1].ms, `${feature} windows are out of order`);
      assert.ok(windows[i].max >= windows[i - 1].max, `${feature} has a longer window with a smaller cap`);
    }
  }
});

test("usage summary reports per window with a cost estimate", () => {
  const times = Array.from({ length: 4 }, (_, i) => minsAgo(i + 1));
  const rows = usageSummary("photo", PLAN, times, NOW);
  assert.equal(rows.length, LIMITS.photo.length);
  assert.equal(rows[0].used, 4);
  assert.equal(rows[0].max, LIMITS.photo[0].max);
  assert.equal(rows[0].spentUsd, Math.round(4 * ROUGH_COST_USD.photo * 100) / 100);
});

test("a cost estimate exists for every metered feature", () => {
  for (const feature of Object.keys(LIMITS)) {
    assert.ok((ROUGH_COST_USD as Record<string, number>)[feature] > 0, `${feature} has no cost estimate`);
  }
});
