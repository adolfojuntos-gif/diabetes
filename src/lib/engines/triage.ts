/**
 * SAFETY TRIAGE ENGINE — deterministic, separate from the model, and it wins.
 *
 * The model never decides whether something is an emergency. This engine evaluates a fixed rule
 * table over (glucose in the last hours, symptoms the person selected or typed, a few profile
 * facts) and returns a level. The app renders the level as a banner ABOVE anything the model
 * says, from fixed text in this file.
 *
 * Levels, most to least severe:
 *   emergency — seek emergency medical assistance now
 *   urgent    — contact a healthcare professional today
 *   clinic    — bring this up with your healthcare professional
 *   general   — appropriate for education and tracking
 *
 * Every rule has an id so the audit log records which ones were evaluated and which fired.
 * Thresholds: 54 / 70 mg/dL (consensus hypoglycemia levels 2 / 1), 250 (very high), 400 (a level
 * at which prompt evaluation is warranted for anyone), DKA warning cluster (very high glucose +
 * vomiting or inability to keep fluids + fruity breath / rapid breathing / abdominal pain).
 */
import type { Symptom, TriageLevel } from "../db/schema";
import { VERY_LOW_MGDL, LOW_MGDL, VERY_HIGH_MGDL } from "../units";
import { HOUR_MS } from "../time";
import { lowEvents } from "./stats";

export type TriageInput = {
  now: Date;
  /** Readings from roughly the last 24 hours. */
  recentReadings: { at: Date; valueMgdl: number }[];
  /** Symptoms the person selected. */
  symptoms: Symptom[];
  /** Anything they typed; scanned for symptom words. */
  freeText?: string;
  severity?: 1 | 2 | 3;
  /** Flow answers. */
  flags?: {
    lowNotRespondingAfterTwoTreatments?: boolean;
    ketones?: "none" | "trace_small" | "moderate_large" | "unknown";
    symptomsForDays?: number;
  };
  profile: {
    pregnant: boolean;
    usesInsulin: boolean;
    diabetesType: string;
    /**
     * Classes the person reports taking, resolved from the medication knowledge layer. Without
     * this the engine could not know about the euglycemic ketoacidosis risk that its own knowledge
     * base documents, which was the most quotable failure in the first attack pass.
     */
    medicationClasses?: string[];
    age?: number | null;
  };
  bloodPressure?: { systolic: number; diastolic: number } | null;
};

export type TriageAction = "treat_low" | "recheck_15" | "check_ketones" | "hydrate" | "tell_someone" | "do_not_drive";

export type TriageResult = {
  level: TriageLevel;
  headline: string;
  body: string;
  /** Plain reasons, one per fired rule. */
  reasons: string[];
  actions: TriageAction[];
  rules: { id: string; fired: boolean }[];
  /** Symptoms detected from free text, so the UI can show what it heard. */
  detectedSymptoms: Symptom[];
  /** The reading the decision leaned on, if any. */
  latest: { valueMgdl: number; minutesAgo: number } | null;
  /** Readings thrown away as impossible (future-dated, non-finite, out of physiological range). */
  discardedReadings: number;
};

/* ------------------------------ keyword detection ------------------------------ */

/**
 * Symptom detection from free text.
 *
 * Two rules learned the hard way, both from an adversarial pass:
 *
 * 1. EVERY BRANCH GETS ITS OWN BOUNDARY. `/\bnumb|tingl\b/` looks like it is anchored and is not:
 *    `\b` binds to the first branch only, so "numb" matched inside "numbers" and asking
 *    "explain my numbers" raised a clinical banner. In a diabetes app "numbers" is the most common
 *    word there is. Every alternation below is wrapped so the boundary applies to all of it.
 * 2. PEOPLE DO NOT TALK LIKE A SYMPTOM LIST. "I went funny and my wife had to give me juice" is a
 *    severe hypoglycemia event. "My foot has a hole in it" is an ulcer. Spanish matters here,
 *    because the people this is being built for are in south Texas.
 *
 * Detection only ever ADDS a symptom. It cannot lower a level, so a false positive costs a banner
 * and a false negative costs a person.
 */
const KEYWORDS: [Symptom, RegExp][] = [
  ["seizure", /\b(seiz\w*|convuls\w*|fitting|had a fit|convulsion\w*)\b/i],
  ["fainted", /\b(faint\w*|passed out|pass out|blacked out|black out|unconscious|unresponsive|won'?t wake|can'?t wake|hard to rouse|couldn'?t rouse|collapsed|found me on the floor|me desmay\w*|desmayo|perdi el conocimiento)\b/i],
  ["confused", /\b(confus\w*|disorient\w*|can'?t think|foggy|not making sense|incoherent|not myself|went funny|very drowsy|drowsy|don'?t remember it|confundid\w*|desorientad\w*)\b/i],
  ["one_sided_weakness", /\b(one side|one arm|one leg|face droop\w*|drooping|weak on (the )?(left|right)|un lado|medio cuerpo)\b/i],
  ["slurred_speech", /\b(slur\w*|can'?t (speak|talk)|trouble (speaking|talking)|speech is coming out wrong|words come out wrong|no puedo hablar|hablo raro)\b/i],
  ["chest_pain", /chest[^.!?]{0,25}(pain|tight|pressure|heavy|crushing|hurt)|(pain|pressure|tightness)[^.!?]{0,20}chest|\b(elephant on my chest|dolor en el pecho|me duele el pecho|presion en el pecho|opresion en el pecho)\b|\b(jaw and arm|arm and jaw)\b/i],
  ["short_of_breath", /\b(short of breath|can'?t breathe|can ?not breathe|trouble breathing|hard to breathe|breathless|struggling to breathe|out of breath|winded|gasping for air|can'?t catch my breath|no puedo respirar|me falta el aire|dificultad para respirar)\b/i],
  ["rapid_breathing", /\b(rapid breathing|breathing fast|breathing hard|deep fast breath\w*|kussmaul|respiracion rapida)\b/i],
  ["fruity_breath", /\b(fruity|acetone|breath smells|aliento a fruta|aliento dulce|huele a acetona)\b/i],
  ["vomiting", /\b(vomit\w*|throwing up|threw up|thrown up|puk(e|ed|ing)|being sick|been sick|keep being sick|can'?t stop being sick|vomit\w*|vomitar|vomitando|estoy vomitando)\b/i],
  ["unable_to_keep_fluids", /\b(can'?t keep (anything|water|fluids|food) down|keep nothing down|keeping nothing down|can'?t drink|no puedo retener|no puedo tomar agua)\b/i],
  ["abdominal_pain", /\b(stomach (pain|ache|hurts|really hurts)|abdominal\w*|belly (pain|hurts|ache)|gut (pain|hurts)|dolor de (estomago|barriga|vientre)|me duele el estomago)\b/i],
  ["nausea", /\b(nause\w*|queasy|sick to my stomach|nausea\w*|ganas de vomitar)\b/i],
  ["shaky", /\b(shak\w*|trembl\w*|jitter\w*|the shakes|temblando|temblor\w*)\b/i],
  ["sweaty", /\b(sweat\w*|clammy|sudando|sudor frio)\b/i],
  ["dizzy", /\b(dizz\w*|light-?headed|lightheaded|woozy|the room spun|mareado|mareo|maread\w*)\b/i],
  ["headache", /\b(headache|head hurts|migraine|dolor de cabeza|me duele la cabeza)\b/i],
  ["blurred_vision", /\b(blurred|blurry|blurring|fuzzy vision|everything looks fuzzy|seeing double|double vision|seeing spots|can'?t see|vision (went )?(weird|funny|blurry|borrosa)|vista borrosa|vision borrosa|veo doble|veo borroso)\b/i],
  ["very_thirsty", /\b(thirst\w*|dry mouth|parched|mucha sed|tengo sed|muy sediento)\b/i],
  ["frequent_urination", /\b(urinat\w*|peeing|pee a lot|bathroom a lot|up all night to pee|haven'?t been able to pee|orino mucho|much[ao] orina|ganas de orinar)\b/i],
  ["fatigue", /\b(tired|fatigue\w*|exhaust\w*|no energy|drained|wiped out|worn out|cansad\w*|sin energia|agotad\w*|me siento debil|weak|weakness)\b/i],
  ["numbness_tingling", /\b(numbness|numb feet|numb hands|numb toes|going numb|gone numb|feet are numb|hands are numb|can'?t feel my (feet|hands|toes)|tingl\w*|pins and needles|burning feet|hormigueo|entumecid\w*|adormecid\w*)\b/i],
  ["foot_wound", /\b(foot (wound|sore|ulcer|blister|cut)|sore on my (foot|heel|toe)|hole in (my |the )?(foot|heel)|toe (wound|infect\w*)|won'?t close|gone black|turned black|ulcer\w*|llaga en el pie|herida en el pie|ulcera)\b/i],
  ["fever", /\b(fever|feverish|high temperature|running a temperature|chills|fiebre|calentura|escalofrios)\b/i],
  ["heart_racing", /\b(heart (racing|pounding|thumping)|palpitat\w*|racing heart|corazon acelerado|palpitaciones)\b/i],
  ["irritable", /\b(irritab\w*|cranky|moody|snappy|irritable)\b/i],
  ["hungry", /\b(hungry|starving|ravenous|hambre|mucha hambre)\b/i],
  ["slow_healing", /\b(slow to heal|not healing|won'?t heal|isn'?t healing|no cicatriza|no sana)\b/i],
];

/**
 * Things that are not symptoms but change what the numbers mean. Insulin delivery stopping is the
 * commonest road to ketoacidosis for someone on a pump, and no symptom word covers it.
 */
const DELIVERY_FAILURE =
  /\b(pump site (failed|failure|problem)|site (failed|failure)|cannula (came out|fell out|blocked|kinked)|infusion set (failed|came out)|occlusion|pump (failed|stopped|error|not working)|no insulin for|missed (my )?(basal|long.?acting|lantus|tresiba|levemir)|forgot (my )?(basal|long.?acting|lantus|tresiba|levemir|insulin)|ran out of insulin|se me salio la canula|no tengo insulina)\b/i;

/** A meter or CGM reporting above its range, or the person quoting a range rather than a value. */
const OFF_SCALE_HIGH = /\b(meter (says|reads) hi|reads? hi\b|sugar is in the (4|5|6)00s|glucose is in the (4|5|6)00s|over 500|above 500)\b/i;

/** Ketone strip results people type in their own words. */
const KETONES_HIGH = /\b(large ketones|moderate ketones|high ketones|ketones are (large|high|moderate)|lots of ketones|cetonas (altas|elevadas))\b/i;

export function detectSymptoms(text: string | undefined): Symptom[] {
  if (!text) return [];
  const out = new Set<Symptom>();
  for (const [sym, re] of KEYWORDS) if (re.test(text)) out.add(sym);
  return [...out];
}

/* ------------------------------------ rules ------------------------------------ */

const LEVEL_TEXT: Record<TriageLevel, { headline: string; body: string }> = {
  emergency: {
    headline: "Seek emergency medical assistance now",
    body:
      "Based on what you've shared, this needs emergency care right now. Call your local emergency number (911 in the US). If you can, have someone stay with you. Don't drive yourself.",
  },
  urgent: {
    headline: "Contact a healthcare professional today",
    body:
      "Based on what you've shared, this should be looked at promptly. Today. Call your care team, a nurse line, or an urgent care. If things get worse, or any emergency sign appears, call emergency services.",
  },
  clinic: {
    headline: "Worth discussing with your healthcare professional",
    body:
      "Nothing here points to an emergency based on what you've shared, but it deserves a conversation with your care team. The notes below are educational, not a diagnosis.",
  },
  general: {
    headline: "Nothing urgent based on what you've shared",
    body:
      "This looks appropriate for tracking and education. If you develop new symptoms or your numbers change quickly, check back in.",
  },
};

export function triage(input: TriageInput): TriageResult {
  const detected = detectSymptoms(input.freeText);
  const sym = new Set<Symptom>([...input.symptoms, ...detected]);
  const has = (...s: Symptom[]) => s.some((x) => sym.has(x));
  const sev = input.severity ?? 2;
  const flags = input.flags ?? {};

  /**
   * A reading only counts if it is real.
   *
   * This block is the answer to the worst defect this engine has had. A reading dated in the
   * FUTURE sorted to the front and then passed the staleness check, because `minutesAgo` was
   * negative and −360 is less than 180. One future-dated row, from a mistyped year or a bad
   * timezone in a CGM export, made a current glucose of 38 invisible and the engine answered
   * "nothing urgent". A non-finite value did the same thing by making every comparison false.
   *
   * So: drop anything not finite, not plausible, or dated ahead of now, and count the drops so a
   * screen can say the data was unusable instead of quietly reporting that all is well.
   */
  const PLAUSIBLE_MIN = 10;
  const PLAUSIBLE_MAX = 900;
  const FUTURE_TOLERANCE_MS = 15 * 60_000; // a few minutes of clock skew is normal; hours are not.
  const usable: { at: Date; valueMgdl: number }[] = [];
  let discarded = 0;
  for (const r of input.recentReadings) {
    const t = r.at instanceof Date ? r.at.getTime() : NaN;
    const v = r.valueMgdl;
    if (!Number.isFinite(t) || !Number.isFinite(v) || v < PLAUSIBLE_MIN || v > PLAUSIBLE_MAX || t - input.now.getTime() > FUTURE_TOLERANCE_MS) {
      discarded++;
      continue;
    }
    usable.push({ at: r.at, valueMgdl: v });
  }

  const recent = usable.sort((a, b) => b.at.getTime() - a.at.getTime());
  const latestRow = recent[0] ?? null;
  const latest = latestRow
    ? { valueMgdl: latestRow.valueMgdl, minutesAgo: Math.round((input.now.getTime() - latestRow.at.getTime()) / 60_000) }
    : null;
  // Only trust a reading as "current" for 3 hours, and never one from the future.
  const cur = latest && latest.minutesAgo >= 0 && latest.minutesAgo <= 180 ? latest.valueMgdl : null;
  const lowNow = cur !== null && cur < LOW_MGDL;
  const veryLowNow = cur !== null && cur < VERY_LOW_MGDL;
  const veryHighNow = cur !== null && cur > VERY_HIGH_MGDL;
  const extremeNow = cur !== null && cur >= 400;
  const last24 = recent.filter((r) => input.now.getTime() - r.at.getTime() <= 24 * HOUR_MS);
  const lowEpisodes24 = lowEvents(last24).length;
  const highs6h = recent.filter((r) => input.now.getTime() - r.at.getTime() <= 6 * HOUR_MS && r.valueMgdl > 300).length;
  const bp = input.bloodPressure ?? null;

  /**
   * A sub-54 reading in the last day matters whether or not it is current. A CGM nadir of 40 seen
   * the next morning used to fire nothing at all, because `cur` was stale and one episode is not
   * the two that `U2` wants. It is now its own rule.
   */
  const veryLow24 = last24.filter((r) => r.valueMgdl < VERY_LOW_MGDL);
  const lowestLast24 = last24.length ? Math.min(...last24.map((r) => r.valueMgdl)) : null;
  const highestLast24 = last24.length ? Math.max(...last24.map((r) => r.valueMgdl)) : null;

  /** Facts the text carries that no symptom word covers. */
  const text = input.freeText ?? "";
  const deliveryFailure = DELIVERY_FAILURE.test(text);
  const offScaleHigh = OFF_SCALE_HIGH.test(text);
  const ketonesHighText = KETONES_HIGH.test(text);
  const ketonesHigh = flags.ketones === "moderate_large" || ketonesHighText;
  /** Medication classes change what a number means. See the euglycemic DKA rule below. */
  const meds = (input.profile.medicationClasses ?? []).map((m) => m.toLowerCase());
  const onSglt2 = meds.includes("sglt2");
  const onSulfonylurea = meds.includes("sulfonylurea");
  const age = input.profile.age ?? null;
  const isChild = age !== null && age < 18;

  const rules: { id: string; level: TriageLevel; test: boolean; reason: string; actions?: TriageAction[] }[] = [
    // ------------------------------ EMERGENCY ------------------------------
    { id: "E1_seizure_or_unconscious", level: "emergency", test: has("seizure", "fainted"), reason: "A seizure, fainting or being unresponsive was reported.", actions: ["tell_someone"] },
    {
      id: "E2_low_with_confusion",
      level: "emergency",
      test: (lowNow || has("shaky", "sweaty")) && has("confused"),
      reason: "Signs of a low together with confusion. The person may not be able to treat it safely themselves. If glucagon is available, someone else should give it. Don't give food or drink to someone who can't swallow safely.",
      actions: ["tell_someone", "do_not_drive"],
    },
    { id: "E3_stroke_signs", level: "emergency", test: has("one_sided_weakness", "slurred_speech"), reason: "One-sided weakness or slurred speech are stroke warning signs." },
    { id: "E4_chest_or_breathing", level: "emergency", test: has("chest_pain") || (has("short_of_breath") && sev >= 2), reason: "Chest pain or trouble breathing." },
    {
      id: "E5_dka_cluster",
      level: "emergency",
      test:
        (veryHighNow || cur === null || flags.ketones === "moderate_large") &&
        has("vomiting", "unable_to_keep_fluids") &&
        has("fruity_breath", "rapid_breathing", "abdominal_pain", "confused"),
      reason: "Very high glucose (or unknown) with vomiting and warning signs such as fruity breath, rapid breathing or abdominal pain. A pattern that can mean diabetic ketoacidosis.",
      actions: ["tell_someone", "do_not_drive"],
    },
    { id: "E6_extreme_high_with_symptoms", level: "emergency", test: extremeNow && has("confused", "very_thirsty", "vomiting", "fatigue", "dizzy"), reason: `Glucose ${cur ?? ""} mg/dL with symptoms.`, actions: ["hydrate", "tell_someone"] },
    { id: "E7_low_not_responding", level: "emergency", test: !!flags.lowNotRespondingAfterTwoTreatments, reason: "A low that hasn't come up after two treatments.", actions: ["tell_someone", "do_not_drive"] },
    { id: "E8_bp_crisis_with_symptoms", level: "emergency", test: !!bp && bp.systolic >= 180 && bp.diastolic >= 120 && has("headache", "blurred_vision", "chest_pain", "short_of_breath", "confused"), reason: "Very high blood pressure with symptoms." },

    /**
     * EUGLYCEMIC KETOACIDOSIS. The rule this engine most needed and did not have.
     *
     * On an SGLT2 inhibitor, ketoacidosis can arrive at a glucose that looks almost normal, so
     * every rule keyed to "very high" misses it. The knowledge layer documents this at
     * `medications.ts` under the SGLT2 entry, which meant the app knew the fact while the safety
     * engine could not reach it. It can now, because the profile carries the medication classes.
     */
    {
      id: "E9_euglycemic_dka",
      level: "emergency",
      test: onSglt2 && has("vomiting", "nausea", "abdominal_pain", "unable_to_keep_fluids", "rapid_breathing", "fruity_breath"),
      reason:
        "You are taking an SGLT2 inhibitor, and on that medicine ketoacidosis can happen even when glucose looks close to normal. Sickness, stomach pain or fast breathing with it needs emergency assessment, not watching.",
      actions: ["check_ketones", "tell_someone", "do_not_drive"],
    },
    {
      id: "E10_off_scale_or_extreme_high",
      level: "emergency",
      test: (cur !== null && cur >= 500) || (highestLast24 !== null && highestLast24 >= 500) || offScaleHigh,
      reason: "A glucose at or above 500 mg/dL, or a meter reading above its range, needs emergency assessment.",
      actions: ["check_ketones", "hydrate", "tell_someone"],
    },
    {
      id: "E11_child_severe_low",
      level: "emergency",
      test: isChild && ((cur !== null && cur < VERY_LOW_MGDL) || veryLow24.length > 0) && has("confused", "fainted", "fatigue", "seizure"),
      reason: "A child with a very low glucose and drowsiness or confusion needs emergency help now.",
      actions: ["tell_someone"],
    },

    // -------------------------------- URGENT --------------------------------
    {
      id: "U12_very_low_in_24h",
      level: "urgent",
      test: veryLow24.length > 0,
      reason: `A reading of ${lowestLast24 ?? ""} mg/dL in the last 24 hours. A glucose under 54 counts whether or not it is the most recent one, and your care team should hear about it today.`,
      actions: ["tell_someone"],
    },
    {
      id: "U13_stale_low_with_symptoms",
      level: "urgent",
      test: cur === null && lowestLast24 !== null && lowestLast24 < LOW_MGDL && has("shaky", "sweaty", "confused", "dizzy", "hungry", "irritable", "heart_racing"),
      reason: `Your last readings include ${lowestLast24} mg/dL and you are describing symptoms that go with a low, with nothing current to go on. Check your glucose now.`,
      actions: ["recheck_15", "treat_low", "do_not_drive"],
    },
    {
      id: "U14_ketones_high_alone",
      level: "urgent",
      test: ketonesHigh,
      reason: "Moderate or large ketones need same-day medical advice, whatever the glucose is doing.",
      actions: ["check_ketones", "hydrate", "tell_someone"],
    },
    {
      id: "U15_insulin_delivery_failure",
      level: "urgent",
      test: deliveryFailure && (input.profile.usesInsulin || input.profile.diabetesType === "type1"),
      reason:
        "Insulin delivery stopping is the commonest route to ketoacidosis. With a failed site, a missed background dose or no insulin available, this needs same-day advice and a ketone check.",
      actions: ["check_ketones", "hydrate", "tell_someone"],
    },
    {
      id: "U16_type1_vomiting",
      level: "urgent",
      test: (input.profile.diabetesType === "type1" || input.profile.usesInsulin) && has("vomiting"),
      reason: "Vomiting when you use insulin needs same-day advice and a ketone check, at any glucose level.",
      actions: ["check_ketones", "hydrate"],
    },
    {
      id: "U17_sulfonylurea_low_signs",
      level: "urgent",
      test: onSulfonylurea && (lowNow || (cur === null && has("shaky", "sweaty", "confused", "dizzy", "hungry"))),
      reason:
        "Lows on a sulfonylurea can last for many hours and can come back after treatment, so this needs advice today rather than watching.",
      actions: ["treat_low", "recheck_15", "tell_someone", "do_not_drive"],
    },
    {
      id: "U18_sustained_low",
      level: "urgent",
      test: last24.filter((r) => r.valueMgdl < LOW_MGDL).length >= 6,
      reason: `${last24.filter((r) => r.valueMgdl < LOW_MGDL).length} readings under ${LOW_MGDL} mg/dL in the last 24 hours. A long stretch of lows counts even when it reads as one episode.`,
      actions: ["tell_someone"],
    },
    {
      id: "U19_child_out_of_range",
      level: "urgent",
      test: isChild && ((cur !== null && (cur < LOW_MGDL || cur > VERY_HIGH_MGDL)) || veryLow24.length > 0 || ketonesHigh),
      reason: "For a child, an out-of-range glucose or raised ketones should be discussed with the care team the same day.",
      actions: [],
    },
    { id: "U1_very_low_now", level: "urgent", test: veryLowNow, reason: `Glucose ${cur ?? ""} mg/dL, under 54. Treat it now and let your care team know today.`, actions: ["treat_low", "recheck_15", "tell_someone", "do_not_drive"] },
    { id: "U2_repeated_lows_24h", level: "urgent", test: lowEpisodes24 >= 2, reason: `${lowEpisodes24} separate lows in the last 24 hours.`, actions: ["tell_someone"] },
    { id: "U3_high_with_ketone_signs", level: "urgent", test: (veryHighNow || flags.ketones === "moderate_large") && has("nausea", "vomiting", "abdominal_pain", "very_thirsty"), reason: "Very high glucose or raised ketones with nausea, vomiting or strong thirst.", actions: ["check_ketones", "hydrate"] },
    { id: "U4_persistent_300", level: "urgent", test: highs6h >= 2 && has("very_thirsty", "frequent_urination", "fatigue", "nausea"), reason: "More than one reading over 300 mg/dL in six hours, with symptoms.", actions: ["check_ketones", "hydrate"] },
    { id: "U5_extreme_high", level: "urgent", test: extremeNow, reason: `Glucose ${cur ?? ""} mg/dL.`, actions: ["check_ketones", "hydrate"] },
    { id: "U6_pregnancy", level: "urgent", test: input.profile.pregnant && (lowNow || (cur !== null && cur > 200) || sym.size > 0), reason: "In pregnancy, out-of-range glucose or new symptoms should be checked the same day.", actions: [] },
    { id: "U7_foot_wound_infection", level: "urgent", test: has("foot_wound") && has("fever"), reason: "A foot wound with fever can mean infection." },
    { id: "U8_sick_day", level: "urgent", test: has("fever") && (veryHighNow || has("vomiting")), reason: "Illness with very high glucose or vomiting.", actions: ["check_ketones", "hydrate"] },
    { id: "U9_cant_keep_fluids", level: "urgent", test: has("unable_to_keep_fluids"), reason: "Not being able to keep fluids down.", actions: ["hydrate"] },
    { id: "U10_sudden_vision", level: "urgent", test: has("blurred_vision") && sev >= 3, reason: "A sudden or severe change in vision." },
    { id: "U11_bp_crisis", level: "urgent", test: !!bp && bp.systolic >= 180 && bp.diastolic >= 120, reason: "Blood pressure 180/120 or higher." },

    // -------------------------------- CLINIC --------------------------------
    { id: "C1_low_now", level: "clinic", test: lowNow && !veryLowNow, reason: `Glucose ${cur ?? ""} mg/dL, under 70. Treat it now; if lows keep happening, your care team should know.`, actions: ["treat_low", "recheck_15", "do_not_drive"] },
    { id: "C2_very_high_now", level: "clinic", test: veryHighNow, reason: `Glucose ${cur ?? ""} mg/dL, over 250.`, actions: input.profile.usesInsulin || input.profile.diabetesType === "type1" ? ["check_ketones", "hydrate"] : ["hydrate"] },
    { id: "C3_persistent_symptoms", level: "clinic", test: has("fatigue", "very_thirsty", "frequent_urination", "numbness_tingling", "slow_healing", "blurred_vision", "foot_wound", "headache", "heart_racing") && (flags.symptomsForDays ?? 0) >= 3, reason: "Symptoms lasting several days." },
    { id: "C4_foot_wound", level: "clinic", test: has("foot_wound"), reason: "Any foot wound deserves a look from someone who knows your feet." },
    { id: "C5_bp_high", level: "clinic", test: !!bp && (bp.systolic >= 140 || bp.diastolic >= 90), reason: "Blood pressure at or above 140/90." },
    { id: "C6_low_signs_no_reading", level: "clinic", test: cur === null && has("shaky", "sweaty", "dizzy", "hungry", "irritable", "heart_racing"), reason: "Symptoms that can go with a low, with no recent reading to confirm. Check now.", actions: ["recheck_15"] },
    { id: "C7_new_symptoms", level: "clinic", test: has("numbness_tingling", "slow_healing", "very_thirsty", "frequent_urination") , reason: "Symptoms worth mentioning at your next visit." },
  ];

  const order: TriageLevel[] = ["emergency", "urgent", "clinic", "general"];
  let level: TriageLevel = "general";
  const reasons: string[] = [];
  const actions = new Set<TriageAction>();
  const evaluated = rules.map((r) => ({ id: r.id, fired: r.test }));
  for (const r of rules) {
    if (!r.test) continue;
    if (order.indexOf(r.level) < order.indexOf(level)) level = r.level;
  }
  for (const r of rules) {
    if (r.test && r.level === level) {
      reasons.push(r.reason);
      for (const a of r.actions ?? []) actions.add(a);
    }
  }
  // A current low always carries the treatment action, whatever level won.
  if (lowNow) {
    actions.add("treat_low");
    actions.add("recheck_15");
  }

  return {
    level,
    headline: LEVEL_TEXT[level].headline,
    body: LEVEL_TEXT[level].body,
    reasons,
    actions: [...actions],
    rules: evaluated,
    detectedSymptoms: detected,
    latest,
    discardedReadings: discarded,
  };
}

export const ACTION_TEXT: Record<TriageAction, string> = {
  treat_low:
    "Treat the low now: 15 grams of fast-acting carbohydrate, 4 glucose tablets, half a cup of juice or regular soda, or a tablespoon of sugar or honey.",
  recheck_15: "Recheck in 15 minutes. If still under 70 mg/dL, treat again. Once you're above 70, have a snack if your next meal is more than an hour away.",
  check_ketones: "If you have ketone strips, check now. Moderate or large ketones need same-day medical advice.",
  hydrate: "Sip water steadily. High glucose pulls water out of the body.",
  tell_someone: "Let someone nearby know what's happening, so you're not handling this alone.",
  do_not_drive: "Don't drive until your glucose is back in range and you feel clear-headed.",
};
