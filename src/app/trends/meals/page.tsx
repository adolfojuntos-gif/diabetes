/**
 * TRENDS / AFTER MEALS — post-meal response, ranked.
 *
 * The rise, the coverage number and the rankings all come out of src/lib/engines/mealResponse.ts.
 * This page formats them. It deliberately shows the coverage number first, because a best-meals
 * list built on two covered meals is not a list.
 */
import Link from "next/link";
import { PageHeader, Card, EmptyState, Notice, Stat } from "@/components/ui";
import { requireAccount } from "@/lib/auth/session";
import { loadSnapshot } from "@/lib/data/snapshot";
import { between } from "@/lib/engines/stats";
import { mealResponses, rankMeals, riseBand, type MealResponse } from "@/lib/engines/mealResponse";
import { formatGlucose, unitLabel, bandOf, BAND_LABEL } from "@/lib/units";
import type { Units } from "@/lib/db/schema";
import { addDays, startOfDay, endOfDay, fmtDay, fmtTime } from "@/lib/time";
import {
  RangeSwitcher,
  parseDays,
  glucose,
  signedGlucose,
  pct,
  BAND_STROKE,
  RISE_LABEL,
  RISE_BAND_CLASS,
  type RiseBand,
} from "../parts";

function slotLabel(slot: string): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function MealCard({
  m,
  units,
  low,
  high,
}: {
  m: MealResponse & { rise: number };
  units: Units;
  low: number;
  high: number;
}) {
  const rb: RiseBand = riseBand(m.rise);
  const band = RISE_BAND_CLASS[rb];
  const preBand = m.pre !== null ? bandOf(m.pre, low, high) : null;
  const peakBand = m.peak !== null ? bandOf(m.peak, low, high) : null;
  return (
    <li className="card-sunk p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base">{m.name || "Unnamed meal"}</h3>
        <span className={`num font-semibold band-${band}`}>
          {signedGlucose(m.rise, units)} {unitLabel(units)}
          <span className="font-normal"> {RISE_LABEL[rb]}</span>
        </span>
      </div>
      <div className="hint mt-1">
        {slotLabel(m.slot)} · {fmtDay(m.at)} at {fmtTime(m.at)} · {Math.round(m.carbsG)} g carbs
      </div>
      <div className="mt-2 text-sm num">
        <span className="muted">before </span>
        <span className={preBand ? `band-${preBand}` : ""}>{glucose(m.pre, units)}</span>
        <span className="muted"> then peaked at </span>
        <span className={peakBand ? `band-${peakBand}` : ""}>{glucose(m.peak, units)}</span>
        <span className="muted"> {unitLabel(units)}</span>
        {preBand && peakBand ? (
          <span className="faint"> ({BAND_LABEL[preBand].toLowerCase()} to {BAND_LABEL[peakBand].toLowerCase()})</span>
        ) : null}
      </div>
      {m.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.tags.map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
      ) : (
        <div className="hint mt-2">No tags on this one. Tags are what make the list below useful.</div>
      )}
    </li>
  );
}

function CarbBucketChart({
  rows,
  units,
}: {
  rows: { bucket: string; n: number; meanRise: number }[];
  units: Units;
}) {
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 40;
  const colW = 86;
  const plotW = Math.max(280, rows.length * colW);
  const plotH = 130;
  const W = padL + plotW + padR;
  const H = padT + plotH + padB;

  const hi = Math.max(60, ...rows.map((r) => r.meanRise));
  const lo = Math.min(0, ...rows.map((r) => r.meanRise));
  const span = hi - lo || 1;
  const y = (v: number) => padT + (1 - (v - lo) / span) * plotH;
  const step = plotW / rows.length;
  const barW = Math.min(44, step * 0.56);

  const label =
    `Average glucose rise after a meal, grouped by the carbohydrate in the meal, in ${unitLabel(units)}. ` +
    rows.map((r) => `${r.bucket}: ${formatGlucose(r.meanRise, units)} across ${r.n} meals`).join("; ") +
    ".";

  return (
    <div className="mt-3 -mx-1 px-1" style={{ overflowX: "auto", maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: "block", maxWidth: "none" }}>
        {[0, 30, 50].filter((g) => g >= lo && g <= hi).map((g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={padL + plotW}
              y1={y(g)}
              y2={y(g)}
              stroke="var(--line-strong)"
              strokeWidth="1"
              strokeDasharray={g === 0 ? undefined : "3 4"}
            />
            <text x={padL - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--ink-faint)">
              {formatGlucose(g, units)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = padL + step * (i + 0.5);
          const top = Math.min(y(r.meanRise), y(0));
          const h = Math.max(2, Math.abs(y(r.meanRise) - y(0)));
          return (
            <g key={r.bucket}>
              <rect
                x={cx - barW / 2}
                y={top}
                width={barW}
                height={h}
                rx="3"
                fill={BAND_STROKE[RISE_BAND_CLASS[riseBand(r.meanRise)]]}
                fillOpacity="0.85"
              />
              <text x={cx} y={H - 22} textAnchor="middle" fontSize="11" fill="var(--ink-soft)">
                {r.bucket}
              </text>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">
                {r.n} meal{r.n === 1 ? "" : "s"}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="hint mt-1">Average rise in {unitLabel(units)}, by how much carbohydrate was in the meal.</p>
    </div>
  );
}

export default async function MealTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const days = parseDays(sp.days);

  return requireAccount(async () => {
  const now = new Date();
  const snap = await loadSnapshot(days, now);
  const u = snap.profile.units;
  const low = snap.targetLow;
  const high = snap.targetHigh;

  const from = addDays(startOfDay(now), -(days - 1));
  const to = endOfDay(now);
  const mealsInWindow = between(snap.meals, from, to);

  // The full reading set, not just the window, so a meal near the edge can still find its pre reading.
  const responses = mealResponses(mealsInWindow, snap.readings);
  const ranking = rankMeals(responses);

  const total = responses.length;
  const covered = ranking.covered.length;
  const coverage = total ? covered / total : 0;
  const coveredMeals = ranking.covered as (MealResponse & { rise: number })[];
  const sortedCovered = [...coveredMeals].sort((a, b) => a.rise - b.rise);
  const tooFewForTwoLists = covered <= 5;

  const header = (
    <PageHeader
      eyebrow="Trends · after meals"
      title="What meals do to you"
      lede="Your own meals, compared against each other, using the reading you took before and the highest reading 1 to 3 hours after."
      action={
        <Link href={`/trends?days=${days}`} className="btn btn-secondary no-print">
          Back to numbers
        </Link>
      }
    />
  );

  if (total === 0) {
    return (
      <div className="page">
        {header}
        <RangeSwitcher days={days} base="/trends/meals" />
        <div className="mt-6">
          <EmptyState
            title="No meals logged in this window"
            body={`There are no meals in the last ${days} days, so there is nothing to compare. Logging one meal a day, with a reading before it and one two hours after, is enough to start this page.`}
            cta="Log a meal"
            href="/log"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      <RangeSwitcher days={days} base="/trends/meals" />

      {/* ------------------------------- coverage ------------------------------- */}
      <Card className="mt-5">
        <h2>Coverage</h2>
        <p className="mt-2">
          {covered} of {total} meal{total === 1 ? "" : "s"} had a reading before and one 1 to 3 hours after.
        </p>
        <p className="muted mt-1 text-sm prose-measure">
          Only those covered meals can be ranked, because a rise needs both ends: without a before reading
          and an after reading there is no number to compare.
        </p>
        <div className="mt-4 grid gap-3 grid-cols-2 md:grid-cols-3">
          <Stat label="Covered meals" value={covered} sub={`${pct(coverage * 100)} of what you logged`} />
          <Stat label="Meals logged" value={total} sub={`over ${days} days`} />
          <Stat
            label={`Rose over ${formatGlucose(50, u)} ${unitLabel(u)}`}
            value={ranking.spikeShare === null ? "not yet" : pct(ranking.spikeShare * 100)}
            sub={covered ? `of the ${covered} covered meal${covered === 1 ? "" : "s"}` : "nothing covered yet"}
          />
        </div>
        {coverage < 0.3 ? (
          <div className="mt-4">
            <Notice>
              <strong>Here is how to fix the coverage.</strong> Pick one meal a day, take a reading just
              before you eat and another two hours after. That is two readings a day, and it is enough to
              start ranking your meals against each other. Nothing else on this page needs to change.
            </Notice>
          </div>
        ) : null}
      </Card>

      {/* -------------------------------- ranking -------------------------------- */}
      {covered === 0 ? (
        <Card className="mt-6">
          <h2>Nothing to rank yet</h2>
          <p className="muted mt-2 text-sm prose-measure">
            None of the {total} meal{total === 1 ? "" : "s"} in this window has both a before reading and a
            reading 1 to 3 hours after, so there is no rise to compare. A longer window may help, or one
            covered meal tomorrow.
          </p>
        </Card>
      ) : tooFewForTwoLists ? (
        <Card className="mt-6">
          <h2>Your covered meals, gentlest first</h2>
          <p className="muted mt-1 text-sm prose-measure">
            With {covered} covered meal{covered === 1 ? "" : "s"} a best five and a worst five would be the
            same list twice, so here they are in one list.
          </p>
          <ul className="mt-4 grid gap-3">
            {sortedCovered.map((m) => (
              <MealCard key={m.mealId} m={m} units={u} low={low} high={high} />
            ))}
          </ul>
        </Card>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <h2>Gentlest five</h2>
            <p className="muted mt-1 text-sm">The smallest rise of your covered meals.</p>
            <ul className="mt-4 grid gap-3">
              {(ranking.best as (MealResponse & { rise: number })[]).map((m) => (
                <MealCard key={m.mealId} m={m} units={u} low={low} high={high} />
              ))}
            </ul>
          </Card>
          <Card>
            <h2>Biggest five</h2>
            <p className="muted mt-1 text-sm">The largest rise. Not a list of things to give up.</p>
            <ul className="mt-4 grid gap-3">
              {(ranking.worst as (MealResponse & { rise: number })[]).map((m) => (
                <MealCard key={m.mealId} m={m} units={u} low={low} high={high} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* ------------------------------- by carbs -------------------------------- */}
      {ranking.byCarbBucket.length > 0 ? (
        <Card className="mt-6">
          <h2>By how much carbohydrate was in it</h2>
          <p className="muted mt-1 text-sm prose-measure">
            Only buckets with at least two covered meals appear, so a single unusual meal cannot draw a bar.
          </p>
          <CarbBucketChart rows={ranking.byCarbBucket} units={u} />
        </Card>
      ) : null}

      {/* -------------------------------- by tag --------------------------------- */}
      {ranking.byTag.length > 0 ? (
        <Card className="mt-6">
          <h2>By tag</h2>
          <p className="muted mt-1 text-sm prose-measure">
            Biggest average rise first. Only tags on at least two covered meals appear.
          </p>
          <ol className="mt-4 grid gap-2">
            {ranking.byTag.map((t, i) => {
              const rb = riseBand(t.meanRise);
              return (
                <li key={t.tag} className="card-sunk p-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">
                    <span className="faint num mr-2">{i + 1}</span>
                    <span className="pill">{t.tag}</span>
                  </span>
                  <span className="text-sm num">
                    <span className={`font-semibold band-${RISE_BAND_CLASS[rb]}`}>
                      {signedGlucose(t.meanRise, u)} {unitLabel(u)}
                    </span>
                    <span className="muted"> average rise · {t.n} meal{t.n === 1 ? "" : "s"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      {/* ------------------------------ the caveat ------------------------------- */}
      <Card className="mt-6">
        <h2>What this is, and what it is not</h2>
        <p className="mt-2 prose-measure">
          These are your own meals compared against each other, in your own body, on the days you logged
          them. They are not a nutrition claim and not a ranking of foods in general: a meal that is gentle
          for you may not be for somebody else, and the same meal can behave differently next week.
        </p>
        <p className="mt-2 prose-measure muted">
          Plenty of things besides food move glucose, including sleep, stress, illness, movement before or
          after eating, the time of day, and medication timing. A big rise after one meal is information,
          not a verdict, and nothing here is a reason to change a medication or an insulin dose. That
          conversation belongs with your care team.
        </p>
      </Card>
    </div>
  );
  });
}
