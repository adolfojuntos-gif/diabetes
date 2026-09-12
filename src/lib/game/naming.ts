/**
 * THE GAME'S NAMES FOR THINGS.
 *
 * Every surface in Steady has two names: the one the game calls it and the one it plainly is. This
 * file holds both, in one place, so a rename is one line rather than forty, and so nobody has to
 * guess what "Provisions" means when reading the code.
 *
 * THE PLAIN NAME IS NOT OPTIONAL. Every screen shows it, as the eyebrow above the game title, and
 * every navigation item carries it in its accessible label. Somebody at 3am with shaking hands, a
 * carer looking over a shoulder, and a clinician being shown the app in a ten minute appointment
 * must all be able to find "Log a reading" without learning a fantasy vocabulary first. The game is
 * a layer on the app; it is not a puzzle in front of it.
 *
 * WHAT IS NEVER RENAMED. The safety banner, the triage text, the clinical disclaimers, the
 * medication and insulin language, and anything the Copilot says about a person's health. Those
 * keep their plain words everywhere, always. A guardian may hand you a quest; a guardian may never
 * hand you a clinical finding dressed as one.
 */

export type Surface = {
  href: string;
  /** What the game calls it. */
  name: string;
  /** What it actually is. Always shown; never replaced. */
  plain: string;
  /** One line of framing for the top of that screen. */
  lede: string;
};

export const SURFACES = {
  world: {
    href: "/",
    name: "Your world",
    plain: "Home",
    lede: "Everything you have built, and the one thing worth doing next.",
  },
  today: {
    href: "/today",
    name: "Today",
    plain: "Today's numbers",
    lede: "Your readings, your food, your day as it actually is.",
  },
  gather: {
    href: "/log",
    name: "Gather",
    plain: "Log",
    lede: "Everything you record here is what the whole world above is built from.",
  },
  explore: {
    href: "/move",
    name: "Explore",
    plain: "Movement",
    lede: "Every walk is ground covered. Fifteen minutes is an expedition.",
  },
  provisions: {
    href: "/plan",
    name: "Provisions",
    plain: "Meal planning",
    lede: "What you are stocking, cooking and carrying this week.",
  },
  chronicle: {
    href: "/trends",
    name: "The Chronicle",
    plain: "Trends",
    lede: "What your own records show, written down without flattery.",
  },
  guardian: {
    href: "/copilot",
    name: "Ask a Guardian",
    plain: "Copilot",
    lede: "The guardians carry the questions. The answers come from Steady's clinical Copilot, in its own plain words.",
  },
  satchel: {
    href: "/toolkit",
    name: "The Satchel",
    plain: "Toolkit",
    lede: "Appointments, questions, labs, caregivers. The things you carry into a room.",
  },
  settings: {
    href: "/settings",
    name: "Settings",
    plain: "Settings",
    lede: "",
  },
} as const satisfies Record<string, Surface>;

export type SurfaceKey = keyof typeof SURFACES;

/**
 * XP shown at the point of action, so a person can see what a thing is worth before doing it
 * rather than discovering it afterwards. The amounts are read from the approved rule configuration,
 * never typed into a screen, so a screen cannot promise what the engine will not pay.
 */
export { HABIT_RULES as XP } from "../engines/rules";
