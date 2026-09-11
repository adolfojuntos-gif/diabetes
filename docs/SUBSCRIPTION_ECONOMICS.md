# What a $20/month photo-scanning plan actually costs to serve

Written 2026-09-11 against the code as it stands. Every figure is derived, not quoted, and the
arithmetic is shown so you can redo it when the assumptions change.

## The short answer

A photo scan costs about **3 cents on Opus 5 and 1.2 cents on Sonnet 5**. At realistic usage a
subscriber costs you **$2 to $5 a month** to serve, against $19.12 net of card fees. That is an
88% gross margin and a good business.

**But your current caps allow $299 of spend on a $20 plan.** That is the number that matters, and
fixing it is a different job from the one those caps were built for.

## What the app sends per action

Measured from the code, not assumed. The browser shrinks every photo to 1280px on the long edge at
82% JPEG quality before it is posted, which is why a 12-megapixel camera shot arrives as roughly
200 KB. An image costs about `width × height ÷ 750` tokens.

| Action | Input tokens | Output tokens | Where the numbers come from |
|---|---|---|---|
| Photo scan | ~1,850 | ~800 | 1280×960 image ≈ 1,640, plus a ~210-token instruction. Output is a small JSON block plus adaptive thinking at low effort. |
| Copilot reply | ~4,000 | ~1,500 | Engine context, retrieved knowledge, memory, recent history. Medium effort. |
| Morning brief | ~2,500 | ~800 | Yesterday's facts plus the pattern report. Low effort. |

These are estimates. To replace them with real figures, run 20 actual photos through it and read
`response.usage`, or call the token-counting endpoint. **Do that before you commit to a price.**

## Cost per action

| Action | Opus 5 ($5/$25) | Sonnet 5 ($2/$10) | Haiku 4.5 ($1/$5) |
|---|---|---|---|
| Photo scan | $0.029 | $0.012 | $0.006 |
| Copilot reply | $0.058 | $0.023 | $0.012 |
| Morning brief | $0.033 | $0.013 | $0.007 |

Worked example for one photo on Opus: `1,850 ÷ 1,000,000 × $5 = $0.0093` in, plus
`800 ÷ 1,000,000 × $25 = $0.020` out, total **$0.029**.

## What a subscriber costs per month

| Behaviour | Photos | Copilot | Briefs | Opus | Sonnet |
|---|---|---|---|---|---|
| Light: scans a few odd meals | 20 | 15 | 0 | $1.44 | $0.58 |
| Typical: a meal a day, a few questions | 60 | 45 | 30 | $5.31 | $2.13 |
| Heavy: every meal, chatty | 120 | 150 | 30 | $13.09 | $5.24 |
| **Your caps, maxed daily** | **1,200** | **4,500** | **180** | **$299** | **$120** |

That last row is the one to sit with. The caps are 40 photos, 150 Copilot replies and 6 briefs per
day. Nobody behaves that way, but on a flat price you are not underwriting the average user, you
are underwriting the worst one, and one determined or malfunctioning account at the cap costs
fifteen times what it pays.

## The margin

On $20, net of Stripe at 2.9% plus 30 cents, you keep **$19.12**.

| | Opus | Sonnet |
|---|---|---|
| Typical subscriber | $13.81 kept, **72%** | $16.99 kept, **89%** |
| Heavy subscriber | $6.03 kept, **32%** | $13.88 kept, **73%** |
| Capped subscriber | **loses $280** | **loses $101** |

## What to change before selling this

**1. Put the photos on Sonnet.** Identifying food on a plate is not the hard reasoning task in this
app. It roughly triples your margin on the feature people are paying for. One environment variable
today (`AI_MODEL`), though see the caveat below about splitting models per feature.

**2. Make the caps per account and tie them to the plan.** The caps in the app today are global,
because the app has no accounts: they were built to stop a stranger with the demo link running up a
bill, and they do that. They are not plan limits. A workable $20 shape:

| Plan allowance | Monthly cost on Sonnet |
|---|---|
| 90 photos (3/day) | $1.05 |
| 120 Copilot replies (4/day) | $2.76 |
| 30 briefs | $0.39 |
| **Total** | **$4.20, a 78% margin** |

That is a genuinely generous product and it still leaves room. Sell overage or a higher tier above
it rather than eating it.

**3. Split the model per feature.** Right now `AI_MODEL` is one setting for all three. Photos on
Sonnet or Haiku, Copilot replies on Opus where the judgment is worth paying for. That is a small
change and it is the difference between a 72% and an 89% margin.

**4. Lean on the caching already built.** The Copilot's system prompt is marked cacheable, so the
second and later turns of a conversation read the prefix at a tenth of the input price. Encouraging
conversations rather than one-shot questions makes your most expensive action cheaper. Worth
measuring, because it could take the typical Copilot figure down by half.

**5. Point people at the free path.** The 179-food carbohydrate reference costs nothing to search
and gives a sourced number with real portion weights. If the interface makes searching the obvious
move for a taco and the camera the move for an unfamiliar plate, most meals never hit a model at
all. This is the largest lever on the list and it is a design decision, not an infrastructure one.

## The costs that are not inference

Worth naming, because inference is the one people fixate on and it is not the binding constraint.

**Hosting is a rounding error today and does not scale.** One `shared-cpu-1x` with 1 GB plus a 1 GB
volume is a few dollars a month, and with `auto_stop_machines` it idles to nearly nothing. But the
app is one machine holding one SQLite file, pinned that way on purpose because two machines would
mean two databases disagreeing. That is correct for one person and it is not a foundation for
subscribers.

**The real cost is the thing a subscription requires that this app does not have.** There is no
authentication, no accounts, and no ownership column on any table. Multi-tenancy here is a
migration across every table, an ownership check on every server action, a rewrite of the export and
the share link, and a move to Postgres or Turso. That is the line item, and it is engineering time,
not dollars per token.

**Card fees are 4.4% of a $20 plan**, which is more than inference costs a typical user on Sonnet.
Annual billing at a discount is worth more to the margin than any model choice.

## How to make these numbers real

1. Set a monthly spend cap in the Anthropic console. It is the only hard stop that exists.
2. Run 20 real photos and 20 real Copilot turns with a key set, then read the `ai_audit` rows and
   the API usage report. Replace the estimates in this document with what you measure.
3. Watch the ratio of photo scans to reference searches. If people photograph everything, your cost
   per user is the photo line. If they search first, it is close to zero.

The estimates here are deliberately pessimistic on output tokens, since adaptive thinking is billed
as output and is hard to predict. If real usage comes in lower, the margins get better, not worse.

---

# At 100 subscribers

The money works. The architecture does not, and that is the whole answer.

## The money

A realistic spread rather than one average user: 50 light, 35 typical, 15 heavy, using the
per-behaviour figures above.

| | Sonnet | Opus |
|---|---|---|
| Revenue, 100 × $20 | $2,000 | $2,000 |
| Card fees, 2.9% + 30c each | −$88 | −$88 |
| Inference | −$182 | −$454 |
| Hosting and database | −$65 | −$65 |
| **Contribution** | **$1,665/mo** | **$1,393/mo** |
| Gross margin | 83% | 70% |

Inference works out at **$1.82 per subscriber on Sonnet**, $4.54 on Opus. Call it $20,000 a year
of contribution on Sonnet.

Be clear-eyed about what that is. It covers the build, it pays for the infrastructure many times
over, and it is not yet a salary. One hundred subscribers is a validation milestone, not a living.

## Two things that get worse rather than better with scale

**The caps.** A single account maxing the current limits costs $299 a month on Opus. At 100
subscribers you only need three such accounts to burn $900 and wipe out half your net. Per-plan
caps matter more at scale, not less, because the chance that somebody behaves badly approaches one.

**The unreviewed knowledge layer.** With one user, who is you, `draft_needs_clinician_review` is an
honest documented limitation. With 100 paying strangers relying on it for carbohydrate figures and
symptom guidance, it is a liability. That is not a cost line, it is a decision about whether to pay
a clinician to review 43 knowledge items before you take money from people with a chronic illness.
Do it before, not after.

## The bill that is not on the table

**You cannot sell this to 100 people today, at any price.** Not because of scale, because of shape.
There is one `profile` row with `id = 1`. There is no user table, no session, and no ownership
column on any of the 35 tables. A hundred subscribers would be a hundred people sharing one
diary, watching each other's glucose readings appear.

What standing it up actually involves:

| Work | Why it is not optional |
|---|---|
| Accounts, sessions, password reset | There is no concept of a user |
| An owner column on every table, plus a migration | Every query currently returns everyone's rows |
| An ownership check on roughly 90 server actions | Any account could otherwise edit any row by id |
| Move off one SQLite file to Postgres or Turso | One machine holding one file is a single writer, pinned deliberately |
| Rework the export, the share links and the spend limiter to be per account | All three are currently global |
| Stripe, webhooks, plan state, cap enforcement per plan | Billing has to know who is over |

That is weeks of focused work, not an afternoon, and it is the real cost of going from one user to
one hundred. The inference bill is the easy part and always was.

**Support is the other hidden line.** A hundred people with a chronic illness will ask clinical
questions you are not permitted to answer. Budget time for that, and decide in advance what the
answer is when somebody emails asking what their reading means.

## The sequence that makes sense

1. Clinician review of the knowledge layer. Cheapest to do now, most expensive to skip.
2. Multi-tenancy: accounts, ownership, a real database. Nothing can be sold before this.
3. Per-plan caps and per-feature model choice, both small once accounts exist.
4. Billing.
5. Then sell, with measured token figures replacing the estimates in this document.
