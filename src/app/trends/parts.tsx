/**
 * Pieces shared by /trends and /trends/meals. Server-safe: pure functions and plain JSX, no hooks.
 *
 * Every chart here is inline SVG on purpose (docs/CONVENTIONS.md § Charts). Glucose values always
 * pass through formatGlucose so a mmol/L profile never sees an mg/dL number, including axis labels.
 */
import Link from "next/link";
import {
  formatGlucose,
  unitLabel,
  BAND_LABEL,
  VERY_LOW_MGDL,
  VERY_HIGH_MGDL,
  type Band,
} from "@/lib/units";
import type { Units } from "@/lib/db/schema";
import { bandWithTargets, type DailyPoint, type ReadingLike } from "@/lib/engines/stats";
import { dateKey, fmtDay } from "@/lib/time";

/* ------------------------------- window ------------------------------- */

export const RANGE_DAYS = [7, 14, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];
export const DEFAULT_DAYS: RangeDays = 14;

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseDays(raw: string | string[] | undefined): RangeDays {
  const n = Number(firstParam(raw));
  return (RANGE_DAYS as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_DAYS;
}

export function RangeSwitcher({ days, base }: { days: RangeDays; base: string }) {
  return (
    <nav className="seg no-print" aria-label="How far back to look">
      {RANGE_DAYS.map((d) => (
        <Link key={d} href={`${base}?days=${d}`} aria-current={d === days ? "true" : undefined}>
          {d} days
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------ formatting ----------------------------- */

/** Round to whole percent, or a dash when there is nothing to round. Never returns NaN or "null". */
export function pct(x: number | null | undefined, dp = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "not yet";
  return `${x.toFixed(dp)}%`;
}

export function num(x: number | null | undefined, dp = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "not yet";
  return x.toFixed(dp);
}

export function glucose(x: number | null | undefined, units: Units): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "not yet";
  return formatGlucose(x, units);
}

/** Signed glucose difference in the person's own unit, e.g. "+42" or "-1.7". */
export function signedGlucose(x: number | null | undefined, units: Units): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "not yet";
  const body = formatGlucose(Math.abs(x), units);
  return `${x > 0 ? "+" : x < 0 ? "-" : ""}${body}`;
}

export function bandRangeText(b: Band, low: number, high: number, units: Units): string {
  const f = (v: number) => formatGlucose(v, units);
  switch (b) {
    case "very_low":
      return `under ${f(VERY_LOW_MGDL)}`;
    case "low":
      return low <= VERY_LOW_MGDL ? "does not apply with your target" : `${f(VERY_LOW_MGDL)} up to ${f(low)}`;
    case "in_range":
      return `${f(low)} to ${f(high)}`;
    case "high":
      return high >= VERY_HIGH_MGDL ? "does not apply with your target" : `above ${f(high)} up to ${f(VERY_HIGH_MGDL)}`;
    case "very_high":
      return `above ${f(VERY_HIGH_MGDL)}`;
  }
}

export const BAND_ORDER: Band[] = ["very_low", "low", "in_range", "high", "very_high"];

/** The five glucose colours, as CSS variables, so SVG uses the same ink as the rest of the app. */
export const BAND_STROKE: Record<Band, string> = {
  very_low: "var(--coral)",
  low: "var(--coral)",
  in_range: "var(--juniper)",
  high: "var(--amber)",
  very_high: "var(--ember)",
};

/* ------------------------------ TIR legend ----------------------------- */

export function TirLegend({
  pctByBand,
  counts,
  low,
  high,
  units,
}: {
  pctByBand: Record<Band, number>;
  counts: Record<Band, number>;
  low: number;
  high: number;
  units: Units;
}) {
  return (
    <ul className="mt-3 grid gap-1.5">
      {BAND_ORDER.map((b) => (
        <li key={b} className="flex items-baseline gap-2 text-sm">
          <span className={`inline-block w-3 h-3 rounded-sm shrink-0 bg-band-${b}`} aria-hidden="true" />
          <span className="w-20 shrink-0 font-semibold">{BAND_LABEL[b]}</span>
          <span className="num w-14 shrink-0">{pctByBand[b].toFixed(1)}%</span>
          <span className="muted">
            {bandRangeText(b, low, high, units)} {unitLabel(units)}
            <span className="faint"> · {counts[b]} reading{counts[b] === 1 ? "" : "s"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The consensus goals next to where this person actually sits. */
export function GoalComparison({
  pctByBand,
  n,
  units,
}: {
  pctByBand: Record<Band, number>;
  n: number;
  units: Units;
}) {
  const f = (v: number) => `${formatGlucose(v, units)} ${unitLabel(units)}`;
  const rows: { goal: string; yours: number; met: boolean }[] = [
    { goal: "Over 70% in range", yours: pctByBand.in_range, met: pctByBand.in_range > 70 },
    { goal: `Under 4% below ${f(70)}`, yours: pctByBand.very_low + pctByBand.low, met: pctByBand.very_low + pctByBand.low < 4 },
    { goal: `Under 1% below ${f(54)}`, yours: pctByBand.very_low, met: pctByBand.very_low < 1 },
  ];
  return (
    <div className="card-sunk p-3 mt-4">
      <div className="eyebrow">Consensus goals, and where you sit</div>
      {n < 10 ? (
        <p className="hint mt-2">
          {n} reading{n === 1 ? "" : "s"} in this window. That is not enough to compare against a goal yet.
        </p>
      ) : (
        <ul className="mt-2 grid gap-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.goal} className="flex items-baseline justify-between gap-3">
              <span className="muted">{r.goal}</span>
              <span className="num font-semibold">
                yours {r.yours.toFixed(1)}%
                <span className="muted font-normal"> ({r.met ? "at the goal" : "not there yet"})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint mt-2">
        Goals from the 2019 international consensus on time in range. They are population goals, not a
        target somebody set for you.
      </p>
    </div>
  );
}

/* --------------------------- glucose over time -------------------------- */

const Y_MIN = 40;
const Y_MAX = 400;
const Y_TICKS = [40, 70, 180, 250, 400];
const GRID = [70, 180, 250];

function clampY(v: number) {
  return Math.min(Y_MAX, Math.max(Y_MIN, v));
}

export type Pt = { t: number; v: number; band: Band };

/**
 * Keep the shape of a dense series without drawing 8000 dots: split the x axis into pixel-wide
 * buckets and keep the highest and the lowest reading in each, in time order. Spikes survive.
 *
 * Exported because the replay's day curve needs the same guarantee. A CGM day is 288 readings, and
 * a second copy of this would be a second place for the "peaks survive" property to quietly stop
 * being true.
 */
export function decimate(pts: Pt[], from: number, to: number, buckets: number): Pt[] {
  const span = to - from || 1;
  const keep = new Map<number, Pt[]>();
  for (const p of pts) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor(((p.t - from) / span) * buckets)));
    const arr = keep.get(b);
    if (arr) arr.push(p);
    else keep.set(b, [p]);
  }
  const out: Pt[] = [];
  for (const b of [...keep.keys()].sort((a, z) => a - z)) {
    const arr = keep.get(b)!;
    let lo = arr[0];
    let hi = arr[0];
    for (const p of arr) {
      if (p.v < lo.v) lo = p;
      if (p.v > hi.v) hi = p;
    }
    const pair = lo === hi ? [lo] : lo.t <= hi.t ? [lo, hi] : [hi, lo];
    for (const p of pair) out.push(p);
  }
  return out;
}

export function GlucoseChart({
  readings,
  from,
  to,
  days,
  low,
  high,
  units,
  n,
  mean,
  tir,
}: {
  readings: ReadingLike[];
  from: Date;
  to: Date;
  days: number;
  low: number;
  high: number;
  units: Units;
  n: number;
  mean: number | null;
  tir: number | null;
}) {
  const padL = 52;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const plotW = Math.max(560, Math.min(days * 48, 2400));
  const plotH = 240;
  const W = padL + plotW + padR;
  const H = padT + plotH + padB;

  const t0 = from.getTime();
  const t1 = to.getTime();
  const span = t1 - t0 || 1;
  const x = (t: number) => padL + ((t - t0) / span) * plotW;
  const y = (v: number) => padT + (1 - (clampY(v) - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

  const pts: Pt[] = readings
    .map((r) => ({ t: r.at.getTime(), v: r.valueMgdl, band: bandWithTargets(r.valueMgdl, low, high) }))
    .sort((a, b) => a.t - b.t);

  const asLine = pts.length > 200;
  const shown = asLine ? decimate(pts, t0, t1, Math.max(1, Math.floor(plotW / 3))) : pts;
  const linePath = asLine ? shown.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ") : "";

  // Day ticks, spaced so the labels do not collide.
  const tickEvery = Math.max(1, Math.ceil(days / Math.max(2, Math.floor(plotW / 84))));
  const ticks: { t: number; label: string }[] = [];
  for (let i = 0; i < days; i += tickEvery) {
    const d = new Date(t0 + i * 86_400_000);
    ticks.push({ t: d.getTime(), label: fmtDay(d) });
  }

  const label =
    `Glucose for each reading over the last ${days} days. ` +
    `${n} reading${n === 1 ? "" : "s"}, average ${glucose(mean, units)} ${unitLabel(units)}, ` +
    `${pct(tir)} in your target range of ${formatGlucose(low, units)} to ${formatGlucose(high, units)} ${unitLabel(units)}. ` +
    `The shaded band is that target range.`;

  return (
    <div className="mt-3 -mx-1 px-1" style={{ overflowX: "auto", maxWidth: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={label}
        style={{ display: "block", maxWidth: "none" }}
      >
        {/* target band */}
        <rect
          x={padL}
          y={y(high)}
          width={plotW}
          height={Math.max(1, y(low) - y(high))}
          fill="var(--juniper)"
          opacity="0.12"
        />
        {/* gridlines */}
        {GRID.map((g) => (
          <line key={g} x1={padL} x2={padL + plotW} y1={y(g)} y2={y(g)} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 4" />
        ))}
        {/* axes */}
        <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke="var(--line-strong)" strokeWidth="1" />
        {Y_TICKS.map((v) => (
          <text key={v} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-faint)">
            {formatGlucose(v, units)}
          </text>
        ))}
        <text x={padL - 8} y={padT - 2} textAnchor="end" fontSize="10" fill="var(--ink-faint)">
          {unitLabel(units)}
        </text>
        {ticks.map((tk) => (
          <g key={tk.t}>
            <line x1={x(tk.t)} x2={x(tk.t)} y1={padT + plotH} y2={padT + plotH + 4} stroke="var(--line-strong)" strokeWidth="1" />
            <text x={x(tk.t)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-faint)">
              {tk.label}
            </text>
          </g>
        ))}
        {/* the readings */}
        {asLine ? (
          <>
            <path d={linePath} fill="none" stroke="var(--ink-soft)" strokeWidth="1.2" strokeLinejoin="round" opacity="0.85" />
            {shown
              .filter((p) => p.band !== "in_range")
              .map((p, i) => (
                <circle key={`o${i}`} cx={x(p.t)} cy={y(p.v)} r="2" fill={BAND_STROKE[p.band]} />
              ))}
          </>
        ) : (
          shown.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.v)} r="3.2" fill={BAND_STROKE[p.band]} fillOpacity="0.9" />)
        )}
      </svg>
      {asLine ? (
        <p className="hint mt-1">
          {pts.length} readings, drawn as a line. Each pixel keeps its highest and lowest reading, so peaks
          and lows are not smoothed away. Readings outside your range are marked.
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------- day by day columns -------------------------- */

export function DayColumns({
  series,
  low,
  high,
  units,
}: {
  series: DailyPoint[];
  low: number;
  high: number;
  units: Units;
}) {
  const padL = 52;
  const padR = 14;
  const padT = 10;
  const padB = 26;
  const colW = 26;
  const plotW = Math.max(520, series.length * colW);
  const plotH = 150;
  const W = padL + plotW + padR;
  const H = padT + plotH + padB;
  const step = plotW / Math.max(1, series.length);
  const barW = Math.min(18, step * 0.7);
  const y = (v: number) => padT + (1 - (clampY(v) - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

  const withData = series.filter((d) => d.mean !== null);
  const tickEvery = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(plotW / 84))));

  const label =
    `Average glucose for each of the last ${series.length} days, in ${unitLabel(units)}. ` +
    `${withData.length} day${withData.length === 1 ? "" : "s"} have at least one reading. ` +
    `The shaded band is your target range, ${formatGlucose(low, units)} to ${formatGlucose(high, units)}.`;

  return (
    <div className="mt-3 -mx-1 px-1" style={{ overflowX: "auto", maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: "block", maxWidth: "none" }}>
        <rect x={padL} y={y(high)} width={plotW} height={Math.max(1, y(low) - y(high))} fill="var(--juniper)" opacity="0.12" />
        {GRID.map((g) => (
          <line key={g} x1={padL} x2={padL + plotW} y1={y(g)} y2={y(g)} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 4" />
        ))}
        <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke="var(--line-strong)" strokeWidth="1" />
        {[70, 180, 250].map((v) => (
          <text key={v} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-faint)">
            {formatGlucose(v, units)}
          </text>
        ))}
        {series.map((d, i) => {
          const cx = padL + step * (i + 0.5);
          if (d.mean === null) {
            return <circle key={d.date} cx={cx} cy={padT + plotH - 3} r="1.5" fill="var(--line-strong)" />;
          }
          const top = y(d.mean);
          const band = bandWithTargets(d.mean, low, high);
          return (
            <rect
              key={d.date}
              x={cx - barW / 2}
              y={top}
              width={barW}
              height={Math.max(2, padT + plotH - top)}
              rx="3"
              fill={BAND_STROKE[band]}
              fillOpacity="0.85"
            />
          );
        })}
        {series.map((d, i) =>
          i % tickEvery === 0 ? (
            <text key={`l${d.date}`} x={padL + step * (i + 0.5)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-faint)">
              {dayLabel(d.date)}
            </text>
          ) : null,
        )}
      </svg>
      <p className="hint mt-1">One column per day, the day&rsquo;s average. A dot means no reading that day.</p>
    </div>
  );
}

/** A day-order label for a DailyPoint, for lists. */
export function dayLabel(key: string): string {
  const [yy, mm, dd] = key.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  return dateKey(d) === key ? fmtDay(d) : key;
}

/* ------------------------------ rise bands ------------------------------ */

export type RiseBand = "gentle" | "moderate" | "spike";

export const RISE_LABEL: Record<RiseBand, string> = {
  gentle: "Gentle",
  moderate: "Moderate",
  spike: "Spike",
};

/**
 * Rise bands borrow the glucose band colours, because a rise is a glucose quantity: gentle reads as
 * in range, moderate as high, spike as very high. The label is always shown next to the colour.
 */
export const RISE_BAND_CLASS: Record<RiseBand, Band> = {
  gentle: "in_range",
  moderate: "high",
  spike: "very_high",
};
