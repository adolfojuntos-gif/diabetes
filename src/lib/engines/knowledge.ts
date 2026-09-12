/**
 * THE NUTRITION KNOWLEDGE TREE — education that unlocks by learning, never by eating well.
 *
 * Five tiers, a handful of lessons in each, and one rule about how you move: you move by reading
 * and answering. Nothing here opens because a glucose reading was good, because a week was tidy, or
 * because somebody ate what an app approved of. A tree that opened on results would be a tree that
 * stayed shut for exactly the people who most need what is in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS ALLOWED TO TEACH, WHICH IS THE WHOLE DESIGN
 *
 * Teaching nutrition to somebody with diabetes is the most dangerous thing in this part of the
 * product, because a lesson is a claim and a claim read at eleven at night can change a dose. The
 * rule that governs everything else in Steady applies hardest here: THIS APP IS NOT THE SOURCE OF
 * CLINICAL TRUTH, and nothing in it may state a nutrition fact that no qualified person has signed
 * off.
 *
 * So every lesson declares what KIND of claim it makes:
 *
 *   "how_steady_works"  A fact about this app's own reference and arithmetic. "Figures are per 100 g
 *                       as eaten" is true because the table says so, and nobody needs a clinician to
 *                       confirm it. These are safe, and they are also the lessons nobody else can
 *                       teach, because they are about this product.
 *   "your_own_data"     A fact about what the person themselves logged, computed by an engine that
 *                       already exists. It asserts nothing general.
 *   "nutrition"         A claim about food and the body. These REQUIRE a clinician's sign-off and
 *                       are not rendered until they have it.
 *
 * The nutrition lessons are declared here anyway, empty and pending, and that is deliberate rather
 * than an oversight: the shape of what the tree WOULD teach is visible to the clinician who reviews
 * it, instead of being invented at review time or, worse, written by whoever ships next.
 *
 * `availableLessons()` is the only door to the screen, and it drops anything pending. A tier whose
 * lessons are all pending is passed through rather than becoming a wall.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Pure. No database, no clock.
 */
import type { ReviewStatus } from "./rules";

/** Bumped when the tiers, the lessons or the progression change. */
export const KNOWLEDGE_ENGINE_VERSION = "1.0.0";

/** XP for reading one lesson and answering its question. Keyed by lesson, so each pays once. */
export const LESSON_XP = 30;

export const TIERS = ["explorer", "carb", "builder", "strategist", "master"] as const;
export type TierKey = (typeof TIERS)[number];

export const TIER_INFO: Record<TierKey, { name: string; glyph: string; about: string }> = {
  explorer: { name: "Food Explorer", glyph: "🌱", about: "What the figures in Steady actually are." },
  carb: { name: "Carb Explorer", glyph: "🌿", about: "How to read a carbohydrate figure, and what it is not telling you." },
  builder: { name: "Meal Builder", glyph: "🌳", about: "What happens when foods are put together and divided up." },
  strategist: { name: "Nutrition Strategist", glyph: "🌲", about: "Your own logs, and what they can and cannot settle." },
  master: { name: "Food Master", glyph: "🌎", about: "Where the numbers end and a person has to take over." },
};

/**
 * A tier is a place in the reading, never a qualification. This sits on the screen next to the
 * names, which are grand on purpose and would otherwise read as credentials.
 */
export const TIER_NOTE =
  "These names mark how far through the reading you are. None of them is a qualification, and none of them means Steady now knows more about your diabetes than the people looking after you.";

export type LessonClaim = "how_steady_works" | "your_own_data" | "nutrition";

export type Lesson = {
  key: string;
  tier: TierKey;
  title: string;
  /** The lesson itself, one paragraph per entry. */
  body: string[];
  /**
   * One question at the end. It is not a test: every option gives a real answer back and the lesson
   * counts as learned either way. A quiz that can be failed is a quiz people stop taking honestly,
   * and the point is the paragraph they read afterwards.
   */
  check: { question: string; options: { label: string; response: string }[] };
  claim: LessonClaim;
  reviewStatus: ReviewStatus;
};

/**
 * THE CATALOGUE.
 *
 * Order inside a tier is the reading order. Nothing here states what food does to a body; where the
 * subject comes close, the lesson says which question it is declining to answer and who to ask.
 */
export const LESSONS: Lesson[] = [
  /* ───────────────────────────── 🌱 Food Explorer ───────────────────────────── */
  {
    key: "per-100g",
    tier: "explorer",
    title: "Every figure here is per 100 grams, as eaten",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Steady's reference holds one set of numbers for each food: what is in 100 grams of it. Every other figure you ever see in this app is that number multiplied by a weight. A portion button does not hold its own carbohydrate figure, it holds a weight.",
      "The words that matter are AS EATEN. Dry pasta and cooked pasta are two different foods in the table, because 100 grams of dry pasta becomes roughly 240 grams of cooked pasta once it has taken on water. The carbohydrate has not changed; it is spread through nearly two and a half times the weight.",
      "This is the single most common way a figure goes wrong, and it goes wrong quietly, because both numbers look perfectly reasonable on their own.",
    ],
    check: {
      question: "A packet says 75 g of carbohydrate per 100 g. You cook 100 g of it and it comes out of the pan at 240 g. What does the packet's figure describe?",
      options: [
        { label: "The dry weight", response: "Yes. The packet weighed the food dry, so 75 g of carbohydrate is now spread through 240 g of cooked food. Steady keeps dry and cooked as separate entries so the weight you put in matches the figure you get back." },
        { label: "The cooked weight", response: "It describes the DRY weight. The packet was written before the pan. Those 75 g of carbohydrate are now spread through 240 g of cooked food, which is why Steady keeps dry and cooked as separate entries." },
        { label: "Either, they are the same", response: "They are not the same, and this is the trap. Water changes the weight and not the carbohydrate, so the same 75 g now sits in 240 g of food. Steady keeps dry and cooked as separate entries for exactly this reason." },
      ],
    },
  },
  {
    key: "a-portion-is-a-reference",
    tier: "explorer",
    title: "A portion is somebody else's portion",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "When you tap \"1 cup\" or \"1 medium apple\", Steady looks up a weight that a reference decided was typical, and multiplies. It is a good starting guess and it is a guess about a general apple, not about the apple in your hand.",
      "The gap is usually bigger than people expect. Medium apples in a shop can differ by half again in weight. A restaurant's cup is not a measuring cup. Somebody serving four people from one pan is not dividing by four with a scale.",
      "This is why every screen in Steady that totals a meal also lists what it does not know, and why the portion difference is usually the first thing on that list. It is not there to undermine the figure. It is there because a figure quoted to one decimal place, with no caveat, invites a confidence it has not earned.",
    ],
    check: {
      question: "You log \"1 medium banana\" and eat a large one. What has happened to the figure?",
      options: [
        { label: "It is too low", response: "Yes, and by more than most people guess. Reference portions are a starting point. Where it matters, weighing the food once tells you more than any table can." },
        { label: "It is still right", response: "It is low. The reference multiplied by the weight of a typical banana, not yours. Where it matters, weighing the food once tells you more than any table can." },
        { label: "There is no way to know", response: "There is: the reference used a typical weight, so a larger banana means the figure is low. Where it matters, weighing the food once settles it." },
      ],
    },
  },
  {
    key: "where-figures-come-from",
    tier: "explorer",
    title: "Four kinds of figure, four kinds of doubt",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Steady labels where every number came from, and the label is not decoration. A government food composition figure was produced by laboratory analysis of many samples and does not change. A manufacturer's label describes one product and is updated when the recipe is. A restaurant's published figure was true on the day it was read. A figure you entered yourself is exactly as good as the measurement you made.",
      "The restaurant figures are the ones that move. A chain can change a supplier or a recipe without announcing it, and the published number follows months later or not at all. That is why Steady records the DATE a restaurant figure was read and shows you its age instead of quietly presenting it as current.",
      "None of these is the good one and none is the bad one. They are four different questions to ask about the same number.",
    ],
    check: {
      question: "Which of these figures can go out of date without anything visibly changing?",
      options: [
        { label: "A restaurant's published figure", response: "Yes. The recipe can change without the published number following. Steady shows you how old the figure is so you can weigh it yourself." },
        { label: "A government composition figure", response: "Those are laboratory analyses of many samples and are stable. The one that drifts is a restaurant's published figure, because a recipe can change without the number following. Steady shows you how old that figure is." },
        { label: "A figure you entered yourself", response: "Yours is as good as the measurement you made, and it does not drift on its own. The one that drifts is a restaurant's published figure, because a recipe can change without the number following." },
      ],
    },
  },

  /* ───────────────────────────── 🌿 Carb Explorer ───────────────────────────── */
  {
    key: "total-and-fibre",
    tier: "carb",
    title: "Total carbohydrate, and the fibre inside it",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "In the reference Steady uses, the fibre figure is part of the carbohydrate figure and not added on top of it. A food listed at 21 g of carbohydrate and 8 g of fibre contains 21 g of carbohydrate, of which 8 g is fibre. It does not contain 29 g.",
      "Subtracting one from the other gives a number often called net carbohydrate. Steady will show it to you, underneath the total and never instead of it, because it is arithmetic this app can do and not a recommendation this app can make.",
      "WHICH OF THE TWO YOU SHOULD BE COUNTING IS NOT A QUESTION STEADY ANSWERS. It depends on your treatment and it is a conversation with your diabetes team. This lesson is only here so that when somebody tells you which one to use, you know exactly what they are pointing at.",
    ],
    check: {
      question: "A label reads: carbohydrate 21 g, of which fibre 8 g. How much carbohydrate is in it?",
      options: [
        { label: "21 g", response: "Yes. The fibre is inside the total, not on top of it. Twenty-one grams of carbohydrate, eight of which is fibre." },
        { label: "29 g", response: "It is 21 g. The fibre sits inside the carbohydrate total rather than adding to it, so 21 g of carbohydrate of which 8 g is fibre." },
        { label: "13 g", response: "Thirteen is the total minus the fibre, which some people are asked to count and some are not. The carbohydrate in the food is 21 g. Which figure applies to you is a question for your diabetes team." },
      ],
    },
  },
  {
    key: "same-food-different-numbers",
    tier: "carb",
    title: "Why two entries for the same food disagree",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Search for rice and you will find entries that do not match. This is almost never an error in the table. It is usually one of three things: one is dry and one is cooked, one is a generic analysis and one is a specific brand, or the two describe different varieties of what people call one food.",
      "The fix is to read the entry name rather than the number. \"White rice, cooked\" and \"White rice\" are two different foods in the sense that matters, which is the sense of what you put on the scale.",
      "When two plausible entries genuinely disagree and you cannot tell which is yours, the honest move is the boring one: pick the one whose description matches what you actually ate, and note that you were unsure.",
    ],
    check: {
      question: "Two entries for oats give very different carbohydrate figures. What is the most likely reason?",
      options: [
        { label: "One is dry and one is cooked", response: "Usually, yes. Water changes the weight and not the carbohydrate, so the same food reads very differently once it has been cooked. Read the entry name before the number." },
        { label: "One of them is wrong", response: "Far more often it is dry against cooked, or generic against a specific brand. Water changes the weight and not the carbohydrate. Read the entry name before the number." },
        { label: "Oats vary that much naturally", response: "Not usually by that much. The common cause is dry against cooked, or generic against a specific brand. Read the entry name before the number." },
      ],
    },
  },

  /* ───────────────────────────── 🌳 Meal Builder ───────────────────────────── */
  {
    key: "energy-not-grams",
    tier: "builder",
    title: "Why Steady compares macros by energy and not by grams",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "When Steady says what a meal is mostly made of, it converts first. Carbohydrate and protein are counted at about four calories a gram, fat at about nine, and fibre at about two because it is only partly metabolised. Then it compares.",
      "Comparing raw grams instead would hide every oil. A tablespoon of olive oil is 14 grams against 250 grams of salad, so by weight it is nothing; by energy it is most of the meal. Neither statement is a criticism of the oil. They are answers to two different questions, and an app that only ever gave you the first would be quietly misleading you.",
      "This is why the plate reports what your meal is by weight and by energy separately, and says so when the two disagree.",
    ],
    check: {
      question: "Salad at 250 g with a tablespoon of oil at 14 g. Which is most of the meal?",
      options: [
        { label: "It depends which question you mean", response: "Exactly. By weight it is overwhelmingly salad. By energy it is mostly the oil. Both are true, they usually differ, and Steady shows you both rather than picking one." },
        { label: "The salad", response: "By weight, yes, overwhelmingly. By energy it is mostly the oil, because fat carries more than twice what the others do per gram. Both are true and Steady shows you both." },
        { label: "The oil", response: "By energy, yes. By weight it is overwhelmingly salad. Both are true, they usually differ, and Steady shows you both rather than picking one." },
      ],
    },
  },
  {
    key: "weight-and-energy",
    tier: "builder",
    title: "A plate has two shapes and they disagree",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Build your plate puts every food in the quarter its own macros put it in, and then describes the plate twice: what most of it is by weight, and what most of it is by energy.",
      "The disagreement between those two is the whole reason the screen exists. A plate that looks three quarters vegetables can be mostly fat by energy, and a person who only ever saw the picture would never know. Seeing both is not a warning. It is simply more of the truth than one figure can hold.",
      "Nothing on that screen is scored, there is no target shape, and the word balanced does not appear on it. What a plate should look like for you is a conversation with a dietitian, not a rule an app enforces on a Tuesday night.",
    ],
    check: {
      question: "Steady tells you a plate is mostly vegetables by weight and mostly fat by energy. What has it told you?",
      options: [
        { label: "Two true things about the same plate", response: "Yes. Neither is a verdict and neither corrects the other. They are two measurements of one meal, and they usually differ." },
        { label: "That something is wrong with the plate", response: "No. Neither figure is a verdict, and nothing on that screen is scored. They are two measurements of one meal, and they usually differ." },
        { label: "That the figures contradict each other", response: "They do not contradict; they measure different things. Weight and energy are two measurements of one meal and they usually differ." },
      ],
    },
  },
  {
    key: "dividing-a-batch",
    tier: "builder",
    title: "A sixth of a pot is a sixth of a pot",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "The Fuel Forge works a recipe out once. You put in what goes in the pot, say how many servings it makes, and it divides. A serving is the batch divided, and that division is exact no matter what happened in the pan.",
      "The figure that water DOES change is the per-100-gram one. A sauce that simmered for an hour finished lighter than the ingredients that went into it, so the same carbohydrate now sits in less food and every 100 grams of it is denser. That is why the Forge asks, optionally, what the finished pot weighed, and says plainly in the uncertainty list when it is working from the ingredients added together instead.",
      "It is worth knowing which of those two numbers you are looking at. One does not need a kitchen scale; the other does.",
    ],
    check: {
      question: "You forge a chili as six servings without weighing the finished pot. Which figure is affected?",
      options: [
        { label: "The per-100-gram figure", response: "Yes. A sixth of the pot is still exactly a sixth whatever boiled away, but 100 g of the finished chili is denser than the ingredients-added-together figure suggests. Weighing the pot fixes that one." },
        { label: "The per-serving figure", response: "That one is safe: a sixth of the pot is a sixth whatever boiled away. It is the per-100-gram figure that shifts, because the finished chili is denser than the raw sum. Weighing the pot fixes it." },
        { label: "Both of them", response: "Only the per-100-gram one. A sixth of the pot is exactly a sixth however much water left it, which is why the Forge computes a serving from the batch rather than from the weight." },
      ],
    },
  },

  /* ─────────────────────────── 🌲 Nutrition Strategist ─────────────────────────── */
  {
    key: "your-own-log-is-the-rare-thing",
    tier: "strategist",
    title: "The only figures in here that are about you",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Everything in the carbohydrate reference is about food in general. It is the same for you as for everybody else using this app, and no table anywhere can be otherwise.",
      "The exception is what happens after you log a meal built from that reference. Steady keeps the components of the meal, so it can go back and show what YOUR readings did after that exact food, on the days you ate it. That is a figure no general nutrition database has and none can produce.",
      "It is an observation about your own logs and it is not a finding. It cannot tell the difference between the food and the walk you took afterwards, the dose, the sleep, or the day itself. What it is good for is giving you and your care team something specific to look at together, instead of a general impression.",
    ],
    check: {
      question: "Steady shows that your readings after a particular meal tended to be higher. What is that?",
      options: [
        { label: "Something specific to ask your team about", response: "That is exactly what it is for. It is an association in your own logs, and it cannot separate the food from the dose, the walk, the sleep or the day. It is a good thing to bring to a conversation." },
        { label: "Proof the meal is bad for you", response: "It cannot show that. It is an association in your own logs, and it cannot separate the food from the dose, the walk, the sleep or the day. It is a good thing to bring to your care team, not a verdict on a meal." },
        { label: "A reason to stop eating it", response: "Steady does not tell anybody what to stop eating. It is an association in your own logs that cannot separate the food from everything else about that day. It is a good thing to raise with your care team." },
      ],
    },
  },
  {
    key: "too-few-to-say",
    tier: "strategist",
    title: "When Steady refuses to compare",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Steady will not compare one fortnight against another unless both sides have enough in them: a minimum number of days with readings, and a minimum number of readings overall. Below that it says it does not have enough to say, and it means it.",
      "This is not caution for the sake of it. Comparing a fortnight with four readings against a fortnight with forty produces a number, and the number is about who was holding the meter, not about the person. An app that showed it anyway would be manufacturing a result out of an absence.",
      "It also means a quiet fortnight is never reported as a bad one. Not enough data and a poor result are different things, and Steady is built to keep them different.",
    ],
    check: {
      question: "You logged four readings in a fortnight. Steady says it does not have enough to compare. Why?",
      options: [
        { label: "Four readings cannot describe a fortnight", response: "Yes. A comparison built on four readings measures who was holding the meter, not the fortnight. Steady would rather say nothing than manufacture a result." },
        { label: "It is a penalty for not logging", response: "It is not, and nothing in Steady penalises a quiet fortnight. A comparison built on four readings would measure who was holding the meter rather than the fortnight." },
        { label: "The fortnight was a bad one", response: "It says nothing about that, and deliberately so. Not enough data and a poor result are different things. Four readings cannot describe a fortnight either way." },
      ],
    },
  },

  /* ───────────────────────────── 🌎 Food Master ───────────────────────────── */
  {
    key: "what-numbers-do-not-know",
    tier: "master",
    title: "The ceiling on every figure in this app",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "No figure Steady shows you knows about the oil in the pan, the sauce, how long something was cooked, what was left on the plate, or how the portion was judged by eye. It knows what you told it and what the reference says, and that is all.",
      "This is why every screen that totals a meal ends with a list of what it does not know, and why that list is never empty. A carbohydrate total offered with no caveat invites a precision it has not got, and the person acting on it deserves to see the same doubts a dietitian would say out loud.",
      "Knowing the ceiling is not a reason to distrust the figures. It is what lets you use them properly: as a good estimate with a known shape to its error, rather than a fact.",
    ],
    check: {
      question: "Why does Steady always list what a meal's figures do not know?",
      options: [
        { label: "So the estimate is used as an estimate", response: "Yes. The doubts are not there to undermine the number. They are what turns it from a false fact into a usable estimate." },
        { label: "To cover itself legally", response: "The reason is practical, not legal. A total with no caveat invites a precision it has not got; naming the doubts is what makes the number usable." },
        { label: "Because the figures are unreliable", response: "They are good estimates. What they are not is exact, and naming the doubts is what lets you use them as estimates rather than facts." },
      ],
    },
  },
  {
    key: "an-app-is-not-a-clinician",
    tier: "master",
    title: "What Steady will never tell you",
    claim: "how_steady_works",
    reviewStatus: "not_required",
    body: [
      "Steady will not tell you a dose. It will not tell you what to eat or what to stop eating. It will not tell you whether a reading is good. It will not tell you that a pattern in your logs means something about your condition. These are not gaps waiting to be filled in a later version; they are the line this product is built on.",
      "What it will do is keep an honest record, do the arithmetic without inventing anything, show you where every figure came from and how much to trust it, and hand you something specific to take to the people who ARE allowed to answer those questions.",
      "If a screen in this app ever seems to be telling you what to do about your diabetes, treat that as a bug and not as advice. And if something is wrong right now, this app is not the thing to be reading: contact your care team, or emergency services.",
    ],
    check: {
      question: "Steady shows a clear pattern in your logs. Who decides what it means?",
      options: [
        { label: "You and your care team", response: "Yes. Steady's job is to find something specific and hand it over honestly. Deciding what it means, and what to do, is a conversation with people who are qualified to have it." },
        { label: "Steady", response: "Never. Steady's job ends at showing you something specific with its provenance attached. What it means, and what to do about it, is a conversation with your care team." },
        { label: "Whichever the numbers support", response: "Numbers do not interpret themselves, and this app is not allowed to interpret them for you. What a pattern means is a conversation with your care team." },
      ],
    },
  },

  /* ═══════════════════════════════════════════════════════════════════════════════════════════
     DECLARED, PENDING, AND NOT RENDERED.

     These are the lessons a nutrition education feature would obviously want, and every one of
     them is a claim about food and the body. Steady is not allowed to write those. They are listed
     with empty bodies so that the shape of what is missing is visible to the clinician who reviews
     this file, rather than being invented at review time or written by whoever ships next.

     `availableLessons()` drops anything still pending, so nothing below reaches a screen.
     ═══════════════════════════════════════════════════════════════════════════════════════════ */
  {
    key: "carbohydrate-and-glucose",
    tier: "carb",
    title: "How carbohydrate-containing foods fit into a meal",
    claim: "nutrition",
    reviewStatus: "pending_clinical_review",
    body: [],
    check: { question: "", options: [] },
  },
  {
    key: "fibre-and-the-figure",
    tier: "carb",
    title: "What fibre does to a carbohydrate figure in practice",
    claim: "nutrition",
    reviewStatus: "pending_clinical_review",
    body: [],
    check: { question: "", options: [] },
  },
  {
    key: "meal-composition",
    tier: "builder",
    title: "What changes when a meal is put together differently",
    claim: "nutrition",
    reviewStatus: "pending_clinical_review",
    body: [],
    check: { question: "", options: [] },
  },
  {
    key: "portion-guidance",
    tier: "strategist",
    title: "Judging a portion without a scale",
    claim: "nutrition",
    reviewStatus: "pending_clinical_review",
    body: [],
    check: { question: "", options: [] },
  },
];

/** What every screen showing this tree must say, while any lesson is still awaiting review. */
export const KNOWLEDGE_REVIEW_NOTE =
  "Everything in this tree is about how Steady's own reference and arithmetic work, or about your own logs. Lessons that would make a claim about food and the body are written into the app but not shown, because no clinician has reviewed them yet. Nothing here is advice about what to eat.";

/**
 * The lessons a person may actually see.
 *
 * The only gate is review status, and it is applied here rather than at the screen so that no
 * future page can forget it.
 */
export function availableLessons(all: Lesson[] = LESSONS): Lesson[] {
  return all.filter((l) => l.reviewStatus !== "pending_clinical_review" && l.body.length > 0 && l.check.options.length > 0);
}

export function lessonsInTier(tier: TierKey, all: Lesson[] = LESSONS): Lesson[] {
  return availableLessons(all).filter((l) => l.tier === tier);
}

export type TierState = {
  tier: TierKey;
  name: string;
  glyph: string;
  about: string;
  lessons: { lesson: Lesson; learned: boolean }[];
  learnedCount: number;
  total: number;
  /** Open means the lessons in it can be read now. */
  open: boolean;
  /** Every available lesson in it has been read. A tier with none available is complete by default. */
  complete: boolean;
  /** Set when a tier is open only because it has nothing in it yet, so a screen can say so. */
  emptyForNow: boolean;
};

export type TreeState = {
  tiers: TierState[];
  learned: number;
  total: number;
  /** The furthest tier that is open. What the person is called, if they want a name for it. */
  standing: { tier: TierKey; name: string; glyph: string };
  /** The next unread lesson in the furthest open tier, or null when the tree is finished. */
  next: Lesson | null;
  finished: boolean;
};

/**
 * Where somebody is in the tree.
 *
 * A TIER OPENS BECAUSE THE ONE BEFORE IT WAS READ, and for no other reason. There is no input to
 * this function for glucose, for a streak, for how long somebody has used the app, or for what they
 * have eaten, and that absence is the feature.
 */
export function treeState(learnedKeys: Iterable<string>, all: Lesson[] = LESSONS): TreeState {
  const learnedSet = new Set(learnedKeys);
  const tiers: TierState[] = [];
  let previousComplete = true;

  for (const tier of TIERS) {
    const lessons = lessonsInTier(tier, all).map((lesson) => ({ lesson, learned: learnedSet.has(lesson.key) }));
    const learnedCount = lessons.filter((l) => l.learned).length;
    const open = previousComplete;
    /*
     * A tier whose lessons are all still awaiting review has nothing in it, and would otherwise be
     * a wall nobody could ever get past. It passes through, and the screen says why.
     */
    const complete = lessons.length === 0 || learnedCount === lessons.length;
    tiers.push({
      tier,
      ...TIER_INFO[tier],
      lessons,
      learnedCount,
      total: lessons.length,
      open,
      complete,
      emptyForNow: lessons.length === 0,
    });
    previousComplete = previousComplete && complete;
  }

  const openTiers = tiers.filter((t) => t.open);
  const furthest = openTiers[openTiers.length - 1] ?? tiers[0];
  const next = openTiers.flatMap((t) => t.lessons).find((l) => !l.learned)?.lesson ?? null;
  const total = tiers.reduce((a, t) => a + t.total, 0);
  const learned = tiers.reduce((a, t) => a + t.learnedCount, 0);

  return {
    tiers,
    learned,
    total,
    standing: { tier: furthest.tier, name: furthest.name, glyph: furthest.glyph },
    next,
    finished: next === null && total > 0,
  };
}

/** Whether a lesson can be opened, which is only ever about the tier it sits in. */
export function canOpen(lessonKey: string, learnedKeys: Iterable<string>, all: Lesson[] = LESSONS): boolean {
  const lesson = availableLessons(all).find((l) => l.key === lessonKey);
  if (!lesson) return false;
  return treeState(learnedKeys, all).tiers.find((t) => t.tier === lesson.tier)?.open ?? false;
}

/**
 * What the check says back.
 *
 * Every option has a real answer and the lesson is learned either way. There is no score here, no
 * record of which option was picked being right or wrong, and nothing to fail. The paragraph
 * somebody reads after answering is the lesson; the question is only what makes them read it.
 */
export function respondTo(lesson: Lesson, optionIndex: number): string {
  const option = lesson.check.options[optionIndex];
  return option ? option.response : "";
}
