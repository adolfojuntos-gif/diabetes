import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDoseLanguage, softenCertainty, normalise, CARE_TEAM_POINTER } from "../src/lib/ai/filter";
import { CLINICAL_KNOWLEDGE } from "../src/lib/knowledge/clinical";
import { MEDICATION_KNOWLEDGE } from "../src/lib/knowledge/medications";
import { detectPatterns } from "../src/lib/engines/patterns";
import { STANDING_QUESTIONS } from "../src/lib/engines/doctorQuestions";

/**
 * The dose filter's two obligations, tested against each other.
 *
 * An adversarial pass put 53 of 60 real dosing sentences through the first version of this filter,
 * and the same version deleted 8 of the app's own 153 reviewed knowledge strings. Either failure
 * alone is a product defect, and fixing one by loosening or tightening is how you trade a miss for
 * a deletion. So both corpora run here, and both must be clean.
 */

/* ============================ MUST BE CAUGHT ============================ */

const MUST_CATCH: [string, string][] = [
  // plain imperatives
  ["plain", "You should take 4 more units of insulin now."],
  ["plain", "Try increasing your basal by 2 units tonight."],
  ["plain", "Reduce your dose to 18 units."],
  ["plain", "Give yourself 6u of Humalog."],
  ["plain", "Add six units at dinner."],
  ["plain", "Take an extra unit before the meal."],
  ["plain", "Inject 10 units before you eat."],
  // spelled out numbers
  ["words", "Try two units extra with that meal."],
  ["words", "Half a pen should cover a meal that size."],
  ["words", "Ten units is a reasonable place to start."],
  ["words", "Twenty units of the long-acting one at bedtime."],
  ["words", "Take four more units."],
  // passive voice
  ["passive", "Your basal is usually increased by about 10% in this situation."],
  ["passive", "An extra correction is often given when readings sit above 250."],
  ["passive", "Two units would typically be added before a meal like that."],
  ["passive", "The evening dose is normally reduced on days like this."],
  // hedged and conditional
  ["hedged", "You might consider whether a little more would help before dinner."],
  ["hedged", "Some people in your position find that a slightly smaller evening amount works better."],
  ["hedged", "It may be worth trying a bit less before you exercise."],
  ["hedged", "If it were me, I'd go a little higher on the evening one."],
  // stopping and holding
  ["stop", "I would skip your metformin this evening."],
  ["stop", "You could stop taking your insulin until the nausea passes."],
  ["stop", "Consider holding your bedtime dose."],
  ["stop", "Just miss tonight's injection."],
  // switching drugs
  ["switch", "Switch to Lantus instead."],
  ["switch", "Ask for Tresiba instead, it's flatter."],
  ["switch", "Metformin in the evening suits most people better."],
  ["switch", "You'd do better on a long-acting one at night."],
  ["switch", "Ozempic on a different day of the week might settle the nausea."],
  // ratios and factors
  ["ratio", "Use 1 unit for every 10 grams of carbohydrate."],
  ["ratio", "One for every ten grams is the usual starting point."],
  ["ratio", "Your ratio should be one to ten."],
  ["ratio", "Your correction factor is probably too weak."],
  ["ratio", "Your ISF looks off, make it stronger."],
  ["ratio", "Your I:C ratio needs tightening at breakfast."],
  ["ratio", "Your carb ratio is probably too high for the morning."],
  // pump jargon
  ["pump", "A square wave bolus would handle pizza better."],
  ["pump", "Try a dual wave bolus for that meal."],
  ["pump", "Your basal rate between 2am and 6am needs to come down."],
  ["pump", "Set a temp basal of 80% while you walk."],
  ["pump", "Pre-bolus by 20 minutes and the spike will flatten."],
  ["pump", "You should titrate up until fasting sits under 130."],
  ["pump", "A sliding scale would suit these numbers better."],
  // timing with no number
  ["timing", "Take it earlier tomorrow and see what happens."],
  ["timing", "Move it to the evening instead."],
  ["timing", "Have it with food next time rather than before."],
  // questions that are advice
  ["question", "Have you thought about taking 2 extra?"],
  ["question", "Why not try a slightly larger evening amount?"],
  ["question", "Would it help to hold tonight's long-acting one?"],
  ["question", "Has anyone suggested you go up by 10%?"],
  // colloquial
  ["colloquial", "Bump it up a touch tonight."],
  ["colloquial", "Go up by two."],
  ["colloquial", "Knock it back by a couple."],
  ["colloquial", "I'd round that up to 8."],
  ["colloquial", "The number you're looking for is 9."],
  ["colloquial", "For a 90 gram meal like that, the usual amount is nine."],
  ["colloquial", "Cover 60 grams with 6."],
  // Spanish
  ["spanish", "Toma cuatro unidades mas antes de la cena."],
  ["spanish", "Aumenta tu insulina basal en 2 unidades."],
  ["spanish", "Puedes ponerte dos unidades extra."],
  ["spanish", "Deja de tomar la metformina por hoy."],
  // schedules and tables
  ["schedule", "What I'd do: breakfast 6, lunch 8, dinner 10."],
  ["schedule", "- Breakfast: 6 units\n- Lunch: 8 units\n- Dinner: 10 units"],
  ["schedule", "| Meal | Units |\n| Breakfast | 6 |\n| Dinner | 10 |"],
  // evasions
  ["evasion", "Take 4 more\nunits."],
  ["evasion", "Take four\nmore\nunits"],
  ["evasion", "T a k e   4   m o r e   u n i t s"],
  ["evasion", "Take 4 more unıts."],
  ["evasion", "**Increase your basal by 2 units.**"],
  // the allowlist bypass, which is the whole reason this file was rewritten
  ["bypass", "Take 4 more units before dinner, according to your log."],
  ["bypass", "You logged 22 units yesterday, so take 26 tonight."],
  ["bypass", "Increase your basal by 2 units, but of course, talk to your doctor."],
  ["bypass", "Ask your care team, but you should take 6 extra units now."],
  ["bypass", "I can't suggest a dose, but 8 units would cover that meal."],
  ["bypass", "Your history shows you need 2 more units at breakfast."],
  ["bypass", "Your log shows 10 units; make it 14 tomorrow."],
  // split across sentences
  ["split", "Your morning number is high. So before breakfast tomorrow, make it two more."],
  ["split", "That meal was 90 grams of carbohydrate. The amount you want here is nine."],
];

test("every dosing sentence in the corpus is caught", () => {
  const missed: string[] = [];
  for (const [group, line] of MUST_CATCH) {
    const r = filterDoseLanguage(line);
    if (!r.filtered) missed.push(`[${group}] ${line.replace(/\n/g, " / ")}`);
  }
  assert.deepEqual(missed, [], `${missed.length} of ${MUST_CATCH.length} dosing sentences got through`);
});

test("a caught sentence leaves no number of units visible to the reader", () => {
  for (const [, line] of MUST_CATCH) {
    const r = filterDoseLanguage(line);
    const remaining = r.text.split(CARE_TEAM_POINTER).join(" ");
    assert.equal(
      /\b\d+(?:\.\d+)?\s*(?:units?|u|iu|unidades?)\b/i.test(remaining),
      false,
      `a dose amount survived in: ${r.text}`,
    );
  }
});

/* ============================ MUST SURVIVE ============================ */

const MUST_PASS: string[] = [
  "Your time in range was 62% over the last 14 days.",
  "Insulin is the hormone that moves glucose into cells.",
  "A 10 minute walk after dinner often softens the rise.",
  "Dose decisions belong to you and your prescriber.",
  "You logged 22 units yesterday, which is what you have been recording all week.",
  "Your log shows 10 units of basal on each of the last seven nights.",
  "I cannot suggest a dose. That is a decision for your prescriber.",
  "Across 45 days you averaged 135 mg/dL with 84% of readings in range.",
  "Yesterday you logged 3 meals totalling 118 grams of carbohydrate.",
  "Your lowest reading this fortnight was 53 mg/dL on Wednesday.",
  "Readings under 54 are the ones your care team most wants to hear about.",
  "Ask your care team what range they would like you to aim for.",
  "Meals tagged takeout rose an average of 68 mg/dL across 6 meals.",
  "Short nights were followed by higher days: 148 versus 121 mg/dL.",
  "Hydration was at or above your goal on 5 of 7 logged days.",
  "That is 63 minutes of movement against a 150 minute weekly guideline.",
  "A1C reflects average glucose over roughly the previous 2 to 3 months.",
  "Sixty percent of your readings were between 70 and 180.",
  "I can help you write down what you have noticed for that conversation.",
  "Worth asking your care team: what should I do when I am ill?",
];

test("legitimate sentences are not filtered", () => {
  const wrong: string[] = [];
  for (const line of MUST_PASS) {
    const r = filterDoseLanguage(line);
    if (r.filtered) wrong.push(`${line}   [rule: ${r.ruleIds.join(",")}]`);
  }
  assert.deepEqual(wrong, [], `${wrong.length} legitimate sentences were wrongly filtered`);
});

test("the filter only removes the offending sentence, not the whole reply", () => {
  const r = filterDoseLanguage(
    "Your mornings are running high. You should take 2 more units at bedtime. Worth asking your care team about it.",
  );
  assert.ok(r.text.includes("Your mornings are running high."));
  assert.ok(r.text.includes("Worth asking your care team about it."));
  assert.ok(!r.text.includes("2 more units"));
});

/* =================== THE APP'S OWN CONTENT MUST SURVIVE =================== */

test("every clinical knowledge string survives the filter", () => {
  const eaten: string[] = [];
  for (const k of CLINICAL_KNOWLEDGE) {
    for (const [field, value] of [["statement", k.statement], ["simple", k.simple]] as const) {
      const r = filterDoseLanguage(value);
      if (r.filtered) eaten.push(`${k.id}.${field} [${r.ruleIds.join(",")}] :: ${r.hits[0]?.slice(0, 90)}`);
    }
  }
  assert.deepEqual(eaten, [], `the filter deleted ${eaten.length} of the app's own reviewed clinical statements`);
});

test("every medication knowledge string survives the filter", () => {
  const eaten: string[] = [];
  for (const m of MEDICATION_KNOWLEDGE) {
    const fields: [string, string][] = [
      ["generallyUsedFor", m.generallyUsedFor],
      ["howItGenerallyWorks", m.howItGenerallyWorks],
      ...m.commonConsiderations.map((c, i) => [`consideration[${i}]`, c] as [string, string]),
      ...m.precautions.map((c, i) => [`precaution[${i}]`, c] as [string, string]),
      ...m.questionsToAsk.map((c, i) => [`question[${i}]`, c] as [string, string]),
    ];
    for (const [field, value] of fields) {
      const r = filterDoseLanguage(value);
      if (r.filtered) eaten.push(`${m.id}.${field} [${r.ruleIds.join(",")}] :: ${r.hits[0]?.slice(0, 90)}`);
    }
  }
  assert.deepEqual(eaten, [], `the filter deleted ${eaten.length} of the app's own reviewed medication statements`);
});

test("every standing doctor question survives the filter", () => {
  for (const q of STANDING_QUESTIONS) {
    const r = filterDoseLanguage(q.text);
    assert.equal(r.filtered, false, `filtered a question for the care team: ${q.text}`);
  }
});

test("every pattern the engine can emit survives the filter", () => {
  const dense = Array.from({ length: 14 }, (_, d) => d).flatMap((d) =>
    [3, 7, 8, 13, 19, 22].map((h) => ({ at: new Date(2026, 8, d + 1, h), valueMgdl: h === 3 ? 62 : h === 8 ? 210 : 150 })),
  );
  const report = detectPatterns({
    now: new Date(2026, 8, 15, 12),
    windowDays: 14,
    targetLow: 70,
    targetHigh: 180,
    hydrationGoalMl: 2000,
    sleepGoalMinutes: 450,
    usesInsulinBolus: true,
    readings: dense,
    meals: [],
    exercise: [],
    sleep: [],
    hydration: [],
    insulin: [],
  });
  assert.ok(report.patterns.length > 0, "no patterns to check");
  for (const p of report.patterns) {
    for (const [field, value] of [["evidence", p.evidence], ["suggestion", p.suggestion], ["doctorQuestion", p.doctorQuestion ?? ""]] as const) {
      if (!value) continue;
      const r = filterDoseLanguage(value);
      assert.equal(r.filtered, false, `pattern ${p.key}.${field} was filtered: ${value}`);
    }
  }
});

/* ============================ normalisation ============================ */

test("normalisation folds the evasions without changing meaning", () => {
  assert.equal(normalise("Take FOUR more Units"), "take 4 more units");
  assert.equal(normalise("Take 4 more\nunits"), "take 4 more units");
  assert.equal(normalise("**bold**"), "bold");
  assert.ok(normalise("unıts").includes("units"));
  assert.ok(normalise("T a k e 4").includes("take"));
});

/* ============================ certainty ============================ */

test("every claim of clinician review is rewritten", () => {
  const claims = [
    "A doctor has reviewed your results.",
    "This was checked by a physician.",
    "Our clinical team approved these notes.",
    "This has been validated by an endocrinologist.",
    "Your care team has seen this.",
    "A nurse looked at these numbers.",
  ];
  for (const c of claims) {
    const r = softenCertainty(c);
    assert.equal(r.changed, true, `not softened: ${c}`);
    assert.equal(
      /\b(?:doctor|physician|clinician|nurse|specialist|endocrinologist|clinical team|care team)\b[^.]*\b(?:reviewed|checked|approved|validated|seen|looked at)\b/i.test(r.text),
      false,
      `the claim survived: ${r.text}`,
    );
  }
});

test("diagnostic certainty is softened, plain facts are not", () => {
  assert.ok(softenCertainty("You definitely have neuropathy.").changed);
  assert.ok(softenCertainty("You've got DKA.").changed);
  assert.ok(softenCertainty("This proves you have insulin resistance.").changed);
  assert.ok(softenCertainty("I'm a doctor and I can tell you this is fine.").changed);
  assert.equal(softenCertainty("Your average was 148 mg/dL.").changed, false);
  assert.equal(softenCertainty("Time in range was 84% this week.").changed, false);
});
