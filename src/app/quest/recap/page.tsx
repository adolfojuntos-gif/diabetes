import Link from "next/link";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { requireAccount } from "@/lib/auth/session";
import { db, journeyAwards } from "@/lib/db";
import { Card, EmptyState, Notice } from "@/components/ui";
import { World } from "@/components/World";
import { getProfile } from "@/lib/data/snapshot";
import { loadJourneyInput, journeyState } from "@/lib/data/journey";
import { getPlayer } from "@/lib/data/lifequest";
import { rollDays, levelForXp, worldState } from "@/lib/engines/journey";
import { buildRecap, recapFrom } from "@/lib/engines/recap";

export const dynamic = "force-dynamic";

const WINDOWS = [30, 60, 90] as const;

/**
 * YOUR WORLD, 90 DAYS.
 *
 * The one screen built to be felt rather than read. It plays as a sequence of cards, each with the
 * world drawn at the level it had reached by that point, so the picture literally grows down the
 * page as you scroll through your own three months.
 *
 * It is deliberately NOT a video and NOT a canvas animation. A sequence of server-rendered cards
 * can be scrolled at the reader's own pace, stopped on the beat that matters to them, read by a
 * screen reader, screenshotted, and printed for an appointment. An autoplaying film can do none of
 * those and would be worse at the only job this page has.
 *
 * Every beat comes from `buildRecap`, which drops any beat it cannot evidence. A quarter with
 * nothing in it produces an empty state and not a consoling story.
 */
export default async function RecapPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const sp = await searchParams;
    const days = WINDOWS.includes(Number(sp.days) as (typeof WINDOWS)[number]) ? Number(sp.days) : 90;

    const now = new Date();
    const [input, player] = await Promise.all([loadJourneyInput(now, profile), getPlayer(now)]);
    const state = await journeyState(player.worldTheme);
    const rolls = rollDays(input, days);

    const from = recapFrom(now, days);
    const ledger = await db.select().from(journeyAwards).orderBy(asc(journeyAwards.earnedAt));
    const inWindow = ledger.filter((a) => a.earnedAt >= from);

    // The level they were at when the window opened is the level implied by the XP earned BEFORE
    // it, which the ledger answers exactly. Nothing here is estimated.
    const xpBefore = ledger.filter((a) => a.earnedAt < from).reduce((acc, a) => acc + a.xp, 0);
    const xpInWindow = inWindow.reduce((acc, a) => acc + a.xp, 0);
    const gemsInWindow = inWindow.reduce((acc, a) => acc + a.gems, 0);

    const beats = buildRecap({
      now,
      days,
      rolls,
      awards: inWindow.map((a) => ({ code: a.code, title: a.title, evidence: a.evidence, earnedAt: a.earnedAt, xp: a.xp, gems: a.gems })),
      levelNow: state.level.level,
      levelThen: levelForXp(xpBefore),
      totalXp: xpInWindow,
      gems: gemsInWindow,
      name: profile.name,
    });

    return (
      <div className="page" data-world={state.theme.key}>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Life Quest</div>
            <h1 className="mt-0.5">Your world, {days} days</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {WINDOWS.map((n) => (
              <Link key={n} href={`/quest/recap?days=${n}`} className={`btn btn-sm ${n === days ? "" : "btn-secondary"}`}>
                {n} days
              </Link>
            ))}
            <Link href="/" className="btn btn-ghost btn-sm">
              Back
            </Link>
          </div>
        </header>

        {beats.length === 0 ? (
          <EmptyState
            title="There is no story here yet"
            body="A recap is built from what you logged, so it needs some days in it first. Log anything and this fills in on its own."
            cta="Log something"
            href="/log"
          />
        ) : (
          <div className="grid gap-5">
            {beats.map((b, i) => (
              <section key={i} className={`recap-beat recap-${b.kind}`} style={{ animationDelay: `${Math.min(i, 12) * 70}ms` }}>
                {/*
                  The world at that point in the sequence. Redrawn per beat rather than animated, so
                  scrolling back up shows the smaller world again exactly as it was.
                */}
                {b.kind === "open" || b.kind === "now" || b.kind === "close" ? (
                  <div className="world-stage mb-3">
                    <World w={worldState(b.level, b.kind === "open" ? 0 : gemsInWindow)} theme={state.theme.key} />
                  </div>
                ) : null}

                <Card className={b.kind === "return" ? "sev-win" : ""}>
                  <div className="eyebrow">
                    {b.kind === "gap"
                      ? "A quiet stretch"
                      : b.kind === "return"
                        ? "Coming back"
                        : b.kind === "milestone"
                          ? "Milestone"
                          : b.kind === "start"
                            ? "The beginning"
                            : ""}
                  </div>
                  <h2 className="mt-1 font-display">{b.headline}</h2>
                  <p className="mt-2 prose-measure">{b.line}</p>
                  {b.evidence ? <p className="hint mt-2">{b.evidence}</p> : null}
                </Card>
              </section>
            ))}
          </div>
        )}

        <div className="mt-8">
          <Notice>
            Every card above is built from a row in your own ledger. Anything the engine could not
            evidence was left out rather than smoothed over, and a quiet stretch is shown as a quiet
            stretch because it is part of what happened.
          </Notice>
        </div>
      </div>
    );
  });
}
