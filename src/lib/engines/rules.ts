/**
 * THE APPROVED RULE CONFIGURATION.
 *
 * Every threshold that decides a reward lives in this one file, versioned, so that a result
 * recorded last March can be reproduced with the rules that were in force last March. Nothing
 * anywhere else in the codebase may hard-code one of these numbers, and nothing may derive one
 * from a model.
 *
 * WHY A SEPARATE FILE. A threshold scattered across three engines is a threshold nobody can review.
 * A clinician who wants to know what this product calls "improvement" should be able to read one
 * screen and know, and the answer must not change silently in a deploy: it changes by bumping a
 * version below, which is then stamped onto every award row written under it.
 *
 * REVIEW STATUS IS PART OF THE CONFIGURATION, NOT A COMMENT. The habit rules reward behaviour and
 * need no clinical sign-off, because logging a meal is not a clinical claim. The trend rules
 * compare a person's own glucose fortnights and DO, so they carry `pending_clinical_review` until a
 * qualified clinician signs them off. The app is honest about that in the screens it shows; see
 * `TREND_REVIEW_NOTE`.
 */

/** Bumped when the arithmetic changes: what is counted, over what window, how it is summarised. */
export const ANALYTICS_ENGINE_VERSION = "1.0.0";

/** Bumped when what counts as "earned" changes: thresholds, amounts, eligibility. */
export const REWARD_RULE_VERSION = "1.0.0";

/** Bumped when a metric's DEFINITION changes, e.g. if "time in range" ever meant something else. */
export const METRIC_DEFINITION_VERSION = "1.0.0";

export type ReviewStatus = "not_required" | "pending_clinical_review" | "clinically_reviewed";

/**
 * DATA SUFFICIENCY. The gate every comparison passes before it is allowed to say anything.
 *
 * These are not clinical thresholds; they are statistical honesty. Comparing a fortnight with four
 * readings against a fortnight with forty produces a number, and the number is meaningless, so the
 * engine refuses rather than producing it with a caveat nobody reads.
 */
export const SUFFICIENCY = {
  /** Distinct local days carrying at least one reading, in EACH window. */
  minDays: 7,
  /** Readings in EACH window. */
  minReadings: 14,
  /** The length of each side of a comparison, in days. */
  windowDays: 14,
  reviewStatus: "not_required" as ReviewStatus,
};

/**
 * Data quality, reported alongside every comparison so the language can be adapted to it. The
 * engine never hides uncertainty and never upgrades it.
 */
export const QUALITY_BANDS = {
  /** Readings on at least this fraction of the days in the window, in BOTH windows. */
  highDayCoverage: 0.85,
  moderateDayCoverage: 0.6,
} as const;

export type DataQuality = "high" | "moderate" | "low" | "insufficient";

export type AnalysisStatus = "VALID" | "INSUFFICIENT_DATA";

/**
 * TREND MILESTONE CRITERIA.
 *
 * Each entry is one rule: what it compares, by how much it must move, and what it pays. Every one
 * of them compares a person against THEIR OWN previous window and nothing else. None compares
 * against a target, a population, or another person, and none can ever be satisfied by a single
 * reading, because every input is an aggregate over a fortnight.
 *
 * `pending_clinical_review` on all of them is deliberate and load-bearing: these numbers were
 * chosen to be conservative, they are not lifted from a guideline that defines a reward, and the
 * product must not imply a clinician has approved them until one has.
 */
export const TREND_RULES = {
  /** Percentage points of time in range gained against the previous window. */
  tirGainPoints: 5,
  /** mg/dL that the mean must move TOWARD the person's own target band. */
  meanTowardRangeMgdl: 10,
  /** Percentage points of coefficient of variation removed. */
  cvDropPoints: 3,
  /** Lows must fall to at most this share of the previous window's rate, which must be non-trivial. */
  lowsRemainingFraction: 0.6,
  lowsPriorMinimum: 2,
  /** Holding: already at or above this time in range, and moved less than `tirGainPoints` either way. */
  holdTirFloor: 70,
  /** Extra days with readings against the previous window. */
  consistencyExtraDays: 3,
  reviewStatus: "pending_clinical_review" as ReviewStatus,
} as const;

/** What every screen showing a trend milestone must say alongside it, while review is pending. */
export const TREND_REVIEW_NOTE =
  "These comparisons are computed by Steady's own engine from your logs. The thresholds that decide when a comparison counts as a milestone have not yet been reviewed by a clinician, so treat a milestone as an observation about your own data and not as a clinical finding.";

/** XP for things the person chose to do. No clinical review needed: none of these is a health claim. */
export const HABIT_RULES = {
  log: 20,
  meal: 15,
  move: 25,
  sleep: 10,
  water: 15,
  checkin: 15,
  journal: 20,
  full_day: 50,
  week5: 100,
  week7: 150,
  appt_prep: 120,
  discovery: 50,
  begin_again: 150,
  /** Minutes of movement in a day before it counts. */
  moveMinutes: 15,
  reviewStatus: "not_required" as ReviewStatus,
} as const;

export const STREAK_RULES: { days: number; xp: number; gems: number; title: string }[] = [
  { days: 3, xp: 60, gems: 0, title: "Three days running" },
  { days: 7, xp: 150, gems: 0, title: "A full week of showing up" },
  { days: 14, xp: 300, gems: 1, title: "Two weeks running" },
  { days: 30, xp: 600, gems: 1, title: "Thirty days" },
  { days: 60, xp: 1000, gems: 2, title: "Sixty days" },
  { days: 100, xp: 1800, gems: 3, title: "One hundred days" },
];

/**
 * Provenance carried by every award row, so any reward in the ledger can be explained months later:
 * which rules produced it, over which window, from how many records, at what data quality.
 */
export type Provenance = {
  engineVersion: string;
  ruleVersion: string;
  metricVersion: string;
  /** Records the calculation actually consumed. */
  sampleSize: number;
  windowFrom: Date | null;
  windowTo: Date | null;
  compareFrom: Date | null;
  compareTo: Date | null;
  dataQuality: DataQuality;
};

export function provenance(over: Partial<Provenance> = {}): Provenance {
  return {
    engineVersion: ANALYTICS_ENGINE_VERSION,
    ruleVersion: REWARD_RULE_VERSION,
    metricVersion: METRIC_DEFINITION_VERSION,
    sampleSize: 0,
    windowFrom: null,
    windowTo: null,
    compareFrom: null,
    compareTo: null,
    dataQuality: "high",
    ...over,
  };
}

/**
 * Data quality from day coverage across both windows. Deliberately the WORSE of the two: a dense
 * recent fortnight compared against a sparse earlier one is a sparse comparison.
 */
export function qualityFor(recentDays: number, priorDays: number, windowDays = SUFFICIENCY.windowDays): DataQuality {
  const worst = Math.min(recentDays, priorDays) / Math.max(1, windowDays);
  if (worst >= QUALITY_BANDS.highDayCoverage) return "high";
  if (worst >= QUALITY_BANDS.moderateDayCoverage) return "moderate";
  return "low";
}

/** The hedging each quality band earns. The engine never sounds more certain than its data. */
export const QUALITY_PHRASE: Record<DataQuality, string> = {
  high: "Based on your records from this period",
  moderate: "Your available logs suggest",
  low: "There is not much here yet, so read this loosely",
  insufficient: "There is not enough consistent information yet to compare these periods",
};
