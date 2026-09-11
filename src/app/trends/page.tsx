/**
 * TRENDS — the numbers, with nothing invented.
 *
 * Every statistic on this page comes out of src/lib/engines/stats.ts (invariant 3: numbers come
 * from the engine). This file only decides how they are laid out and formats them into the
 * profile's unit.
 */
import Link from "next/link";
import { PageHeader, Card, Stat, EmptyState, TirBar } from "@/components/ui";
import { requireAccount } from "@/lib/auth/session";
import { loadSnapshot } from "@/lib/data/snapshot";
import {
  glucoseStats,
  statsByBlock,
  dailySeries,
  lowEvents,
  between,
  DAY_BLOCKS,
  type DayBlock,
} from "@/lib/engines/stats";
import { formatGlucose, unitLabel, bandOf, BAND_LABEL, VERY_LOW_MGDL } from "@/lib/units";
import { addDays, startOfDay, endOfDay, fmtDay, fmtTime } from "@/lib/time";
import {
  RangeSwitcher,
  GlucoseChart,
  DayColumns,
  TirLegend,
  GoalComparison,
  parseDays,
  firstParam,
  glucose,
  pct,
  num,
  dayLabel,
} from "./parts";
import { ScrollToBlock } from "./ScrollToBlock";

const BLOCK_KEYS = DAY_BLOCKS.map((b) => b.key);

function parseBlock(raw: string | string[] | undefined): DayBlock | null {
  const v = firstParam(raw);
  return v && (BLOCK_KEYS as string[]).includes(v) ? (v as DayBlock) : null;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const days = parseDays(sp.days);
  const focusBlock = parseBlock(sp.block);

  return requireAccount(async () => {
  const now = new Date();
  const snap = await loadSnapshot(days, now);
  const profile = snap.profile;
  const u = profile.units;
  const low = snap.targetLow;
  const high = snap.targetHigh;

  const from = addDays(startOfDay(now), -(days - 1));
  const to = endOfDay(now);
  const readings = between(snap.readings, from, to);

  const stats = glucoseStats(readings, low, high);
  const blocks = statsByBlock(readings, low, high);
  const series = dailySeries(readings, from, to, low, high);
  const lows = lowEvents(readings, low).sort((a, b) => b.start.getTime() - a.start.getTime());

  const rankedDays = series
    .filter((d) => d.tir !== null && d.n > 0)
    .map((d) => ({ ...d, tir: d.tir as number }))
    .sort((a, b) => b.tir - a.tir);
  const bestDays = rankedDays.slice(0, 3);
  const worstDays = rankedDays.slice(-3).reverse();

  const header = (
    <PageHeader
      eyebrow="Trends"
      title="Your numbers"
      lede={`Everything here is counted from your own readings over the last ${days} days. Nothing is estimated or filled in.`}
      action={
        <Link href={`/trends/meals?days=${days}`} className="btn btn-secondary no-print">
          After meals
        </Link>
      }
    />
  );

  if (stats.n === 0) {
    return (
      <div className="page">
        {header}
        <RangeSwitcher days={days} base="/trends" />
        <div className="mt-6">
          <EmptyState
            title="No glucose readings in this window"
            body={`There are no readings in the last ${days} days, so there is nothing to count yet. One reading a day, at any time, is enough for this page to start showing you something.`}
            cta="Log a reading"
            href="/log/glucose"
          />
        </div>
        <p className="hint mt-4">You can also try a longer window above, in case your readings are further back.</p>
      </div>
    );
  }

  const lowPct = stats.pct.very_low + stats.pct.low;

  return (
    <div className="page">
      {header}
      <RangeSwitcher days={days} base="/trends" />

      {/* ------------------------------ headline ------------------------------ */}
      <div className="mt-5 grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Time in range"
          value={pct(stats.timeInRange)}
          sub={`${formatGlucose(low, u)} to ${formatGlucose(high, u)} ${unitLabel(u)}, your target`}
          band={stats.timeInRange !== null && stats.timeInRange >= 70 ? "in_range" : undefined}
        />
        <Stat
          label="Average glucose"
          value={glucose(stats.mean, u)}
          unit={unitLabel(u)}
          sub={`across ${stats.n} reading${stats.n === 1 ? "" : "s"}`}
          band={stats.mean !== null ? bandOf(stats.mean, low, high) : undefined}
        />
        <Stat
          label="Readings"
          value={stats.n}
          sub={`on ${stats.days} of ${days} days`}
        />
        <Stat
          label="Lows"
          value={stats.lowsCount}
          sub={
            stats.counts.very_low > 0
              ? `${stats.counts.very_low} of them under ${formatGlucose(VERY_LOW_MGDL, u)} ${unitLabel(u)}`
              : `none under ${formatGlucose(VERY_LOW_MGDL, u)} ${unitLabel(u)}`
          }
          band={stats.lowsCount > 0 ? "low" : undefined}
        />
        {stats.gmiReliable && stats.gmi !== null ? (
          <Stat
            label="GMI"
            value={num(stats.gmi, 1)}
            unit="%"
            sub={`estimated from your average over ${stats.days} days`}
          />
        ) : (
          <Stat
            label="GMI"
            value="Not yet"
            sub={`Needs about 14 days of dense data. This window has ${stats.n} reading${stats.n === 1 ? "" : "s"} across ${stats.days} day${stats.days === 1 ? "" : "s"}.`}
          />
        )}
        <Stat label="Variability (CV)" value={pct(stats.cv)} sub="consensus target is 36% or less" />
      </div>

      {/* -------------------------------- bands -------------------------------- */}
      <Card className="mt-6">
        <h2>Where your readings landed</h2>
        <p className="muted mt-1 text-sm">
          Each of your {stats.n} readings counted once, by the band it fell in.
        </p>
        <div className="mt-4">
          <TirBar pct={stats.pct} />
        </div>
        <TirLegend pctByBand={stats.pct} counts={stats.counts} low={low} high={high} units={u} />
        <GoalComparison pctByBand={stats.pct} n={stats.n} units={u} />
      </Card>

      {/* ------------------------------ the chart ------------------------------ */}
      <Card className="mt-6">
        <h2>Glucose over time</h2>
        <p className="muted mt-1 text-sm">
          Every reading in the window, in the order it happened. The green band is your target range;
          the dashed lines sit at {formatGlucose(70, u)}, {formatGlucose(180, u)} and{" "}
          {formatGlucose(250, u)} {unitLabel(u)}.
        </p>
        <GlucoseChart
          readings={readings}
          from={from}
          to={to}
          days={days}
          low={low}
          high={high}
          units={u}
          n={stats.n}
          mean={stats.mean}
          tir={stats.timeInRange}
        />
        <p className="hint mt-2">
          Lowest reading {glucose(stats.min, u)}, highest {glucose(stats.max, u)} {unitLabel(u)}.
          {stats.n < 10 ? " With fewer than 10 readings this is a sketch, not a pattern." : ""}
        </p>
      </Card>

      {/* ----------------------------- time of day ----------------------------- */}
      <Card className="mt-6">
        <h2>Time of day</h2>
        <p className="muted mt-1 text-sm">
          Range problems usually sit in one part of the day, and one part of the day is a smaller thing
          to work on than all of it.
        </p>
        <div className="mt-4 grid gap-3">
          {DAY_BLOCKS.map((b) => {
            const s = blocks[b.key];
            const on = focusBlock === b.key;
            return (
              <div
                key={b.key}
                id={`block-${b.key}`}
                className="card-sunk p-3"
                style={on ? { outline: "2px solid var(--ink)", outlineOffset: "2px" } : undefined}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base">{b.label}</h3>
                  <div className="text-sm num">
                    {s.n === 0 ? (
                      <span className="muted">no readings</span>
                    ) : (
                      <>
                        <span className="font-semibold">{pct(s.timeInRange)}</span>
                        <span className="muted"> in range</span>
                      </>
                    )}
                  </div>
                </div>
                {s.n > 0 ? (
                  <>
                    <div className="mt-2">
                      <TirBar pct={s.pct} />
                    </div>
                    <div className="hint mt-1.5">
                      {s.n} reading{s.n === 1 ? "" : "s"} · average {glucose(s.mean, u)} {unitLabel(u)}
                      {s.lowsCount > 0 ? ` · ${s.lowsCount} low` : ""}
                      {s.n < 10 ? " · too few to call this a pattern" : ""}
                    </div>
                  </>
                ) : (
                  <p className="hint mt-1.5">
                    Nothing logged in this block yet. One reading here would fill in a real gap.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 no-print">
          {DAY_BLOCKS.map((b) => (
            <Link
              key={b.key}
              href={`/trends?days=${days}&block=${b.key}#block-${b.key}`}
              className={`btn btn-sm ${focusBlock === b.key ? "" : "btn-secondary"}`}
            >
              {b.label.split(" (")[0]}
            </Link>
          ))}
        </div>
        {focusBlock ? <ScrollToBlock id={`block-${focusBlock}`} /> : null}
      </Card>

      {/* ------------------------------ day by day ----------------------------- */}
      <Card className="mt-6">
        <h2>Day by day</h2>
        <p className="muted mt-1 text-sm">Each day&rsquo;s average, with your target range behind it.</p>
        <DayColumns series={series} low={low} high={high} units={u} />
        {rankedDays.length >= 2 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="eyebrow">Steadiest days</div>
              <ul className="mt-2 grid gap-1.5 text-sm">
                {bestDays.map((d) => (
                  <li key={d.date} className="flex items-baseline justify-between gap-3">
                    <span>{dayLabel(d.date)}</span>
                    <span className="num muted">
                      {pct(d.tir)} in range · avg {glucose(d.mean, u)} · {d.n} reading{d.n === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="eyebrow">Hardest days</div>
              <ul className="mt-2 grid gap-1.5 text-sm">
                {worstDays.map((d) => (
                  <li key={d.date} className="flex items-baseline justify-between gap-3">
                    <span>{dayLabel(d.date)}</span>
                    <span className="num muted">
                      {pct(d.tir)} in range · avg {glucose(d.mean, u)} · {d.n} reading{d.n === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="hint mt-3">
            Two days with readings would let this rank your days. Right now there {rankedDays.length === 1 ? "is one" : "are none"}.
          </p>
        )}
        {rankedDays.length >= 2 ? (
          <p className="hint mt-3">
            A day with two readings and a day with twelve are not really comparable, so the reading count
            is shown next to each one.
          </p>
        ) : null}
      </Card>

      {/* -------------------------------- lows --------------------------------- */}
      <Card className="mt-6">
        <h2>Lows</h2>
        {lows.length === 0 ? (
          <p className="mt-2 text-sm">
            No readings under {formatGlucose(low, u)} {unitLabel(u)} in the last {days} days. That is a
            good thing to see, and worth mentioning at your next appointment.
          </p>
        ) : (
          <>
            <p className="muted mt-1 text-sm">
              {lows.length} low episode{lows.length === 1 ? "" : "s"} in the last {days} days. Readings less
              than an hour apart are counted as one episode. {pct(lowPct, 1)} of all your readings were
              under {formatGlucose(low, u)} {unitLabel(u)}.
            </p>
            <ul className="mt-3 grid gap-2">
              {lows.map((e) => {
                const b = bandOf(e.nadir, low, high);
                return (
                  <li key={e.start.toISOString()} className="card-sunk p-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm">
                      {fmtDay(e.start)} at {fmtTime(e.start)}
                    </span>
                    <span className="text-sm num">
                      <span className={`font-semibold band-${b}`}>
                        {BAND_LABEL[b]} {formatGlucose(e.nadir, u)} {unitLabel(u)}
                      </span>
                      <span className="muted"> at its lowest · {e.n} reading{e.n === 1 ? "" : "s"} in the episode</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {stats.counts.very_low > 0 ? (
              <div className="card-quiet sev-attention p-3 mt-3 text-sm">
                {stats.counts.very_low} reading{stats.counts.very_low === 1 ? "" : "s"} under{" "}
                {formatGlucose(VERY_LOW_MGDL, u)} {unitLabel(u)}. Readings this low are the ones a care team
                most wants to hear about.
              </div>
            ) : null}
          </>
        )}
      </Card>

      <p className="hint mt-6 prose-measure">
        Steady counts what you logged. A window with few readings will look different from the same window
        with many, and that is a fact about the log rather than about you.
      </p>
    </div>
  );
  });
}
