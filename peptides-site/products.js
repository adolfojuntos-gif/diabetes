/*
  Product catalogue. Every claim here is meant to be defensible:
  - Prescription products cite their pivotal trials and say they require a licensed prescriber.
  - Cosmetic and supplement products make structure/appearance claims only, sized to the evidence.
  Edit prices and copy here; the page renders from this file.
*/
window.PRODUCTS = [
  {
    id: "semaglutide",
    name: "Semaglutide",
    tagline: "The weekly shot behind the weight-loss headlines.",
    category: "weight",
    rx: true,
    color: "#2f6bff",
    form: "Once-weekly injection pen",
    price: 99,
    priceNote: "/mo membership + medication",
    badge: "Most popular",
    headline: "Up to 15% average body-weight loss",
    description:
      "Semaglutide is the active ingredient in Wegovy® and Ozempic®. It mimics GLP-1, a hormone your gut already makes after a meal, so you feel full sooner, stay full longer, and the constant 'food noise' quiets down.",
    how: [
      "Activates GLP-1 receptors in the brain's appetite centres, turning down hunger and cravings.",
      "Slows how fast the stomach empties, so smaller meals feel satisfying.",
      "Helps the pancreas release insulin when blood sugar rises, smoothing out spikes and crashes.",
    ],
    timeline: [
      ["Week 1–2", "Many people notice less appetite and fewer cravings."],
      ["Month 1–2", "Dose steps up every 4 weeks; steady, visible weight change begins."],
      ["Month 4–6", "Most of the loss happens here as you reach your maintenance dose."],
      ["Month 15", "STEP-1 trial: 14.9% average loss at 2.4 mg vs 2.4% on placebo (68 weeks)."],
    ],
    use: [
      "Inject once a week, same day each week, any time of day, with or without food.",
      "Under the skin of the belly (2 inches from the navel), front of the thigh, or back of the upper arm. Rotate sites.",
      "Your provider starts low and raises the dose every 4 weeks to limit nausea.",
      "Keep unopened pens in the fridge (36–46°F). Never freeze.",
    ],
    safety:
      "Prescription only. Common side effects are nausea, diarrhoea, vomiting and constipation, mostly while the dose is rising. Not for anyone with a personal or family history of medullary thyroid cancer or MEN2, or who is pregnant. Your provider reviews your history before prescribing.",
    source: "Wilding et al., NEJM 2021 (STEP-1)",
  },
  {
    id: "tirzepatide",
    name: "Tirzepatide",
    tagline: "Dual-action. The strongest results in the class.",
    category: "weight",
    rx: true,
    color: "#7a3cff",
    form: "Once-weekly injection",
    price: 99,
    priceNote: "/mo membership + medication",
    badge: "Highest results",
    headline: "Up to 20.9% average body-weight loss",
    description:
      "Tirzepatide is the active ingredient in Zepbound® and Mounjaro®. It acts on two gut hormones, GLP-1 and GIP, at once, which is why it posted the largest average weight loss of any approved medicine in its trials.",
    how: [
      "GLP-1 action: lowers appetite and slows stomach emptying.",
      "GIP action: improves how the body handles sugar and fat, and appears to add to the appetite effect.",
      "Together they cut calorie intake without the white-knuckle willpower.",
    ],
    timeline: [
      ["Week 1–4", "Starts at 2.5 mg. Appetite drops noticeably for most people."],
      ["Month 2–5", "Dose rises in 2.5 mg steps every 4 weeks; weight comes off steadily."],
      ["Month 6–9", "Maintenance dose (5, 10 or 15 mg) is reached."],
      ["Month 17", "SURMOUNT-1: 20.9% average loss at 15 mg vs 3.1% on placebo (72 weeks)."],
    ],
    use: [
      "Inject once a week, same day each week, with or without food.",
      "Belly, thigh or upper arm. Rotate sites every week.",
      "Never skip ahead on dose; your provider decides each step.",
      "Refrigerate. A pen or vial can stay at room temperature up to 21 days if needed.",
    ],
    safety:
      "Prescription only. Side effects are similar to semaglutide (mainly digestive, mainly early). Same thyroid-cancer and pregnancy cautions. Can reduce how well oral birth control works during dose increases.",
    source: "Jastreboff et al., NEJM 2022 (SURMOUNT-1)",
  },
  {
    id: "tesamorelin",
    name: "Tesamorelin",
    tagline: "Targets stubborn belly fat around the organs.",
    category: "metabolic",
    rx: true,
    color: "#00a37a",
    form: "Daily injection",
    price: 149,
    priceNote: "/mo membership + medication",
    badge: "Metabolic",
    headline: "~15–18% less visceral fat in 26 weeks",
    description:
      "Tesamorelin (Egrifta®) is a growth-hormone-releasing peptide. It signals the pituitary to release your own growth hormone in its natural pulse, which preferentially shrinks visceral fat, the deep belly fat tied to metabolic risk.",
    how: [
      "Binds GHRH receptors on the pituitary, raising your natural growth-hormone output.",
      "Growth hormone and IGF-1 increase fat breakdown, especially in visceral fat stores.",
      "Lean mass is preserved because the signal is your body's own.",
    ],
    timeline: [
      ["Month 1–2", "IGF-1 levels rise; some people notice better sleep and recovery."],
      ["Month 3", "Waistline changes become measurable."],
      ["Month 6", "Trials: visceral fat down roughly 15–18% vs placebo."],
    ],
    use: [
      "One injection under the skin of the belly, daily.",
      "Rotate injection spots; avoid scars, bruises and the navel.",
      "Labs (IGF-1, glucose) are checked by your provider at baseline and follow-up.",
    ],
    safety:
      "Prescription only. FDA-approved for reducing excess abdominal fat in adults with HIV-associated lipodystrophy; any other use is off-label at your provider's discretion. Can raise blood sugar, cause joint pain or swelling. Not for pregnancy or active cancer.",
    source: "Falutz et al., NEJM 2007",
  },
  {
    id: "ghk-cu",
    name: "GHK-Cu Copper Peptide Serum",
    tagline: "Firmer, smoother, younger-looking skin.",
    category: "skin",
    rx: false,
    color: "#1aa3b8",
    form: "Topical serum, 30 ml",
    price: 68,
    priceNote: "one-time · $58 subscribe",
    badge: "Skin repair",
    headline: "Visible firmness and fine-line improvement in 12 weeks",
    description:
      "GHK-Cu is a copper-binding peptide your skin makes naturally and loses with age. Applied topically, it supports collagen and elastin, helping skin look firmer, smoother and more even. It is the hero of our skin-repair routine.",
    how: [
      "Signals skin cells to support collagen and elastin production.",
      "Delivers copper, which the skin's repair enzymes rely on.",
      "Supports the look of skin recovering from sun, dryness and breakouts.",
    ],
    timeline: [
      ["Week 1–2", "Skin feels more hydrated and smooth."],
      ["Week 4–8", "Tone looks more even; texture improves."],
      ["Week 12", "Clinical studies of copper peptide creams: improved look of fine lines, firmness and density."],
    ],
    use: [
      "Apply 3–4 drops to clean, dry skin morning and night.",
      "Follow with moisturiser; use SPF 30+ in the morning.",
      "Don't layer in the same routine as vitamin C (L-ascorbic acid) or strong acids. Use them at opposite times of day.",
    ],
    safety:
      "Cosmetic. Patch-test first. Stop if irritation persists. Not intended to diagnose, treat, cure or prevent any disease.",
    source: "Pickart & Margolina, Int J Mol Sci 2018 (review)",
  },
  {
    id: "matrixyl",
    name: "Matrixyl + Argireline Line Serum",
    tagline: "Smooths expression lines. No needles.",
    category: "skin",
    rx: false,
    color: "#e0569b",
    form: "Topical serum, 30 ml",
    price: 54,
    priceNote: "one-time · $46 subscribe",
    badge: "Anti-aging",
    headline: "Softer-looking expression lines in 4–8 weeks",
    description:
      "Two of the best-studied cosmetic peptides in one formula. Palmitoyl pentapeptide-4 (Matrixyl®) supports the skin's matrix; acetyl hexapeptide-8 (Argireline®) helps relax the look of expression lines around eyes and forehead.",
    how: [
      "Matrixyl mimics a collagen fragment, signalling skin to rebuild its support structure.",
      "Argireline gently dampens the muscle signals behind repeated expression lines.",
      "Hyaluronic acid base plumps the surface while the peptides work.",
    ],
    timeline: [
      ["Week 1", "Immediate smoothing and hydration."],
      ["Week 4", "Expression lines look softer."],
      ["Week 8–12", "Firmer-looking skin with continued use."],
    ],
    use: [
      "Apply a pea-size amount to forehead, crow's feet and smile lines twice daily.",
      "Pat, don't rub. Let absorb 60 seconds before moisturiser.",
      "Pairs well with GHK-Cu (one AM, one PM) for a full routine.",
    ],
    safety: "Cosmetic. Patch-test first. Avoid contact with eyes. Not intended to diagnose, treat, cure or prevent any disease.",
    source: "Robinson et al., Int J Cosmet Sci 2005; Blanes-Mira et al., 2002",
  },
  {
    id: "collagen",
    name: "Collagen Peptides Performance",
    tagline: "Built for tendons, joints and hard training.",
    category: "athlete",
    rx: false,
    color: "#ff7a1a",
    form: "Powder, 30 servings",
    price: 49,
    priceNote: "one-time · $42 subscribe",
    badge: "Athletes",
    headline: "Support for joints and connective tissue under load",
    description:
      "Hydrolysed collagen peptides with added vitamin C, timed before training. Connective tissue adapts slower than muscle, and this is the nutrition protocol sports scientists use to help it keep up. NSF Certified for Sport® sourcing, safe for tested athletes.",
    how: [
      "Supplies glycine, proline and hydroxyproline, the building blocks of collagen.",
      "Taken 30–60 minutes before loading, it raises the amino acids available to tendons and ligaments when they're being stimulated.",
      "Vitamin C is a required co-factor for the body's own collagen synthesis.",
    ],
    timeline: [
      ["Day 1", "Mixes clear, no taste, into water or a shake."],
      ["Week 4–8", "Support for joint comfort during training."],
      ["Month 3–6", "Studies in athletes: less activity-related joint discomfort with daily use."],
    ],
    use: [
      "Mix one scoop (15 g) into water, 30–60 minutes before training.",
      "On rest days, take any time.",
      "Pair with your normal protein intake; this is not a replacement for it.",
    ],
    safety:
      "Dietary supplement. Contains bovine collagen. These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure or prevent any disease.",
    source: "Shaw et al., Am J Clin Nutr 2017; Clark et al., Curr Med Res Opin 2008",
  },
];

window.CATEGORIES = [
  { id: "all", label: "All" },
  { id: "weight", label: "Weight loss" },
  { id: "metabolic", label: "Metabolic" },
  { id: "skin", label: "Skin & repair" },
  { id: "athlete", label: "Athletes" },
];
