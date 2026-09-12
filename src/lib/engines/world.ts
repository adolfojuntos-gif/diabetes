/**
 * THE LIVING WORLD.
 *
 * Before this file the world was `worldState(level, gems)`: a pure function of two integers. It was
 * honest and it was dead. Nothing could appear in it, nothing could be found, and it could not
 * answer the only question that makes somebody open an app twice, which is "what changed?".
 *
 * So the world now has a MEMORY, and the memory is a ledger of events rather than a bag of mutable
 * fields. Same discipline as the award ledger next door, for the same reasons: a ledger can only be
 * wrong in a way you can read line by line, it cannot drift, and a retry cannot double-count it.
 * What the drawing shows is still derived — from history now, instead of from a level.
 *
 * THREE RULES THIS FILE IS BUILT ON:
 *
 * 1. DETERMINISTIC, NEVER RANDOM. Every event key contains the day or week it belongs to, and every
 *    "chance" is a hash of that key. Opening the app twice on a Tuesday shows the same Tuesday. A
 *    world that rolled dice per request would hand out a different history to every reload, and a
 *    person could farm rare moments by refreshing.
 *
 * 2. NOTHING HERE EVER ASKS FOR ATTENTION AT A PARTICULAR MOMENT. Sightings land on days the person
 *    already logged something, and are found when they next open the app. The world never creates a
 *    reason to check at 11pm, because a health product that trains people to check their phone at
 *    11pm has done them harm whatever its retention numbers say.
 *
 * 3. NOTHING HERE IS CLINICAL AND NOTHING HERE SCOLDS. A visitor arriving is not a health event, an
 *    absence is never named as a failure, and no line in this file mentions a reading, a number or
 *    a target. The safety engine and the Copilot own all of that.
 */
import { dateKey, weekKey } from "../time";
import type { DayRoll } from "./journey";

/** Bumped when what the world can produce changes. Stamped on every row it writes. */
export const WORLD_ENGINE_VERSION = "1.0.0";

export const WORLD_EVENT_KINDS = ["growth", "arrival", "sighting", "landmark", "season"] as const;
export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number];

export type WorldEventDraft = {
  /** Unique and date-anchored, so the same day can only ever produce it once. */
  key: string;
  kind: WorldEventKind;
  title: string;
  body: string;
  /** The moment it belongs to. */
  at: Date;
};

export type WorldTickInput = {
  now: Date;
  level: number;
  /** Days, oldest first, across the habit window. */
  rolls: DayRoll[];
  /** How many consecutive days ended with nothing logged, counting back from today. */
  away: number;
  theme: "forest" | "coast" | "city";
};

/**
 * A stable hash. The same string always produces the same number, so "one week in three" is a
 * property of the week rather than of the moment somebody happened to load the page.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic "one in n", keyed to a string. */
function chance(key: string, oneIn: number): boolean {
  return hash(key) % oneIn === 0;
}

function pick<T>(key: string, list: readonly T[]): T {
  return list[hash(key) % list.length];
}

/* ------------------------------- the cast --------------------------------- */

/**
 * People who pass through. They are inhabitants of somebody's adventure and explicitly NOT
 * clinicians: none of them may ever be given a line about health, and none of the lines below is.
 */
const VISITORS: Record<WorldTickInput["theme"], { name: string; role: string; line: string }[]> = {
  forest: [
    { name: "Odda", role: "the Cartographer", line: "She is drawing the valley properly for the first time, and she wants to know what you have called things." },
    { name: "Bram", role: "the Gardener", line: "He left cuttings by the path. He says they take better here than where he came from." },
    { name: "Silla", role: "the Stargazer", line: "She has been following one particular star west and has stopped to watch it from your ridge." },
    { name: "Hal", role: "the Builder", line: "He looked at what you have put up, nodded once, and started unloading timber." },
  ],
  coast: [
    { name: "Meret", role: "the Ferryman", line: "She works the crossing when the water allows it, which this week it does." },
    { name: "Nils", role: "the Netmaker", line: "He has set up on the shingle and says the light here is better for the work." },
    { name: "Odda", role: "the Cartographer", line: "The coastline on her chart is wrong, and she has come to fix it." },
    { name: "Tove", role: "the Beachcomber", line: "She walks the tideline every morning and keeps what the sea leaves." },
  ],
  city: [
    { name: "Joss", role: "the Archivist", line: "He is recording what was here before, which turns out to be more than anyone thought." },
    { name: "Rae", role: "the Baker", line: "She took the corner unit. The whole street smells different in the mornings now." },
    { name: "Odda", role: "the Cartographer", line: "She is mapping the quarter street by street and keeps finding alleys that are not on anything." },
    { name: "Kit", role: "the Busker", line: "He plays under the overpass because the sound is better there, and he is right." },
  ],
};

/** Uncommon things that were there to be noticed. Never urgent, never timed. */
const SIGHTINGS: Record<WorldTickInput["theme"], { title: string; body: string }[]> = {
  forest: [
    { title: "A deer on the path", body: "It was standing in the middle of the track at dawn and did not move for a long time." },
    { title: "The valley under cloud", body: "The whole floor filled with mist overnight and only the ridge was above it." },
    { title: "Meteors over the ridge", body: "Three or four an hour, all night, from the north." },
    { title: "The old boundary stone", body: "Something carved, half under moss, from long before any of this." },
  ],
  coast: [
    { title: "Phosphorescence", body: "Every wave lit up green where it broke. It lasted about an hour." },
    { title: "A whale, far out", body: "Twice, then nothing. Long enough to be sure it was not a wave." },
    { title: "The tide went further out than usual", body: "Sand where there is never sand, and a wreck rib showing." },
    { title: "Terns came back", body: "The whole colony at once, the way they do, overnight." },
  ],
  city: [
    { title: "The river went still", body: "No wind for one evening and the whole quarter was in the water upside down." },
    { title: "A fox on the overpass", body: "Sitting in the middle of it at four in the morning, entirely unbothered." },
    { title: "Someone painted the end wall", body: "It was grey on Tuesday. It is not grey now." },
    { title: "Snow that stayed", body: "An hour of it, and for once it settled on the rooftops instead of melting." },
  ],
};

/** Landmarks that become visible as the map opens. One per region, from level three. */
const LANDMARKS: Record<WorldTickInput["theme"], string[]> = {
  forest: ["a standing stone at the treeline", "a footbridge over the stream", "a hollow with a spring in it", "an old charcoal burner's clearing", "a ruined wall running uphill", "a cairn on the shoulder of the ridge", "a tarn below the summit", "a track heading north out of the map"],
  coast: ["a marker post above the tideline", "a boathouse nobody has used in years", "a rock pool that never empties", "a stack out beyond the point", "a bell on the harbour wall", "a path cut into the cliff", "a beacon site on the headland", "a chart showing water past the edge"],
  city: ["a mural under the arches", "a bench facing the wrong way on purpose", "a courtyard behind a door", "a disused platform", "a clock that is right twice a day", "a rooftop with the gate left open", "a bridge nobody uses any more", "a street that is not on the map"],
};

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

export function seasonOf(d: Date): Season {
  const m = d.getMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

const SEASON_LINE: Record<Season, string> = {
  winter: "The light goes early now and the ground is hard in the mornings.",
  spring: "Everything that was waiting has started at once.",
  summer: "Long evenings, and the whole place is open.",
  autumn: "The colour turned this week. It always seems to happen overnight.",
};

/* --------------------------------- the tick -------------------------------- */

/**
 * Everything the world has to say today, as drafts. The caller writes them idempotently; running
 * this twice on the same day produces the same keys and therefore nothing new.
 *
 * Deliberately quiet. On a typical day this returns nothing at all, because a world that has news
 * every single time you open it has no news.
 */
export function tickWorld(input: WorldTickInput): WorldEventDraft[] {
  const out: WorldEventDraft[] = [];
  const today = dateKey(input.now);
  const wk = weekKey(input.now);
  const last = input.rolls[input.rolls.length - 1];
  const loggedToday = Boolean(last?.active);

  /*
   * SOMETHING GREW WHILE YOU WERE AWAY.
   *
   * Fires on the day somebody comes back after a real absence, and it is the most important line in
   * this file. The world kept going, nothing was lost, and that is stated as a fact about the place
   * rather than as reassurance about them, which is the difference between being welcomed and being
   * consoled.
   */
  const gap = gapEndingToday(input.rolls);
  if (loggedToday && gap >= 5) {
    out.push({
      key: `growth:${today}`,
      kind: "growth",
      title: "It kept going without you",
      body:
        gap >= 21
          ? `${gap} days, and the place looks it. Things grew, the light moved round, and everything you built is exactly where you left it.`
          : `${gap} days of it carrying on by itself. Nothing here was waiting on you, and nothing here was lost.`,
      at: input.now,
    });
  }

  /*
   * A VISITOR. Only once there is somewhere worth arriving at, and only in some weeks: a traveller
   * who turns up every single week is a fixture, not a traveller.
   */
  if (input.level >= 6 && chance(`visitor:${wk}`, 3)) {
    const v = pick(`who:${wk}`, VISITORS[input.theme]);
    out.push({
      key: `arrival:${wk}`,
      kind: "arrival",
      title: `${v.name} arrived, ${v.role}`,
      body: v.line,
      at: input.now,
    });
  }

  /*
   * A SIGHTING. Uncommon, and gated on having logged that day, which is the anti-manipulation rule
   * made concrete: the world can only show you something on a day you were already here. It cannot
   * become a reason to open the app at a particular hour, because it is found rather than timed.
   */
  if (loggedToday && chance(`sighting:${today}`, 11)) {
    const s = pick(`what:${today}`, SIGHTINGS[input.theme]);
    out.push({ key: `sighting:${today}`, kind: "sighting", title: s.title, body: s.body, at: input.now });
  }

  /* A LANDMARK becomes visible with each region from the third. Anchored to the level, not a day. */
  if (input.level >= 3) {
    const idx = Math.min(LANDMARKS[input.theme].length - 1, input.level - 3);
    out.push({
      key: `landmark:${input.theme}:${input.level}`,
      kind: "landmark",
      title: "Something is visible from here now",
      body: `From this far along you can see ${LANDMARKS[input.theme][idx]}.`,
      at: input.now,
    });
  }

  /* THE SEASON. Once per season per year, and it changes the light rather than asking for anything. */
  const season = seasonOf(input.now);
  out.push({
    key: `season:${season}:${input.now.getFullYear()}`,
    kind: "season",
    title: seasonTitle(season),
    body: SEASON_LINE[season],
    at: input.now,
  });

  return out;
}

function seasonTitle(s: Season): string {
  return s === "winter" ? "Winter" : s === "spring" ? "Spring" : s === "summer" ? "Summer" : "Autumn";
}

/** The run of empty days immediately before today, when today itself is active. */
export function gapEndingToday(rolls: DayRoll[]): number {
  if (rolls.length === 0 || !rolls[rolls.length - 1].active) return 0;
  let gap = 0;
  for (let i = rolls.length - 2; i >= 0; i--) {
    if (rolls[i].active) break;
    gap++;
  }
  return gap;
}

/* ------------------------------ what it builds ----------------------------- */

/**
 * What the ledger adds to the drawing. The world is still derived, but from its own history rather
 * than from a level, which is the whole point: two people at level 7 no longer have identical
 * worlds, because they have not lived in them identically.
 */
export type WorldExtras = {
  /** People who have arrived and stayed. */
  visitors: number;
  /** Landmarks that have become visible. */
  landmarks: number;
  /** Uncommon things noticed, which is what puts lights in the sky. */
  sightings: number;
  season: Season;
};

export function worldExtras(events: { kind: string }[], now: Date): WorldExtras {
  let visitors = 0;
  let landmarks = 0;
  let sightings = 0;
  for (const e of events) {
    if (e.kind === "arrival") visitors++;
    else if (e.kind === "landmark") landmarks++;
    else if (e.kind === "sighting") sightings++;
  }
  return { visitors, landmarks, sightings, season: seasonOf(now) };
}

/**
 * The "what's new" line for the top of the world.
 *
 * Returns null when there is genuinely nothing, and the screen then says nothing, because inventing
 * news is how a discovery feed becomes noise that people learn to skip.
 */
export function whatsNew(unseen: { kind: string; title: string }[]): string | null {
  if (unseen.length === 0) return null;
  if (unseen.length === 1) return unseen[0].title;
  return `${unseen[0].title}, and ${unseen.length - 1} other thing${unseen.length - 1 === 1 ? "" : "s"}`;
}
