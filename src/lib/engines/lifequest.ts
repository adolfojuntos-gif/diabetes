/**
 * LIFE QUEST — the game layer.
 *
 * `journey.ts` decides what was EARNED. This file decides what the game SAYS: which guardian is
 * speaking, what this week's adventure is, what today's one small quest is, and which of the seven
 * identities the person is building. It is pure, deterministic and holds no clock of its own.
 *
 * The three rules that shape everything here:
 *
 * 1. A QUEST CAN ONLY EVER ASK FOR A BEHAVIOUR. "Take a short walk" is a quest. "Get your glucose
 *    under 140" is not, and no template in this file may ever become one, because a quest that
 *    asks for a number is an instruction to manipulate a number, and somebody will skip a meal to
 *    finish it.
 * 2. THE GAME NEVER OUTRANKS SAFETY. The screens check triage first and draw the banner above all
 *    of this. Nothing in this file returns anything urgent, so it cannot bury something that is.
 * 3. NOTHING HERE CAN SUBTRACT. There is no fail state, no expiry penalty, no lost streak. A quest
 *    that was not done simply was not done, and next week brings another.
 *
 * Quests are seeded from the ISO week, so everybody with the same week and the same gaps gets a
 * stable adventure that does not reshuffle when the page is reloaded, and the person cannot reroll
 * for an easier one.
 */
import type { DayRoll } from "./journey";
import { weekKey, parseDateKey } from "../time";

/* ------------------------------- identities ------------------------------- */

/**
 * The seven dimensions. This is the answer to "Diabetes Score: 98/100", which this app will never
 * have. A person is an Explorer and a Builder and somebody with Courage; none of those is a grade,
 * and none of them can be lowered by a reading.
 */
export const DIMENSIONS = [
  { key: "consistency", name: "Consistency", blurb: "Showing up, on the ordinary days as well as the good ones." },
  { key: "explorer", name: "Explorer", blurb: "Movement, and the places it takes you." },
  { key: "builder", name: "Builder", blurb: "The routines you assemble: food, plans, preparation." },
  { key: "wellness", name: "Wellness", blurb: "Sleep, water, and saying how the day actually felt." },
  { key: "learner", name: "Learner", blurb: "Understanding your own body a little better than last month." },
  { key: "courage", name: "Courage", blurb: "The hard appointments, and coming back after time away." },
  { key: "discovery", name: "Discovery", blurb: "What you noticed out there and wrote down." },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

/** Which award codes feed which identity. A code may feed more than one; that is intended. */
const DIMENSION_CODES: Record<DimensionKey, string[]> = {
  consistency: ["log", "week5", "week7", "streak3", "streak7", "streak14", "streak30", "streak60", "streak100", "trend_consistency"],
  explorer: ["move", "quest_explore", "discovery"],
  builder: ["meal", "full_day", "appt_prep", "quest_build"],
  wellness: ["sleep", "water", "checkin", "journal", "quest_wellness", "rest"],
  learner: ["quest_learn", "trend_steady", "trend_mean"],
  courage: ["begin_again", "appt_prep", "trend_lows", "trend_tir", "hold_steady"],
  discovery: ["discovery", "quest_discover"],
};

export type DimensionScore = {
  key: DimensionKey;
  name: string;
  blurb: string;
  xp: number;
  /** 1..5, the rank shown beside the name. Deliberately shallow so nobody is ever "low". */
  rank: number;
  rankName: string;
  /** 0..1 toward the next rank. */
  progress: number;
};

const RANK_NAMES = ["Setting out", "Finding the way", "Well travelled", "Seasoned", "Legend"];
/** Cumulative XP for each rank. Flat enough that every dimension is reachable without grinding. */
const RANK_AT = [0, 300, 900, 2000, 4000];

export function dimensionScores(awards: { code: string; xp: number }[]): DimensionScore[] {
  return DIMENSIONS.map((d) => {
    const codes = new Set(DIMENSION_CODES[d.key]);
    const xp = awards.reduce((a, r) => (codes.has(r.code) ? a + r.xp : a), 0);
    let rank = 1;
    while (rank < RANK_AT.length && xp >= RANK_AT[rank]) rank++;
    const base = RANK_AT[rank - 1];
    const next = RANK_AT[rank] ?? base;
    return {
      key: d.key,
      name: d.name,
      blurb: d.blurb,
      xp,
      rank,
      rankName: RANK_NAMES[rank - 1],
      progress: next > base ? Math.min(1, (xp - base) / (next - base)) : 1,
    };
  });
}

/* ------------------------------- guardians -------------------------------- */

/**
 * The guardians. They give quests, they notice things, and they are explicitly not clinicians:
 * none of them may ever mention a dose, a medication or a treatment, and none of the lines below
 * do. The Copilot is where clinical questions go, and the guardians point there rather than
 * answering.
 */
export type Guardian = {
  key: string;
  name: string;
  animal: string;
  glyph: string;
  /** The region level from which this guardian is the one speaking. */
  fromLevel: number;
  voice: string;
  greeting: string[];
  onRest: string;
  onReturn: string;
};

export const GUARDIANS: Guardian[] = [
  {
    key: "forest",
    name: "Wren",
    animal: "the Forest Guardian",
    glyph: "🐺",
    fromLevel: 1,
    voice: "steady, unhurried, notices small things",
    greeting: [
      "The clearing looks different with you in it.",
      "You came back. The path is a little clearer than it was.",
      "Nothing out here is in a hurry. Neither are you.",
    ],
    onRest: "Sit a while. The forest keeps going whether or not you walk it today.",
    onReturn: "The trees kept growing while you were away. Nothing here was lost.",
  },
  {
    key: "river",
    name: "Calla",
    animal: "the River Guardian",
    glyph: "🐋",
    fromLevel: 5,
    voice: "warm, plainspoken, fond of water metaphors and suspicious of them",
    greeting: [
      "The river is wider than when you started. That was you.",
      "Water finds its way by going the same direction most days, not every day.",
      "You have built something here that holds.",
    ],
    onRest: "Still water is still water. Rest is not a stall.",
    onReturn: "The river never stopped. It was waiting at the bend for you.",
  },
  {
    key: "mountain",
    name: "Ridge",
    animal: "the Mountain Guardian",
    glyph: "🦅",
    fromLevel: 7,
    voice: "direct, dry, never sentimental",
    greeting: [
      "From up here you can see the clearing you started in. It is small.",
      "Height is just a lot of ordinary steps stacked up.",
      "You climbed this. Nobody carried you.",
    ],
    onRest: "Every climber I have watched go far stopped more often than the ones who did not.",
    onReturn: "The mountain does not keep score. Pick up where the trail is.",
  },
  {
    key: "night",
    name: "Vesper",
    animal: "the Night Guardian",
    glyph: "🦉",
    fromLevel: 10,
    voice: "quiet, a little wry, speaks in short lines",
    greeting: [
      "The stars over your world are ones you earned. One for each thing that changed.",
      "It is late somewhere. It usually is.",
      "You are further along than the version of you who first stood in that clearing.",
    ],
    onRest: "Night is not a failure of the day. Rest.",
    onReturn: "I left a light on. Come in.",
  },
];

export function guardianFor(level: number): Guardian {
  let g = GUARDIANS[0];
  for (const x of GUARDIANS) if (level >= x.fromLevel) g = x;
  return g;
}

/** A stable line for the day, so the guardian is not saying something new on every reload. */
export function guardianLine(g: Guardian, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return g.greeting[h % g.greeting.length];
}

/* --------------------------------- quests --------------------------------- */

/**
 * `auto` quests are confirmed by the logs themselves, so nothing is taken on trust and nothing has
 * to be self-reported. `manual` quests are the ones only the person can know about — five quiet
 * minutes, a photo of something on a walk — and those are marked done by tapping. That is not a
 * loophole: the reward for lying about resting is having not rested.
 */
export type QuestKind = "auto" | "manual";

export type QuestTemplate = {
  code: string;
  title: string;
  ask: string;
  why: string;
  xp: number;
  kind: QuestKind;
  dimension: DimensionKey;
  /** For auto quests: is it done, given this week's days so far? */
  done?: (days: DayRoll[]) => boolean;
  /** Higher when the person's logs show this is the thing they have been skipping. */
  weight?: (days: DayRoll[]) => number;
};

const daysWith = (days: DayRoll[], f: (d: DayRoll) => boolean) => days.filter(f).length;

export const QUEST_TEMPLATES: QuestTemplate[] = [
  {
    code: "quest_explore",
    title: "The unwalked way",
    ask: "Take one walk somewhere you have not been before. Any length. Being somewhere new is the whole quest.",
    why: "Movement is one of the few things here that is entirely your decision.",
    xp: 50,
    kind: "manual",
    dimension: "explorer",
  },
  {
    code: "quest_discover",
    title: "Something worth noticing",
    ask: "Find one thing outside worth looking at twice, and write it into your Explorer Journal.",
    why: "It turns a walk into somewhere you went rather than minutes you spent.",
    xp: 40,
    kind: "manual",
    dimension: "discovery",
  },
  {
    code: "quest_wellness",
    title: "Five quiet minutes",
    ask: "Take five minutes that belong to nobody else. No phone, no logging, nothing to finish.",
    why: "Stress is not a soft factor. It shows up in the numbers like everything else does.",
    xp: 20,
    kind: "manual",
    dimension: "wellness",
  },
  {
    code: "quest_learn",
    title: "One thing you did not know",
    ask: "Ask the Copilot one question about your own body that you have been meaning to ask.",
    why: "Understanding your own patterns is the part of this nobody can do for you.",
    xp: 25,
    kind: "manual",
    dimension: "learner",
  },
  {
    code: "quest_checkin",
    title: "Say how it actually is",
    ask: "Complete the daily check-in on three days this week.",
    why: "How you feel is data too, and it is the only kind no device records.",
    xp: 40,
    kind: "auto",
    dimension: "wellness",
    done: (d) => daysWith(d, (x) => x.checkin) >= 3,
    weight: (d) => 3 - Math.min(3, daysWith(d, (x) => x.checkin)),
  },
  {
    code: "quest_move",
    title: "Three times out",
    ask: "Log movement on three days this week. Fifteen minutes counts.",
    why: "Three short walks beat one long one your legs remember for a week.",
    xp: 60,
    kind: "auto",
    dimension: "explorer",
    done: (d) => daysWith(d, (x) => x.moveMinutes >= 15) >= 3,
    weight: (d) => 3 - Math.min(3, daysWith(d, (x) => x.moveMinutes >= 15)),
  },
  {
    code: "quest_build",
    title: "Four days of plates",
    ask: "Log what you ate on four days this week.",
    why: "Four days is enough for the app to start telling you which foods your body answers differently.",
    xp: 50,
    kind: "auto",
    dimension: "builder",
    done: (d) => daysWith(d, (x) => x.meals > 0) >= 4,
    weight: (d) => 4 - Math.min(4, daysWith(d, (x) => x.meals > 0)),
  },
  {
    code: "quest_night",
    title: "Four mornings after",
    ask: "Log your sleep on four mornings this week.",
    why: "Sleep moves the morning reading more than almost anything else you can change.",
    xp: 40,
    kind: "auto",
    dimension: "wellness",
    done: (d) => daysWith(d, (x) => x.sleepLogged) >= 4,
    weight: (d) => 4 - Math.min(4, daysWith(d, (x) => x.sleepLogged)),
  },
  {
    code: "quest_water",
    title: "The dull one that works",
    ask: "Hit your water goal on three days this week.",
    why: "Unglamorous, and it holds the rest of the day up.",
    xp: 30,
    kind: "auto",
    dimension: "wellness",
    done: (d) => daysWith(d, (x) => x.waterGoalMet) >= 3,
    weight: (d) => 3 - Math.min(3, daysWith(d, (x) => x.waterGoalMet)),
  },
];

/** The named adventures. One per week, chosen by the week key, so they cycle rather than repeat. */
export const ADVENTURES: { name: string; opening: string; reward: string }[] = [
  { name: "The Lost Trail", opening: "A track leaves the clearing on the north side and nobody has walked it in a long time.", reward: "The Lost Forest" },
  { name: "The Low Water Crossing", opening: "The river is down this week. There is a way across that is not usually there.", reward: "The Far Bank" },
  { name: "The Ridge Before Dawn", opening: "There is one hour before sunrise when you can see the whole valley you have been building.", reward: "The Overlook" },
  { name: "The Quiet Hollow", opening: "Somewhere past the orchard the noise stops completely. It is worth finding on purpose.", reward: "The Hollow" },
  { name: "The Long Way Round", opening: "The direct route is not the interesting one this week.", reward: "The Old Orchard Road" },
  { name: "What the Owl Saw", opening: "Vesper has been keeping notes on things that only happen after dark.", reward: "The Night Meadow" },
  { name: "The Stones That Count", opening: "Someone stacked a cairn at every place they stopped to rest. There are more than you would think.", reward: "The Cairn Path" },
  { name: "Where the Falls Begin", opening: "Every waterfall starts as something small enough to step over.", reward: "The Headwater" },
];

export type Quest = {
  key: string;
  code: string;
  slot: number;
  title: string;
  ask: string;
  why: string;
  xp: number;
  kind: QuestKind;
  dimension: DimensionKey;
};

export type Adventure = {
  weekKey: string;
  name: string;
  opening: string;
  reward: string;
  quests: Quest[];
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * This week's adventure: three quests, weighted toward whatever the person has actually been
 * skipping, with one manual quest always present so the week is not purely bookkeeping.
 *
 * Seeded by the week, never by the clock, so opening the app twice on Tuesday shows the same
 * adventure and there is no reroll to hunt for.
 */
export function weeklyAdventure(now: Date, weekDays: DayRoll[]): Adventure {
  const wk = weekKey(now);
  const seed = hash(wk);
  const a = ADVENTURES[seed % ADVENTURES.length];

  const autos = QUEST_TEMPLATES.filter((t) => t.kind === "auto")
    .map((t, i) => ({ t, w: (t.weight?.(weekDays) ?? 0) * 10 + ((seed >> i) & 3) }))
    .sort((x, y) => y.w - x.w)
    .map((x) => x.t);
  const manuals = QUEST_TEMPLATES.filter((t) => t.kind === "manual");
  const manual = manuals[seed % manuals.length];

  const chosen = [autos[0], autos[1], manual].filter(Boolean);
  return {
    weekKey: wk,
    name: a.name,
    opening: a.opening,
    reward: a.reward,
    quests: chosen.map((t, slot) => ({
      key: `${t.code}:${wk}`,
      code: t.code,
      slot,
      title: t.title,
      ask: t.ask,
      why: t.why,
      xp: t.xp,
      kind: t.kind,
      dimension: t.dimension,
    })),
  };
}

/** Whether an auto quest is satisfied by this week's logs. Manual quests always return false here. */
export function autoQuestDone(code: string, weekDays: DayRoll[]): boolean {
  const t = QUEST_TEMPLATES.find((x) => x.code === code);
  return t?.kind === "auto" && Boolean(t.done?.(weekDays));
}

/**
 * Today's one small thing. Always achievable, always the gap rather than the thing they already do,
 * and never more than one, because a list of five is a list nobody starts.
 */
export function todaysQuest(today: DayRoll, hydrationGoalMl: number): { title: string; ask: string; href: string; xp: number } {
  if (today.readings === 0)
    return { title: "One reading", ask: "Any time, any number. The number is not the quest; the logging is.", href: "/log/glucose", xp: 20 };
  if (!today.checkin)
    return { title: "Say how today is going", ask: "Three questions, about thirty seconds.", href: "/copilot/checkin", xp: 15 };
  if (today.meals === 0) return { title: "One plate", ask: "Log something you ate today.", href: "/log/meal", xp: 15 };
  if (today.moveMinutes < 15) return { title: "Fifteen minutes out", ask: "A walk counts. Round the block counts.", href: "/move", xp: 25 };
  if (!today.sleepLogged) return { title: "Last night", ask: "Ten seconds to log how you slept.", href: "/log/sleep", xp: 10 };
  if (today.waterMl < hydrationGoalMl) return { title: "Finish the water", ask: `${today.waterMl} ml so far of ${hydrationGoalMl}.`, href: "/log/water", xp: 15 };
  if (!today.journal) return { title: "Write one line", ask: "What today was actually like. One line is a whole entry.", href: "/copilot", xp: 20 };
  return { title: "Today is done", ask: "Everything you set out to do today is logged. Rest is also part of it.", href: "/quest", xp: 0 };
}

/* ------------------------------ rest & return ------------------------------ */

export type Standing = {
  /** Days since anything at all was logged. Zero when something was logged today. */
  away: number;
  /** Long enough away that the app must say something kind rather than nothing. */
  returning: boolean;
  headline: string;
  body: string;
};

/**
 * What to say to somebody who has been away.
 *
 * There is exactly one forbidden sentence in this function and it is "you lost your streak". Time
 * away from a health app is usually caused by the thing the health app is for: an illness, a hard
 * month, a hospital stay. Greeting that with a loss is how somebody deletes the app on the day
 * they most need it.
 */
export function standing(rolls: DayRoll[]): Standing {
  let away = 0;
  for (let i = rolls.length - 1; i >= 0; i--) {
    if (rolls[i].active) break;
    away++;
  }
  const everLogged = rolls.some((r) => r.active);
  if (!everLogged)
    return {
      away,
      returning: false,
      headline: "Your world is waiting to be started",
      body: "Nothing here is graded, and nothing is ever taken away. One reading opens the clearing.",
    };
  if (away >= 21)
    return {
      away,
      returning: true,
      headline: "Welcome back",
      body: "Your world has been waiting for you. Every tree, every path, every milestone is exactly where you left it. Some journeys have difficult chapters and your progress is not erased by them.",
    };
  if (away >= 7)
    return {
      away,
      returning: true,
      headline: "Welcome back",
      body: "You do not have to start over. You can continue. Nothing was lost while you were away.",
    };
  if (away >= 3)
    return {
      away,
      returning: true,
      headline: "Your journey is still here",
      body: `${away} days away, and everything you built is still standing. Pick it up wherever is easiest.`,
    };
  return { away, returning: false, headline: "", body: "" };
}

/** The award for coming back. Earned for returning, which is the hardest single thing in this app. */
export function beginAgainAward(rolls: DayRoll[]): { key: string; code: string; xp: number } | null {
  const s = standing(rolls);
  const last = rolls[rolls.length - 1];
  if (!last?.active) return null; // they are back only once something is logged
  // Count the gap that ended today, not the current run.
  let gap = 0;
  for (let i = rolls.length - 2; i >= 0; i--) {
    if (rolls[i].active) break;
    gap++;
  }
  if (gap < 3 || s.away > 0) return null;
  return { key: `begin_again:${rolls[rolls.length - 1].date}`, code: "begin_again", xp: 150 };
}

/* ------------------------------- achievements ------------------------------ */

/**
 * The named achievements, in the order a person meets them. These are the emotional ones; the
 * ledger already holds the mechanical awards. Every title here is about what the person did, and
 * not one of them is about a reading.
 */
export const ACHIEVEMENTS: { code: string; title: string; line: string }[] = [
  { code: "log", title: "First Step", line: "You logged something. That is the whole of it." },
  { code: "full_day", title: "Showed Up", line: "A complete day, logged end to end." },
  { code: "streak3", title: "Keep Going", line: "Three days running." },
  { code: "week5", title: "One Day at a Time", line: "Five days in one week." },
  { code: "streak7", title: "Weekend Warrior", line: "A whole week without a gap." },
  { code: "streak30", title: "30 Days of Consistency", line: "A month of showing up." },
  { code: "streak100", title: "New Horizons", line: "One hundred days." },
  { code: "begin_again", title: "Begin Again", line: "Coming back is part of the journey." },
  { code: "appt_prep", title: "Courage", line: "You walked into the room prepared." },
  { code: "discovery", title: "First Discovery", line: "You noticed something and wrote it down." },
  { code: "trend_tir", title: "Moving Forward", line: "Your own trend, moving in a better direction." },
  { code: "hold_steady", title: "Mountain Climber", line: "You held a good fortnight in place." },
  { code: "quest_explore", title: "Explorer", line: "You went somewhere new on purpose." },
  { code: "week7", title: "World Builder", line: "Seven days out of seven." },
];

export function achievementFor(code: string): { title: string; line: string } | null {
  const a = ACHIEVEMENTS.find((x) => x.code === code);
  return a ? { title: a.title, line: a.line } : null;
}

/** The week's days, for quest checking. Monday through today. */
export function thisWeek(rolls: DayRoll[], now: Date): DayRoll[] {
  const wk = weekKey(now);
  return rolls.filter((d) => weekKey(parseDateKey(d.date)) === wk);
}
