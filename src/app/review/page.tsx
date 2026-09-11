/**
 * WEEKLY REVIEW — one week against the one before it, and a page worth printing.
 *
 * Every number is from src/lib/engines/review.ts, which is itself built on the stats, meal and
 * pattern engines. This file formats and lays out. It colours a change only where the direction is
 * unambiguous, and it refuses to compare two weeks when either has fewer than 10 readings.
 */
import Link from "next/link";
import { PageHeader, Card, EmptyState, Notice, PatternCard, TirBar, Stat } from "@/components/ui";
import { requireAccount } from "@/lib/auth/session";
import { loadReviewInput, usesInsulin } from "@/lib/data/snapshot";
import { weeklyReview, type WeekSummary } from "@/lib/engines/review";
import { between } from "@/lib/engines/stats";
import type { MealResponse } from "@/lib/engines/mealResponse";
import { riseBand } from "@/lib/engines/mealResponse";
import { formatGlucose, unitLabel } from "@/lib/units";
import type { Units } from "@/lib/db/schema";
import { addDays, startOfWeek, dateKey, parseDateKey, fmtDayLong, fmtDay, fmtTime } from "@/lib/time";
import { RISE_LABEL, RISE_BAND_CLASS, signedGlucose, glucose, pct, num } from "../trends/parts";
import { PrintButton } from "./PrintButton";

const NOT_ENOUGH = "not enough readings to compare";

type Cmp =
  | { kind: "none"; text: string }
  | { kind: "delta"; d: number; text: string; tone: "good" | "bad" | null };

type Row = { label: string; cur: string; prev: string; cmp: Cmp; note?: string };

function parseWeek(raw: string | string[] | undefined, now: Date): Date {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return startOfWeek(now);
  const d = parseDateKey(v);
  if (Number.isNaN(d.getTime())) return startOfWeek(now);
  return startOfWeek(d);
}

function hours(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "not logged";
  return `${(min / 60).toFixed(1)} h`;
}

function DeltaCell({ cmp }: { cmp: Cmp }) {
  if (cmp.kind === "none") return <span className="muted text-sm">{cmp.text}</span>;
  if (cmp.d === 0) return <span className="muted text-sm">no change</span>;
  const cls = cmp.tone === "good" ? "band-in_range" : cmp.tone === "bad" ? "band-low" : "";
  return (
    <span className={`num text-sm font-semibold ${cls}`}>
      <span aria-hidden="true">{cmp.d > 0 ? "↑" : "↓"}</span> {cmp.d > 0 ? "up" : "down"} {cmp.text}
    </span>
  );
}

function weightOf(logs: { at: Date; kg: number }[], w: WeekSummary): number | null {
  const inWeek = between(logs, w.from, w.to).sort((a, b) => a.at.getTime() - b.at.getTime());
  return inWeek.length ? inWeek[inWeek.length - 1].kg : null;
}

function MealLine({ m, units }: { m: MealResponse; units: Units }) {
  if (m.rise === null) return null;
  const rb = riseBand(m.rise);
  return (
    <li className="card-sunk p-3 flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-sm">
        <span className="font-semibold">{m.name || "Unnamed meal"}</span>
        <span className="hint"> · {fmtDay(m.at)} at {fmtTime(m.at)} · {Math.round(m.carbsG)} g carbs</span>
      </span>
      <span className="text-sm num">
        <span className={`font-semibold band-${RISE_BAND_CLASS[rb]}`}>
          {signedGlucose(m.rise, units)} {unitLabel(units)}
        </span>
        <span className="muted"> {RISE_LABEL[rb].toLowerCase()}</span>
      </span>
    </li>
  );
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const realNow = new Date();
  const weekFrom = parseWeek(sp.week, realNow);
  const weekTo = addDays(weekFrom, 7);
  // Load as if "now" were the end of the week being reviewed, so a past week gets its own context.
  const asOf = weekTo < realNow ? weekTo : realNow;

  return requireAccount(async () => {
  const input = await loadReviewInput(asOf, weekFrom);
  const profile = input.profile;
  const u = profile.units;
  const review = weeklyReview(input);
  const cur = review.current;
  const prev = review.previous;

  const thisWeek = startOfWeek(realNow);
  const prevKey = dateKey(addDays(weekFrom, -7));
  const nextFrom = addDays(weekFrom, 7);
  const nextKey = dateKey(nextFrom);
  const nextInFuture = nextFrom > thisWeek;
  const isThisWeek = dateKey(weekFrom) === dateKey(thisWeek);

  const nav = (
    <div className="mt-4 flex flex-wrap items-center gap-2 no-print">
      <Link href={`/review?week=${prevKey}`} className="btn btn-secondary btn-sm">
        Previous week
      </Link>
      {nextInFuture ? (
        <span className="btn btn-secondary btn-sm" aria-disabled="true" style={{ opacity: 0.5 }}>
          Next week
        </span>
      ) : (
        <Link href={`/review?week=${nextKey}`} className="btn btn-secondary btn-sm">
          Next week
        </Link>
      )}
      {isThisWeek ? null : (
        <Link href="/review" className="btn btn-ghost btn-sm">
          Back to this week
        </Link>
      )}
      <PrintButton />
    </div>
  );

  const header = (
    <PageHeader
      eyebrow="Weekly review"
      title={`Week of ${fmtDayLong(weekFrom)}`}
      lede={
        isThisWeek
          ? "This week so far, against the week before it. It fills in as the week goes on."
          : "This week against the week before it."
      }
    />
  );

  const nothingLogged =
    cur.glucose.n === 0 &&
    cur.meals.count === 0 &&
    cur.exercise.sessions === 0 &&
    cur.sleep.nights === 0 &&
    cur.hydration.daysLogged === 0 &&
    cur.insulin.daysLogged === 0;

  if (nothingLogged) {
    return (
      <div className="page">
        {header}
        {nav}
        <div className="mt-6">
          <EmptyState
            title="Nothing logged in this week"
            body="A review needs a week of logging behind it: readings, meals, movement, sleep, whatever you keep. Log a few days and this page will have something real to say."
            cta="Start logging"
            href="/log"
          />
        </div>
      </div>
    );
  }

  /* ----------------------------- the comparison ----------------------------- */

  const canCompare = cur.glucose.n >= 10 && prev.glucose.n >= 10;
  const d = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

  const curWeight = weightOf(input.weightLogs, cur);
  const prevWeight = weightOf(input.weightLogs, prev);

  const glucoseCmp = (delta: number | null, text: (x: number) => string, tone: (x: number) => "good" | "bad" | null): Cmp =>
    !canCompare || delta === null ? { kind: "none", text: NOT_ENOUGH } : { kind: "delta", d: delta, text: text(Math.abs(delta)), tone: tone(delta) };

  const plainCmp = (delta: number | null, text: (x: number) => string, noneText: string): Cmp =>
    delta === null ? { kind: "none", text: noneText } : { kind: "delta", d: delta, text: text(Math.abs(delta)), tone: null };

  const rows: Row[] = [
    {
      label: "Time in range",
      cur: pct(cur.glucose.timeInRange),
      prev: pct(prev.glucose.timeInRange),
      cmp: glucoseCmp(
        d(cur.glucose.timeInRange, prev.glucose.timeInRange),
        (x) => `${x.toFixed(0)} points`,
        (x) => (x > 0 ? "good" : "bad"),
      ),
      note: `your target is ${formatGlucose(input.targetLow, u)} to ${formatGlucose(input.targetHigh, u)} ${unitLabel(u)}`,
    },
    {
      label: "Average glucose",
      cur: `${glucose(cur.glucose.mean, u)} ${unitLabel(u)}`,
      prev: `${glucose(prev.glucose.mean, u)} ${unitLabel(u)}`,
      cmp: glucoseCmp(
        d(cur.glucose.mean, prev.glucose.mean),
        (x) => `${formatGlucose(x, u)} ${unitLabel(u)}`,
        () => null,
      ),
      note: "an average can move for good and bad reasons, so it is shown without a judgement",
    },
    {
      label: "Variability (CV)",
      cur: pct(cur.glucose.cv),
      prev: pct(prev.glucose.cv),
      cmp: glucoseCmp(
        d(cur.glucose.cv, prev.glucose.cv),
        (x) => `${x.toFixed(1)} points`,
        (x) => (x < 0 ? "good" : "bad"),
      ),
      note: "lower is steadier; the consensus target is 36% or less",
    },
    {
      label: "Lows",
      cur: String(cur.glucose.lowsCount),
      prev: String(prev.glucose.lowsCount),
      cmp: glucoseCmp(
        d(cur.glucose.lowsCount, prev.glucose.lowsCount),
        (x) => `${x.toFixed(0)} reading${x === 1 ? "" : "s"}`,
        (x) => (x < 0 ? "good" : "bad"),
      ),
      note: `readings under ${formatGlucose(input.targetLow, u)} ${unitLabel(u)}`,
    },
    {
      label: "Readings",
      cur: `${cur.glucose.n} on ${cur.glucose.days} day${cur.glucose.days === 1 ? "" : "s"}`,
      prev: `${prev.glucose.n} on ${prev.glucose.days} day${prev.glucose.days === 1 ? "" : "s"}`,
      cmp: plainCmp(cur.glucose.n - prev.glucose.n, (x) => `${x.toFixed(0)} reading${x === 1 ? "" : "s"}`, "nothing logged either week"),
    },
    {
      label: "Movement minutes",
      cur: `${cur.exercise.minutes} min`,
      prev: `${prev.exercise.minutes} min`,
      cmp: plainCmp(cur.exercise.minutes - prev.exercise.minutes, (x) => `${x.toFixed(0)} min`, "nothing logged either week"),
      note: `${cur.exercise.sessions} session${cur.exercise.sessions === 1 ? "" : "s"} this week`,
    },
    {
      label: "Average sleep",
      cur: hours(cur.sleep.avgMinutes),
      prev: hours(prev.sleep.avgMinutes),
      cmp: plainCmp(d(cur.sleep.avgMinutes, prev.sleep.avgMinutes), (x) => `${x.toFixed(0)} min a night`, "not enough nights logged to compare"),
      note: `${cur.sleep.nights} night${cur.sleep.nights === 1 ? "" : "s"} logged, goal ${hours(input.sleepGoalMinutes)}`,
    },
    {
      label: "Days water goal hit",
      cur: `${cur.hydration.daysAtGoal} of ${cur.hydration.daysLogged} logged`,
      prev: `${prev.hydration.daysAtGoal} of ${prev.hydration.daysLogged} logged`,
      cmp: plainCmp(cur.hydration.daysAtGoal - prev.hydration.daysAtGoal, (x) => `${x.toFixed(0)} day${x === 1 ? "" : "s"}`, "nothing logged either week"),
      note: `goal is ${input.hydrationGoalMl} ml a day`,
    },
    {
      label: "Carbs per day",
      cur: cur.meals.avgCarbsPerDay === null ? "not logged" : `${num(cur.meals.avgCarbsPerDay)} g`,
      prev: prev.meals.avgCarbsPerDay === null ? "not logged" : `${num(prev.meals.avgCarbsPerDay)} g`,
      cmp: plainCmp(d(cur.meals.avgCarbsPerDay, prev.meals.avgCarbsPerDay), (x) => `${x.toFixed(0)} g a day`, "not enough meal logs to compare"),
      note: "across the days you logged a meal, shown without a judgement",
    },
  ];

  if (usesInsulin(profile)) {
    rows.push({
      label: "Insulin units per day",
      cur: cur.insulin.avgUnitsPerDay === null ? "not logged" : num(cur.insulin.avgUnitsPerDay, 1),
      prev: prev.insulin.avgUnitsPerDay === null ? "not logged" : num(prev.insulin.avgUnitsPerDay, 1),
      cmp: plainCmp(d(cur.insulin.avgUnitsPerDay, prev.insulin.avgUnitsPerDay), (x) => `${x.toFixed(1)} units a day`, "not enough insulin logs to compare"),
      note: "what you recorded taking; Steady never suggests a dose",
    });
  }

  rows.push({
    label: "Weight change",
    cur: curWeight === null ? "not logged" : `${num(curWeight, 1)} kg`,
    prev: prevWeight === null ? "not logged" : `${num(prevWeight, 1)} kg`,
    cmp: plainCmp(d(curWeight, prevWeight), (x) => `${x.toFixed(1)} kg`, "not enough weight logs to compare"),
    note: "the last weight you logged in each week, shown without a judgement",
  });

  const bestMeals = (review.ranking.best ?? []).filter((m) => m.rise !== null);

  return (
    <div className="page">
      {header}
      {nav}

      <p className="hint mt-3 prose-measure">
        Printing this gives you one page with the week&rsquo;s numbers, your wins and the things worth
        raising. It is a good thing to bring to an appointment, and it fits in a pocket.
      </p>

      {review.sampleNote ? (
        <div className="mt-5">
          <Notice>
            <strong>About the sample size. </strong>
            {review.sampleNote}
          </Notice>
        </div>
      ) : null}

      {/* ----------------------------- headline bar ----------------------------- */}
      {cur.glucose.n > 0 ? (
        <Card className="mt-5">
          <h2>How the week went</h2>
          <div className="mt-4 grid gap-3 grid-cols-2 md:grid-cols-4">
            <Stat
              label="Time in range"
              value={pct(cur.glucose.timeInRange)}
              band={cur.glucose.timeInRange !== null && cur.glucose.timeInRange >= 70 ? "in_range" : undefined}
            />
            <Stat label="Average" value={glucose(cur.glucose.mean, u)} unit={unitLabel(u)} />
            <Stat label="Readings" value={cur.glucose.n} sub={`on ${cur.glucose.days} of 7 days`} />
            <Stat label="Lows" value={cur.glucose.lowsCount} band={cur.glucose.lowsCount > 0 ? "low" : undefined} />
          </div>
          <div className="mt-4">
            <TirBar pct={cur.glucose.pct} />
          </div>
          <p className="hint mt-2">
            Very low {cur.glucose.pct.very_low.toFixed(1)}% · low {cur.glucose.pct.low.toFixed(1)}% · in range{" "}
            {cur.glucose.pct.in_range.toFixed(1)}% · high {cur.glucose.pct.high.toFixed(1)}% · very high{" "}
            {cur.glucose.pct.very_high.toFixed(1)}%
          </p>
        </Card>
      ) : (
        <Card className="mt-5">
          <h2>How the week went</h2>
          <p className="muted mt-2 text-sm">
            No glucose readings this week, so the glucose rows below have nothing to compare. Everything else
            you logged is still here.
          </p>
        </Card>
      )}

      {/* ------------------------------ the table ------------------------------- */}
      <Card className="mt-6">
        <h2>This week against last week</h2>
        {!canCompare ? (
          <p className="muted mt-1 text-sm prose-measure">
            {cur.glucose.n} reading{cur.glucose.n === 1 ? "" : "s"} this week and {prev.glucose.n} last week.
            Ten in each week is the least it takes for a glucose comparison to mean anything, so those rows
            say so rather than showing a change.
          </p>
        ) : null}
        <div className="mt-4" style={{ overflowX: "auto", maxWidth: "100%" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "34rem" }}>
            <caption className="sr-only">
              This week compared with last week, with the change in each measure.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="eyebrow text-left pb-2">
                  Measure
                </th>
                <th scope="col" className="eyebrow text-right pb-2">
                  This week
                </th>
                <th scope="col" className="eyebrow text-right pb-2">
                  Last week
                </th>
                <th scope="col" className="eyebrow text-right pb-2">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ borderTop: "1px solid var(--line)" }}>
                  <th scope="row" className="text-left font-normal py-2.5 pr-3">
                    <span className="font-semibold">{r.label}</span>
                    {r.note ? <span className="hint block">{r.note}</span> : null}
                  </th>
                  <td className="text-right num py-2.5 pl-3 font-semibold whitespace-nowrap">{r.cur}</td>
                  <td className="text-right num py-2.5 pl-3 muted whitespace-nowrap">{r.prev}</td>
                  <td className="text-right py-2.5 pl-3">
                    <DeltaCell cmp={r.cmp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint mt-3 prose-measure">
          A change is only coloured where the direction is not in question: more time in range is better,
          more lows is worse, and lower variability is steadier. Weight, carbs and the average are shown as
          plain numbers, because up or down is not automatically better.
        </p>
      </Card>

      {/* -------------------------------- wins ---------------------------------- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2>Your wins</h2>
          {review.wins.length === 0 ? (
            <p className="muted mt-2 text-sm">
              Nothing reached the bar for a win this week. That is about the numbers and the logging, not
              about the effort.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {review.wins.map((w) => (
                <li key={w} className="card-sunk sev-win p-3 text-sm">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2>Worth discussing</h2>
          {review.toDiscuss.length === 0 ? (
            <p className="muted mt-2 text-sm">
              Nothing this week rose to the level of something to raise. If something felt off anyway, that is
              still worth mentioning.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {review.toDiscuss.map((t) => (
                <li key={t} className="card-sunk sev-watch p-3 text-sm">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ------------------------------ patterns -------------------------------- */}
      <section className="mt-6">
        <h2>Patterns</h2>
        <p className="muted mt-1 text-sm prose-measure">
          Found over the 14 days ending with this week, each one with the numbers it came from.
        </p>
        {review.patterns.length === 0 ? (
          <div className="card-quiet p-4 mt-3 text-sm muted">
            No patterns met their minimum sample size this fortnight. That is the engine refusing to guess.
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {review.patterns.map((p) => (
              <PatternCard key={p.key} p={p} units={u} />
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------- best meals -------------------------------- */}
      <Card className="mt-6">
        <h2>Best meals this week</h2>
        {bestMeals.length === 0 ? (
          <p className="muted mt-2 text-sm prose-measure">
            No meal this week had both a reading before it and one 1 to 3 hours after, so none can be ranked.
            One covered meal a day is enough to change that.
          </p>
        ) : (
          <>
            <p className="muted mt-1 text-sm">Smallest rise first, out of the meals with a reading either side.</p>
            <ul className="mt-3 grid gap-2">
              {bestMeals.map((m) => (
                <MealLine key={m.mealId} m={m} units={u} />
              ))}
            </ul>
            <p className="hint mt-3">
              {review.ranking.covered.length} of {review.ranking.covered.length + review.ranking.uncovered} meals
              this week had readings either side.{" "}
              <Link href="/trends/meals?days=7" className="underline no-print">
                See the whole post-meal picture
              </Link>
              .
            </p>
          </>
        )}
      </Card>

      <p className="hint mt-6 prose-measure">
        Steady is not a medical device and nothing here has been reviewed by a clinician. It counts what you
        logged so you and your care team have the same picture in front of you.
      </p>
    </div>
  );
  });
}
