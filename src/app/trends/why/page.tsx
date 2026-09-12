/**
 * TRENDS / WHY DID THIS HAPPEN — one reading, and the things that may have contributed to it.
 *
 * Every word of the answer comes out of src/lib/engines/attribution.ts (invariant 3: numbers come
 * from the engine). This file picks the reading, formats mg/dL into the profile's own unit, and lays
 * the engine's output out. It names no factor of its own and it never says one caused anything.
 *
 * Two things about the layout are not decoration.
 *
 * The heading leads with the count, because the count is the honest headline. Three things is a
 * different answer from one thing, and a page titled "Why did this happen" over an empty list reads
 * as a failure when it is a real result.
 *
 * "What this cannot see" is always on the page, never behind a toggle and never at the bottom as a
 * disclaimer. The most likely explanation for a high reading is often something that was never
 * logged, and a list of three factors with no mention of that reads as a complete account.
 */
import Link from "next/link";
import { PageHeader, Card, Notice } from "@/components/ui";
import { PatternEvidenceChart } from "@/components/PatternChart";
import { requireAccount } from "@/lib/auth/session";
import { loadSnapshot } from "@/lib/data/snapshot";
import { between, type ReadingLike } from "@/lib/engines/stats";
import { explainReading, type Contributor } from "@/lib/engines/attribution";
import type { Severity } from "@/lib/engines/patterns";
import type { Units } from "@/lib/db/schema";
import { formatGlucose, unitLabel, bandOf, BAND_LABEL } from "@/lib/units";
import { addDays, startOfDay, endOfDay, dateKey, fmtTime, fmtDay, fmtDayLong } from "@/lib/time";
import { firstParam } from "../parts";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
/** With no `at` param, the reading to explain is the highest of the last week. */
const DEFAULT_LOOKBACK_DAYS = 7;
/**
 * How close a reading has to be to the requested moment to count as the one asked for. A link built
 * by this app is exact; a hand-edited or rounded timestamp is not, and a minute of slack is kinder
 * than an error page.
 */
const MATCH_WINDOW_MS = 15 * 60_000;

/**
 * Confidence is shown with the engine's word, not a colour.
 *
 * The chart beneath takes a severity because that is the API it has, and amber and coral mean
 * high and low everywhere else in this app. A coral pill next to "Likely" would read as a glucose
 * band, so the pill stays neutral and the word does the work.
 */
const SEVERITY_OF: Record<Contributor["confidence"], Severity> = { likely: "attention", possible: "watch" };
const CONFIDENCE_WORD: Record<Contributor["confidence"], string> = { likely: "Likely", possible: "Possible" };

/**
 * The reading an `at` param is asking about, or null when nothing logged is near it.
 *
 * Nearest rather than exact, with a fifteen minute ceiling. Exact matching looks correct and breaks
 * on a link somebody typed out or a timestamp that lost its seconds, and silently explaining a
 * different reading than the one asked for would be worse than saying nothing.
 */
function nearestReading(raw: string | undefined, readings: ReadingLike[]): ReadingLike | null {
  if (!raw || !readings.length) return null;
  const asked = new Date(raw);
  if (Number.isNaN(asked.getTime())) return null;
  const nearest = readings.reduce((a, b) =>
    Math.abs(b.at.getTime() - asked.getTime()) < Math.abs(a.at.getTime() - asked.getTime()) ? b : a,
  );
  return Math.abs(nearest.at.getTime() - asked.getTime()) <= MATCH_WINDOW_MS ? nearest : null;
}

function ContributorCard({ c, units }: { c: Contributor; units: Units }) {
  const severity = SEVERITY_OF[c.confidence];
  return (
    <article className={`card p-4 sev-${severity}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3>{c.label}</h3>
        <span className="pill">{CONFIDENCE_WORD[c.confidence]}</span>
      </div>
      <p className="mt-1 text-sm">{c.evidence}</p>
      {/**
       * The chart sits between the evidence and the mechanism, which is the order somebody reads in:
       * what happened, what it looks like, why that is a known thing. It draws the engine's own spec
       * and adds no number the sentence above does not already state.
       */}
      {c.chart ? (
        <div className="mt-3">
          <PatternEvidenceChart chart={c.chart} severity={severity} units={units} />
        </div>
      ) : null}
      <p className="mt-2 text-sm muted">{c.because}</p>
      <div className="mt-3">
        <Link href={c.href} className="btn btn-secondary btn-sm">
          See the evidence
        </Link>
      </div>
    </article>
  );
}

export default async function WhyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const atRaw = firstParam(sp.at);

  return requireAccount(async () => {
    const now = new Date();
    const snap = await loadSnapshot(WINDOW_DAYS, now);
    const u = snap.profile.units;
    const low = snap.targetLow;
    const high = snap.targetHigh;

    const header = (
      <PageHeader
        eyebrow="Trends"
        title="Why did this happen"
        lede="One reading, and the things in your own log that may have contributed to it."
        action={
          <Link href="/trends" className="btn btn-secondary no-print">
            Back to trends
          </Link>
        }
      />
    );

    /* ---------------------------- which reading ---------------------------- */

    const weekFrom = addDays(startOfDay(now), -(DEFAULT_LOOKBACK_DAYS - 1));
    const recent = between(snap.readings, weekFrom, endOfDay(now));
    const highestRecent = recent.length ? recent.reduce((a, b) => (b.valueMgdl > a.valueMgdl ? b : a)) : null;

    /** The reading nearest the requested moment, if one is close enough to be the one meant. */
    const requested: ReadingLike | null = nearestReading(atRaw, snap.readings);

    const target = requested ?? highestRecent;
    const missed = atRaw !== undefined && requested === null;

    if (!target) {
      return (
        <div className="page">
          {header}
          <Notice>
            There are no readings in the last {DEFAULT_LOOKBACK_DAYS} days, so there is nothing to explain
            yet. One reading is enough for this page to have something to work with.
          </Notice>
          <div className="mt-4">
            <Link href="/log/glucose" className="btn">
              Log a reading
            </Link>
          </div>
        </div>
      );
    }

    const answer = explainReading({
      at: target.at,
      valueMgdl: target.valueMgdl,
      targetLow: low,
      targetHigh: high,
      usesInsulinBolus: snap.usesInsulinBolus,
      hydrationGoalMl: snap.hydrationGoalMl,
      sleepGoalMinutes: snap.sleepGoalMinutes,
      readings: snap.readings,
      meals: snap.meals,
      insulin: snap.insulin,
      exercise: snap.exercise,
      sleep: snap.sleep,
      hydration: snap.hydration,
    });

    const n = answer.contributors.length;
    const band = bandOf(answer.valueMgdl, low, high);

    /**
     * The heading, in the count's own words.
     *
     * "1 things" reached a screen in this codebase once, so the engine's count picks the word rather
     * than a template. At zero there is no count to lead with, and the engine's own note is the
     * whole answer: padding it out with a heading that promised a list would be worse than honest.
     */
    const headline =
      n === 0
        ? null
        : n === 1
          ? "We found one thing that may have contributed"
          : `We found ${n} things that may have contributed`;

    // Used as the answer at zero, so it is not also printed a second time further down.
    const noteIsTheAnswer = n === 0;

    /** Other readings worth asking about, so the page is not a dead end. */
    const others = [...recent]
      .filter((r) => r.at.getTime() !== target.at.getTime())
      .sort((a, b) => b.valueMgdl - a.valueMgdl)
      .slice(0, 6);

    return (
      <div className="page">
        {header}

        {missed ? (
          <div className="mb-4">
            {/* Not amber. Amber means high glucose everywhere else in this app, and this is a missing link. */}
            <Notice>
              There is no reading logged at that time, so this explains your highest reading of the last{" "}
              {DEFAULT_LOOKBACK_DAYS} days instead.
            </Notice>
          </div>
        ) : null}

        {/* ---------------------------- the reading ---------------------------- */}
        <Card>
          <div className="eyebrow">The reading</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className={`num font-display text-4xl band-${band}`}>{formatGlucose(answer.valueMgdl, u)}</span>
            <span className="muted">{unitLabel(u)}</span>
            <span className={`pill chip-${band}`}>{BAND_LABEL[band]}</span>
          </div>
          <div className="hint mt-2">
            {fmtDayLong(answer.at)} at {fmtTime(answer.at)}
            {requested === null && !missed ? ` · your highest reading of the last ${DEFAULT_LOOKBACK_DAYS} days` : ""}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 no-print">
            <Link href={`/trends/replay?date=${dateKey(answer.at)}`} className="btn btn-secondary btn-sm">
              Replay this whole day
            </Link>
          </div>
        </Card>

        {/* ----------------------------- the answer ----------------------------- */}
        <section className="mt-6">
          {headline ? (
            <>
              <h2>{headline}</h2>
              <p className="muted mt-1 text-sm prose-measure">
                Drawn from what you logged around this reading. Each one may have played a part. None of
                them is the whole story.
              </p>
              <div className="mt-4 grid gap-3">
                {answer.contributors.map((c) => (
                  <ContributorCard key={c.key} c={c} units={u} />
                ))}
              </div>
            </>
          ) : (
            <Card>
              <h2>{answer.note ?? "Nothing you logged around this reading stands out."}</h2>
              <p className="muted mt-2 text-sm prose-measure">
                Adding a meal, a walk or a night&rsquo;s sleep to the log gives this page more to work with
                next time. What it cannot see is listed below either way.
              </p>
            </Card>
          )}
        </section>

        {/* ----------------------------- the note ----------------------------- */}
        {answer.note && !noteIsTheAnswer ? (
          <div className="mt-4">
            <Notice>{answer.note}</Notice>
          </div>
        ) : null}

        {/* --------------------------- the blind spots --------------------------- */}
        {/**
         * Required, not optional. `blindSpots` is part of the answer and the engine populates it on
         * every call, including the ones that found three strong factors.
         */}
        <Card className="mt-6">
          <h2>What this cannot see</h2>
          <p className="muted mt-1 text-sm prose-measure">
            This answer is drawn from what you logged. These things move glucose too, and Steady has no
            way to see them.
          </p>
          <ul className="mt-3 grid gap-2">
            {answer.blindSpots.map((b) => (
              <li key={b} className="card-sunk p-3 text-sm">
                {b}
              </li>
            ))}
          </ul>
          <p className="hint mt-4 prose-measure">
            Any one of these can move a reading on its own. If one of them fits your week, that is worth
            more than anything on this page.
          </p>
        </Card>

        {/* -------------------------- another reading -------------------------- */}
        {others.length ? (
          <Card className="mt-6">
            <h2>Ask about another reading</h2>
            <p className="muted mt-1 text-sm">
              Your highest readings from the last {DEFAULT_LOOKBACK_DAYS} days.
            </p>
            <ul className="mt-3 grid gap-2">
              {others.map((r) => {
                const b = bandOf(r.valueMgdl, low, high);
                return (
                  <li key={r.at.toISOString()}>
                    <Link href={`/trends/why?at=${encodeURIComponent(r.at.toISOString())}`} className="card-sunk p-3 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm">
                        {fmtDay(r.at)} at {fmtTime(r.at)}
                      </span>
                      <span className={`num text-sm font-semibold band-${b}`}>
                        {formatGlucose(r.valueMgdl, u)} {unitLabel(u)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        <p className="hint mt-6 prose-measure">
          Steady reads your log and nothing else. A factor named here may have played a part, and what it
          means for you is a conversation with your care team.
        </p>
      </div>
    );
  });
}
