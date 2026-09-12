/**
 * One day's glucose, with everything that was logged on it marked in place.
 *
 * Server-rendered inline SVG, no charting library and no client JavaScript, the same choice
 * `GlucoseChart` in ../parts.tsx made and for the same reason: this is the centrepiece of the
 * screen, and a chart that arrives after a spinner is a chart somebody has already scrolled past.
 *
 * THIS FILE INVENTS NO NUMBERS. Every value comes from the readings and the `ReplayEvent` list the
 * replay engine built. What happens here is geometry: a reading becomes a point, a time becomes an
 * x position, a kind becomes a shape.
 *
 * The x axis is always the whole day, 00:00 to 24:00, and never only the hours that happen to have
 * readings. A morning of dense logging stretched across the full width would read as a whole day,
 * which is the one thing a day's shape must not lie about.
 *
 * Glucose arrives in mg/dL and is converted for display only, like everywhere else in the app.
 */
import type { ReplayEvent, ReplayEventKind } from "@/lib/engines/replay";
import type { ReadingLike } from "@/lib/engines/stats";
import { bandWithTargets } from "@/lib/engines/stats";
import type { Units } from "@/lib/db/schema";
import { formatGlucose, unitLabel, BAND_LABEL } from "@/lib/units";
import { parseDateKey, endOfDay, fmtTime, fmtDayLong } from "@/lib/time";
import { decimate, BAND_STROKE, type Pt } from "../parts";

/* --------------------------------- glyphs --------------------------------- */

/**
 * A shape per kind, not a colour per kind.
 *
 * Eight things happen on a day and only five colours in this app mean anything, four of which are
 * reserved for glucose bands. So the marks are told apart by outline: the accessibility rule that
 * colour is never the only signal happens to be the only workable design here as well.
 *
 * The three marks drawn from the curve itself are the exceptions and do carry glucose colour, since
 * a peak IS a reading and colouring it anything else would be the odd choice.
 */
const GLYPH: Record<ReplayEventKind, { legend: string; colour: string }> = {
  wake: { legend: "Woke up", colour: "var(--ink-faint)" },
  meal: { legend: "A meal", colour: "var(--bloom)" },
  insulin: { legend: "Insulin recorded", colour: "var(--slate)" },
  exercise: { legend: "Movement", colour: "var(--ink-soft)" },
  rise: { legend: "The rise starts", colour: "var(--ink-soft)" },
  peak: { legend: "Highest reading", colour: "var(--ink)" },
  back_in_range: { legend: "Back in range", colour: "var(--juniper)" },
  bed: { legend: "Went to bed", colour: "var(--ink-faint)" },
};

function Glyph({ kind, cx, cy, colour, r = 4.5 }: { kind: ReplayEventKind; cx: number; cy: number; colour: string; r?: number }) {
  switch (kind) {
    case "wake":
      return <path d={`M${cx} ${cy - r} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z`} fill={colour} />;
    case "bed":
      return <path d={`M${cx} ${cy + r} L${cx + r} ${cy - r} L${cx - r} ${cy - r} Z`} fill={colour} />;
    case "meal":
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1} fill={colour} />;
    case "insulin":
      return (
        <g stroke={colour} strokeWidth={2} strokeLinecap="round">
          <line x1={cx - r} x2={cx + r} y1={cy} y2={cy} />
          <line x1={cx} x2={cx} y1={cy - r} y2={cy + r} />
        </g>
      );
    case "exercise":
      return <path d={`M${cx} ${cy - r - 0.8} L${cx + r + 0.8} ${cy} L${cx} ${cy + r + 0.8} L${cx - r - 0.8} ${cy} Z`} fill={colour} />;
    case "rise":
      return <circle cx={cx} cy={cy} r={r} fill="var(--paper-raised)" stroke={colour} strokeWidth={2} />;
    case "back_in_range":
      return <rect x={cx - r - 1.5} y={cy - 1.8} width={(r + 1.5) * 2} height={3.6} rx={1.8} fill={colour} />;
    case "peak":
      return (
        <g>
          <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={colour} strokeWidth={1.5} opacity={0.55} />
          <circle cx={cx} cy={cy} r={r} fill={colour} />
        </g>
      );
  }
}

/** The legend, so a shape on the chart can be looked up. Order follows a day. */
const LEGEND_ORDER: ReplayEventKind[] = ["wake", "meal", "insulin", "exercise", "rise", "peak", "back_in_range", "bed"];

/* -------------------------------- the chart -------------------------------- */

/** At most this many labels on the chart itself. The rest are in the ordered list beneath it. */
const MAX_INLINE_LABELS = 3;
/** Horizontal room a label needs to itself, in chart units. Below this two labels overlap. */
const LABEL_GAP = 130;

/**
 * Which events get their name printed on the chart.
 *
 * The shape of the day is the point, so the marks that describe the shape go first, and a meal is
 * next because it is the one thing a person looks for. Anything that would land on top of an
 * already-placed label is left to the list below rather than drawn over.
 */
const LABEL_PRIORITY: ReplayEventKind[] = ["peak", "rise", "meal", "back_in_range", "exercise", "insulin", "wake", "bed"];

export function DayCurve({
  date,
  readings,
  events,
  targetLow,
  targetHigh,
  units,
  timeInRange,
  mean,
}: {
  date: string;
  readings: ReadingLike[];
  events: ReplayEvent[];
  targetLow: number;
  targetHigh: number;
  units: Units;
  timeInRange: number | null;
  mean: number | null;
}) {
  const padL = 54;
  const padR = 18;
  const padT = 18;
  /** Room under the axis for the float lane and then the hour labels. */
  const padB = 48;
  const plotW = 760;
  const plotH = 220;
  const W = padL + plotW + padR;
  const H = padT + plotH + padB;

  const dayStart = parseDateKey(date);
  const t0 = dayStart.getTime();
  const t1 = endOfDay(dayStart).getTime();
  const span = t1 - t0 || 1;

  /**
   * The y axis is scaled to this day, and always contains the whole target band.
   *
   * Auto-scaling alone would crop the band on a day that never came near it, and the band is what
   * the curve is being read against. Padded out to a round ten either side so the top and bottom
   * labels are numbers somebody can hold.
   */
  const values = readings.map((r) => r.valueMgdl);
  const lowest = Math.min(targetLow, ...(values.length ? values : [targetLow]));
  const highest = Math.max(targetHigh, ...(values.length ? values : [targetHigh]));
  const pad = Math.max(12, (highest - lowest) * 0.12);
  const yMin = Math.max(0, Math.floor((lowest - pad) / 10) * 10);
  const yMax = Math.ceil((highest + pad) / 10) * 10;
  const ySpan = yMax - yMin || 1;

  const x = (t: number) => padL + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * plotW;
  const y = (v: number) => padT + (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / ySpan) * plotH;

  const axisY = padT + plotH;
  /** Where events with no reading near them sit: under the axis, so they never imply a value. */
  const floatY = axisY + 13;

  /* ------------------------------- the line ------------------------------- */

  const pts: Pt[] = readings
    .map((r) => ({ t: r.at.getTime(), v: r.valueMgdl, band: bandWithTargets(r.valueMgdl, targetLow, targetHigh) }))
    .sort((a, b) => a.t - b.t);

  // A CGM day is around 288 readings. Same helper as the trends chart, so peaks still survive.
  const dense = pts.length > 200;
  const shown = dense ? decimate(pts, t0, t1, Math.max(1, Math.floor(plotW / 3))) : pts;
  const linePath = shown.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");

  /* ------------------------------- the ticks ------------------------------- */

  const hourTicks: { t: number; label: string }[] = [];
  for (let h = 0; h < 24; h += 3) {
    const d = new Date(dayStart);
    d.setHours(h, 0, 0, 0);
    hourTicks.push({ t: d.getTime(), label: d.toLocaleTimeString([], { hour: "numeric" }) });
  }

  // Only the numbers worth reading: the two edges and the two edges of the target band.
  const yTicks = [yMin, targetLow, targetHigh, yMax]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .filter((v, i, arr) => i === 0 || Math.abs(y(v) - y(arr[i - 1])) >= 14);

  /* ---------------------------- which labels fit ---------------------------- */

  const inline: ReplayEvent[] = [];
  for (const kind of LABEL_PRIORITY) {
    for (const e of events) {
      if (e.kind !== kind) continue;
      if (inline.length >= MAX_INLINE_LABELS) break;
      const ex = x(e.at.getTime());
      if (inline.every((p) => Math.abs(x(p.at.getTime()) - ex) >= LABEL_GAP)) inline.push(e);
    }
  }
  const labelled = new Set(inline);

  /* ------------------------------ the summary ------------------------------ */

  const peak = pts.length ? pts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const u = unitLabel(units);
  const ariaLabel =
    `Your glucose through ${fmtDayLong(dayStart)}, midnight to midnight. ` +
    (pts.length
      ? `${pts.length} reading${pts.length === 1 ? "" : "s"}` +
        (mean !== null ? `, average ${formatGlucose(mean, units)} ${u}` : "") +
        (timeInRange !== null ? `, ${timeInRange.toFixed(0)}% in your target range of ${formatGlucose(targetLow, units)} to ${formatGlucose(targetHigh, units)} ${u}` : "") +
        ". "
      : "No readings on this day. ") +
    (peak ? `The highest was ${formatGlucose(peak.v, units)} ${u} at ${fmtTime(new Date(peak.t))}. ` : "") +
    `The shaded band is your target range. ` +
    `${events.length} logged moment${events.length === 1 ? "" : "s"} ${events.length === 1 ? "is" : "are"} marked, and each one is named in the list below the chart.`;

  return (
    <div className="mt-3 -mx-1 px-1" style={{ overflowX: "auto", maxWidth: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        /**
         * Scales to the card rather than forcing a scroll.
         *
         * A fixed pixel width put the second half of the day past the right edge, so the 4pm peak,
         * which is the whole reason somebody opened this screen, was hidden until they scrolled. A
         * day has a fixed span, so the natural thing is to fit it: the viewBox keeps the geometry
         * and the width follows the container. The scroll container below stays as the fallback for
         * a very narrow phone.
         */
        width="100%"
        height={H}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block", maxWidth: "100%", minWidth: 420, height: "auto" }}
      >
        {/* the target band, behind everything */}
        <rect
          x={padL}
          y={y(targetHigh)}
          width={plotW}
          height={Math.max(1, y(targetLow) - y(targetHigh))}
          fill="var(--juniper)"
          opacity="0.12"
        />
        {[targetLow, targetHigh].map((v) => (
          <line key={v} x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} stroke="var(--juniper)" strokeWidth="1" strokeDasharray="3 4" opacity="0.55" />
        ))}

        {/* axes */}
        <line x1={padL} x2={padL + plotW} y1={axisY} y2={axisY} stroke="var(--line-strong)" strokeWidth="1" />
        {yTicks.map((v) => (
          <text key={v} x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-faint)">
            {formatGlucose(v, units)}
          </text>
        ))}
        <text x={padL - 8} y={padT - 4} textAnchor="end" fontSize="10" fill="var(--ink-faint)">
          {u}
        </text>
        {hourTicks.map((tk) => (
          <g key={tk.t}>
            <line x1={x(tk.t)} x2={x(tk.t)} y1={padT} y2={axisY} stroke="var(--line)" strokeWidth="1" />
            <text x={x(tk.t)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-faint)">
              {tk.label}
            </text>
          </g>
        ))}

        {/* the day's own line, then the readings on top of it */}
        {shown.length > 1 ? (
          <path d={linePath} fill="none" stroke="var(--ink-soft)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        ) : null}
        {(dense ? shown.filter((p) => p.band !== "in_range") : shown).map((p, i) => (
          <circle key={`r${i}`} cx={x(p.t)} cy={y(p.v)} r={dense ? 2.2 : 3} fill={BAND_STROKE[p.band]} fillOpacity="0.9" />
        ))}

        {/* the events */}
        {events.map((e, i) => {
          const ex = x(e.at.getTime());
          const onCurve = e.valueMgdl !== null;
          const ey = onCurve ? y(e.valueMgdl as number) : floatY;
          const colour =
            e.kind === "peak" && e.valueMgdl !== null
              ? BAND_STROKE[bandWithTargets(e.valueMgdl, targetLow, targetHigh)]
              : GLYPH[e.kind].colour;
          return (
            <g key={`e${i}`}>
              {onCurve ? null : (
                // A floating event has no value, so it gets a hairline down to its own lane and no
                // further. Drawing it up to the curve would place it on a reading it does not have.
                <line x1={ex} x2={ex} y1={axisY} y2={floatY - 6} stroke="var(--line-strong)" strokeWidth="1" />
              )}
              <Glyph kind={e.kind} cx={ex} cy={ey} colour={colour} r={onCurve ? 4.5 : 3.6} />
            </g>
          );
        })}

        {/* the few labels that fit */}
        {inline.map((e, i) => {
          const ex = x(e.at.getTime());
          const onCurve = e.valueMgdl !== null;
          const ey = onCurve ? y(e.valueMgdl as number) : floatY;
          const above = ey - padT > 34;
          const anchor = ex < padL + 70 ? "start" : ex > padL + plotW - 70 ? "end" : "middle";
          const tx = anchor === "start" ? ex - 2 : anchor === "end" ? ex + 2 : ex;
          return (
            <g key={`l${i}`} aria-hidden>
              <text x={tx} y={above ? ey - 13 : ey + 22} textAnchor={anchor} fontSize="11" fontWeight={600} fill="var(--ink)">
                {e.label}
              </text>
              <text x={tx} y={above ? ey - 13 + 13 : ey + 22 + 13} textAnchor={anchor} fontSize="10.5" fill="var(--ink-faint)">
                {fmtTime(e.at)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* the key, because a shape is only useful if it can be looked up */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="What each mark on the chart means">
        {LEGEND_ORDER.filter((k) => events.some((e) => e.kind === k)).map((k) => (
          <li key={k} className="flex items-center gap-1.5 hint">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ display: "block", flexShrink: 0 }}>
              <Glyph kind={k} cx={7} cy={7} colour={GLYPH[k].colour} r={4} />
            </svg>
            {GLYPH[k].legend}
          </li>
        ))}
      </ul>

      <p className="hint mt-2">
        {dense
          ? `${pts.length} readings, drawn as a line. Each pixel keeps its highest and lowest reading, so the peak is not smoothed away. `
          : ""}
        Marks under the axis are moments with no reading within half an hour, so they are placed in time
        but not on the curve.
        {labelled.size < events.length
          ? ` ${labelled.size} of ${events.length} are named on the chart; all of them are in the list below.`
          : ""}
      </p>
      {peak ? (
        <p className="hint mt-1">
          Highest reading {formatGlucose(peak.v, units)} {u} at {fmtTime(new Date(peak.t))}, which was{" "}
          {BAND_LABEL[bandWithTargets(peak.v, targetLow, targetHigh)].toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}
