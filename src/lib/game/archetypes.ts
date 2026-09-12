/**
 * WHO YOU ARE HERE.
 *
 * A person with diabetes is asked to be a patient all day. This is the one screen in the product
 * where they get to be something else, and the choice is theirs rather than inferred: nothing in
 * this file reads a reading, a trend, or a diagnosis to decide what somebody is like.
 *
 * WHAT AN ARCHETYPE MAY CHANGE: which quests come up more often, what the guardian calls them, and
 * which of the seven identities their work reads against first.
 *
 * WHAT IT MAY NEVER CHANGE: what anything is worth. An Explorer's walk and a Builder's walk earn
 * the same XP, level 7 costs the same either way, and no archetype can reach a milestone another
 * cannot. It changes what the app OFFERS, never what it PAYS, and `tests/archetype.test.ts` holds
 * that line. The alternative is a product where picking wrong at signup quietly costs you months,
 * and nobody would ever be told.
 *
 * IT IS ALSO NOT A PERSONALITY TEST. There is no wrong answer, no scoring, and it can be changed
 * whenever somebody likes, because what a person wants out of this in March is not what they wanted
 * in January.
 */
import type { DimensionKey } from "../engines/lifequest";

export const ARCHETYPE_KEYS = ["explorer", "builder", "scholar", "wanderer", "guardian", "maker"] as const;
export type ArchetypeKey = (typeof ARCHETYPE_KEYS)[number];

export type Archetype = {
  key: ArchetypeKey;
  name: string;
  /** One line, in their own terms, with no health framing at all. */
  line: string;
  /** What this looks like in practice, so the choice is informed rather than a vibe. */
  detail: string;
  /**
   * Quest codes this person sees more of. A bias on the ORDER of an already-ranked list, never a
   * filter: every quest stays reachable by every archetype, or the choice becomes a lock.
   */
  favours: string[];
  /** The identity their work reads against first, shown at the top of the seven. */
  leads: DimensionKey;
  glyph: string;
};

export const ARCHETYPES: Archetype[] = [
  {
    key: "explorer",
    name: "The Explorer",
    line: "You would rather be outside, and you would rather not go the same way twice.",
    detail: "More walking, more new routes, more reasons to look at something you have not seen before.",
    favours: ["quest_explore", "quest_route", "quest_move", "quest_discover", "quest_blue"],
    leads: "explorer",
    glyph: "🧭",
  },
  {
    key: "builder",
    name: "The Builder",
    line: "You like a system that works, and you like having built it yourself.",
    detail: "More routine, more planning ahead, more of the quiet scaffolding that makes a week hold together.",
    favours: ["quest_build", "quest_whole", "quest_pair", "quest_night"],
    leads: "builder",
    glyph: "🔨",
  },
  {
    key: "scholar",
    name: "The Scholar",
    line: "You want to understand what is actually happening, not just be told it is fine.",
    detail: "More questions worth asking, more of your own patterns explained, more preparation before a room.",
    favours: ["quest_learn", "quest_journal", "quest_pair"],
    leads: "learner",
    glyph: "📖",
  },
  {
    key: "wanderer",
    name: "The Wanderer",
    line: "You are not here to optimise anything. You are here because it is yours.",
    detail: "Fewer asks, gentler weeks, and more of the quests that are about noticing rather than achieving.",
    favours: ["quest_nothing", "quest_blue", "quest_discover", "quest_wellness"],
    leads: "wellness",
    glyph: "🍃",
  },
  {
    key: "guardian",
    name: "The Guardian",
    line: "There are people who depend on you being all right, and you know it.",
    detail: "More connection, more preparation, more of the things that make the people around you less frightened.",
    favours: ["quest_reach", "quest_checkin", "quest_learn"],
    leads: "courage",
    glyph: "🛡️",
  },
  {
    key: "maker",
    name: "The Maker",
    line: "You keep things. Notes, photographs, lists, the odd stone off a beach.",
    detail: "More collecting, more writing down, more of a record you will be glad of in a year.",
    favours: ["quest_discover", "quest_journal", "quest_blue"],
    leads: "discovery",
    glyph: "🗝️",
  },
];

export const DEFAULT_ARCHETYPE: ArchetypeKey = "wanderer";

export function archetypeOf(key: string | null | undefined): Archetype {
  return ARCHETYPES.find((a) => a.key === key) ?? ARCHETYPES.find((a) => a.key === DEFAULT_ARCHETYPE)!;
}

/**
 * How strongly an archetype tilts the quest ranking.
 *
 * Deliberately small, and the number matters. The gap weight is what makes a quest RELEVANT, and a
 * favourite that outranks relevance would mean an Explorer who has not logged a meal in a fortnight
 * gets offered another walk. The tilt is enough to break a tie and not enough to win an argument:
 * over a simulated year it changes which quests appear more often without ever making one
 * unreachable.
 */
export const FAVOUR_WEIGHT = 2;

/** Does this archetype favour this quest? Pure, so the ranking stays testable. */
export function favours(a: Archetype | null, code: string): boolean {
  return a ? a.favours.includes(code) : false;
}

/**
 * The seven identities, reordered so the one this person came for is first. The scores themselves
 * are untouched: this changes the reading order of a list and nothing about what is in it.
 */
export function leadFirst<T extends { key: DimensionKey }>(dimensions: T[], a: Archetype | null): T[] {
  if (!a) return dimensions;
  const lead = dimensions.find((d) => d.key === a.leads);
  return lead ? [lead, ...dimensions.filter((d) => d !== lead)] : dimensions;
}
