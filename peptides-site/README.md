# Arcline Peptides: storefront

A static marketing and shop site for weight-loss, metabolic, skin and athlete peptides. No build step: open `index.html` or serve the folder with any static host (Netlify, Vercel, Cloudflare Pages, S3).

```
index.html        page structure and copy
styles.css        design system (fonts, colours, layout, mobile). Nothing on the page animates.
products.js       the catalogue: edit names, prices, claims, timelines and usage here
app.js            treatment filters, product details, cart, quiz, weight calculator
fetch_images.py   downloads the 12 photos into img/ as web-sized JPEGs (run once)
img/              photos (people shown are AI-generated models, labelled on the page)
```

Run `python3 fetch_images.py` once before opening the site. The photos were generated with
Higgsfield and are lifestyle and product shots only. There are no before/after photos.

## Writing for all ages

Body text is 19px in Atkinson Hyperlegible, a typeface made for low-vision readers. Contrast is
at least 6.5:1 and buttons are at least 48px tall. Copy uses short sentences and everyday words,
and explains terms like GLP-1 the first time they appear.

"Arcline" is a placeholder brand. Rename it in `index.html` (logo, title, footer).

## Layout modeled on Ozempic® and Wegovy® sites

Novo Nordisk's brand sites follow one pattern, and this page uses it:

- A thin top bar pointing to safety information, and a safety tray pinned to the bottom of the screen.
- A hero that pairs a lifestyle photo with one plain-language promise and a footnoted average result.
- Results given as **pounds and percent** with the starting weight and the placebo result in the footnote (here: about 35 lb on semaglutide and about 48 lb on tirzepatide).
- A row of key numbers in columns.
- "How many people reached their goal" (at least 5%, 10%, 15% and 20% weight loss), shown as "86 in 100" rather than statistics jargon.
- A "what to expect" timeline in columns, a "how it works" explainer, and step-by-step injection instructions with a body diagram.
- A full Important Safety Information section with the boxed warning first.

## What the page borrows from high-revenue telehealth sites

These patterns come from the top direct-to-consumer GLP-1 and wellness brands (Hims & Hers, Ro, Henry Meds, Noom Med, Eden, Found) and from brand-pharma sites like Wegovy and Zepbound.

| Pattern | Where they use it | Where it is here |
|---|---|---|
| A big outcome number in the headline | Wegovy and Zepbound lead with average % weight loss | Hero says "up to 20%"; stat bubbles; product headlines |
| Price-first, low-friction entry ("free consult", "from $X/mo") | Hims, Ro, Henry Meds | Announcement bar, hero checks, pricing cards |
| Quiz funnel instead of "buy now" for Rx | Every telehealth brand | 2-minute assessment section that recommends products |
| Three-step "how it works" | Ro, Hims, Found | Steps section |
| Trust strip (licensed providers, US pharmacies, HSA/FSA) | Ro, Henry Meds | Strip under the hero |
| Trial data as social proof | Brand-pharma sites | Animated STEP-1 / SURMOUNT-1 chart |
| Before/after member stories with consent and a "results vary" line | Noom, Found | Member stories grid (see below) |
| Food-noise / cravings language | Category-wide | Hero and semaglutide copy |
| Sticky mobile CTA | Hims, Ro | Bottom bar on phones |
| Referral credit | Hims, Ro | "Give $50, get $50" |
| Subscribe & save, cancel anytime | All | Pricing and product cards |
| ISI / safety info next to every Rx claim | Required on pharma sites | Each product modal, FAQ, footer |

## Things to do before launch

1. **Member photos.** The "Member stories" frames are empty on purpose. Add real, written-consent photos to `img/` and fill the `STORIES` array in `app.js`. The FTC treats invented or AI-generated "customer results" as deceptive. If a member got a discount or payment, say so next to their story.
2. **Telehealth partner.** Prescription products (semaglutide, tirzepatide, tesamorelin) must be prescribed by a licensed provider and dispensed by a licensed pharmacy. Wire "Start visit" / "Continue to assessment" to your telehealth intake platform (for example OpenLoop, Beluga or MDIntegrations). Since the FDA ended the semaglutide and tirzepatide shortages in 2025, mass compounded copies are restricted. Confirm with your partner and lawyer which product you're allowed to dispense.
3. **Checkout.** The Checkout button for non-Rx items shows a placeholder alert. Connect it to Stripe Checkout or Shopify.
4. **Claims review.** Copy is sized to the cited evidence. Keep the "up to"/"average" wording, the trial citations and the safety text if you edit it. Serum and collagen copy uses appearance and structure/function language only, as cosmetics and supplements require.
5. **Prices.** $99/mo membership and the product prices are placeholders.

## Deliberately not included

- **BPC-157, TB-500 and other "research peptides" for human use.** They aren't approved, the FDA has put BPC-157 in the category that can't be compounded, and WADA bans both, so marketing them to athletes as working would expose the business and its customers. The athlete line uses collagen peptides instead, and the FAQ explains why.
- **Fake countdown timers or "only 3 left" scarcity.** Regulators flag these, and they hurt repeat purchases and referrals, which this business depends on.
