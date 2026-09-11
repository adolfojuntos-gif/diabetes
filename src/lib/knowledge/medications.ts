/**
 * CONTROLLED MEDICATION KNOWLEDGE.
 *
 * General, class-level information the Copilot may explain. It never includes doses, never
 * says whether a person should take, stop, or change anything, and names its source and review
 * status on every item. Nothing here is clinician-reviewed until a clinician has reviewed it.
 */
export type MedicationKnowledge = {
  id: string;
  names: string[]; // generic first, then common brands (lowercase for matching)
  displayName: string;
  drugClass: string;
  generallyUsedFor: string;
  howItGenerallyWorks: string;
  commonConsiderations: string[];
  commonSideEffects: string[];
  precautions: string[];
  questionsToAsk: string[];
  source: string;
  version: string;
  reviewDate: string;
  reviewStatus: "draft_needs_clinician_review" | "clinician_reviewed";
};

const SRC = "FDA prescribing information (class labeling); ADA Standards of Care in Diabetes. Pharmacologic Approaches to Glycemic Treatment";
const V = "2026.09.1";
const R = "2026-09-10";

export const MEDICATION_KNOWLEDGE: MedicationKnowledge[] = [
  {
    id: "metformin",
    names: ["metformin", "glucophage", "fortamet", "glumetza", "riomet"],
    displayName: "Metformin",
    drugClass: "Biguanide",
    generallyUsedFor: "Type 2 diabetes; sometimes prediabetes or gestational diabetes at a clinician's discretion.",
    howItGenerallyWorks: "Reduces the amount of glucose the liver releases and improves the body's response to insulin. It does not cause the pancreas to release more insulin, so on its own it rarely causes lows.",
    commonConsiderations: ["Usually taken with food to reduce stomach upset.", "Kidney function is checked before starting and periodically, because the dose depends on it.", "Long-term use is linked with lower vitamin B12 levels."],
    commonSideEffects: ["Nausea, diarrhea, stomach upset (often improves over weeks)", "Metallic taste", "Reduced appetite"],
    precautions: ["Clinicians may pause it around certain imaging contrast dyes, surgery, or serious illness with dehydration.", "Rare but serious: lactic acidosis, mainly with significant kidney impairment."],
    questionsToAsk: ["Should I take this with meals?", "How often should my kidney function and B12 be checked?", "Is there anything I should do about it when I'm sick or having a scan?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "sulfonylurea",
    names: ["glipizide", "glimepiride", "glyburide", "gliclazide", "glucotrol", "amaryl", "diabeta", "micronase"],
    displayName: "Sulfonylureas (glipizide, glimepiride, glyburide, gliclazide)",
    drugClass: "Sulfonylurea",
    generallyUsedFor: "Type 2 diabetes.",
    howItGenerallyWorks: "Prompts the pancreas to release more insulin, regardless of what glucose is doing. Which is why this class can cause lows.",
    commonConsiderations: ["Lows are the main risk, especially with skipped meals, alcohol, or exercise.", "Some weight gain is common.", "Timing relative to meals matters; the prescriber sets it."],
    commonSideEffects: ["Hypoglycemia", "Weight gain", "Occasionally nausea or skin reactions"],
    precautions: ["Older adults and people with kidney impairment are at higher risk of prolonged lows (particularly with glyburide).", "Carry fast-acting carbohydrate."],
    questionsToAsk: ["What should I do if I skip a meal?", "How do I recognise and treat a low on this medicine?", "Is this still the right choice for me given my lows?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "dpp4",
    names: ["sitagliptin", "linagliptin", "saxagliptin", "alogliptin", "januvia", "tradjenta", "onglyza", "nesina"],
    displayName: "DPP-4 inhibitors (sitagliptin, linagliptin, and others)",
    drugClass: "DPP-4 inhibitor",
    generallyUsedFor: "Type 2 diabetes.",
    howItGenerallyWorks: "Prolongs the action of the body's own gut hormones (incretins), which increase insulin release after meals and reduce glucose output from the liver, in a glucose-dependent way. So lows are uncommon on their own.",
    commonConsiderations: ["Weight-neutral.", "Generally well tolerated.", "Modest glucose-lowering effect."],
    commonSideEffects: ["Headache", "Upper respiratory symptoms", "Nasopharyngitis"],
    precautions: ["Rare reports of pancreatitis; severe abdominal pain should be reported.", "Joint pain has been reported.", "Saxagliptin and alogliptin carry heart-failure cautions."],
    questionsToAsk: ["Does this interact with my other medicines?", "What symptoms should I report right away?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "sglt2",
    names: ["empagliflozin", "dapagliflozin", "canagliflozin", "ertugliflozin", "jardiance", "farxiga", "invokana", "steglatro"],
    displayName: "SGLT2 inhibitors (empagliflozin, dapagliflozin, canagliflozin)",
    drugClass: "SGLT2 inhibitor",
    generallyUsedFor: "Type 2 diabetes; also used for heart failure and chronic kidney disease protection, including in people without diabetes.",
    howItGenerallyWorks: "Causes the kidneys to remove more glucose through the urine. Works independently of insulin, so lows are uncommon on its own.",
    commonConsiderations: ["Increases urination; hydration matters.", "Modest weight and blood pressure reduction are common.", "Heart and kidney protective effects shown in trials."],
    commonSideEffects: ["Genital yeast infections", "Urinary tract infections", "Increased urination, thirst"],
    precautions: ["Ketoacidosis can occur at near-normal glucose ('euglycemic DKA'), especially with fasting, illness, very low-carb eating, surgery, or in type 1 diabetes; nausea, vomiting or abdominal pain should be reported promptly.", "Clinicians commonly advise pausing around surgery or serious illness (a 'sick-day rule'). Ask yours.", "Dehydration and low blood pressure, particularly in older adults or with diuretics."],
    questionsToAsk: ["What should I do with this medicine when I'm sick or fasting?", "How do I recognise ketoacidosis on this medicine?", "How much should I be drinking?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "glp1",
    names: ["semaglutide", "liraglutide", "dulaglutide", "exenatide", "ozempic", "wegovy", "rybelsus", "victoza", "saxenda", "trulicity", "byetta", "bydureon"],
    displayName: "GLP-1 receptor agonists (semaglutide, liraglutide, dulaglutide)",
    drugClass: "GLP-1 receptor agonist",
    generallyUsedFor: "Type 2 diabetes; some are also approved for weight management and cardiovascular risk reduction.",
    howItGenerallyWorks: "Mimics a gut hormone that increases insulin release when glucose is high, slows stomach emptying, reduces glucose output from the liver, and reduces appetite.",
    commonConsiderations: ["Most are weekly or daily injections; one semaglutide product is a tablet.", "Nausea is common early and often eases; smaller meals help.", "Weight loss is common."],
    commonSideEffects: ["Nausea, vomiting, diarrhea or constipation", "Reduced appetite", "Injection-site reactions"],
    precautions: ["Not used with a personal or family history of medullary thyroid cancer or MEN 2.", "Pancreatitis has been reported; severe persistent abdominal pain should be reported.", "Gallbladder problems; dehydration from vomiting can affect kidneys.", "Combined with insulin or sulfonylureas, lows are possible."],
    questionsToAsk: ["How do I manage the nausea?", "What should I do if I miss a dose?", "Should anything about my other diabetes medicines change while I'm on this? (a decision for the prescriber)"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "gip_glp1",
    names: ["tirzepatide", "mounjaro", "zepbound"],
    displayName: "Tirzepatide (GIP/GLP-1 receptor agonist)",
    drugClass: "Dual GIP and GLP-1 receptor agonist",
    generallyUsedFor: "Type 2 diabetes; also approved for weight management.",
    howItGenerallyWorks: "Acts on two gut-hormone receptors to increase glucose-dependent insulin release, slow stomach emptying, and reduce appetite.",
    commonConsiderations: ["Weekly injection.", "Substantial weight loss is common.", "Gastrointestinal effects are most noticeable when the dose is being increased."],
    commonSideEffects: ["Nausea, diarrhea, decreased appetite, vomiting, constipation"],
    precautions: ["Same thyroid C-cell tumour warning as GLP-1 agonists.", "Pancreatitis, gallbladder disease reported.", "Lows possible when combined with insulin or sulfonylureas."],
    questionsToAsk: ["How quickly should the dose increase happen for me?", "What should I eat to reduce nausea?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "tzd",
    names: ["pioglitazone", "rosiglitazone", "actos", "avandia"],
    displayName: "Pioglitazone (thiazolidinedione)",
    drugClass: "Thiazolidinedione",
    generallyUsedFor: "Type 2 diabetes.",
    howItGenerallyWorks: "Improves the body's sensitivity to insulin in muscle and fat.",
    commonConsiderations: ["Takes weeks to reach full effect.", "Weight gain and fluid retention are common.", "Does not cause lows on its own."],
    commonSideEffects: ["Weight gain", "Swelling (edema)", "Anemia (mild)"],
    precautions: ["Can worsen heart failure.", "Bone fracture risk, especially in women.", "Bladder cancer signal has been studied; blood in urine should be reported."],
    questionsToAsk: ["Is this safe with my heart?", "What swelling should I report?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "insulin_rapid",
    names: ["lispro", "aspart", "glulisine", "humalog", "novolog", "novorapid", "apidra", "fiasp", "lyumjev", "admelog"],
    displayName: "Rapid-acting insulin (lispro, aspart, glulisine)",
    drugClass: "Insulin. Rapid-acting",
    generallyUsedFor: "Mealtime ('bolus') coverage and correcting highs, in type 1 and type 2 diabetes; the insulin used in most pumps.",
    howItGenerallyWorks: "Starts working within about 15 minutes, peaks around 1–2 hours, and lasts roughly 3–5 hours. Timing relative to meals is set by the prescriber.",
    commonConsiderations: ["Dose depends on food, glucose, activity and individual sensitivity. Decided with the care team.", "Lows are the main risk.", "Rotating injection sites prevents lumps (lipohypertrophy) that make absorption unpredictable."],
    commonSideEffects: ["Hypoglycemia", "Injection-site reactions", "Weight gain"],
    precautions: ["Never share pens or needles.", "Store unopened insulin refrigerated; in-use pens per label at room temperature.", "Stacking corrections close together increases the risk of lows."],
    questionsToAsk: ["When should I take it relative to eating?", "What should I do about it when I exercise?", "How should I handle a correction if I'm already high?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "insulin_basal",
    names: ["glargine", "detemir", "degludec", "lantus", "basaglar", "toujeo", "semglee", "levemir", "tresiba", "nph", "humulin n", "novolin n"],
    displayName: "Long-acting / basal insulin (glargine, detemir, degludec, NPH)",
    drugClass: "Insulin. Basal",
    generallyUsedFor: "Background insulin coverage across the day and night, in type 1 and type 2 diabetes.",
    howItGenerallyWorks: "Released slowly over many hours (roughly 12 hours for NPH, up to 24 hours or more for glargine, detemir and degludec) to cover the glucose the liver releases between meals and overnight.",
    commonConsiderations: ["Usually once (sometimes twice) daily at a consistent time.", "Overnight and fasting readings are what clinicians look at when reviewing basal insulin.", "NPH has a peak and a higher risk of overnight lows than the newer analogues."],
    commonSideEffects: ["Hypoglycemia (especially overnight)", "Injection-site reactions", "Weight gain"],
    precautions: ["Never share pens.", "Don't mix glargine, detemir or degludec with other insulins in a syringe.", "A missed or doubled dose should be discussed with the care team rather than 'made up' on guesswork."],
    questionsToAsk: ["What fasting readings would tell you my basal dose needs looking at?", "What should I do if I forget a dose?", "How should I adjust around travel across time zones? (a plan to make together)"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "insulin_premixed",
    names: ["70/30", "75/25", "50/50", "humalog mix", "novolog mix", "humulin 70/30", "novolin 70/30", "ryzodeg"],
    displayName: "Premixed insulin (70/30, 75/25, 50/50)",
    drugClass: "Insulin. Premixed",
    generallyUsedFor: "A fixed combination of intermediate/long-acting and rapid/short-acting insulin, usually twice daily with meals.",
    howItGenerallyWorks: "Covers both background needs and a meal in one injection, at the cost of less flexibility in meal timing and size.",
    commonConsiderations: ["Meal timing and consistency matter more than with separate basal and bolus insulins.", "Cloudy mixes need gentle rolling before use."],
    commonSideEffects: ["Hypoglycemia (especially if a meal is small, late or skipped)", "Weight gain"],
    precautions: ["Skipping a meal after the injection risks a low.", "Never share pens."],
    questionsToAsk: ["What should I do if I can't eat after taking it?", "Would separate insulins give me more flexibility?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "glucagon",
    names: ["glucagon", "baqsimi", "gvoke", "zegalogue", "dasiglucagon"],
    displayName: "Glucagon (rescue for severe lows)",
    drugClass: "Rescue medication",
    generallyUsedFor: "Severe hypoglycemia when a person cannot safely take carbohydrate by mouth or is unresponsive. Given by another person.",
    howItGenerallyWorks: "Signals the liver to release stored glucose, raising blood glucose within about 10–15 minutes. Available as nasal powder, auto-injector, or a kit that needs mixing.",
    commonConsiderations: ["Recommended for everyone at risk of level 2 or 3 hypoglycemia (on insulin or sulfonylureas).", "Family, friends and co-workers should know where it is and how to use it.", "Check the expiry date periodically."],
    commonSideEffects: ["Nausea and vomiting after it works", "Headache"],
    precautions: ["Call emergency services when it is used.", "Once the person is awake and able to swallow, they need carbohydrate by mouth.", "It works less well if liver glycogen is depleted (prolonged fasting, alcohol)."],
    questionsToAsk: ["Should I have a glucagon prescription?", "Which form is easiest for the people around me to use?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "statin",
    names: ["atorvastatin", "rosuvastatin", "simvastatin", "pravastatin", "lipitor", "crestor", "zocor"],
    displayName: "Statins (atorvastatin, rosuvastatin, simvastatin)",
    drugClass: "Statin (cholesterol-lowering)",
    generallyUsedFor: "Reducing cardiovascular risk; recommended for most adults with diabetes over 40 by the ADA, individualised.",
    howItGenerallyWorks: "Reduces cholesterol production in the liver, lowering LDL cholesterol.",
    commonConsiderations: ["Taken long-term; benefits are about future risk rather than how you feel.", "May slightly raise glucose, which guidelines consider outweighed by cardiovascular benefit."],
    commonSideEffects: ["Muscle aches", "Headache", "Digestive upset"],
    precautions: ["Unexplained severe muscle pain or dark urine should be reported promptly.", "Some interact with grapefruit or other medicines."],
    questionsToAsk: ["Why was this recommended for me?", "What should I do about muscle aches?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
  {
    id: "ace_arb",
    names: ["lisinopril", "enalapril", "ramipril", "losartan", "valsartan", "irbesartan", "olmesartan", "zestril", "cozaar", "diovan"],
    displayName: "ACE inhibitors and ARBs (lisinopril, losartan, and others)",
    drugClass: "Blood pressure / kidney protection",
    generallyUsedFor: "High blood pressure; protecting the kidneys when albumin appears in the urine, in people with diabetes.",
    howItGenerallyWorks: "Relaxes blood vessels and reduces pressure inside the kidney's filters.",
    commonConsiderations: ["Kidney function and potassium are checked after starting and periodically.", "A dry cough is a known ACE-inhibitor effect; ARBs usually avoid it."],
    commonSideEffects: ["Dizziness, especially when standing", "Dry cough (ACE inhibitors)", "Raised potassium"],
    precautions: ["Not used in pregnancy.", "Swelling of lips, face or tongue (angioedema) is an emergency."],
    questionsToAsk: ["Is this for blood pressure, kidneys, or both?", "How often will my potassium and kidney function be checked?"],
    source: SRC, version: V, reviewDate: R, reviewStatus: "draft_needs_clinician_review",
  },
];

/** Find the knowledge item matching a medication name the person typed. */
export function findMedication(name: string): MedicationKnowledge | undefined {
  const n = name.toLowerCase().trim();
  if (!n) return undefined;
  return MEDICATION_KNOWLEDGE.find((m) => m.names.some((alias) => n.includes(alias) || alias.includes(n)));
}

export function medicationById(id: string): MedicationKnowledge | undefined {
  return MEDICATION_KNOWLEDGE.find((m) => m.id === id);
}
