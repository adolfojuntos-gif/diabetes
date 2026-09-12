/**
 * THE NARRATION GATE.
 *
 * The rules a Game Master line must pass before a person sees it, and the engine's own line for
 * when it does not. Deliberately separate from `gamemaster.ts` and deliberately free of
 * `server-only`, for one reason: this is the safety argument, and a safety argument that cannot be
 * tested without an API key and a network call is not one. `tests/gamemaster.test.ts` throws its
 * whole red-team corpus at these two functions directly.
 *
 * Pure policy. No model, no client, no I/O.
 */

/**
 * Exactly what the model is told about the world. Nothing else reaches it: no glucose values, no
 * readings, no clinical history. The Game Master does not need them and cannot be trusted with
 * what it does not need.
 */
export type NarrationFacts = {
  guardian: { name: string; animal: string; voice: string };
  region: string;
  level: number;
  /** The awards to celebrate. Amounts are final and may not be altered. */
  earned: { title: string; evidence: string; xp: number; gems: number }[];
  /** The engine's own sentence. Shown verbatim when the model is unavailable or is rejected. */
  fallback: string;
  playerName: string;
};

/**
 * Every numeral a narration is allowed to contain. Any other digit sequence in the output is a
 * number the model made up, and there is no such thing as a harmless invented number in a product
 * whose whole claim is that its figures come from the person's own records.
 */
function allowedNumbers(f: NarrationFacts): Set<string> {
  const ok = new Set<string>([String(f.level)]);
  for (const e of f.earned) {
    ok.add(String(e.xp));
    ok.add(String(e.gems));
    // Figures inside the engine's own evidence line and title are quotable: the engine wrote them.
    for (const m of e.evidence.matchAll(/\d+/g)) ok.add(m[0]);
    for (const m of e.title.matchAll(/\d+/g)) ok.add(m[0]);
  }
  return ok;
}

/**
 * Vocabulary the Game Master has no business using.
 *
 * Note that this rejects phrases the ENGINE is allowed to print, such as "time in range". That is
 * not an inconsistency. The engine states a computed figure under its own name with its evidence
 * beside it; a wolf in a forest saying the same words reads as a clinical judgement delivered by a
 * character nobody can hold to account, and those are different things.
 */
const FORBIDDEN =
  /\b(glucose|blood sugar|reading|readings|mg\/dl|mmol|a1c|hba1c|insulin|dose|doses|units?|medication|medicine|tablet|inject|carb|carbs|hypo|hyper|in range|time in range|target|diagnos|symptom|healthy|healthier|control(led)?)\b/i;

/** Language that scolds, in the shapes it usually takes. */
const SCOLDING = /\b(lost your streak|you missed|you failed|lapse|slipped|should have|try harder|get back on track|no excuses)\b/i;

export type Rejection = { ok: false; reason: string };
export type Acceptance = { ok: true };

/** The gate every generated line passes before a person sees it. */
export function verifyNarration(text: string, f: NarrationFacts): Acceptance | Rejection {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty" };
  if (t.length > 700) return { ok: false, reason: "too long" };
  if (FORBIDDEN.test(t)) return { ok: false, reason: `clinical language: ${t.match(FORBIDDEN)?.[0]}` };
  if (SCOLDING.test(t)) return { ok: false, reason: `scolding: ${t.match(SCOLDING)?.[0]}` };
  if (t.includes("—")) return { ok: false, reason: "em-dash" };

  const ok = allowedNumbers(f);
  for (const m of t.matchAll(/\d+/g)) {
    if (!ok.has(m[0])) return { ok: false, reason: `invented number: ${m[0]}` };
  }
  return { ok: true };
}

/**
 * The engine's own celebration sentence: what is shown when there is no API key, and what the
 * model's output is measured against. Complete on its own, so nothing is missing without a model.
 */
export function engineCelebration(
  guardian: { name: string },
  region: string,
  earned: { title: string; xp: number; gems: number }[],
): string {
  if (earned.length === 0) return `${guardian.name} has nothing new to report from ${region} today.`;
  const names = earned.map((e) => e.title.toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const xp = earned.reduce((a, e) => a + e.xp, 0);
  const gems = earned.reduce((a, e) => a + e.gems, 0);
  const gemPart = gems > 0 ? `, and ${gems} progress gem${gems === 1 ? "" : "s"}` : "";
  return `${guardian.name} noticed: ${list}. That is ${xp} XP${gemPart}, and ${region} looks a little different for it.`;
}
