/**
 * Helpers for /move. Pure, no DB, no React.
 *
 * The filter chips are written in the person's words ("I have 10 minutes") and each one resolves
 * to a predicate rather than a single tag string, because the seed content decides its own tag
 * vocabulary. A chip that finds nothing says so instead of looking broken.
 */
export const WEEKLY_MINUTES_GUIDELINE = 150;

export type IdeaLike = { kind: string; minutes: number; tags: string };

export function tagList(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function tagLabel(tag: string): string {
  return tag.replace(/[-_]/g, " ");
}

function hasTag(idea: IdeaLike, ...wanted: string[]): boolean {
  const list = tagList(idea.tags);
  return wanted.some((w) => list.includes(w));
}

function kindIs(idea: IdeaLike, ...kinds: string[]): boolean {
  const k = (idea.kind ?? "").trim().toLowerCase();
  return kinds.includes(k);
}

export type MoveChip = {
  key: string;
  label: string;
  /** Null means "everything". */
  match: ((idea: IdeaLike) => boolean) | null;
};

export const MOVE_CHIPS: readonly MoveChip[] = [
  { key: "all", label: "All", match: null },
  {
    key: "10min",
    label: "I have 10 minutes",
    match: (i) => i.minutes <= 10 || hasTag(i, "quick", "10min", "short"),
  },
  { key: "after_meal", label: "After a meal", match: (i) => hasTag(i, "after_meal", "post_meal", "after-meal") },
  { key: "low_energy", label: "Low energy today", match: (i) => hasTag(i, "low_energy", "low-energy", "gentle", "restful") },
  { key: "no_equipment", label: "No equipment", match: (i) => hasTag(i, "no_equipment", "no-equipment", "bodyweight") },
  { key: "desk", label: "At my desk", match: (i) => hasTag(i, "desk", "seated", "chair", "office", "work") },
  { key: "travel", label: "Travelling", match: (i) => hasTag(i, "travel", "hotel", "airport") },
  {
    key: "kids",
    label: "With the kids",
    match: (i) => hasTag(i, "kids", "family", "play", "playful") || kindIs(i, "play"),
  },
];

export function chipFor(key: string | null): MoveChip {
  if (!key) return MOVE_CHIPS[0];
  return MOVE_CHIPS.find((c) => c.key === key.toLowerCase()) ?? MOVE_CHIPS[0];
}

export const INTENSITY_LABEL: Record<string, string> = {
  light: "Light",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

/**
 * Intensity pills use neutral, juniper and slate only. Coral and amber belong to glucose bands and
 * safety levels and are never borrowed for anything else.
 */
export const INTENSITY_PILL: Record<string, string> = {
  light: "pill",
  moderate: "pill pill-juniper",
  vigorous: "pill pill-slate",
};

export function intensityLabel(v: string): string {
  return INTENSITY_LABEL[v] ?? v.replace(/[-_]/g, " ");
}

export function intensityPill(v: string): string {
  return INTENSITY_PILL[v] ?? "pill";
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return String(Math.round(v));
}

export function firstParam(p: string | string[] | undefined): string | null {
  if (Array.isArray(p)) return p.length ? p[0] : null;
  return typeof p === "string" ? p : null;
}
