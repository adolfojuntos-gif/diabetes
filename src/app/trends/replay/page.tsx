/**
 * TRENDS / GLUCOSE REPLAY — one day, told in order, then set against this person's best days.
 *
 * Every number and every sentence on this page comes out of src/lib/engines/replay.ts (invariant 3:
 * numbers come from the engine). This file decides the layout and formats mg/dL into the profile's
 * own unit. It adds no finding of its own.
 *
 * The comparison at the bottom is the part that could mislead, so the page says plainly what it is:
 * a list of differences between two sets of days, which is a place to look and not a conclusion.
 * Days differ in more ways than any app can see, and only a handful of them are ever logged.
 */
import Link from "next/link";
import { PageHeader, Card, Stat, Notice, EmptyState } from "@/components/ui";
import { PatternEvidenceChart } from "@/components/PatternChart";
import { requireAccount } from "@/lib/auth/session";
import { loadSnapshot } from "@/lib/data/snapshot";
import { db, sleepLogs } from "@/lib/db";
import type { Units } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { spikeDays, replayDay, type ReplayInput, type Difference } from "@/lib/engines/replay";
import { formatGlucose, unitLabel, bandOf, BAND_LABEL } from "@/lib/units";
import { addDays, startOfDay, dateKey, parseDateKey, fmtTime, fmtDayLong } from "@/lib/time";
import { firstParam, glucose, pct, dayLabel } from "../parts";
import { DayCurve } from "./DayCurve";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/** A date key and nothing else. A malformed param falls back to the chooser rather than guessing. */
function parseDate(raw: string | string[] | undefined): string | null {
  const v = firstParam(raw);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = parseDateKey(v);
  return Number.isNaN(d.getTime()) || dateKey(d) !== v ? null : v;
}

/** One difference, drawn with the same two-bar vocabulary the pattern cards use. */
function DifferenceRow({ d, units }: { d: Difference; units: Units }) {
  return (
    <li className="card-sunk p-3">
      <h3 className="text-base">{d.label}</h3>
      <div className="mt-2">
        <PatternEvidenceChart
          chart={{
            kind: "compare",
            unit: d.unit,
            better: d.better,
            bars: [
              { label: "Your best days", value: d.bestAverage },
              { label: "This day", value: d.thisDay },
            ],
          }}
          /**
           * Neutral on purpose. A difference is not a problem and not a win, and painting it amber
           * would tell somebody they did something wrong on a day the app cannot explain.
           */
          severity="info"
          units={units}
        />
      </div>
      <p className="muted mt-2 text-sm">{d.sentence}</p>
    </li>
  );
}

export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const date = parseDate(sp.date);

  return requireAccount(async () => {
    const now = new Date();
    const snap = await loadSnapshot(WINDOW_DAYS, now);
    const u = snap.profile.units;
    const low = snap.targetLow;
    const high = snap.targetHigh;

    /**
     * The shared snapshot type carries only a night's wakeDate, minutes and quality, so the bed and
     * wake TIMES the replay places on the curve are not in it. Read them here rather than widening
     * a loader six other screens depend on.
     */
    const sleepFrom = dateKey(addDays(startOfDay(now), -(WINDOW_DAYS + 1)));
    const sleep = await db.select().from(sleepLogs).where(gte(sleepLogs.wakeDate, sleepFrom));

    const input: ReplayInput = {
      targetLow: low,
      targetHigh: high,
      readings: snap.readings,
      meals: snap.meals,
      insulin: snap.insulin,
      exercise: snap.exercise,
      sleep,
    };

    const header = (
      <PageHeader
        eyebrow="Trends"
        title="Glucose replay"
        lede="One day at a time, in the order it happened, with everything you logged on it marked in place."
        action={
          <Link href="/trends" className="btn btn-secondary no-print">
            Back to trends
          </Link>
        }
      />
    );

    /* ------------------------------ the chooser ------------------------------ */

    if (!date) {
      const candidates = spikeDays(input, now, WINDOW_DAYS);

      return (
        <div className="page">
          {header}
          {candidates.length === 0 ? (
            <EmptyState
              title="No day to replay yet"
              body={`A day is offered here once it has four or more readings and a reading above your target range. There is nothing like that in the last ${WINDOW_DAYS} days, which is a good thing to read.`}
              cta="Log a reading"
              href="/log/glucose"
            />
          ) : (
            <Card>
              <h2>Pick a day</h2>
              <p className="muted mt-1 text-sm">
                {candidates.length} day{candidates.length === 1 ? "" : "s"} in the last {WINDOW_DAYS} went above{" "}
                {formatGlucose(high, u)} {unitLabel(u)}. The highest peak is first, because that is usually the
                day you remember.
              </p>
              <ul className="mt-4 grid gap-2">
                {candidates.map((c) => {
                  const band = bandOf(c.peakMgdl, low, high);
                  return (
                    <li key={c.date}>
                      <Link href={`/trends/replay?date=${c.date}`} className="card-sunk p-3 block">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold">{dayLabel(c.date)}</span>
                          <span className="num text-sm">
                            <span className={`font-semibold band-${band}`}>
                              {BAND_LABEL[band]} {formatGlucose(c.peakMgdl, u)} {unitLabel(u)}
                            </span>
                            <span className="muted"> at {fmtTime(c.peakAt)}</span>
                          </span>
                        </div>
                        <div className="hint mt-1">
                          {pct(c.timeInRange)} in range · {c.readings} reading{c.readings === 1 ? "" : "s"} · biggest
                          jump between two readings {formatGlucose(c.biggestRise, u)} {unitLabel(u)}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="hint mt-4 prose-measure">
                Only days with at least four readings are offered. Replaying four hours of a day tells a
                misleading story about it.
              </p>
            </Card>
          )}
        </div>
      );
    }

    /* ------------------------------- the replay ------------------------------- */

    const replay = replayDay(date, input, now, WINDOW_DAYS);
    const dayStart = parseDateKey(date);
    const peakBand = replay.peak ? bandOf(replay.peak.valueMgdl, low, high) : null;

    if (replay.readings.length === 0) {
      return (
        <div className="page">
          {header}
          <EmptyState
            title={`No readings on ${fmtDayLong(dayStart)}`}
            body="There is nothing logged on this day, so there is no day to replay. Pick another one."
            cta="Pick a day"
            href="/trends/replay"
          />
        </div>
      );
    }

    return (
      <div className="page">
        {header}

        <div className="seg no-print" aria-label="Which day">
          <Link href="/trends/replay">All days</Link>
          <Link href={`/trends/replay?date=${date}`} aria-current="true">
            {dayLabel(date)}
          </Link>
        </div>

        {replay.note ? (
          <div className="mt-4">
            <Notice>{replay.note}</Notice>
          </div>
        ) : null}

        {/* -------------------------- the day in numbers -------------------------- */}
        <div className="mt-5 grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Highest reading"
            value={replay.peak ? formatGlucose(replay.peak.valueMgdl, u) : "not yet"}
            unit={replay.peak ? unitLabel(u) : undefined}
            sub={replay.peak ? `at ${fmtTime(replay.peak.at)}` : "no readings on this day"}
            band={peakBand ?? undefined}
          />
          <Stat
            label="Time in range"
            value={pct(replay.timeInRange)}
            sub={`${formatGlucose(low, u)} to ${formatGlucose(high, u)} ${unitLabel(u)}, your target`}
            band={replay.timeInRange !== null && replay.timeInRange >= 70 ? "in_range" : undefined}
          />
          <Stat label="Average" value={glucose(replay.mean, u)} unit={unitLabel(u)} sub={`across ${replay.readings.length} reading${replay.readings.length === 1 ? "" : "s"}`} />
          <Stat
            label="First meal to the peak"
            value={
              replay.minutesFirstMealToPeak === null
                ? "not yet"
                : replay.minutesFirstMealToPeak >= 60
                  ? `${(replay.minutesFirstMealToPeak / 60).toFixed(1)} h`
                  : `${replay.minutesFirstMealToPeak} min`
            }
            sub={replay.minutesFirstMealToPeak === null ? "needs a logged meal before the peak" : "from the first meal logged that day"}
          />
        </div>

        {/* ------------------------------ 1. the curve ----------------------------- */}
        <Card className="mt-6">
          <h2>The day&rsquo;s curve</h2>
          <p className="muted mt-1 text-sm">
            {fmtDayLong(dayStart)}, midnight to midnight. The green band is your target range, and each
            mark is something you logged.
          </p>
          <DayCurve
            date={date}
            readings={replay.readings}
            events={replay.events}
            targetLow={low}
            targetHigh={high}
            units={u}
            timeInRange={replay.timeInRange}
            mean={replay.mean}
          />
        </Card>

        {/* ----------------------------- 2. the timeline ---------------------------- */}
        <Card className="mt-6">
          <h2>How the day went</h2>
          <p className="muted mt-1 text-sm">
            Everything logged on this day, in order, with the time of each step.
          </p>
          {replay.events.length === 0 ? (
            <p className="hint mt-3">
              Nothing but readings was logged on this day, so there is no order to walk through yet.
            </p>
          ) : (
            <ol className="mt-4 grid gap-2">
              {replay.events.map((e, i) => (
                <li key={`${e.at.toISOString()}-${e.kind}-${i}`} className="card-sunk p-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num text-sm font-semibold shrink-0" style={{ minWidth: "5.5rem" }}>
                    {fmtTime(e.at)}
                  </span>
                  <span className="text-sm font-semibold">{e.label}</span>
                  {e.detail ? <span className="muted text-sm">{e.detail}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* ---------------------------- 3. the comparison --------------------------- */}
        <Card className="mt-6">
          <h2>The biggest differences between this day and your best days</h2>
          {replay.bestDays.length < 2 ? (
            <p className="muted mt-2 text-sm">
              There are not enough other well-logged days in the last {WINDOW_DAYS} to compare this one
              against yet. A few more days of readings will fill this in.
            </p>
          ) : (
            <>
              <p className="muted mt-1 text-sm">
                Compared against your {replay.bestDays.length} best day
                {replay.bestDays.length === 1 ? "" : "s"} for time in range:{" "}
                {replay.bestDays.map((d) => dayLabel(d)).join(", ")}.
              </p>
              <p className="muted mt-2 text-sm prose-measure">
                {/**
                 * The one sentence this section cannot go without, and the reason it is here is in the
                 * header of src/lib/engines/replay.ts. Two sets of days differ in dozens of ways and
                 * only a handful are ever written down, so a difference is somewhere to look.
                 */}
                These are differences, not causes. Two days differ in many ways, and only a few of them
                are ever logged.
              </p>
              {replay.differences.length === 0 ? (
                <p className="hint mt-3">
                  On everything this app can measure, this day looks like your best days.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3">
                  {replay.differences.map((d) => (
                    <DifferenceRow key={d.key} d={d} units={u} />
                  ))}
                </ul>
              )}
              <p className="hint mt-4 prose-measure">
                Best means time in range, not a low average. A day spent under {formatGlucose(low, u)}{" "}
                {unitLabel(u)} has a flattering average and is not a day to hold up as a model.
              </p>
            </>
          )}
        </Card>

        <div className="mt-6 flex flex-wrap gap-2 no-print">
          <Link href="/trends/replay" className="btn btn-secondary">
            Pick another day
          </Link>
          {replay.peak ? (
            <Link href={`/trends/why?at=${encodeURIComponent(replay.peak.at.toISOString())}`} className="btn btn-secondary">
              Why did the peak happen
            </Link>
          ) : null}
        </div>

        <p className="hint mt-6 prose-measure">
          Steady replays what you logged. A day with four readings and a day with forty have very
          different curves, and that is a fact about the log rather than about the day.
        </p>
      </div>
    );
  });
}
