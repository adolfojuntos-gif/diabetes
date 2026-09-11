/**
 * CONTROLLED CLINICAL KNOWLEDGE.
 *
 * The model is not the source of medical truth in this app. It retrieves items from this list
 * and explains them conversationally. Every item names where the statement comes from, when it
 * was written, and its review status. Nothing here is marked as clinician-reviewed until a
 * qualified professional has actually reviewed it — that field is honest by construction.
 *
 * Sources are named bodies and documents, not fabricated URLs or page numbers.
 */
export type KnowledgeItem = {
  id: string;
  topic: string;
  /** Keywords the retriever matches against the person's question. */
  keywords: string[];
  statement: string;
  /** For the "simple" style. */
  simple: string;
  source: string;
  sourceType: "guideline" | "consensus" | "study" | "educational";
  updated: string; // YYYY-MM-DD this item was written/updated in this codebase
  region: "international" | "US";
  reviewStatus: "draft_needs_clinician_review" | "clinician_reviewed";
  reviewBy: string; // when this item should be re-reviewed
  evidenceLevel?: string;
};

export const KNOWLEDGE_VERSION = "2026.09.1";

export const CLINICAL_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "tir_targets",
    topic: "Time in range",
    keywords: ["time in range", "tir", "in range", "target", "70", "180", "range"],
    statement:
      "The international consensus on time in range recommends that most adults with type 1 or type 2 diabetes aim for more than 70% of glucose readings between 70 and 180 mg/dL (3.9–10.0 mmol/L), less than 4% below 70 mg/dL, and less than 1% below 54 mg/dL. Targets are individualised. Older adults, people at high risk of hypoglycemia, and people who are pregnant have different goals.",
    simple: "A common goal is for about 7 out of 10 readings to land between 70 and 180. Your own target may be different. Your care team sets it with you.",
    source: "International Consensus on Time in Range (Battelino et al., Diabetes Care, 2019); ADA Standards of Care in Diabetes",
    sourceType: "consensus",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "hypo_levels",
    topic: "Hypoglycemia levels",
    keywords: ["low", "hypo", "hypoglycemia", "54", "70", "shaky", "sweaty"],
    statement:
      "Hypoglycemia is classified in three levels: level 1 is glucose below 70 mg/dL (3.9 mmol/L) and at or above 54; level 2 is below 54 mg/dL (3.0 mmol/L), which is clinically significant; level 3 is a severe event with altered mental or physical state requiring another person's help, regardless of the glucose value.",
    simple: "Under 70 is low. Under 54 is a serious low. Any low where you need someone else's help is the most serious kind, whatever the number.",
    source: "ADA Standards of Care in Diabetes. Glycemic Goals and Hypoglycemia; International Hypoglycaemia Study Group",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "hypo_treatment",
    topic: "Treating a low (rule of 15)",
    keywords: ["treat low", "rule of 15", "glucose tablets", "juice", "low", "hypo", "what do i do"],
    statement:
      "For a conscious person able to swallow, the standard approach to a low is 15–20 grams of fast-acting carbohydrate (glucose tablets, juice, regular soda, sugar or honey), recheck glucose after 15 minutes, repeat if still below 70 mg/dL, and once glucose is back up, eat a meal or snack to prevent recurrence. Glucagon is indicated for a person who cannot safely swallow or is unresponsive; it must be given by someone else, and emergency services should be called.",
    simple: "Eat or drink 15 grams of fast sugar. Like 4 glucose tablets or half a cup of juice. Wait 15 minutes and check again. Repeat if still under 70. Then have a snack.",
    source: "ADA Standards of Care in Diabetes. Hypoglycemia treatment recommendations",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "hyper_symptoms",
    topic: "High glucose and its symptoms",
    keywords: ["high", "hyperglycemia", "thirsty", "urination", "250", "300", "tired"],
    statement:
      "Sustained high glucose commonly produces increased thirst, frequent urination, fatigue and blurred vision. Glucose persistently above 250 mg/dL, especially in people with type 1 diabetes or on insulin, warrants checking for ketones; very high glucose with nausea, vomiting, abdominal pain, fruity-smelling breath or rapid breathing can indicate diabetic ketoacidosis, which is a medical emergency.",
    simple: "Very high sugar makes you thirsty, tired and needing the bathroom a lot. If it's very high AND you feel sick to your stomach or your breath smells fruity, that's an emergency.",
    source: "ADA Standards of Care in Diabetes; ADA patient education on hyperglycemia and DKA",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "dawn_phenomenon",
    topic: "Dawn phenomenon",
    keywords: ["morning", "dawn", "fasting high", "wake up high", "overnight rise"],
    statement:
      "The dawn phenomenon is an early-morning rise in glucose driven by the normal overnight release of hormones (growth hormone, cortisol, catecholamines) that increase glucose production by the liver and reduce insulin sensitivity. It is common in both type 1 and type 2 diabetes. Distinguishing it from a rebound after an overnight low, or from the effect of the previous evening's meal, generally requires readings in the middle of the night, which a care team may ask for.",
    simple: "Many people's sugar rises before breakfast because of normal morning hormones. Your care team can tell whether that's what's happening for you.",
    source: "ADA educational material; endocrinology reviews of the dawn phenomenon",
    sourceType: "educational",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "gmi",
    topic: "Glucose management indicator (GMI)",
    keywords: ["gmi", "estimated a1c", "glucose management indicator"],
    statement:
      "GMI estimates the A1C level that would be expected from a period of CGM data: GMI (%) = 3.31 + 0.02392 × mean glucose (mg/dL). It is most meaningful with at least 14 days of CGM data covering 70% or more of the time. GMI and laboratory A1C often differ for an individual, and a difference is not an error in either. It reflects biology and measurement differences.",
    simple: "GMI is a guess at what your A1C might be, based on your sensor readings. It's often a bit different from the lab A1C, and that's normal.",
    source: "Bergenstal et al., Diabetes Care 2018 (GMI); International Consensus on Time in Range 2019",
    sourceType: "study",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "variability_cv",
    topic: "Glucose variability",
    keywords: ["variability", "cv", "swings", "standard deviation", "up and down"],
    statement:
      "Glycemic variability is commonly summarised as the coefficient of variation (CV = standard deviation ÷ mean × 100). The international consensus sets a target CV of 36% or less; higher variability is associated with more frequent hypoglycemia.",
    simple: "If your numbers swing a lot, the app shows a percentage called CV. Under 36% is the usual goal.",
    source: "International Consensus on Time in Range (2019)",
    sourceType: "consensus",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "post_meal",
    topic: "Glucose after meals",
    keywords: ["after eating", "post meal", "postprandial", "spike", "carbs", "meal"],
    statement:
      "Glucose typically peaks 1–2 hours after the start of a meal. The ADA suggests a general post-meal target of below 180 mg/dL measured 1–2 hours after the start of the meal for many non-pregnant adults, individualised by the care team. The size of the rise depends on the amount and type of carbohydrate, and is moderated by fibre, protein, fat, and physical activity around the meal.",
    simple: "Your sugar usually peaks 1 to 2 hours after you start eating. Fibre, protein and a walk afterwards all soften the rise.",
    source: "ADA Standards of Care in Diabetes. Glycemic Targets; ADA nutrition therapy consensus report",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "exercise",
    topic: "Physical activity",
    keywords: ["exercise", "walk", "activity", "workout", "move", "150 minutes"],
    statement:
      "Most adults with diabetes are advised to accumulate at least 150 minutes per week of moderate-to-vigorous aerobic activity spread over at least 3 days, with no more than 2 consecutive days without activity, plus 2–3 sessions per week of resistance exercise. Breaking up prolonged sitting every 30 minutes with light activity has glucose benefits. Exercise can lower glucose for hours afterwards; people on insulin or sulfonylureas should be aware of the risk of lows during and after activity and discuss adjustments with their care team.",
    simple: "Aim for about 150 minutes of movement a week, and try not to sit for long stretches. Exercise can lower sugar for hours after. If you take insulin, talk with your team about lows.",
    source: "ADA Standards of Care in Diabetes. Physical Activity; ADA/ACSM position statement on exercise and diabetes",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "sleep",
    topic: "Sleep and glucose",
    keywords: ["sleep", "tired", "insomnia", "bedtime", "short night"],
    statement:
      "Short or poor-quality sleep is associated with reduced insulin sensitivity and higher glucose the following day, and with increased appetite. The ADA recommends assessing sleep as part of diabetes care and suggests that most adults aim for 7 or more hours per night. Obstructive sleep apnea is common in type 2 diabetes and is worth raising with a care team when snoring, daytime sleepiness or unrefreshing sleep are present.",
    simple: "Bad sleep can push your sugar up the next day. Most adults do best with 7 or more hours. If you snore or feel exhausted despite sleeping, tell your care team.",
    source: "ADA Standards of Care in Diabetes. Lifestyle Management (sleep health)",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "hydration",
    topic: "Hydration",
    keywords: ["water", "hydration", "thirsty", "dehydrated", "drink"],
    statement:
      "Water is the recommended default beverage for people with diabetes. High glucose increases urine output and can lead to dehydration, which in turn concentrates glucose further. General guidance is to drink to thirst and more during illness, heat, or when glucose is running high; people with heart or kidney conditions may have individual fluid limits set by their care team. Sugar-sweetened beverages are advised against.",
    simple: "Water is the best drink. When your sugar is high your body loses water, so drink more then. Skip sugary drinks.",
    source: "ADA Standards of Care in Diabetes. Nutrition; ADA nutrition therapy consensus report",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "sick_day",
    topic: "Illness and sick days",
    keywords: ["sick", "ill", "fever", "flu", "vomiting", "cold", "infection"],
    statement:
      "Illness and infection commonly raise glucose because of stress hormones, even when eating less. General sick-day education includes checking glucose more often, staying hydrated, continuing to take medication as prescribed unless a clinician has said otherwise, checking ketones if glucose is high (particularly in type 1 diabetes), and seeking same-day advice for vomiting, inability to keep fluids down, moderate or large ketones, or glucose that stays very high. A personal sick-day plan should come from the care team.",
    simple: "Being sick usually pushes sugar up. Check more often, drink water, and don't stop your medicines on your own. If you're vomiting or can't keep fluids down, call your care team today.",
    source: "ADA patient education on sick-day management; ADA Standards of Care in Diabetes",
    sourceType: "educational",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "foot_care",
    topic: "Foot care",
    keywords: ["foot", "feet", "wound", "blister", "numb", "tingling", "neuropathy"],
    statement:
      "People with diabetes are advised to check their feet daily for cuts, blisters, redness or swelling, to have a comprehensive foot examination at least annually, and to seek prompt professional evaluation for any wound, especially with reduced sensation or poor circulation. Numbness, tingling or burning in the feet can indicate peripheral neuropathy and should be reported to a care team.",
    simple: "Look at your feet every day. Any sore, cut or blister that isn't healing needs a professional to look at it soon. Numb or tingling feet are worth mentioning too.",
    source: "ADA Standards of Care in Diabetes. Foot Care; IWGDF guidelines",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "carb_counting",
    topic: "Carbohydrates and meal planning",
    keywords: ["carbs", "carbohydrate", "what should i eat", "diet", "food", "eat", "plate"],
    statement:
      "There is no single ideal percentage of calories from carbohydrate for people with diabetes; eating patterns should be individualised. Evidence supports emphasising non-starchy vegetables, minimising added sugars and refined grains, and choosing whole foods over highly processed ones. Carbohydrate counting or the plate method (half non-starchy vegetables, a quarter protein, a quarter carbohydrate) are common practical tools. Fibre, protein and fat in a meal slow the glucose rise.",
    simple: "There's no one right diet. A good starting picture: half the plate vegetables, a quarter protein, a quarter carbs like rice or potatoes. Fewer sugary drinks and white-flour foods.",
    source: "ADA Standards of Care in Diabetes. Nutrition Therapy; ADA nutrition consensus report",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_a1c",
    topic: "What A1C measures",
    keywords: ["a1c", "hba1c", "hemoglobin a1c", "average", "3 months"],
    statement:
      "Hemoglobin A1C reflects average glucose over roughly the previous 2–3 months, weighted toward the most recent weeks, by measuring the share of hemoglobin with glucose attached. It is used for diagnosis (a threshold of 6.5% is used for diabetes in appropriate clinical context) and for monitoring. A1C can be affected by conditions that change red blood cell lifespan (anemia, hemoglobin variants, pregnancy, kidney disease, recent transfusion), so a single value is interpreted alongside other information. The ADA suggests a general target below 7% for many non-pregnant adults, individualised to the person.",
    simple: "A1C is like a 3-month average of your sugar. Under 7% is a common goal for many adults, but the right target for you is set with your care team. And some health conditions can make A1C read higher or lower than your real average.",
    source: "ADA Standards of Care in Diabetes. Classification and Diagnosis; Glycemic Targets",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_fasting_glucose",
    topic: "What a fasting glucose lab measures",
    keywords: ["fasting glucose", "fpg", "fasting plasma"],
    statement:
      "Fasting plasma glucose is a laboratory blood glucose measured after no caloric intake for at least 8 hours. Diagnostic thresholds used in appropriate clinical context are 100–125 mg/dL for prediabetes and 126 mg/dL or higher for diabetes on repeat testing. A single value is a snapshot and is affected by illness, stress, sleep and medication timing.",
    simple: "This is your sugar after not eating overnight. It's one snapshot, not the whole story.",
    source: "ADA Standards of Care in Diabetes. Classification and Diagnosis",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_lipids",
    topic: "What a lipid panel measures",
    keywords: ["cholesterol", "ldl", "hdl", "triglycerides", "lipid"],
    statement:
      "A lipid panel measures total cholesterol, LDL cholesterol, HDL cholesterol and triglycerides. Diabetes raises cardiovascular risk, so lipid management is part of routine diabetes care; targets for LDL depend on overall cardiovascular risk and are set by the care team. Triglycerides are strongly affected by recent food, alcohol and glucose control.",
    simple: "This checks the fats in your blood. People with diabetes have their cholesterol checked regularly because of heart health. What counts as a good number depends on your overall risk.",
    source: "ADA Standards of Care in Diabetes. Cardiovascular Disease and Risk Management",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_kidney",
    topic: "What kidney labs measure",
    keywords: ["kidney", "egfr", "creatinine", "uacr", "albumin", "microalbumin"],
    statement:
      "Kidney health in diabetes is monitored with eGFR (an estimate of filtration rate calculated from blood creatinine, age and sex) and urine albumin-to-creatinine ratio (UACR), which detects protein leaking into urine. The ADA recommends at least annual testing of both. eGFR of 60 or above is generally considered normal filtration; UACR below 30 mg/g is generally considered normal. Trends over time matter more than a single value.",
    simple: "eGFR tells how well your kidneys filter; the urine albumin test checks if protein is leaking. Both are checked yearly because diabetes can affect the kidneys quietly.",
    source: "ADA Standards of Care in Diabetes. Chronic Kidney Disease and Risk Management; KDIGO guidelines",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_thyroid",
    topic: "What TSH measures",
    keywords: ["tsh", "thyroid"],
    statement:
      "TSH (thyroid-stimulating hormone) screens thyroid function. Autoimmune thyroid disease is more common in people with type 1 diabetes, so periodic TSH testing is recommended for them. Thyroid function affects energy, weight and glucose.",
    simple: "TSH checks your thyroid, which affects energy and weight. It's checked more often in type 1 diabetes.",
    source: "ADA Standards of Care in Diabetes. Comprehensive Medical Evaluation and Assessment of Comorbidities",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_b12",
    topic: "What vitamin B12 measures",
    keywords: ["b12", "vitamin b12", "metformin b12"],
    statement:
      "Vitamin B12 is needed for nerve and blood cell health. Long-term metformin use is associated with lower B12 levels, and the ADA suggests periodic B12 measurement for people on metformin, particularly with anemia or neuropathy.",
    simple: "B12 is a vitamin your nerves need. People on metformin for a long time sometimes run low on it, so it gets checked.",
    source: "ADA Standards of Care in Diabetes. Pharmacologic Approaches (metformin and B12)",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_liver",
    topic: "What liver enzymes measure",
    keywords: ["liver", "alt", "ast"],
    statement:
      "ALT and AST are liver enzymes released into the blood when liver cells are stressed or damaged. Fatty liver disease is common alongside type 2 diabetes, so liver enzymes are often checked. Mild elevations have many causes and are interpreted with other tests and imaging.",
    simple: "These check your liver. Fatty liver is common with type 2 diabetes, so doctors keep an eye on it.",
    source: "ADA Standards of Care in Diabetes. Comprehensive Medical Evaluation (NAFLD)",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_electrolytes",
    topic: "What electrolytes measure",
    keywords: ["potassium", "sodium", "electrolytes"],
    statement:
      "Sodium and potassium are electrolytes kept in tight ranges by the kidneys. They are checked routinely, and particularly with some blood pressure and diabetes medications that affect potassium, or with kidney disease.",
    simple: "Sodium and potassium are salts your body keeps in balance. Some medicines and kidney problems can shift them, so they get checked.",
    source: "General clinical chemistry education; ADA Standards of Care (medication monitoring)",
    sourceType: "educational",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "lab_vitamin_d",
    topic: "What vitamin D measures",
    keywords: ["vitamin d"],
    statement:
      "25-hydroxyvitamin D reflects vitamin D status, which matters for bone health. Low levels are common in the general population; whether supplementation affects glucose is an area of ongoing research and not established.",
    simple: "Vitamin D is mostly about bone health. Low levels are common. Whether it affects sugar isn't settled.",
    source: "General clinical education; ADA Standards of Care (no established glycemic recommendation)",
    sourceType: "educational",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "blood_pressure",
    topic: "Blood pressure in diabetes",
    keywords: ["blood pressure", "bp", "hypertension", "140", "130"],
    statement:
      "Blood pressure should be measured at every routine diabetes visit. The ADA recommends a target below 130/80 mmHg for most people with diabetes when it can be safely attained, individualised to the person. Home measurements are encouraged. Readings of 180/120 or higher, particularly with symptoms, need urgent evaluation.",
    simple: "Doctors check blood pressure at every diabetes visit. Under 130/80 is a common goal. 180/120 or higher is urgent.",
    source: "ADA Standards of Care in Diabetes. Cardiovascular Disease and Risk Management (hypertension)",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "insulin_general",
    topic: "What insulin does (general)",
    keywords: ["insulin", "bolus", "basal", "rapid", "long acting", "how does insulin work"],
    statement:
      "Insulin is the hormone that lets glucose move from the blood into cells. Injected insulins are grouped by how fast they start and how long they last: rapid-acting (taken with meals or to correct highs), short-acting, intermediate-acting, and long-acting or ultra-long-acting (background 'basal' coverage), plus premixed combinations. Dose amounts, timing and adjustments are individual and are decided with the prescribing clinician; this app records doses and never suggests them.",
    simple: "Insulin is what moves sugar out of the blood into the body. Some insulins work fast for meals; some work slowly in the background all day. How much to take is always something you decide with your prescriber, never with an app.",
    source: "ADA Standards of Care in Diabetes. Pharmacologic Approaches to Glycemic Treatment; FDA prescribing information (class labeling)",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "pregnancy",
    topic: "Diabetes in pregnancy",
    keywords: ["pregnant", "pregnancy", "gestational"],
    statement:
      "In pregnancy, glucose targets are tighter and monitoring is more frequent; both hypoglycemia and hyperglycemia carry additional risks. Care is led by a specialist team, and new symptoms or out-of-range readings should be reported promptly rather than watched.",
    simple: "In pregnancy the targets are stricter and your team wants to hear about highs, lows and new symptoms the same day.",
    source: "ADA Standards of Care in Diabetes. Management of Diabetes in Pregnancy",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "older_adults",
    topic: "Older adults",
    keywords: ["older", "elderly", "senior", "age"],
    statement:
      "For older adults, glycemic targets are often relaxed to reduce the risk of hypoglycemia, which is more dangerous with age (falls, confusion, cardiac events). The ADA emphasises avoiding hypoglycemia over reaching tight targets in this group, and simplifying regimens where appropriate. Decisions made by the care team.",
    simple: "For older adults, avoiding lows matters more than hitting a tight number. Your team may set looser goals on purpose.",
    source: "ADA Standards of Care in Diabetes. Older Adults",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
  {
    id: "diabetes_distress",
    topic: "Diabetes distress and burnout",
    keywords: ["frustrated", "burnout", "tired of this", "overwhelmed", "distress", "exhausted", "give up"],
    statement:
      "Diabetes distress. The emotional burden of living with a demanding chronic condition. Is common and is distinct from depression. The ADA recommends routinely asking about it and offering support; it is associated with worse glucose outcomes and improves with acknowledgement, practical problem-solving and, where needed, referral to a behavioural health professional familiar with diabetes.",
    simple: "Feeling worn down by diabetes is common and real. It's worth telling your care team. There is help for the weight of it, not just the numbers.",
    source: "ADA Standards of Care in Diabetes. Facilitating Positive Health Behaviors and Well-being (psychosocial care)",
    sourceType: "guideline",
    updated: "2026-09-10",
    region: "international",
    reviewStatus: "draft_needs_clinician_review",
    reviewBy: "2027-03-01",
  },
];

/** Simple keyword retrieval; returns the best-matching items for a question. */
export function retrieveKnowledge(question: string, limit = 4, extraKeys: string[] = []): KnowledgeItem[] {
  const q = question.toLowerCase();
  const scored = CLINICAL_KNOWLEDGE.map((k) => {
    let score = 0;
    for (const kw of k.keywords) if (q.includes(kw)) score += kw.length > 4 ? 2 : 1;
    if (extraKeys.includes(k.id)) score += 5;
    return { k, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.k);
}

export function knowledgeById(id: string): KnowledgeItem | undefined {
  return CLINICAL_KNOWLEDGE.find((k) => k.id === id);
}
