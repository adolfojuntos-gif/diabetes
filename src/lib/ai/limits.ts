/**
 * SPEND LIMITS on the three features that call a model, per plan.
 *
 * Why this exists: on a flat monthly price you are not underwriting the average subscriber, you are
 * underwriting the worst one. `docs/SUBSCRIPTION_ECONOMICS.md` measured what the old caps allowed
 * and the answer was $299 of inference on a $20 plan, because those caps were built for a different
 * job: stopping a stranger with a demo link running up a bill. They did that job. They were never
 * plan limits, and a cap that one account can ride to fifteen times what it pays is not a business.
 *
 * Four decisions worth stating.
 *
 * ALLOWANCES COME FROM THE PLAN, AND THE PLAN IS REQUIRED. Every function here takes a plan rather
 * than reading a global, and it is a required argument on purpose: a caller that forgets is a
 * compile error rather than a silent fall back to the most generous tier.
 *
 * IT COUNTS THE AUDIT LOG, NOT A COUNTER. `ai_audit` already records one row per model call, so the
 * limiter counts the thing that actually happened rather than a number that has to be kept in
 * agreement with it. That also means a restart, a suspend or a redeploy cannot reset an allowance,
 * which an in-memory counter would.
 *
 * IT FAILS CLOSED, AND CLOSED IS STILL USEFUL. Every paid feature has a free path that was built
 * first: the Copilot answers from the engine over real data, the check-in is written by the engine,
 * and a meal can be typed by hand or looked up in the carbohydrate reference. So hitting a limit
 * degrades the feature instead of breaking the screen, and a database error does the same. Nothing
 * here can spend money by failing.
 *
 * A ZERO ALLOWANCE IS A REAL STATE. On the free plan the monthly maximum for a written check-in is
 * zero, and that has to read as "not on your plan" rather than "try again later", because there is
 * no later. Handled explicitly below; the general path would have produced an invalid reset date.
 *
 * The window maths is pure and tested in `tests/limits.test.ts`.
 */
import type { AiFeature } from "../db/schema";
import type { Plan } from "../db/control";

export type Window = { label: string; ms: number; max: number };

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/**
 * Thirty days, not a calendar month. A rolling window cannot be gamed by subscribing on the 30th,
 * and it needs no reset job. It does mean "this month" in the interface is loose by a day or two,
 * which is the right trade for not having a clock that has to be right.
 */
const MONTH = 30 * DAY;

/**
 * Per plan, per feature, newest limit first is not required: every window is checked.
 *
 * The monthly figures are the budget and come from the economics doc. The hourly and daily ones are
 * abuse protection, deliberately loose enough that a real person never meets them: somebody
 * photographs five meals on a Sunday and one on Monday, and that should work.
 *
 * Worst case a `plus` subscriber can spend, at these caps: $4.23 a month on Sonnet and $10.56 on
 * Opus, against $19.12 kept after card fees. Profitable even if every subscriber rides every cap on
 * the expensive model, which is the property the old caps did not have.
 */
export const PLAN_LIMITS: Record<Plan, Record<AiFeature, Window[]>> = {
  free: {
    // Enough to see what the paid feature actually does on your own food, and not enough to live on.
    photo: [{ label: "month", ms: MONTH, max: 3 }],
    copilot: [
      { label: "day", ms: DAY, max: 4 },
      { label: "month", ms: MONTH, max: 10 },
    ],
    /**
     * The one paid feature that is genuinely absent rather than rationed, because the engine writes
     * a real check-in from the same numbers and that path is free and unlimited. Rationing it to one
     * or two a month would be worse than not offering it: a person would get the good version, come
     * to rely on it, and then lose it.
     */
    coach: [{ label: "month", ms: MONTH, max: 0 }],
  },
  plus: {
    photo: [
      { label: "hour", ms: HOUR, max: 6 },
      { label: "day", ms: DAY, max: 12 },
      { label: "month", ms: MONTH, max: 90 },
    ],
    copilot: [
      { label: "hour", ms: HOUR, max: 15 },
      { label: "day", ms: DAY, max: 25 },
      { label: "month", ms: MONTH, max: 120 },
    ],
    coach: [
      // Two are legitimate per day, morning and weekly. The rest of the allowance is retries.
      { label: "day", ms: DAY, max: 3 },
      { label: "month", ms: MONTH, max: 30 },
    ],
  },
};

/** The windows that apply to one account. An unknown plan gets the free tier, never the paid one. */
export function windowsFor(plan: Plan, feature: AiFeature): Window[] {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free)[feature] ?? PLAN_LIMITS.free[feature];
}

/**
 * How many audit rows are enough to decide.
 *
 * The query that feeds this used a hard-coded 500. That is fine at today's caps and it is a
 * fail-OPEN if a plan is ever given a larger allowance: truncating the count makes somebody look
 * under their limit when they are over it. Deriving it removes the trap. One more than the largest
 * maximum is sufficient, because the decision is only ever "is the count at or above this".
 */
export function rowsNeededFor(plan: Plan, feature: AiFeature): number {
  const windows = windowsFor(plan, feature);
  return Math.max(...windows.map((w) => w.max)) + 1;
}

/** The longest window, which is how far back the query has to look. */
export function longestWindowMs(plan: Plan, feature: AiFeature): number {
  return Math.max(...windowsFor(plan, feature).map((w) => w.ms));
}

/** Per-call cost estimates, so a refusal can say what was being spent. Opus 5 rates. */
export const ROUGH_COST_USD: Record<AiFeature, number> = { photo: 0.03, copilot: 0.06, coach: 0.04 };

export type LimitVerdict = {
  allowed: boolean;
  /** The window that blocked it, when one did. */
  blockedBy: Window | null;
  used: number;
  max: number;
  /** When the oldest call in the blocking window ages out. Null when no amount of waiting helps. */
  resetsAt: Date | null;
  /** True when the block is the plan itself rather than a burst, so the interface can offer an upgrade. */
  upgradeWouldHelp: boolean;
  /** Ready to show a person. Empty when allowed. */
  message: string;
};

/**
 * Decide from timestamps alone. `callTimes` are the moments this feature called a model, newest
 * first or in any order; only their values matter.
 */
export function verdictFor(feature: AiFeature, plan: Plan, callTimes: Date[], now = new Date()): LimitVerdict {
  const windows = windowsFor(plan, feature);
  const times = callTimes.map((d) => d.getTime()).filter((t) => Number.isFinite(t) && t <= now.getTime());

  for (const w of windows) {
    /**
     * A zero allowance first, because the general path below would read `inWindow[0]` out of an
     * empty array and build a reset date from NaN. It is also a different sentence: waiting does
     * not help, so the honest answer names the plan.
     */
    if (w.max <= 0) {
      return {
        allowed: false,
        blockedBy: w,
        used: 0,
        max: 0,
        resetsAt: null,
        upgradeWouldHelp: plan === "free",
        message: notOnYourPlan(feature, plan),
      };
    }
  }

  for (const w of windows) {
    const cutoff = now.getTime() - w.ms;
    const inWindow = times.filter((t) => t > cutoff).sort((a, b) => a - b);
    if (inWindow.length >= w.max) {
      // The oldest call in the window is the one whose expiry frees a slot.
      const resetsAt = new Date(inWindow[0] + w.ms);
      return {
        allowed: false,
        blockedBy: w,
        used: inWindow.length,
        max: w.max,
        resetsAt,
        /**
         * Only worth offering an upgrade when the paid plan would actually be more generous in the
         * window that blocked them. Suggesting it to someone already on plus, or for a window plus
         * does not raise, is the kind of prompt that makes people distrust the whole interface.
         */
        upgradeWouldHelp: plan === "free" && paidMaxFor(feature, w.label) > w.max,
        message: messageFor(feature, plan, w, inWindow.length, resetsAt, now),
      };
    }
  }

  /** The tightest window is the one worth reporting when nothing is blocked. */
  const reportOn = windows.reduce((a, b) => (a.ms <= b.ms ? a : b));
  const cutoff = now.getTime() - reportOn.ms;
  return {
    allowed: true,
    blockedBy: null,
    used: times.filter((t) => t > cutoff).length,
    max: reportOn.max,
    resetsAt: null,
    upgradeWouldHelp: false,
    message: "",
  };
}

const FEATURE_NOUN: Record<AiFeature, string> = {
  photo: "photo estimate",
  copilot: "Copilot reply",
  coach: "written check-in",
};

/** What the paid plan allows in the same named window, or 0 when it has no such window. */
function paidMaxFor(feature: AiFeature, label: string): number {
  const w = PLAN_LIMITS.plus[feature].find((x) => x.label === label);
  if (w) return w.max;
  // No window of that name on plus means plus does not restrict it at that grain at all.
  return Number.POSITIVE_INFINITY;
}

const FREE_PATH: Record<AiFeature, string> = {
  photo: "You can still log the meal by hand, or look the food up in the carbohydrate reference, which gives a sourced number with real portion weights and costs nothing.",
  copilot:
    "The Copilot will keep answering from this app's own engine over your real data, which costs nothing and is clearly labelled as coming from the engine.",
  coach: "The engine writes your check-in instead, from the same numbers, and that never runs out.",
};

function notOnYourPlan(feature: AiFeature, plan: Plan): string {
  const noun = FEATURE_NOUN[feature];
  const offer =
    plan === "free" && paidMaxFor(feature, "month") > 0
      ? " The written version is part of Steady Plus."
      : "";
  return `A model-written ${noun} is not part of your plan.${offer} ${FREE_PATH[feature]}`;
}

function messageFor(feature: AiFeature, plan: Plan, w: Window, used: number, resetsAt: Date, now: Date): string {
  const noun = FEATURE_NOUN[feature];
  const perWindow = `${used} of ${w.max} this ${w.label}`;
  /**
   * A time of day for a window that frees up within the day, a date for one that does not. "It
   * frees up again at 3:20 pm" is a lie when the window is thirty days long, and the old copy said
   * exactly that for every window because it only had hours and days to describe.
   *
   * Measured against the `now` this verdict was given, NOT against the real clock. Reading
   * `Date.now()` here made the sentence depend on when it happened to be rendered rather than on
   * the moment being described, which is wrong in production and untestable anywhere.
   */
  const soon = resetsAt.getTime() - now.getTime() < DAY;
  const when = soon
    ? `at ${resetsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : `on ${resetsAt.toLocaleDateString([], { month: "long", day: "numeric" })}`;
  const upgrade =
    plan === "free" && paidMaxFor(feature, w.label) > w.max
      ? ` Steady Plus allows ${paidMaxFor(feature, w.label)} a ${w.label}.`
      : "";
  return `That is ${perWindow} for the ${noun}, which is the cap that keeps this from running up a bill. It frees up again ${when}.${upgrade} ${FREE_PATH[feature]}`;
}

/** A human summary of where usage stands, for a settings screen. */
export function usageSummary(feature: AiFeature, plan: Plan, callTimes: Date[], now = new Date()) {
  return windowsFor(plan, feature).map((w) => {
    const cutoff = now.getTime() - w.ms;
    const used = callTimes.filter((d) => d.getTime() > cutoff).length;
    return { label: w.label, used, max: w.max, spentUsd: Math.round(used * ROUGH_COST_USD[feature] * 100) / 100 };
  });
}
