/**
 * SYNTHETIC USERS — a year of Life Quest, five ways.
 *
 *   npm run simulate            a summary table for every persona
 *   npm run simulate -- --days 90 --persona weekend    one persona, in detail
 *
 * WHY THIS EXISTS. Every engine in this feature is tested for correctness on the day it runs. None
 * of that answers the only question that decides whether the product works: is it still worth
 * opening on day 200? A unit test cannot see a quest pool that exhausts in six weeks, a level curve
 * that stalls, or a world that goes silent for a month, because each of those is a property of a
 * sequence rather than of a call.
 *
 * So this drives the real engines, unmodified, over a year of synthetic days and reports what a
 * person would actually experience. It runs entirely in memory: the engines are pure, so no
 * database is involved and the whole year takes about a second.
 *
 * It is deliberately a REPORT rather than a pass/fail. The findings it surfaces are design
 * questions, and a script that turned them into a red build would just get its thresholds loosened.
 * `tests/simulation.test.ts` pins the handful that are genuinely regressions.
 */
import { buildJourney, rollDays, levelForXp, type JourneyInput } from "../src/lib/engines/journey";
import { weeklyAdventure, thisWeek, todaysQuest, standing, NOVELTY_WEEKS } from "../src/lib/engines/lifequest";
import { tickWorld } from "../src/lib/engines/world";
import { dateKey, addDays, weekKey } from "../src/lib/time";

/* ------------------------------- the personas ------------------------------ */

export type Persona = {
  key: string;
  name: string;
  note: string;
  /** Does this person log on this day? `i` is days since they started. */
  logs: (i: number) => boolean;
  /** How complete is a day they do log? */
  depth: "full" | "glucose_only" | "mixed";
  /** Their glucose on day `i`, as a mean the day varies around. */
  mean: (i: number) => number;
};

export const PERSONAS: Persona[] = [
  {
    key: "steady",
    name: "Steady",
    note: "logs most days, misses the odd one",
    logs: (i) => i % 9 !== 4,
    depth: "full",
    mean: (i) => 165 - Math.min(35, i * 0.12),
  },
  {
    key: "weekend",
    name: "Weekend",
    note: "only has time at weekends",
    logs: (i) => i % 7 === 5 || i % 7 === 6,
    depth: "mixed",
    mean: () => 170,
  },
  {
    key: "returning",
    name: "Returning",
    note: "three weeks on, three weeks gone, repeatedly",
    logs: (i) => i % 42 < 21,
    depth: "full",
    mean: () => 160,
  },
  {
    key: "perfect",
    name: "Perfect",
    note: "logs everything every single day, the upper bound",
    logs: () => true,
    depth: "full",
    mean: (i) => 175 - Math.min(45, i * 0.14),
  },
  {
    key: "sparse",
    name: "Sparse",
    note: "about one day in five, never more",
    logs: (i) => i % 5 === 0,
    depth: "glucose_only",
    mean: () => 185,
  },
];

/* ------------------------------ building a life ---------------------------- */

const START = new Date(2026, 0, 1, 8, 0);

/** Deterministic wobble, so a run is reproducible and two runs can be compared. */
function wobble(i: number, spread: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * spread;
}

/** Everything the engines need, for a person `days` into their journey. */
function lifeAt(p: Persona, days: number): JourneyInput {
  const now = addDays(START, days);
  const readings: { at: Date; valueMgdl: number }[] = [];
  const meals: { at: Date }[] = [];
  const exercise: { at: Date; minutes: number }[] = [];
  const sleep: { wakeDate: string }[] = [];
  const hydration: { at: Date; ml: number }[] = [];
  const checkins: { date: string }[] = [];

  for (let i = 0; i <= days; i++) {
    if (!p.logs(i)) continue;
    const day = addDays(START, i);
    const m = p.mean(i);
    for (const h of [8, 12, 17, 21]) {
      readings.push({ at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), h), valueMgdl: Math.round(m + wobble(i * 4 + h, 70)) });
    }
    if (p.depth === "glucose_only") continue;
    meals.push({ at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 13) });
    if (p.depth === "full" || i % 2 === 0) {
      exercise.push({ at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18), minutes: 30 });
      sleep.push({ wakeDate: dateKey(day) });
      hydration.push({ at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 11), ml: 2200 });
      checkins.push({ date: dateKey(day) });
    }
  }

  return {
    now,
    targetLow: 70,
    targetHigh: 180,
    hydrationGoalMl: 2000,
    readings,
    meals,
    exercise,
    sleep,
    hydration,
    checkins,
    journal: [],
    appointmentsPrepped: [],
  };
}

/* --------------------------------- the run --------------------------------- */

export type DayReport = {
  day: number;
  date: string;
  level: number;
  xp: number;
  gems: number;
  newAwards: number;
  newWorldEvents: number;
  questTitle: string;
  /** Nothing earned and nothing happened. The day the app had nothing to say. */
  dead: boolean;
};

export type Run = {
  persona: Persona;
  days: DayReport[];
  /** Every distinct award key ever earned, which is what the ledger would hold. */
  awardKeys: Set<string>;
  worldKeys: Set<string>;
  /** Weekly adventure quest codes in order, for repetition analysis. */
  questCodes: string[];
  landmarksSeen: number;
};

export function simulate(p: Persona, days: number): Run {
  const awardKeys = new Set<string>();
  const worldKeys = new Set<string>();
  const questCodes: string[] = [];
  const seenWeeks = new Set<string>();
  const out: DayReport[] = [];
  let xp = 0;
  let gems = 0;
  let landmarks = 0;

  for (let d = 0; d < days; d++) {
    const input = lifeAt(p, d);
    const report = buildJourney(input);
    const rolls = rollDays(input);

    let newAwards = 0;
    for (const a of report.awards) {
      if (awardKeys.has(a.key)) continue;
      awardKeys.add(a.key);
      xp += a.xp;
      gems += a.gems;
      newAwards++;
    }

    const level = levelForXp(xp);
    let newWorld = 0;
    for (const e of tickWorld({ now: input.now, level, rolls, away: standing(rolls).away, theme: "forest" })) {
      if (worldKeys.has(e.key)) continue;
      worldKeys.add(e.key);
      if (e.kind === "landmark") landmarks++;
      newWorld++;
    }

    const wk = weekKey(input.now);
    if (!seenWeeks.has(wk)) {
      seenWeeks.add(wk);
      // The same novelty window the data layer applies, so the simulation measures the real thing.
      const recent = questCodes.slice(-3 * NOVELTY_WEEKS);
      for (const q of weeklyAdventure(input.now, thisWeek(rolls, input.now), recent).quests) questCodes.push(q.code);
    }

    const today = rolls[rolls.length - 1];
    out.push({
      day: d,
      date: dateKey(input.now),
      level,
      xp,
      gems,
      newAwards,
      newWorldEvents: newWorld,
      questTitle: todaysQuest(today, input.hydrationGoalMl).title,
      dead: newAwards === 0 && newWorld === 0,
    });
  }

  return { persona: p, days: out, awardKeys, worldKeys, questCodes, landmarksSeen: landmarks };
}

/* ------------------------------- the findings ------------------------------ */

export type Findings = {
  persona: string;
  levelAt: Record<string, number>;
  xpAt: Record<string, number>;
  gems: number;
  /** The longest run of consecutive days on which the app had nothing new at all. */
  longestDeadRun: number;
  deadDays: number;
  /** Distinct quest codes offered, against how many the pool holds. */
  questVariety: number;
  /** The most any single quest code was offered. */
  questMaxRepeat: number;
  /** Distinct world events across the run. */
  worldEvents: number;
  /** How many days passed before the world had anything to say at all. */
  firstWorldEventDay: number | null;
  landmarks: number;
};

export function analyse(run: Run): Findings {
  const at: Record<string, number> = {};
  const xpAt: Record<string, number> = {};
  for (const mark of [1, 7, 30, 90, 365]) {
    const d = run.days[Math.min(run.days.length - 1, mark - 1)];
    if (d && run.days.length >= mark) {
      at[`d${mark}`] = d.level;
      xpAt[`d${mark}`] = d.xp;
    }
  }

  let longest = 0;
  let cur = 0;
  let deadDays = 0;
  for (const d of run.days) {
    if (d.dead) {
      cur++;
      deadDays++;
      if (cur > longest) longest = cur;
    } else cur = 0;
  }

  const counts = new Map<string, number>();
  for (const c of run.questCodes) counts.set(c, (counts.get(c) ?? 0) + 1);

  const first = run.days.find((d) => d.newWorldEvents > 0);

  return {
    persona: run.persona.name,
    levelAt: at,
    xpAt,
    gems: run.days[run.days.length - 1]?.gems ?? 0,
    longestDeadRun: longest,
    deadDays,
    questVariety: counts.size,
    questMaxRepeat: Math.max(0, ...counts.values()),
    worldEvents: run.worldKeys.size,
    firstWorldEventDay: first ? first.day : null,
    landmarks: run.landmarksSeen,
  };
}

/* ---------------------------------- output --------------------------------- */

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

function main() {
  const args = process.argv.slice(2);
  const daysArg = args.indexOf("--days");
  const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 365;
  const only = args.indexOf("--persona") >= 0 ? args[args.indexOf("--persona") + 1] : null;
  const list = only ? PERSONAS.filter((p) => p.key === only) : PERSONAS;

  console.log(`\nLIFE QUEST — ${days} simulated days, ${list.length} persona${list.length === 1 ? "" : "s"}\n`);
  console.log(
    pad("persona", 11) + pad("d7", 5) + pad("d30", 5) + pad("d90", 5) + pad("d365", 6) + pad("xp", 9) + pad("gems", 6) + pad("quiet", 7) + pad("quests", 8) + "world",
  );
  console.log("-".repeat(78));

  const all: Findings[] = [];
  for (const p of list) {
    const f = analyse(simulate(p, days));
    all.push(f);
    console.log(
      pad(f.persona, 11) +
        pad(f.levelAt.d7 ?? "-", 5) +
        pad(f.levelAt.d30 ?? "-", 5) +
        pad(f.levelAt.d90 ?? "-", 5) +
        pad(f.levelAt.d365 ?? "-", 6) +
        pad((f.xpAt.d365 ?? f.xpAt.d90 ?? 0).toLocaleString(), 9) +
        pad(f.gems, 6) +
        pad(`${f.longestDeadRun}d`, 7) +
        pad(`${f.questVariety}/${f.questMaxRepeat}`, 8) +
        String(f.worldEvents),
    );
  }

  console.log("\nquiet  = longest run of days with nothing earned and nothing new in the world");
  console.log("quests = distinct quest codes offered / most times any one of them repeated");
  console.log("world  = distinct world events across the run\n");

  /* The things worth arguing about, stated rather than asserted. */
  console.log("FINDINGS");
  for (const f of all) {
    const notes: string[] = [];
    /*
     * Thresholds tuned to flag things worth arguing about rather than everything unusual. A report
     * that cries wolf on every run is a report nobody reads, and the first two versions of this
     * did exactly that: reaching the final region after eight months was listed as a problem when
     * it is the curve working.
     */
    const weeks = Math.max(1, Math.round(days / 7));
    if (f.longestDeadRun >= 7) notes.push(`${f.longestDeadRun} consecutive days with nothing to show`);
    if (f.questMaxRepeat > weeks * 0.4) notes.push(`one quest offered ${f.questMaxRepeat} times in ${weeks} weeks`);
    if (f.questVariety <= 4) notes.push(`only ${f.questVariety} distinct quests in ${days} days`);
    if (f.worldEvents <= 8) notes.push(`the world produced only ${f.worldEvents} events in ${days} days`);
    // The map running out is only a problem if it runs out EARLY.
    if (days >= 180 && (f.levelAt.d90 ?? 0) >= 12) notes.push(`opened the whole map by day 90 (level ${f.levelAt.d90})`);
    if ((f.levelAt.d30 ?? 0) <= 1 && (f.xpAt.d30 ?? 0) > 0) notes.push(`still level 1 after a month on ${f.xpAt.d30} XP`);
    console.log(`  ${pad(f.persona, 11)} ${notes.length ? notes.join("; ") : "nothing alarming"}`);
  }
  console.log("");
}

if (process.argv[1]?.endsWith("simulate.ts")) main();
