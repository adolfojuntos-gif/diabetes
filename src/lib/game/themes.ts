/**
 * THE WORLDS.
 *
 * Three places a person can be building, and the choice is theirs. Somebody who has never wanted to
 * climb anything should not be handed a mountain, and somebody who grew up on a coast should get
 * water. The point of the choice is not customisation for its own sake: it is that the picture has
 * to be a place THEY want to look at, or the whole emotional engine is decoration.
 *
 * WHAT A THEME MAY CHANGE: the palette, the terrain, what the milestones are called, and which
 * guardians speak. WHAT A THEME MAY NEVER CHANGE: what earns XP, what earns a gem, the thresholds,
 * the sufficiency gate, or a single word of clinical or safety copy. The rules live in
 * `engines/rules.ts` and are identical in every world, so two people at the same level have done
 * the same amount, whatever their sky looks like.
 *
 * This is also the seam that keeps the product from being diabetes-only. A theme is a skin over a
 * progress ledger that knows nothing about glucose; the day this engine is pointed at blood
 * pressure or sleep, the worlds come along unchanged.
 */

export const THEME_KEYS = ["forest", "coast", "city"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export type Theme = {
  key: ThemeKey;
  name: string;
  blurb: string;
  /** What the drawing calls its own parts, used in alt text and in the region copy. */
  terrain: "forest" | "coast" | "city";
  /** Twelve regions, one per level. Same count in every theme, so progression is identical. */
  regions: { level: number; name: string; blurb: string }[];
  /** Guardian keys from `engines/lifequest.ts`, in the order they take over. */
  guardians: string[];
};

export const THEMES: Record<ThemeKey, Theme> = {
  forest: {
    key: "forest",
    name: "The Wildwood",
    blurb: "Hills, trees and a river, with mountains further out than they look.",
    terrain: "forest",
    regions: [
      { level: 1, name: "The Clearing", blurb: "Where everyone starts. Bare ground, good light." },
      { level: 2, name: "First Path", blurb: "A track worn into the grass by walking it more than once." },
      { level: 3, name: "The Grove", blurb: "The first trees you planted are taller than you now." },
      { level: 4, name: "Stone Bridge", blurb: "Something you built to get over the thing that used to stop you." },
      { level: 5, name: "Riverbend", blurb: "Water wide enough to hear from the path." },
      { level: 6, name: "The Orchard", blurb: "Things planted a while ago, bearing." },
      { level: 7, name: "Highland Trail", blurb: "The ground starts to rise. You can see where you came from." },
      { level: 8, name: "The Falls", blurb: "Loud, cold, and worth the walk." },
      { level: 9, name: "Pine Ridge", blurb: "Above the tree line of where you began." },
      { level: 10, name: "The Summit", blurb: "Not the end. A place to stand and look back from." },
      { level: 11, name: "Lake of Stars", blurb: "Still water on the far side of the summit." },
      { level: 12, name: "The Far Country", blurb: "Everything past the map you were given." },
    ],
    guardians: ["forest", "river", "mountain", "night"],
  },
  coast: {
    key: "coast",
    name: "The Long Shore",
    blurb: "Open water, islands that appear as you go, and weather you can see coming.",
    terrain: "coast",
    regions: [
      { level: 1, name: "The Shingle", blurb: "A stretch of stones and the sea doing what it always does." },
      { level: 2, name: "The Tideline", blurb: "The mark of how far you got, left where you can see it." },
      { level: 3, name: "Dune Grass", blurb: "The first thing that grew here, and it holds the sand down." },
      { level: 4, name: "The Jetty", blurb: "You built something that goes out into the water." },
      { level: 5, name: "The Sound", blurb: "Deep enough now to carry a boat." },
      { level: 6, name: "Harbour Town", blurb: "Somewhere to come back to, with the lights on." },
      { level: 7, name: "The Headland", blurb: "High ground with the whole bay behind it." },
      { level: 8, name: "The Lighthouse", blurb: "Yours, and it is lit." },
      { level: 9, name: "The Outer Isles", blurb: "Places only reachable because you have a boat now." },
      { level: 10, name: "Open Water", blurb: "Not the end. The point from which everything is reachable." },
      { level: 11, name: "The Night Crossing", blurb: "Stars on the water and no hurry." },
      { level: 12, name: "The Far Shore", blurb: "Everything past the chart you were given." },
    ],
    guardians: ["forest", "river", "mountain", "night"],
  },
  city: {
    key: "city",
    name: "The Quarter",
    blurb: "Streets, rooftops and lit windows, and it fills in block by block.",
    terrain: "city",
    regions: [
      { level: 1, name: "The Empty Lot", blurb: "Hoarding, weeds, and good light in the afternoon." },
      { level: 2, name: "First Street", blurb: "One road, and it goes somewhere." },
      { level: 3, name: "The Corner", blurb: "A shop opened. Somebody swept outside it." },
      { level: 4, name: "The Overpass", blurb: "You built a way across the thing that used to be in the way." },
      { level: 5, name: "The Canal", blurb: "Water through the middle of it, with somewhere to sit." },
      { level: 6, name: "The Market", blurb: "Loud on a Saturday, which is the point." },
      { level: 7, name: "The Terraces", blurb: "The ground rises. You can see your first street from here." },
      { level: 8, name: "The Rooftops", blurb: "Above the noise, and still in it." },
      { level: 9, name: "The Skyline", blurb: "Recognisable from a distance now." },
      { level: 10, name: "The Observatory", blurb: "Not the end. Somewhere built for looking back from." },
      { level: 11, name: "The Night Quarter", blurb: "Every window you earned, lit at once." },
      { level: 12, name: "The Far District", blurb: "Everything past the map you were given." },
    ],
    guardians: ["forest", "river", "mountain", "night"],
  },
};

export const DEFAULT_THEME: ThemeKey = "forest";

export function themeOf(key: string | null | undefined): Theme {
  return THEMES[(key ?? DEFAULT_THEME) as ThemeKey] ?? THEMES[DEFAULT_THEME];
}
