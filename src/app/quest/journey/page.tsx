import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { loadJourneyInput, journeyState, milestones, xpByMonth } from "@/lib/data/journey";
import { buildJourney } from "@/lib/engines/journey";
import { dailySeries } from "@/lib/engines/stats";
import { formatGlucose, unitLabel } from "@/lib/units";
import { addDays, startOfDay, endOfDay, fmtDay } from "@/lib/time";
import { QUALITY_PHRASE, TREND_REVIEW_NOTE } from "@/lib/engines/rules";

export const dynamic = "force-dynamic";

/**
 * YOUR JOURNEY — the long view.
 *
 * The one thing this page must never do is grade a chapter. A month with four logged days is
 * called "a quiet month" and drawn the same size as any other, because the months people log least
 * are usually the months they were having the worst time, and a timeline that shrinks those is a
 * timeline that punishes illness.
 *
 * Every figure on the page comes from the engines. The narrative sentences are assembled from those
 * same figures in `story()`, so there is no path by which prose and chart can disagree.
 */
export default async function JourneyPage() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const now = new Date();
    const input = await loadJourneyInput(now, profile);
    const report = buildJourney(input);
    const [state, milestoneRows, xpMonths] = await Promise.all([journeyState(), milestones(40), xpByMonth()]);
    const u = profile.units;

    const from = addDays(startOfDay(now), -29);
    const series = dailySeries(input.readings, from, endOfDay(now), profile.targetLowMgdl, profile.targetHighMgdl);
    const points = series.filter((p) => p.mean !== null);

    /* The 30-day line. Drawn only when there is enough of it to be a line rather than a dot. */
    const lo = Math.min(profile.targetLowMgdl - 20, ...points.map((p) => p.mean!));
    const hi = Math.max(profile.targetHighMgdl + 20, ...points.map((p) => p.mean!));
    const span = Math.max(1, hi - lo);
    const x = (i: number) => (i / Math.max(1, series.length - 1)) * 600;
    const y = (v: number) => 150 - ((v - lo) / span) * 140;
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(series.indexOf(p))} ${y(p.mean!)}`).join(" ");

    const trend = report.trend;
    const moved = trend.comparable ? (trend.recent.timeInRange ?? 0) - (trend.prior.timeInRange ?? 0) : 0;

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="Your journey"
          lede="Everything you have built, in order. Nothing on this page can be lost, and no month here is graded."
          action={
            <Link href="/" className="btn btn-secondary btn-sm">
              Back to your world
            </Link>
          }
        />

        {/* ------------------------------ your story ----------------------------- */}
        <Card className="rise rise-1">
          <div className="eyebrow">Your story</div>
          <div className="mt-2 grid gap-2">
            {report.story.lines.map((l, i) => (
              <p key={i} className="prose-measure">
                {l}
              </p>
            ))}
          </div>
          <div className="divider my-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="num text-2xl font-display">{state.level.level}</div>
              <div className="hint">level</div>
            </div>
            <div>
              <div className="num text-2xl font-display">{state.xp.toLocaleString()}</div>
              <div className="hint">XP earned</div>
            </div>
            <div>
              <div className="num text-2xl font-display">{state.gems}</div>
              <div className="hint">progress gems</div>
            </div>
            <div>
              <div className="num text-2xl font-display">{report.best}</div>
              <div className="hint">longest run of days</div>
            </div>
          </div>
        </Card>

        {/* ---------------------------- the comparison --------------------------- */}
        <section className="mt-6 grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <Card>
            <div className="eyebrow">Your last 30 days</div>
            {points.length >= 4 ? (
              <>
                <svg viewBox="0 0 600 160" className="w-full h-auto mt-3" role="img" aria-label="Daily average glucose over the last 30 days">
                  {/* The target band, so the line is read against the person's own range and not zero. */}
                  <rect
                    x="0"
                    y={y(profile.targetHighMgdl)}
                    width="600"
                    height={Math.max(2, y(profile.targetLowMgdl) - y(profile.targetHighMgdl))}
                    fill="var(--juniper-soft)"
                  />
                  <path d={path} fill="none" stroke="var(--bloom)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  {points.map((p) => (
                    <circle key={p.date} cx={x(series.indexOf(p))} cy={y(p.mean!)} r="2.5" fill="var(--bloom)" />
                  ))}
                </svg>
                <div className="hint mt-1">
                  Daily average, {fmtDay(from)} to {fmtDay(now)}. The green band is your range,{" "}
                  {formatGlucose(profile.targetLowMgdl, u)} to {formatGlucose(profile.targetHighMgdl, u)} {unitLabel(u)}.
                </div>
              </>
            ) : (
              <p className="muted text-sm mt-2">
                Not enough readings in the last 30 days to draw a line yet. It appears once there are readings on a few
                more days.
              </p>
            )}
          </Card>

          <Card>
            <div className="eyebrow">Two weeks against the two before</div>
            {trend.comparable ? (
              <>
                <div className="grid gap-3 mt-3">
                  {[
                    { label: "The fortnight before", v: trend.prior.timeInRange ?? 0 },
                    { label: "The last 14 days", v: trend.recent.timeInRange ?? 0 },
                  ].map((r) => (
                    <div key={r.label}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm">{r.label}</span>
                        <span className="num font-display">{r.v.toFixed(0)}%</span>
                      </div>
                      <div className="xp-bar mt-1">
                        <span style={{ width: `${Math.min(100, r.v)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="hint mt-3">
                  {trend.recentN} readings across {trend.recent.days} days, against {trend.priorN} across{" "}
                  {trend.prior.days} days. Data quality: {trend.dataQuality}.
                </p>
                <p className="text-sm mt-2 prose-measure">
                  {QUALITY_PHRASE[trend.dataQuality]}, {moved >= 5
                    ? "you moved forward: your recent trend has improved compared with your previous period."
                    : moved <= -5
                      ? "your recent trend sits below the fortnight before. Nothing has been taken away for that, and nothing here counts against you: glucose moves for reasons that are not choices."
                      : "your recent trend is holding close to the fortnight before."}
                </p>
              </>
            ) : (
              <p className="muted text-sm mt-2">{trend.reason}</p>
            )}
          </Card>
        </section>

        {/* ------------------------------- chapters ------------------------------ */}
        <h2 className="mt-8 mb-3">Your chapters</h2>
        {report.chapters.length === 0 ? (
          <Card>
            <p className="muted">Your first chapter opens the day you log something. There is nothing to catch up on.</p>
          </Card>
        ) : (
          <div className="chapter-rail grid gap-4">
            {report.chapters.map((c) => (
              <div key={c.month} className="relative">
                <span className="chapter-dot" aria-hidden>
                  {c.glyph}
                </span>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="eyebrow">{c.label}</div>
                      <h3 className="mt-0.5">{c.stage}</h3>
                    </div>
                    <span className="hint num">{(xpMonths.get(c.month) ?? 0).toLocaleString()} XP</span>
                  </div>
                  <p className="text-sm mt-2">
                    Logged on {c.daysActive} of {c.daysInMonth} days, {c.readings} reading{c.readings === 1 ? "" : "s"}
                    {c.tir !== null ? `, ${c.tir.toFixed(0)}% of them inside your range` : ""}.
                  </p>
                </Card>
              </div>
            ))}
          </div>
        )}

        {/* ------------------------------ milestones ----------------------------- */}
        <h2 className="mt-8 mb-3">Milestones</h2>
        {milestoneRows.length === 0 ? (
          <Card>
            <p className="muted prose-measure">
              No trend milestones yet. They need readings on {7} days in each of two fortnights before anything can be
              compared honestly, and they are never awarded for a single reading.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {milestoneRows.map((m) => (
              <article key={m.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3>{m.title}</h3>
                  {m.gems > 0 ? <span className="gem-pill num shrink-0">◆ {m.gems}</span> : null}
                </div>
                <p className="text-sm mt-1">{m.body}</p>
                <p className="hint mt-2">{m.evidence}</p>
                <p className="hint mt-1">
                  {fmtDay(m.earnedAt)} · {m.sampleSize} record{m.sampleSize === 1 ? "" : "s"} · data quality {m.dataQuality} ·
                  rules v{m.ruleVersion}
                </p>
              </article>
            ))}
          </div>
        )}

        <div className="mt-6">
          <Notice tone="amber">
            Trend milestones compare you against your own previous fortnight and nothing else. They are never awarded
            for hitting a target, never for a single reading, and a fortnight that went the other way costs you
            nothing. {TREND_REVIEW_NOTE}
          </Notice>
        </div>
      </div>
    );
  });
}
