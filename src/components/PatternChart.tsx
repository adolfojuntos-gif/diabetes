/**
 * Drawing a pattern's own evidence.
 *
 * Server-rendered SVG, no charting library and no client JavaScript, which is the same choice the
 * trends screen already made. It matters more than bundle size here: these cards appear on the first
 * screen somebody opens in the morning, and a chart that arrives after a spinner is a chart they
 * scroll past.
 *
 * THIS FILE INVENTS NO NUMBERS. Every figure comes from the `PatternChart` spec the engine built
 * from the same values as the evidence sentence. What happens here is geometry: a value becomes a
 * bar length, and a unit becomes a label. There is no rounding that changes a reading, no averaging,
 * and no inference. A chart is read faster and trusted harder than a sentence, so one that disagreed
 * with the words beneath it would be worse than no chart at all.
 *
 * Glucose arrives in mg/dL, always, and is converted for display only, like everywhere else.
 */
import type { PatternChart, ChartUnit, Severity } from "@/lib/engines/patterns";
import type { Units } from "@/lib/db/schema";
import { formatGlucose, unitLabel } from "@/lib/units";

/** The tone a severity paints in. Kept here so a chart matches the card it sits in. */
function toneFor(severity: Severity): string {
  if (severity === "win") return "var(--juniper)";
  if (severity === "attention") return "var(--coral)";
  if (severity === "watch") return "var(--amber)";
  return "var(--slate)";
}

/** A value with its unit, ready to read. Glucose goes through the unit conversion. */
function label(value: number, unit: ChartUnit, units: Units): string {
  if (unit === "mgdl") return `${formatGlucose(value, units)} ${unitLabel(units)}`;
  if (unit === "percent") return `${Math.round(value)}%`;
  if (unit === "minutes") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
  if (unit === "ml") return value >= 1000 ? `${(value / 1000).toFixed(1)} L` : `${Math.round(value)} ml`;
  return String(Math.round(value));
}

/* ------------------------------- two or three bars ------------------------------- */

function Compare({
  bars,
  unit,
  better,
  units,
  severity,
}: {
  bars: { label: string; value: number }[];
  unit: ChartUnit;
  better: "lower" | "higher";
  units: Units;
  severity: Severity;
}) {
  const values = bars.map((b) => b.value);
  const span = Math.max(...values);
  /**
   * Bars are drawn from zero, not from the smallest value.
   *
   * Starting the axis at the minimum is the standard way to make a small difference look enormous,
   * and on a glucose comparison that is not a presentation choice, it is a misleading medical
   * picture. A rise from 112 to 144 is real and worth seeing; drawn from a floor of 110 it would
   * look like a tenfold jump.
   */
  const safeSpan = span > 0 ? span : 1;
  const best = better === "lower" ? Math.min(...values) : Math.max(...values);

  return (
    <div className="grid gap-2">
      {bars.map((b) => {
        const width = Math.max(2, (b.value / safeSpan) * 100);
        const isBest = b.value === best;
        return (
          <div key={b.label}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="muted">{b.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: isBest ? 600 : 400 }}>
                {label(b.value, unit, units)}
              </span>
            </div>
            <div
              aria-hidden
              style={{
                height: 8,
                borderRadius: 999,
                background: "var(--paper-sunk)",
                overflow: "hidden",
                marginTop: 3,
              }}
            >
              <div
                style={{
                  width: `${width}%`,
                  height: "100%",
                  borderRadius: 999,
                  // The better of the two is always the calm colour, whichever direction better means.
                  background: isBest ? "var(--juniper)" : toneFor(severity),
                  opacity: isBest ? 0.85 : 1,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------- one gauge ---------------------------------- */

/**
 * How the good zone reads in words.
 *
 * A zone is described by its one meaningful edge wherever it has one, because naming both is
 * clumsy when one of them is the end of the scale. "Outside 0 mg/dL to 50 mg/dL" was on screen for
 * a meal rise: the zero carries no information, a rise cannot be below it, and the sentence made
 * the reader work out which half of it mattered. "Over 50 mg/dL" says the same thing.
 */
function zoneText(
  value: number,
  max: number,
  good: { from: number; to: number },
  unit: ChartUnit,
  units: Units,
): string {
  const inGood = value >= good.from && value <= good.to;
  // A zone starting at zero is a ceiling: the only number that matters is the top of it.
  if (good.from <= 0) return `${inGood ? "under" : "over"} ${label(good.to, unit, units)}`;
  // A zone running to the end of the scale is a floor.
  if (good.to >= max) return `${inGood ? "at or above" : "below"} ${label(good.from, unit, units)}`;
  return `${inGood ? "inside" : "outside"} ${label(good.from, unit, units)} to ${label(good.to, unit, units)}`;
}

/**
 * The edge of the good zone. A dashed hairline rather than a solid rule, so it reads as a threshold
 * somebody is measured against and not as a second value.
 */
function GoalEdge({ x, y, h }: { x: number; y: number; h: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={y - 2}
      y2={y + h + 2}
      stroke="var(--juniper)"
      strokeWidth={1.5}
      strokeDasharray="2 2"
      opacity={0.85}
    />
  );
}

function Gauge({
  value,
  max,
  good,
  unit,
  units,
  severity,
}: {
  value: number;
  max: number;
  good: { from: number; to: number };
  unit: ChartUnit;
  units: Units;
  severity: Severity;
}) {
  const W = 300;
  const H = 40;
  const trackY = 14;
  const trackH = 9;
  const safeMax = max > 0 ? max : 1;
  const x = (v: number) => Math.min(W, Math.max(0, (v / safeMax) * W));

  const clamped = Math.min(Math.max(value, 0), safeMax);
  const inGood = value >= good.from && value <= good.to;
  const markerX = x(clamped);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label(value, unit, units)} of a possible ${label(max, unit, units)}. The good range is ${label(good.from, unit, units)} to ${label(good.to, unit, units)}.`}
        style={{ display: "block", width: "100%", height: "auto" }}
      >
        <rect x={0} y={trackY} width={W} height={trackH} rx={trackH / 2} fill="var(--paper-sunk)" />
        {/* The stretch that counts as good, so the number is read against something. */}
        <rect
          x={x(good.from)}
          y={trackY}
          width={Math.max(1, x(good.to) - x(good.from))}
          height={trackH}
          rx={trackH / 2}
          fill="var(--juniper-soft)"
        />
        <rect
          x={0}
          y={trackY}
          width={Math.max(2, markerX)}
          height={trackH}
          rx={trackH / 2}
          fill={inGood ? "var(--juniper)" : toneFor(severity)}
        />
        {/**
         * Where the good zone begins and ends, drawn ON TOP of the fill.
         *
         * The soft band alone was not enough: it sits under the filled bar, so somebody inside the
         * zone could not see where the zone started, which is the one number they are being measured
         * against. For time in range that boundary is the consensus 70%, and for variability it is
         * 36%. Those are the figures worth being able to find on the track.
         *
         * Only drawn where the boundary is not the end of the track, since a line at zero or at the
         * far edge marks nothing.
         */}
        {good.from > 0 ? <GoalEdge x={x(good.from)} y={trackY} h={trackH} /> : null}
        {good.to < safeMax ? <GoalEdge x={x(good.to)} y={trackY} h={trackH} /> : null}
        {/* A tick at the value itself, because a filled bar's end is hard to read precisely. */}
        <line
          x1={markerX}
          x2={markerX}
          y1={trackY - 5}
          y2={trackY + trackH + 5}
          stroke="var(--ink)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </svg>
      <div className="flex items-baseline justify-between gap-3 text-xs mt-1">
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{label(value, unit, units)}</span>
        <span className="muted">{zoneText(value, max, good, unit, units)}</span>
      </div>
    </div>
  );
}

/* ---------------------------------- a tally ---------------------------------- */

function Tally({
  count,
  of,
  noun,
  tone,
}: {
  count: number;
  of: number | null;
  noun: string;
  tone: "good" | "watch" | "bad";
}) {
  /**
   * Dots, up to a point. Past about twenty the eye stops counting and a number reads better, and
   * drawing four hundred dots for a logging streak would be slower and say less.
   */
  const MAX_DOTS = 20;
  const total = of ?? count;
  const drawDots = total > 0 && total <= MAX_DOTS;
  const fill = tone === "good" ? "var(--juniper)" : tone === "bad" ? "var(--coral)" : "var(--amber)";

  if (!drawDots) {
    return (
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: 28, lineHeight: 1, fontWeight: 600, color: fill, fontVariantNumeric: "tabular-nums" }}>
          {count}
        </span>
        <span className="muted text-xs">
          {of === null ? noun : `of ${of} ${noun}`}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              width: 11,
              height: 11,
              borderRadius: 999,
              // A hollow dot is one that did not happen, which is the point when there is a total.
              background: i < count ? fill : "transparent",
              border: i < count ? "none" : "1.5px solid var(--line-strong)",
              display: "inline-block",
            }}
          />
        ))}
      </div>
      <div className="text-xs mt-2">
        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{count}</span>{" "}
        <span className="muted">{of === null ? noun : `of ${of} ${noun}`}</span>
      </div>
    </div>
  );
}

/* ---------------------------------- the switch ---------------------------------- */

export function PatternEvidenceChart({
  chart,
  severity,
  units,
}: {
  chart: PatternChart;
  severity: Severity;
  units: Units;
}) {
  if (chart.kind === "compare") {
    // A comparison of one thing is not a comparison. Guarded rather than drawn badly.
    if (chart.bars.length < 2) return null;
    return <Compare bars={chart.bars} unit={chart.unit} better={chart.better} units={units} severity={severity} />;
  }
  if (chart.kind === "gauge") {
    return (
      <Gauge
        value={chart.value}
        max={chart.max}
        good={chart.good}
        unit={chart.unit}
        units={units}
        severity={severity}
      />
    );
  }
  return <Tally count={chart.count} of={chart.of} noun={chart.noun} tone={chart.tone} />;
}
