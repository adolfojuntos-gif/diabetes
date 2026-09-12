import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LESSONS,
  TIER_NOTE,
  TIERS,
  TIER_INFO,
  availableLessons,
  lessonsInTier,
  treeState,
  canOpen,
  respondTo,
  type Lesson,
} from "../src/lib/engines/knowledge";

/**
 * THE NUTRITION KNOWLEDGE TREE.
 *
 * This is the most dangerous feature in the food half of the app, because a lesson is a claim and a
 * claim read at eleven at night can change a dose. Almost every test here is a guard: that no
 * rendered lesson states a nutrition fact, that nothing awaiting clinical review can reach a
 * screen, and that the tree cannot be opened by eating well or closed by eating badly.
 */

const keysOf = (ls: Lesson[]) => ls.map((l) => l.key);
const everyKey = keysOf(availableLessons());

/* ===================== nothing unreviewed reaches a person ==================== */

test("a lesson awaiting clinical review is never available", () => {
  const pending = LESSONS.filter((l) => l.reviewStatus === "pending_clinical_review");
  assert.ok(pending.length > 0, "the pending lessons should stay declared, so a reviewer can see the shape of what is missing");
  for (const l of pending) {
    assert.ok(!everyKey.includes(l.key), `${l.key} is pending review and must not be available`);
    assert.ok(!canOpen(l.key, []), `${l.key} must not be openable`);
    assert.ok(!canOpen(l.key, everyKey), `${l.key} must not be openable even to somebody who read everything`);
  }
});

test("every lesson a person can actually read makes no claim about food and the body", () => {
  /**
   * THE LOAD-BEARING TEST. `claim: "nutrition"` is the declaration that a lesson asserts something
   * about food and a body, which this app is not allowed to invent. If one ever becomes available
   * without a clinician's sign-off, that is the failure this catches.
   */
  for (const l of availableLessons()) {
    assert.notEqual(l.claim, "nutrition", `${l.key} makes a nutrition claim and is being shown`);
    assert.equal(l.reviewStatus, "not_required", `${l.key} should need no review, or it should not be rendered`);
  }
});

test("an unreviewed lesson cannot be smuggled in by giving it a body", () => {
  const smuggled: Lesson = {
    key: "smuggled",
    tier: "carb",
    title: "Something about food",
    claim: "nutrition",
    reviewStatus: "pending_clinical_review",
    body: ["Looks complete."],
    check: { question: "Does it?", options: [{ label: "No", response: "Correct." }] },
  };
  assert.ok(!keysOf(availableLessons([...LESSONS, smuggled])).includes("smuggled"));
});

test("no rendered lesson tells anybody what to eat", () => {
  /*
   * Titles, bodies, questions and responses, which are the app SPEAKING. Option labels are excluded
   * deliberately: they are the things a person might believe, and one of them is "Proof the meal is
   * bad for you" precisely so that the response can say it is not. Banning a belief from being
   * named is how a screen loses the ability to correct it.
   */
  const text = availableLessons()
    .flatMap((l) => [l.title, ...l.body, l.check.question, ...l.check.options.map((o) => o.response)])
    .join(" ");
  for (const banned of [
    /you should eat/i,
    /you should avoid/i,
    /try to (?:eat|cut|reduce|limit)/i,
    /is (?:good|bad) for you/i,
    /\bhealthier\b/i,
    /\bunhealthy\b/i,
    /aim for/i,
    /recommended (?:daily|intake|amount)/i,
    /\byour dose\b/i,
  ]) {
    assert.doesNotMatch(text, banned, `banned construction ${banned} appears in a rendered lesson`);
  }
});

test("no rendered lesson states a clinical threshold", () => {
  /**
   * A number attached to a bodily target is the shape of an invented clinical threshold. The
   * arithmetic constants the lessons DO quote (4, 9, 2 calories a gram; 100 g; grams on a label)
   * are not thresholds, so this looks only for the units that describe a person.
   */
  const text = availableLessons()
    .flatMap((l) => [...l.body, ...l.check.options.map((o) => o.response)])
    .join(" ");
  assert.doesNotMatch(text, /\d+\s*(?:mg\/dl|mmol|hba1c|%\s*(?:in range|time in range))/i);
});

test("the last lesson in the tree is the one about the limits of the app", () => {
  const last = availableLessons().at(-1)!;
  assert.equal(last.key, "an-app-is-not-a-clinician");
  assert.match(last.body.join(" "), /emergency services|care team/i);
});

/* ========================= it opens by reading, only ======================== */

test("treeState takes no input but what has been read", () => {
  /**
   * The guarantee is structural rather than behavioural. The one required argument is the set of
   * lessons read; there is no parameter for glucose, a streak, a diet or a length of time, so the
   * tree CANNOT be made to open on results without changing this signature and failing here. The
   * catalogue is the only other argument and it carries a default, which is why the count is one.
   */
  assert.equal(treeState.length, 1, "treeState(learnedKeys) and nothing else that is required");
});

test("the same reading always gives the same state, because no clock reaches this", () => {
  const read = lessonsInTier("explorer").map((l) => l.key);
  assert.deepEqual(treeState(read), treeState(read));
  assert.deepEqual(treeState([...read].reverse()), treeState(read), "order of reading changes nothing");
});

test("the first tier is open to somebody who has read nothing", () => {
  const s = treeState([]);
  assert.equal(s.tiers[0].open, true);
  assert.equal(s.learned, 0);
  assert.equal(s.standing.tier, "explorer");
  assert.equal(s.next?.tier, "explorer");
});

test("a later tier stays shut until the one before it is read", () => {
  const s = treeState([]);
  for (const t of s.tiers.slice(1)) assert.equal(t.open, false, `${t.tier} should be shut`);
  assert.ok(!canOpen("energy-not-grams", []), "a builder lesson is not open at the start");
});

test("reading a tier opens the next one and nothing further", () => {
  const first = lessonsInTier("explorer").map((l) => l.key);
  const s = treeState(first);
  assert.equal(s.tiers[0].complete, true);
  assert.equal(s.tiers[1].open, true);
  assert.equal(s.tiers[2].open, false);
  assert.equal(s.standing.tier, "carb");
  assert.ok(canOpen(lessonsInTier("carb")[0].key, first));
});

test("reading every lesson finishes the tree and leaves nothing next", () => {
  const s = treeState(everyKey);
  assert.equal(s.finished, true);
  assert.equal(s.next, null);
  assert.equal(s.learned, s.total);
  assert.equal(s.standing.tier, "master");
  for (const t of s.tiers) assert.equal(t.open, true, t.tier);
});

test("a tier whose lessons are all still pending is passed through, not a wall", () => {
  /**
   * If a whole tier's content were awaiting review, gating on it would shut the tree permanently
   * for everybody. An empty tier completes by default and says so.
   */
  const noBuilderContent = LESSONS.filter((l) => l.tier !== "builder" || l.reviewStatus === "pending_clinical_review");
  const readUpToBuilder = [...lessonsInTier("explorer", noBuilderContent), ...lessonsInTier("carb", noBuilderContent)].map((l) => l.key);
  const s = treeState(readUpToBuilder, noBuilderContent);
  const builder = s.tiers.find((t) => t.tier === "builder")!;
  assert.equal(builder.total, 0);
  assert.equal(builder.emptyForNow, true);
  assert.equal(builder.complete, true);
  assert.equal(s.tiers.find((t) => t.tier === "strategist")!.open, true, "an empty tier is passed through, not a wall");
});

test("progress never goes backwards and an unknown key is simply ignored", () => {
  const s = treeState([...everyKey, "a-lesson-that-was-removed"]);
  assert.equal(s.learned, s.total);
  assert.equal(s.finished, true);
});

/* ============================== the check ================================= */

test("every option in every check gives a real answer back", () => {
  for (const l of availableLessons()) {
    assert.ok(l.check.options.length >= 2, `${l.key} needs a choice worth making`);
    for (const [i, o] of l.check.options.entries()) {
      assert.ok(o.response.trim().length > 30, `${l.key} option ${i} needs a real answer, not an acknowledgement`);
      assert.equal(respondTo(l, i), o.response);
    }
  }
});

test("no option is marked right or wrong, because the check is not a test", () => {
  for (const l of availableLessons()) {
    for (const o of l.check.options) {
      assert.ok(!("correct" in o), `${l.key} must not record a correct option`);
      assert.doesNotMatch(o.response, /incorrect|you (?:got it )?wrong|try again|well done|good job/i, `${l.key}: ${o.response}`);
    }
  }
});

test("an answer out of range says nothing rather than throwing", () => {
  const l = availableLessons()[0];
  assert.equal(respondTo(l, 99), "");
  assert.equal(respondTo(l, -1), "");
});

/* ============================== the catalogue ============================= */

test("every lesson sits in a real tier and every tier is described", () => {
  for (const l of LESSONS) assert.ok(TIERS.includes(l.tier), `${l.key} has tier ${l.tier}`);
  for (const t of TIERS) assert.ok(TIER_INFO[t].name.length > 0 && TIER_INFO[t].about.length > 0, t);
});

test("lesson keys are unique, because progress is stored against them", () => {
  const keys = LESSONS.map((l) => l.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("no tier name is presented as a qualification", () => {
  assert.match(TIER_NOTE, /qualification/i);
  assert.match(TIER_NOTE, /how far through the reading/i);
});

test("every rendered lesson is substantial enough to be worth the tap", () => {
  for (const l of availableLessons()) {
    assert.ok(l.body.length >= 2, `${l.key} is too thin`);
    assert.ok(l.body.every((p) => p.length > 80), `${l.key} has a paragraph that is barely a sentence`);
    assert.doesNotMatch(l.body.join(" "), /—/, `${l.key} uses an em dash`);
  }
});
