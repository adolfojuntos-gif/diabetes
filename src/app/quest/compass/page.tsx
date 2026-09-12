import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { compass } from "@/lib/data/fuel";

export const dynamic = "force-dynamic";

const WINDOWS = [1, 7, 30] as const;

/**
 * THE CARB COMPASS.
 *
 * The one screen in this product most capable of doing harm, and the design is mostly a list of
 * things it will not do.
 *
 * IT NEVER SHOWS A REMAINING BUDGET. "You have 80 g left" turns the next meal into an overdraft. It
 * is the single most restrictive thing a diabetes app can put on a screen, it is worst for exactly
 * the people most at risk of disordered eating, and the engine behind this page contains no
 * subtraction at all. Where somebody HAS recorded a daily figure with their care team, it is shown
 * beside what they logged, as theirs, and the comparison is left to them.
 *
 * IT NEVER GRADES A MEAL OR A DAY. No colour means good, no arrow means better, nothing is high or
 * low. Carbohydrate is not a sin and a number is not a verdict.
 *
 * IT SAYS NOTHING IT CANNOT EVIDENCE. Under three meals it explains why it is quiet instead of
 * describing a "pattern" that is really one lunch.
 *
 * Every figure comes from the engine over the person's own logged meals.
 */
export default async function CompassPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const sp = await searchParams;
    const days = WINDOWS.includes(Number(sp.days) as (typeof WINDOWS)[number]) ? Number(sp.days) : 7;
    const c = await compass(days);

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="The Carb Compass"
          lede="Not how much is left. How much there was, and where it sat in your day."
          action={
            <div className="flex flex-wrap gap-2">
              {WINDOWS.map((n) => (
                <Link key={n} href={`/quest/compass?days=${n}`} className={`btn btn-sm ${n === days ? "" : "btn-secondary"}`}>
                  {n === 1 ? "Today" : `${n} days`}
                </Link>
              ))}
            </div>
          }
        />

        {c.meals === 0 ? (
          <EmptyState
            title="No meals logged in this window"
            body="The compass is built entirely from what you recorded, so it stays empty until there is something in it. Nothing is missing and nothing is owed."
            cta="Log a meal"
            href="/log/meal"
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <div className="eyebrow">Carbohydrate logged</div>
                <div className="num text-3xl font-display mt-1">
                  {c.carbsG}
                  <span className="text-base font-body muted ml-1">g</span>
                </div>
                <div className="hint mt-1">
                  across {c.meals} meal{c.meals === 1 ? "" : "s"}
                </div>
              </Card>
              <Card>
                <div className="eyebrow">Per meal</div>
                <div className="num text-3xl font-display mt-1">
                  {c.perMeal}
                  <span className="text-base font-body muted ml-1">g</span>
                </div>
                <div className="hint mt-1">averaged over what you logged</div>
              </Card>
              <Card>
                <div className="eyebrow">Days covered</div>
                <div className="num text-3xl font-display mt-1">{c.daysCovered}</div>
                <div className="hint mt-1">of the {days === 1 ? "day" : `${days} days`} in this window</div>
              </Card>
            </div>

            {/* ---------------------------- the spread ---------------------------- */}
            <Card className="mt-4">
              <div className="eyebrow">Where it sat</div>
              <p className="hint mt-1 prose-measure">
                The shape of your day, not a score. There is no right distribution here, and nothing
                below is being compared with anything.
              </p>
              <div className="grid gap-3 mt-4">
                {c.spread.map((s) => (
                  <div key={s.slot}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm">
                        {s.label}
                        <span className="hint ml-2">
                          {s.meals} meal{s.meals === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="num font-display">
                        {Math.round(s.carbsG)} g
                        <span className="hint ml-2">{Math.round(s.share * 100)}%</span>
                      </span>
                    </div>
                    <div className="xp-bar mt-1">
                      <span style={{ width: `${Math.max(2, Math.round(s.share * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* ---------------------------- what it shows -------------------------- */}
            <Card className="mt-4">
              <div className="eyebrow">What your record shows</div>
              {c.thin ? (
                <p className="mt-2 prose-measure muted">{c.thin}</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {c.notes.map((n) => (
                    <li key={n} className="prose-measure">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* --------------------------- their own figure ------------------------ */}
            {c.ownTargetG ? (
              <Card className="mt-4">
                <div className="eyebrow">The figure you recorded</div>
                {/*
                  BOTH FIGURES IN THE SAME UNIT, which is a matter of honesty rather than polish. A
                  seven day total of 648 g sitting beside a daily figure of 150 g reads as alarming to
                  anyone glancing, and it is not a comparison at all: the units differ by a factor of
                  six. Showing the per-day average is not the subtraction this page refuses to do. It is
                  what makes the two numbers comparable, so the person can draw their own conclusion
                  instead of a false one.
                */}
                <p className="mt-2 prose-measure">
                  You have {c.ownTargetG} g a day written down as the figure you set with your care team.
                </p>
                <p className="mt-2 prose-measure">
                  Across this window you logged {c.carbsG} g on {c.daysCovered} day{c.daysCovered === 1 ? "" : "s"},
                  which averages{" "}
                  <span className="num">{Math.round(c.carbsG / Math.max(1, c.daysCovered))} g</span> on the days you
                  logged something.
                </p>
                <p className="hint mt-2 prose-measure">
                  Both numbers are shown as they are. Steady does not subtract one from the other, does not tell you
                  how much is left, and does not say whether the difference matters. That conversation belongs with
                  the people who set the figure with you.
                </p>
              </Card>
            ) : null}
          </>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/quest/forest" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>The Food Forest</h3>
            <p className="hint mt-1">Everything you have logged, grown into a place.</p>
          </Link>
          <Link href="/trends/meals" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Meals and your readings</h3>
            <p className="hint mt-1">The clinical view, with the evidence behind it.</p>
          </Link>
        </div>

        <div className="mt-6">
          <Notice>
            Everything here is counted from meals you logged, by this app&apos;s own engine. Steady
            does not set a carbohydrate figure for you, does not tell you how much you have left, and
            nothing on this page is advice about what or how much to eat. If you want a number, it is
            one to agree with your care team.
          </Notice>
        </div>
      </div>
    );
  });
}
