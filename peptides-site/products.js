/*
  Product catalogue. Written in plain language (aim: easy for a 12-year-old or an 80-year-old to read).
  Every result claim points to a published study. Prescription products always say a licensed
  provider decides. Cosmetic and supplement products make appearance or structure claims only.
*/
window.PRODUCTS = [
  {
    id: "semaglutide",
    name: "Semaglutide",
    img: "img/pen-blue.jpg",
    tagline: "A once-a-week shot that helps you feel full and eat less.",
    category: "weight",
    rx: true,
    form: "Weekly injection pen",
    price: 99,
    priceNote: "a month for care, plus medicine",
    badge: "Most chosen",
    headline: "People lost about 35 lb on average",
    speed: "Many people feel less hungry in the first 1–2 weeks.",
    description:
      "Semaglutide is the medicine inside Wegovy® and Ozempic®. It copies a hormone your body already makes after you eat. That hormone tells your brain you are full. So you feel satisfied with smaller meals, and thoughts about food quiet down.",
    how: [
      "Tells your brain you are full, so you eat less without fighting hunger.",
      "Slows down how fast food leaves your stomach, so you stay full longer.",
      "Helps your body release insulin when you eat, which keeps blood sugar steadier.",
    ],
    timeline: [
      ["Weeks 1–4", "You start on a low dose. Many people notice they are less hungry."],
      ["Months 2–4", "Your provider raises the dose a little every 4 weeks. Weight starts to come off."],
      ["Months 4–12", "This is when most people lose the most weight."],
      ["Month 15", "In the study, people lost 14.9% of their body weight on average (about 35 lb)."],
    ],
    use: [
      "Take it once a week, on the same day. Any time of day is fine, with or without food.",
      "Inject it under the skin of your belly, thigh, or upper arm. Use a different spot each week.",
      "Your provider starts you low and raises the dose slowly. This helps prevent an upset stomach.",
      "Keep new pens in the fridge. Do not freeze.",
    ],
    safety:
      "Prescription only. The most common side effects are nausea, diarrhea, vomiting, and constipation. These are most common when the dose goes up, and usually get better. Do not use if you or your family have had medullary thyroid cancer or MEN 2, or if you are pregnant. Your provider will review your health history first.",
    source: "STEP 1 study, Wilding et al., New England Journal of Medicine, 2021. Average starting weight 232 lb; placebo group lost 2.4% (about 6 lb).",
  },
  {
    id: "tirzepatide",
    name: "Tirzepatide",
    img: "img/pen-violet.jpg",
    tagline: "A once-a-week shot that works on two hunger hormones.",
    category: "weight",
    rx: true,
    form: "Weekly injection",
    price: 99,
    priceNote: "a month for care, plus medicine",
    badge: "Strongest results",
    headline: "People lost about 48 lb on average",
    speed: "Hunger often drops within the first month.",
    description:
      "Tirzepatide is the medicine inside Zepbound® and Mounjaro®. It copies two natural hormones instead of one. In studies, this gave the biggest average weight loss of any approved weight-loss medicine.",
    how: [
      "Works on two “I'm full” hormones, GLP-1 and GIP, at the same time.",
      "Cuts hunger and cravings, so eating less feels natural.",
      "Helps your body handle sugar and fat better.",
    ],
    timeline: [
      ["Weeks 1–4", "You start on 2.5 mg. Most people notice they want to eat less."],
      ["Months 2–5", "The dose goes up a small step every 4 weeks. Weight comes off steadily."],
      ["Months 6–9", "You reach the dose that is right for you."],
      ["Month 17", "In the study, people on the highest dose lost 20.9% of their body weight on average (about 48 lb)."],
    ],
    use: [
      "Take it once a week, on the same day, with or without food.",
      "Inject it into your belly, thigh, or upper arm. Change the spot each week.",
      "Never raise your own dose. Your provider decides each step.",
      "Keep it in the fridge. It can stay at room temperature for up to 21 days if needed.",
    ],
    safety:
      "Prescription only. Side effects are like semaglutide's, mostly stomach-related and mostly early on. The same thyroid cancer and pregnancy warnings apply. It can make birth control pills work less well, so ask your provider about backup birth control.",
    source: "SURMOUNT-1 study, Jastreboff et al., New England Journal of Medicine, 2022. Average starting weight 231 lb; placebo group lost 3.1% (about 7 lb).",
  },
  {
    id: "tesamorelin",
    name: "Tesamorelin",
    img: "img/vial.jpg",
    tagline: "A daily shot that targets deep belly fat.",
    category: "metabolic",
    rx: true,
    form: "Daily injection",
    price: 149,
    priceNote: "a month for care, plus medicine",
    badge: "Metabolic health",
    headline: "Deep belly fat went down about 15–18%",
    speed: "Waist changes usually show by month 3.",
    description:
      "Tesamorelin (Egrifta®) helps your body make more of its own growth hormone. That helps shrink the deep fat around your organs. This kind of fat is linked to heart disease and diabetes.",
    how: [
      "Signals a small gland in your brain to release more of your own growth hormone.",
      "Growth hormone helps your body burn stored fat, especially deep belly fat.",
      "Because the hormone is your own, your body keeps its muscle.",
    ],
    timeline: [
      ["Months 1–2", "Your hormone levels rise. Some people sleep and recover better."],
      ["Month 3", "Changes in your waist size become easy to measure."],
      ["Month 6", "In studies, deep belly fat went down about 15–18%."],
    ],
    use: [
      "One small shot under the skin of your belly, every day.",
      "Change the spot each day. Stay away from scars, bruises, and your belly button.",
      "Your provider checks simple blood tests at the start and later on.",
    ],
    safety:
      "Prescription only. FDA-approved to reduce extra belly fat in adults with HIV-related fat changes. Any other use is “off-label” and up to your provider. It can raise blood sugar and cause joint pain or swelling. Not for use during pregnancy or with active cancer.",
    source: "Falutz et al., New England Journal of Medicine, 2007.",
  },
  {
    id: "ghk-cu",
    name: "Copper Peptide Serum",
    img: "img/serum-blue.jpg",
    tagline: "Helps skin look firmer and smoother.",
    category: "skin",
    rx: false,
    form: "Skin serum, 1 oz",
    price: 68,
    priceNote: "or $58 a month with subscribe and save",
    badge: "Skin repair",
    headline: "Firmer-looking skin in about 12 weeks",
    speed: "Skin feels softer in 1–2 weeks.",
    description:
      "GHK-Cu is a tiny protein piece your skin makes on its own. We make less of it as we age. Put on the skin, it helps support collagen, the thing that keeps skin firm and smooth.",
    how: [
      "Helps skin support its own collagen and elastin, which keep it firm and bouncy.",
      "Brings copper to the skin, which its natural repair process uses.",
      "Helps skin look better after sun, dryness, or breakouts.",
    ],
    timeline: [
      ["Weeks 1–2", "Skin feels softer and more hydrated."],
      ["Weeks 4–8", "Skin tone looks more even."],
      ["Week 12", "In studies of copper peptide creams, fine lines and firmness looked better."],
    ],
    use: [
      "Put 3–4 drops on clean, dry skin in the morning and at night.",
      "Then use your moisturizer. Wear sunscreen every morning.",
      "Use vitamin C serums or strong acids at a different time of day.",
    ],
    safety: "Cosmetic. Test on a small patch of skin first. Stop if it stays red or itchy. Not meant to diagnose, treat, cure, or prevent any disease.",
    source: "Pickart and Margolina, International Journal of Molecular Sciences, 2018 (review).",
  },
  {
    id: "matrixyl",
    name: "Line Smoothing Serum",
    img: "img/serum-pink.jpg",
    tagline: "Softens the look of lines. No needles.",
    category: "skin",
    rx: false,
    form: "Skin serum, 1 oz",
    price: 54,
    priceNote: "or $46 a month with subscribe and save",
    badge: "Fine lines",
    headline: "Softer-looking lines in 4–8 weeks",
    speed: "Skin looks smoother right away.",
    description:
      "Two well-studied skin peptides in one serum. Matrixyl® helps skin rebuild its support. Argireline® helps relax the look of lines from smiling and frowning.",
    how: [
      "Matrixyl tells skin to rebuild its support structure.",
      "Argireline gently softens the look of lines from facial expressions.",
      "Hyaluronic acid plumps the surface while the peptides work.",
    ],
    timeline: [
      ["Week 1", "Skin looks smoother and feels hydrated."],
      ["Week 4", "Lines on the forehead and around the eyes look softer."],
      ["Weeks 8–12", "Skin looks firmer the longer you use it."],
    ],
    use: [
      "Use a pea-sized amount on your forehead, around your eyes, and smile lines, twice a day.",
      "Gently pat it in. Wait one minute before moisturizer.",
      "Works well with the Copper Peptide Serum. Use one in the morning and one at night.",
    ],
    safety: "Cosmetic. Test on a small patch of skin first. Keep out of eyes. Not meant to diagnose, treat, cure, or prevent any disease.",
    source: "Robinson et al., International Journal of Cosmetic Science, 2005; Blanes-Mira et al., 2002.",
  },
  {
    id: "collagen",
    name: "Collagen Peptides",
    img: "img/collagen.jpg",
    tagline: "Supports joints and tendons for active people.",
    category: "athlete",
    rx: false,
    form: "Powder, 30 servings",
    price: 49,
    priceNote: "or $42 a month with subscribe and save",
    badge: "Athletes",
    headline: "Joint support for hard training",
    speed: "Joint comfort may improve in 4–8 weeks.",
    description:
      "Collagen peptides with vitamin C, taken before exercise. Muscles get stronger fast, but tendons and joints take longer. This is the nutrition plan sports scientists use to help them keep up. Tested and safe for athletes in drug-tested sports.",
    how: [
      "Gives your body the building blocks it uses to make collagen.",
      "Taken before exercise, those building blocks are ready when your joints and tendons are working.",
      "Vitamin C helps your body turn them into collagen.",
    ],
    timeline: [
      ["Day 1", "Mixes clear into water. No taste."],
      ["Weeks 4–8", "Joints may feel more comfortable during training."],
      ["Months 3–6", "In studies, athletes had less joint pain from activity."],
    ],
    use: [
      "Mix one scoop into water. Drink it 30 to 60 minutes before exercise.",
      "On rest days, take it any time.",
      "Keep eating your normal protein. This does not replace it.",
    ],
    safety:
      "Dietary supplement. Made from beef collagen. These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease.",
    source: "Shaw et al., American Journal of Clinical Nutrition, 2017; Clark et al., Current Medical Research and Opinion, 2008.",
  },
];

window.CATEGORIES = [
  { id: "all", label: "All" },
  { id: "weight", label: "Weight loss" },
  { id: "metabolic", label: "Metabolic health" },
  { id: "skin", label: "Skin" },
  { id: "athlete", label: "Athletes" },
];
