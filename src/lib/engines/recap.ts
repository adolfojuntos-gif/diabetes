/**
 * THE RECAP — "look how far you have come".
 *
 * A sequence of beats built from the ledger and the logs, meant to be read slowly. This is the one
 * screen in the product whose job is emotional rather than informational, and that makes it the
 * one most at risk of lying, so the rules here are tighter than anywhere else:
 *
 *   EVERY BEAT MUST BE BACKED BY A ROW. A beat with no evidence is dropped, not softened. There is
 *   no "you have been doing great" beat, because there is no row that means that.
 *
 *   NO BEAT MAY GRADE A PERIOD. The recap of somebody's worst quarter and their best are the same
 *   shape: what they did, when, and what it built. A recap that congratulates good quarters is a
 *   recap that shames bad ones by omission.
 *
 *   A QUIET STRETCH IS PART OF THE STORY. Weeks away are shown as weeks away and named as such,
 *   followed by the return, because for most people the return is the most important thing in the
 *   whole sequence and hiding the gap would rob it of its meaning.
 *
 * Pure. Takes rows, returns beats.
 */
import { dateKey, addDays, startOfDay } from "../time";
import type { DayRoll } from "./journey";

export type BeatKind = "open" | "start" | "milestone" | "gap" | "return" | "growth" | "now" | "close";

export type Beat = {
  kind: BeatKind;
  /** Big line. Short enough to read in one look. */
  headline: string;
  /** One sentence under it. Always a fact, never a compliment. */
  line: string;
  /** The engine's figure behind the beat, shown small. Empty when the beat is a caption. */
  evidence: string;
  /** "YYYY-MM-DD" this beat sits at, for the timeline rail. Null for the opening and closing cards. */
  date: string | null;
  /** The level the world had reached by this beat, so the drawing can play forward. */
  level: number;
};

export type RecapInput = {
  now: Date;
  days: number;
  rolls: DayRoll[];
  /** The ledger, oldest first. */
  awards: { code: string; title: string; evidence: string; earnedAt: Date; xp: number; gems: number }[];
  /** Level reached at the end of the window, and at the start of it. */
  levelNow: number;
  levelThen: number;
  totalXp: number;
  gems: number;
  name: string;
};

/** How long a stretch with nothing logged has to be before it is worth naming. */
const GAP_DAYS = 5;

/** The codes worth stopping the sequence for, in the order they matter emotionally. */
const HEADLINE_CODES = new Set([
  "begin_again",
  "streak100",
  "streak60",
  "streak30",
  "trend_tir",
  "trend_lows",
  "hold_steady",
  "trend_mean",
  "trend_steady",
  "streak14",
  "week7",
  "appt_prep",
]);

function fmt(d: Date): string {
  return d.toLocaleDateString([], { month: "long", day: "numeric" });
}

export function buildRecap(input: RecapInput): Beat[] {
  const beats: Beat[] = [];
  const active = input.rolls.filter((r) => r.active);
  if (active.length === 0) return beats;

  const first = active[0];
  const firstDate = new Date(first.date + "T00:00:00");

  beats.push({
    kind: "open",
    headline: `${input.days} days ago`,
    line: "A smaller world, and somebody who had not done this yet.",
    evidence: "",
    date: null,
    level: input.levelThen,
  });

  beats.push({
    kind: "start",
    headline: "You started here",
    line: `On ${fmt(firstDate)} you logged something, and the ledger below this one has run unbroken since.`,
    evidence: `first entry in this window, ${first.date}`,
    date: first.date,
    level: input.levelThen,
  });

  /*
   * Gaps and returns, taken in pairs. A gap alone is never a beat: it only earns its place in the
   * sequence because somebody came back afterwards, and the beat is about the coming back.
   */
  let run = 0;
  let started = false;
  for (let i = 0; i < input.rolls.length; i++) {
    const r = input.rolls[i];
    if (!r.active) {
      // Days before the first entry are not a gap. Somebody who joined six weeks into the window
      // did not go quiet for six weeks, and calling it that would invent an absence.
      if (started) run++;
      continue;
    }
    if (started && run >= GAP_DAYS) {
      const gapStart = input.rolls[i - run];
      beats.push({
        kind: "gap",
        headline: `${run} quiet days`,
        line: "Nothing was logged, and nothing was lost. The world stayed exactly as you left it.",
        evidence: `no entries, ${gapStart.date} to ${input.rolls[i - 1].date}`,
        date: gapStart.date,
        level: input.levelThen,
      });
      beats.push({
        kind: "return",
        headline: "Then you came back",
        line: "This is the hardest single thing anybody does in an app like this, and you did it.",
        evidence: `logging resumed ${r.date}`,
        date: r.date,
        level: input.levelThen,
      });
    }
    run = 0;
    started = true;
  }

  /* The milestones, one per code, in the order they happened. */
  const seen = new Set<string>();
  for (const a of input.awards) {
    if (!HEADLINE_CODES.has(a.code) || seen.has(a.code)) continue;
    seen.add(a.code);
    beats.push({
      kind: "milestone",
      headline: a.title,
      line: `${fmt(a.earnedAt)}.`,
      evidence: a.evidence,
      date: dateKey(a.earnedAt),
      level: input.levelThen,
    });
  }

  beats.sort((x, y) => {
    if (x.date === null) return -1;
    if (y.date === null) return 1;
    return x.date.localeCompare(y.date);
  });

  /* Growth, stated as the difference between the two halves of the window. */
  const half = Math.floor(input.rolls.length / 2);
  const early = input.rolls.slice(0, half).filter((r) => r.active).length;
  const late = input.rolls.slice(half).filter((r) => r.active).length;
  if (early > 0 || late > 0) {
    beats.push({
      kind: "growth",
      headline: late > early ? "And it built up" : "And you kept at it",
      line:
        late > early
          ? `You logged on ${early} of the first ${half} days and ${late} of the last ${input.rolls.length - half}.`
          : `You logged on ${early + late} of these ${input.rolls.length} days.`,
      evidence: `${input.totalXp.toLocaleString()} XP across the window`,
      date: null,
      level: Math.max(input.levelThen, Math.floor((input.levelThen + input.levelNow) / 2)),
    });
  }

  beats.push({
    kind: "now",
    headline: "Here is where you are",
    line:
      input.levelNow > input.levelThen
        ? `Level ${input.levelThen} then. Level ${input.levelNow} now.`
        : `Level ${input.levelNow}, held through all of it.`,
    evidence: `${active.length} days logged · ${input.totalXp.toLocaleString()} XP · ${input.gems} progress gem${input.gems === 1 ? "" : "s"}`,
    date: dateKey(input.now),
    level: input.levelNow,
  });

  beats.push({
    kind: "close",
    headline: "Look how far you have come",
    line: input.name ? `That was ${input.days} days, ${input.name}. The next one starts whenever you want it to.` : `That was ${input.days} days. The next one starts whenever you want it to.`,
    evidence: "",
    date: null,
    level: input.levelNow,
  });

  return beats;
}

/** The window's start, for loading. */
export function recapFrom(now: Date, days: number): Date {
  return addDays(startOfDay(now), -(days - 1));
}
