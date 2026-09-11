/**
 * DOSE-LANGUAGE FILTER — the last line of the "never suggests a dose" rule.
 *
 * The first version of this file was a blocklist of instruction shapes, and an adversarial pass
 * put 53 of 60 real dosing sentences straight through it. Three structural reasons, all fixed here:
 *
 *  1. IT TRUSTED AN ALLOWLIST FIRST. Any sentence containing "you logged" or "ask your doctor" was
 *     waved through before the patterns ran, so appending four words disabled the filter:
 *     "I can't suggest a dose, but 8 units would cover that meal" passed untouched. That is exactly
 *     the sentence a model under a strong system prompt is most likely to produce, and the old
 *     allowlist rewarded it. Exemptions are now decided LAST, and only for sentences that carry no
 *     instruction to the reader at all.
 *  2. IT MATCHED RAW TEXT. "four more units" has no digit, "Take 4 more\nunits" has a newline in the
 *     middle, "unıts" uses a dotless i. Everything is normalised before matching now.
 *  3. IT LOOKED AT ONE SENTENCE AT A TIME. "Your morning number is high. So before breakfast
 *     tomorrow, make it two more." splits harmlessly in half. Detection now runs over a sliding
 *     two-sentence window as well as each sentence alone.
 *
 * The other half of the job is not eating real answers. The old version replaced 8 of the app's own
 * 153 reviewed knowledge strings, including the two drug classes people ask about most, and a filter
 * that deletes true educational content is also a product defect. `tests/safety.test.ts` asserts
 * both directions: a corpus of dosing sentences must all be caught, and every string in the
 * knowledge layer must survive untouched.
 */
export const CARE_TEAM_POINTER =
  "[Dosing and medication changes are decisions for your prescriber. I can help you write down what you've noticed so that conversation is quick and specific.]";

/* ------------------------------- normalisation ------------------------------- */

const NUMBER_WORDS: Record<string, string> = {
  half: "0.5", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60",
  // Spanish, because the people this is for speak it.
  medio: "0.5", media: "0.5", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5",
  seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", quince: "15", veinte: "20",
};

/**
 * Fold the text so an evasion cannot hide in punctuation, spacing or a lookalike character.
 * The normalised copy is only used for DETECTION; the reader always sees the original sentence or
 * the fixed pointer, never this.
 */
export function normalise(s: string): string {
  let t = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents, so "unídad" folds to "unidad"
    .replace(/[ı]/g, "i") // dotless i
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, "-")
    .toLowerCase()
    .replace(/[*_`>#|]+/g, " ") // markdown emphasis, quotes, headings and table pipes
    .replace(/\s+/g, " ");
  // Spaced-out letters: "t a k e   4" folds to "take 4".
  t = t.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ""));
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  return t.trim();
}

/* --------------------------------- vocabulary --------------------------------- */

const DRUG =
  "insulin|insulina|basal|bolus|metformin|metformina|glipizide|glimepiride|glyburide|gliclazide|sulfonylurea|sitagliptin|linagliptin|empagliflozin|dapagliflozin|canagliflozin|semaglutide|liraglutide|dulaglutide|tirzepatide|pioglitazone|lispro|aspart|glulisine|glargine|detemir|degludec|atorvastatin|rosuvastatin|lisinopril|losartan|glucophage|januvia|tradjenta|jardiance|farxiga|invokana|ozempic|wegovy|rybelsus|victoza|trulicity|mounjaro|zepbound|humalog|novolog|novorapid|apidra|fiasp|lyumjev|lantus|basaglar|toujeo|semglee|levemir|tresiba|nph|humulin|novolin|actos|amaryl|glucotrol|lipitor|crestor|zestril|cozaar|glucagon|baqsimi|gvoke";

const UNIT = "units?|unidades?|unidad|u|iu|mg|mcg|ug|ml|tablets?|pastillas?|pills?|pens?|puffs?|shots?|jabs?";

/** Words that name the thing being changed. */
const THING = `dose|dosis|dosage|${UNIT}|${DRUG}|medication|medicamento|medicine|meds?|prescription|regimen|injection|inyeccion|shot|pump setting|basal rate|pen`;

/** Any second-person or advisory instruction aimed at the reader. */
const INSTRUCT =
  "take|taking|takes|tomar|toma|tome|inject|injecting|inyect\\w*|add|adding|anad\\w*|agreg\\w*|give|giving|use|using|usar|try|trying|prueba|need|needs|should|shall|could|would|might|may|consider|considera|start|starting|empez\\w*|switch|switching|cambi\\w*|move|moving|shift|swap|bump|go up|go down|make it|round (?:it )?up|round (?:it )?down|aim for|stick to|cover|covering|correct|correcting|titrate|titrating|adjust|adjusting|increase|increasing|aument\\w*|decrease|decreasing|reduce|reducing|reduc\\w*|lower|lowering|baj\\w*|raise|raising|subir|sube|double|doubling|halve|halving|cut|cutting|skip|skipping|salt\\w*|stop|stopping|dej\\w*|hold|holding|omit|omitting|pause|pausing|discontinue|miss|missing|delay|delaying|space|spacing|pre-?bolus|prebolus";

/**
 * Terms that ARE a dosing decision no matter how they are phrased, with or without a number.
 * A sentence containing any of these is about how much or when to take something.
 */
const DOSE_JARGON = new RegExp(
  `\\b(?:` +
    `insulin[- ]to[- ]carb(?:ohydrate)? ratio|carb(?:ohydrate)? ratio|i[:/ ]c ratio|\\bic ratio\\b|` +
    `insulin sensitivity factor|\\bisf\\b|correction factor|correction scale|sliding scale|` +
    `basal rate|temp(?:orary)? basal|square wave bolus|dual wave bolus|extended bolus|combo bolus|` +
    `pre-?bolus(?:ing)?|insulin on board|\\biob\\b|` +
    `titrat(?:e|ing|ion)|up-?titrat\\w*|dose escalation|` +
    `1 (?:unit|u) (?:for|per) (?:every )?\\d+|\\d+ (?:units?|u) (?:for|per) (?:every )?\\d+|` +
    `ratio should be \\d|factor is (?:too )?(?:weak|strong)` +
    `)\\b`,
  "i",
);

/**
 * A quantity next to a dose unit. The normaliser has already turned "four" into "4".
 *
 * The trailing lookahead is load-bearing. `mg` has to be in the unit list, because "500 mg twice a
 * day" is a dose, but without excluding `mg/dL` the pattern matched "between 70 and 180 mg/dL" and
 * the filter deleted the app's own time-in-range definition. A glucose concentration is not a dose.
 * The optional article lets "half a pen" through as an amount.
 */
const AMOUNT_UNIT = new RegExp(
  `\\b(?:\\d+(?:\\.\\d+)?|an? extra|another|extra|more|fewer|less)\\s*(?:an? |of an? )?(?:more\\s+)?(?:${UNIT})\\b(?!\\s*/\\s*d?l)`,
  "i",
);

/** "an extra correction", "another bolus" — a dose named without a number. */
const IMPLIED_DOSE = /\b(?:an?|one|another|extra|additional)\s+(?:extra\s+)?(?:correction|bolus|dose|dosis|shot|injection|jab|unit|pen)\b/i;

/** A bare quantity in a sentence that is otherwise clearly about a medicine. */
const BARE_AMOUNT = /\b\d+(?:\.\d+)?\b/;

/**
 * WHO IS BEING TOLD WHAT. This is the distinction the first version lacked, and lacking it is why
 * it both missed real advice and deleted the app's own reviewed content.
 *
 * "Prolongs the action of the body's own gut hormones, which increase insulin release" is physiology.
 * "Increase your insulin" is advice. Both contain an increase verb and the word insulin, so no
 * vocabulary list can separate them. What separates them is the target: advice is aimed at the
 * reader, either in the second person or as a bare imperative.
 *
 * So the patterns below come in two tiers:
 *
 *   AMOUNT-BEARING patterns need no such test. A number sitting next to a dose unit in model prose
 *   is a dose, full stop, and the report-only exemption at the end is what protects "you logged 22
 *   units yesterday".
 *
 *   DIRECTIVE patterns (change a thing, change the timing, a bare comparative) only count when the
 *   sentence is actually aimed at the reader. That single requirement is what lets every string in
 *   the knowledge layer through while still catching "Take it earlier tomorrow".
 */

/** The sentence addresses the reader. */
const SECOND_PERSON = /\b(?:you|your|yours|yourself|tu|tus|te|usted|su)\b/i;

/** The sentence opens with a bare imperative, which is advice with the "you" left implicit. */
const IMPERATIVE_OPENER = new RegExp(
  `^(?:ok(?:ay)?,?\\s+|so,?\\s+|then,?\\s+|just\\s+|maybe\\s+|perhaps\\s+|i'?d\\s+|i would\\s+)*` +
    `(?:take|try|add|give|use|inject|increase|decrease|reduce|lower|raise|double|halve|cut|skip|miss|stop|hold|omit|pause|switch|move|shift|swap|bump|knock|nudge|dial|ease|push|pull|round|go|set|have|ask|consider|aim|stick|cover|correct|adjust|titrate|space|delay|pre-?bolus|prebolus|` +
    `toma|tome|aumenta|reduce|baja|sube|deja|cambia|usa|prueba|ponte|puedes)\\b`,
  "i",
);

/**
 * Advice offered in the first person is still advice. "If it were me, I'd go a little higher"
 * carries no "you" and is not an imperative, and it is a dosing recommendation.
 */
const FIRST_PERSON_ADVICE = /\bi'?d\b|\bi would\b|\bif it were me\b|\bwhat i'?d do\b|\byo (?:tomaria|subiria|bajaria)\b/i;

/** "if you take insulin, ..." is a condition, not an instruction. */
const CONDITIONAL_FRAME = /\b(?:if|when|whenever|unless|while|si|cuando)\s+(?:you|your|tu|usted)?\s*\b(?:take|takes|taking|use|uses|using|are on|is on|have|has|get|gets|feel|feels|notice|notices)\b/i;

/** Comparatives that name an amount without naming a unit: "a little more", "a bit less". */
const COMPARATIVE = "more|less|higher|lower|smaller|larger|bigger|stronger|weaker|fewer";
const HEDGE = "a little|a bit|a touch|slightly|somewhat|a tad|marginally|a couple|a fraction";

type Pattern = { id: string; re: RegExp; needsTarget: boolean };

const PATTERNS: Pattern[] = [
  /* ---------- amount-bearing: a number next to a dose unit ---------- */
  { id: "instruct_amount", needsTarget: false, re: new RegExp(`\\b(?:${INSTRUCT})\\b[^.!?]{0,50}?${AMOUNT_UNIT.source}`, "i") },
  { id: "amount_instruct", needsTarget: false, re: new RegExp(`${AMOUNT_UNIT.source}[^.!?]{0,50}?\\b(?:${INSTRUCT}|before|after|with|at bedtime|tonight|tomorrow|in the morning|extra|mas)\\b`, "i") },
  { id: "amount_near_drug", needsTarget: false, re: new RegExp(`${AMOUNT_UNIT.source}[^.!?]{0,60}?\\b(?:${DRUG})\\b|\\b(?:${DRUG})\\b[^.!?]{0,60}?${AMOUNT_UNIT.source}`, "i") },
  { id: "make_it_amount", needsTarget: false, re: /\b(?:make it|makes it|round\s+\w+\s+(?:up|down)(?:\s+to)?|go up by|go down by|up by|down by)\b[^.!?]{0,15}?\b\d+(?:\.\d+)?\b/i },
  { id: "amount_is", needsTarget: false, re: /\b(?:the (?:usual|right|correct|starting|recommended) (?:amount|number|dose)|the (?:amount|number) (?:you|we)(?:'re| are)? (?:want|looking for|after))\b[^.!?]{0,20}?\b\d+(?:\.\d+)?\b/i },
  { id: "cover_with", needsTarget: false, re: /\bcover\b[^.!?]{0,30}?\b\d+(?:\.\d+)?\s*(?:g|grams?|carbs?)?\b[^.!?]{0,20}?\bwith\b[^.!?]{0,15}?\b\d+/i },
  { id: "ratio_per_grams", needsTarget: false, re: /\b\d+(?:\.\d+)?\s*(?:units?|u)?\s*(?:for|per)\s*(?:every\s*)?\d+\s*(?:g\b|grams?|carbs?|mg\/dl|points?)/i },
  { id: "dose_schedule", needsTarget: false, re: /\b(?:breakfast|lunch|dinner|bedtime|morning|evening|desayuno|comida|cena)\b\s*[:=-]?\s*\d+(?:\.\d+)?\b[^.!?]{0,40}?\b(?:breakfast|lunch|dinner|bedtime|morning|evening|desayuno|comida|cena)\b\s*[:=-]?\s*\d+/i },

  /* ---------- directive: must be aimed at the reader ---------- */
  { id: "instruct_thing", needsTarget: true, re: new RegExp(`\\b(?:${INSTRUCT})\\b[^.!?]{0,35}?\\b(?:${THING})\\b`, "i") },
  { id: "thing_instruct", needsTarget: true, re: new RegExp(`\\b(?:${THING})\\b[^.!?]{0,30}?\\b(?:${INSTRUCT})\\b`, "i") },
  { id: "passive_change", needsTarget: true, re: new RegExp(`\\b(?:is|are|was|were|be|been|being|would|could|gets?|often|usually|typically|normally)\\b[^.!?]{0,40}?\\b(?:increased|decreased|reduced|lowered|raised|added|held|skipped|stopped|adjusted|titrated|doubled|halved)\\b`, "i") },
  { id: "timing_change", needsTarget: true, re: new RegExp(`\\b(?:${INSTRUCT}|have|having|take)\\b[^.!?]{0,30}?\\b(?:earlier|later|at night|in the (?:morning|evening)|to the (?:morning|evening|night)|before (?:bed|food|meals?)|after (?:food|meals?)|next time|further apart|closer together|with food|on an empty stomach|a different (?:day|time))\\b`, "i") },
  { id: "hedged_comparative", needsTarget: true, re: new RegExp(`\\b(?:${HEDGE})\\b[^.!?]{0,20}?\\b(?:${COMPARATIVE})\\b|\\b(?:${COMPARATIVE})\\b[^.!?]{0,25}?\\b(?:evening|morning|bedtime|dose|dosis|amount|one|pen|shot)\\b`, "i") },
  // The object is mandatory. Without it, "bad sleep can push your sugar up" matched, and a rising
  // glucose is the opposite of a dose instruction.
  { id: "colloquial_change", needsTarget: true, re: /\b(?:bump|knock|nudge|dial|crank|ease)\b\s+(?:it|them|that|this|the dose|your dose|the basal|your basal|the amount)\b[^.!?]{0,12}?\b(?:up|down|back|higher|lower)\b/i },
  // "an extra correction is often given", "the evening dose is normally reduced"
  { id: "implied_dose_change", needsTarget: false, re: new RegExp(`${IMPLIED_DOSE.source}[^.!?]{0,40}?\\b(?:is|are|was|were|often|usually|typically|normally|would|could|gets?)\\b[^.!?]{0,25}?\\b(?:given|added|taken|needed|required|increased|reduced)\\b`, "i") },
  { id: "stacking", needsTarget: true, re: /stack(?:ing)?s+(?:corrections?|insulin|doses?|boluses)/i },
  // Anchored to the start of the sentence on purpose. "The evening dose is normally reduced on days
  // like this" is a recommendation; "...most noticeable when the dose is being increased" is a
  // temporal clause in an education string, and anchoring is what separates them.
  { id: "named_dose_change", needsTarget: false, re: /^(?:the|your)\s+(?:(?:evening|morning|bedtime|breakfast|lunch|dinner|basal|bolus|insulin|long-?acting|rapid-?acting)\s+)?dose\b[^.!?]{0,30}?\b(?:increased|decreased|reduced|lowered|raised|adjusted|held|skipped|doubled|halved)\b/i },
  { id: "go_up_by", needsTarget: true, re: /\b(?:go|going|goes)\s+(?:up|down|higher|lower)\b[^.!?]{0,18}?\b(?:by\s+)?(?:\d+(?:\.\d+)?|a (?:couple|touch|bit|little))\b/i },
  { id: "percent_change", needsTarget: true, re: /\b(?:up|down|increase|decrease|raise|lower|reduce|by)\b[^.!?]{0,15}?\b\d+\s*%/i },

  /* ---------- drug choice and swapping: advice regardless of person ---------- */
  {
    id: "drug_preference",
    needsTarget: false,
    re: new RegExp(
      `\\b(?:${DRUG}|long-?acting|short-?acting|rapid-?acting|ultra-?long)\\b[^.!?]{0,45}?\\b(?:instead|rather than|better|suits|works better|is flatter|smoother|a different (?:day|time)|switch|swap)\\b|` +
        `\\b(?:instead of|rather than|switch to|swap to|move to|ask for|better on|better with|do better on|prefer)\\b[^.!?]{0,30}?\\b(?:${DRUG}|long-?acting|short-?acting|rapid-?acting|ultra-?long)\\b`,
      "i",
    ),
  },

  /* ---------- advice wearing a question mark, aimed at the reader ---------- */
  {
    id: "advice_question",
    needsTarget: false,
    re: new RegExp(
      `\\b(?:have you (?:thought|considered)|why not|would it help|has anyone suggested|what about|how about|ever tried|could you)\\b[^?]{0,80}?` +
        `(?:${AMOUNT_UNIT.source}|\\b(?:${THING})\\b|\\b(?:${COMPARATIVE})\\b|\\b\\d+\\b)`,
      "i",
    ),
  },
];

/**
 * Sentences that only REPORT or DEFER, checked LAST and only when the sentence contains no
 * instruction aimed at the reader. This is a narrow exemption, not the old front-door allowlist:
 * "you logged 22 units yesterday" survives, "you logged 22 units, so take 26 tonight" does not,
 * because the second clause carries an instruction.
 */
const REPORT_ONLY = new RegExp(
  `^(?=[^.!?]*\\b(?:logged|log shows|recorded|records|entered|noted|shows|showed|reported|you took|you have taken|you've taken|totall?ing|totaled|totalled|averaged|averages|according to your|in your log|on record|history shows|i cannot|i can't|i never|belongs to|decisions? for)\\b)`,
  "i",
);

/** An instruction aimed at the reader, used to disqualify the report-only exemption. */
const HAS_INSTRUCTION = new RegExp(
  `\\b(?:${INSTRUCT})\\b|\\bso\\b[^.!?]{0,20}?\\b\\d+|\\bmake it\\b|\\bbut\\b[^.!?]{0,40}?${AMOUNT_UNIT.source}`,
  "i",
);

export type FilterResult = { text: string; filtered: boolean; hits: string[]; ruleIds: string[] };

/**
 * Is this sentence aimed at the reader? Directive patterns only count when it is, which is what
 * keeps physiology ("increase insulin release") and the patient's own questions ("what should I do
 * if I miss a dose?") out of the filter while still catching "take it earlier tomorrow".
 */
function aimedAtReader(n: string): boolean {
  // A question about the person's own care is theirs to ask, even when it says "tell you".
  if (/\?\s*$/.test(n) && /\b(?:my|mine|mi|mis)\b/i.test(n)) return false;
  if (FIRST_PERSON_ADVICE.test(n)) return true;
  if (CONDITIONAL_FRAME.test(n)) return false; // "if you take insulin, ..." is a condition
  if (/\?\s*$/.test(n) && /\b(?:i|me|yo)\b/i.test(n) && !SECOND_PERSON.test(n)) return false;
  return SECOND_PERSON.test(n) || IMPERATIVE_OPENER.test(n);
}

function looksLikeDosing(normalised: string): string | null {
  if (DOSE_JARGON.test(normalised)) return "dose_jargon";
  const targeted = aimedAtReader(normalised);
  for (const p of PATTERNS) {
    if (p.needsTarget && !targeted) continue;
    if (p.re.test(normalised)) return p.id;
  }
  return null;
}

/**
 * Split into sentences, keeping the original text so the reader sees their own words back.
 * Newlines are treated as sentence breaks AND the pieces are rejoined for window matching, so
 * advice split across a line break is still caught.
 */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function filterDoseLanguage(text: string): FilterResult {
  const parts = sentencesOf(text);
  if (parts.length === 0) return { text: text.trim(), filtered: false, hits: [], ruleIds: [] };

  const norm = parts.map(normalise);
  const blocked = new Array<string | null>(parts.length).fill(null);

  for (let i = 0; i < parts.length; i++) {
    const hit = looksLikeDosing(norm[i]);
    if (hit) blocked[i] = hit;
  }
  // A two-sentence window catches advice deliberately split in half.
  for (let i = 0; i < parts.length - 1; i++) {
    if (blocked[i] && blocked[i + 1]) continue;
    const hit = looksLikeDosing(`${norm[i]} ${norm[i + 1]}`);
    if (hit) {
      // Only the half carrying the number or the drug is removed, so an innocent lead-in survives.
      const carries = (n: string) => BARE_AMOUNT.test(n) || new RegExp(`\\b(?:${DRUG}|${UNIT})\\b`, "i").test(n);
      const a = carries(norm[i]);
      const b = carries(norm[i + 1]);
      if (a) blocked[i] = blocked[i] ?? hit;
      if (b) blocked[i + 1] = blocked[i + 1] ?? hit;
      if (!a && !b) blocked[i + 1] = blocked[i + 1] ?? hit;
    }
  }

  /**
   * A whole-text pass, for advice broken across more line breaks than any window covers:
   * "Take four\nmore\nunits" arrives as three fragments, none of which says anything on its own.
   * If the reassembled text reads as dosing and nothing was caught in isolation, every fragment
   * carrying a number, a unit or a drug name goes.
   */
  if (!blocked.some(Boolean) && parts.length > 1) {
    const whole = looksLikeDosing(norm.join(" "));
    if (whole) {
      const carries = new RegExp(`\\b(?:${DRUG}|${UNIT})\\b`, "i");
      for (let i = 0; i < parts.length; i++) {
        if (BARE_AMOUNT.test(norm[i]) || carries.test(norm[i])) blocked[i] = whole;
      }
      // If it read as dosing only when reassembled, and no single fragment carries the evidence,
      // the safe move is to drop the lot rather than publish half an instruction.
      if (!blocked.some(Boolean)) for (let i = 0; i < parts.length; i++) blocked[i] = whole;
    }
  }

  const hits: string[] = [];
  const ruleIds: string[] = [];
  const out = parts.map((sentence, i) => {
    const rule = blocked[i];
    if (!rule) return sentence;
    // Last chance: a sentence that only reports or defers, with no instruction in it, is kept.
    if (REPORT_ONLY.test(norm[i]) && !HAS_INSTRUCTION.test(norm[i])) return sentence;
    hits.push(sentence);
    ruleIds.push(rule);
    return CARE_TEAM_POINTER;
  });

  const joined = out.join(" ").replace(new RegExp(`(?:${escapeRe(CARE_TEAM_POINTER)}\\s*){2,}`, "g"), `${CARE_TEAM_POINTER} `);
  return { text: joined.trim(), filtered: hits.length > 0, hits, ruleIds };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------ certainty ------------------------------ */

/**
 * Individualised certainty, and any claim that a clinician has seen this. A false claim of
 * clinician review is the one statement that turns an honest product into a misrepresentation.
 */
const CERTAINTY: { re: RegExp; to: string }[] = [
  {
    re: /\b(?:a|an|our|the|my|your)?\s*(?:doctor|physician|clinician|nurse|specialist|endocrinologist|gp|medical team|clinical team|care team)\s*(?:has|have|had|was|were|is|are)?\s*(?:been\s+)?(?:reviewed|read|checked|approved|validated|verified|seen|looked at|signed off)\b/gi,
    to: "nobody medically qualified has looked at",
  },
  {
    re: /\b(?:this|that|these|the notes?|the content)\s+(?:has been|have been|was|were|is|are)\s+(?:reviewed|approved|validated|verified|checked)\s+by\s+(?:a|an|our|the)?\s*(?:doctor|physician|clinician|nurse|specialist|endocrinologist|medical|clinical)\w*\b/gi,
    to: "this has not been looked at by anyone medically qualified",
  },
  {
    re: /\byou(?:'ve| have)? (?:definitely |certainly |clearly |probably )?(?:got|have)\s+(diabetes|dka|ketoacidosis|neuropathy|retinopathy|nephropathy|hypoglycemia unawareness|insulin resistance|gastroparesis)\b/gi,
    to: "this could be consistent with $1",
  },
  { re: /\bthis (?:proves|confirms|means you have)\b/gi, to: "this may suggest" },
  { re: /\b(?:definitely|certainly|without a doubt|no question)\b/gi, to: "possibly" },
  { re: /\bi can diagnose\b/gi, to: "I cannot diagnose" },
  { re: /\bi(?:'m| am) a (?:doctor|physician|nurse|clinician)\b/gi, to: "I am not a clinician" },
];

export function softenCertainty(text: string): { text: string; changed: boolean } {
  let t = text;
  let changed = false;
  for (const { re, to } of CERTAINTY) {
    const next = t.replace(re, to);
    if (next !== t) {
      changed = true;
      t = next;
    }
  }
  return { text: t, changed };
}

export const CERTAINTY_PHRASES = CERTAINTY.map((c) => c.re);
