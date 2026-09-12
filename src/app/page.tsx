import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { Card, Notice, TriageBanner } from "@/components/ui";
import { World } from "@/components/World";
import { loadLifeQuest } from "@/lib/data/lifequest";
import { getProfile } from "@/lib/data/snapshot";
import { runTriage } from "./copilot/actions";
import { markQuestDone, enterRest, leaveRest, acknowledge, dismissMorning, seenTheWorld } from "./quest/actions";
import { SubmitButton } from "@/components/Form";
import { dateKey } from "@/lib/time";
import { fmtDayLong } from "@/lib/time";
import { TREND_REVIEW_NOTE } from "@/lib/engines/rules";

export const dynamic = "force-dynamic";

/**
 * LIFE QUEST.
 *
 * The order of this page is the safety architecture made visible. Triage is loaded and drawn
 * FIRST, above the world, above the level, above anything celebratory, because a person whose
 * readings say they need help must not be handed confetti instead. Everything below the banner is
 * a game; the banner is not, and it never moves.
 */
export default async function QuestPage() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const [triage, q] = await Promise.all([runTriage({}), loadLifeQuest()]);

    /*
     * THE ONE INTERRUPT IN THE PRODUCT, AND WHAT OUTRANKS IT.
     *
     * A new region takes over the whole screen, because a moment that appears as a card between
     * two other cards is not a moment. It does NOT take over when triage has something to say,
     * when the person is resting, or when they are away and being welcomed back: in all three the
     * screen already has a more important job, and the ceremony simply waits. Nothing expires while
     * it waits, because the region was unlocked the instant it was earned.
     */
    if (q.unlocked && triage.level === "general" && !q.resting && !q.standing.returning) redirect("/quest/unlocked");
    const { state, guardian, standing, dimensions, todayQuest, adventure, quests, fresh, resting, restUntil } = q;
    const level = state.level;

    const questsDone = quests.filter((x) => x.completedAt).length;

    return (
      <div className="page">
        {/* SAFETY FIRST, ALWAYS. Nothing on this page may be drawn above this. */}
        {triage.level !== "general" ? (
          <div className="mb-5">
            <TriageBanner t={triage} />
          </div>
        ) : null}

        {/* ------------------------------- morning ------------------------------- */}
        {q.morning && !q.resting ? (
          <section className="morning rise" aria-label="This morning">
            <div className="eyebrow">{fmtDayLong(new Date())}</div>
            <h2 className="morning-title mt-0.5">
              {profile.name ? `Good morning, ${profile.name}` : "Good morning"}
            </h2>
            <p className="mt-2 prose-measure">
              {q.standing.returning
                ? "Your world has been waiting for you, exactly as you left it."
                : todayQuest.xp > 0
                  ? `${guardian.name} has one thing for you today.`
                  : "Everything you set out to do today is already logged."}
            </p>
            {todayQuest.xp > 0 ? (
              <div className="card-sunk p-3 mt-3">
                <div className="eyebrow">Today&apos;s quest</div>
                <div className="font-display text-xl mt-0.5">{todayQuest.title}</div>
                <p className="text-sm mt-1 prose-measure">{todayQuest.ask}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 mt-4">
              {/*
                Both buttons acknowledge the greeting, so it is shown once a day and never becomes a
                thing to dismiss. Taking the action and skipping it both count as having read it.
              */}
              {todayQuest.xp > 0 ? (
                <form action={dismissMorning}>
                  <input type="hidden" name="date" value={dateKey(new Date())} />
                  <input type="hidden" name="to" value={todayQuest.href} />
                  <SubmitButton className="btn" pendingText="Going…">
                    {`Start it · +${todayQuest.xp} XP`}
                  </SubmitButton>
                </form>
              ) : null}
              <form action={dismissMorning}>
                <input type="hidden" name="date" value={dateKey(new Date())} />
                <SubmitButton className="btn btn-ghost" pendingText="…">
                  Just show me my world
                </SubmitButton>
              </form>
            </div>
          </section>
        ) : null}

        {/* --------------------------------- the HUD -------------------------------
          A game tells you where you stand without being asked. The ring is the level, the track is
          the way into the next region, and both are read from the ledger. It is sticky, so wherever
          you scroll to on the front door you can still see what you are building toward.
        */}
        <div className="hud rise" data-world={state.theme.key}>
          <div className="hud-ring num" style={{ "--p": level.progress } as React.CSSProperties} aria-hidden>
            <span>{level.level}</span>
          </div>
          <div className="hud-main">
            <div className="eyebrow">
              {level.nextRegion ? `Next: ${level.nextRegion.name}` : "The map is fully open"}
            </div>
            <div className="hud-region">{level.region.name}</div>
            <div className="hud-track">
              <span style={{ width: `${Math.round(level.progress * 100)}%` }} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="num font-display text-lg" style={{ color: "var(--gold)" }}>
              {level.xp.toLocaleString()}
            </div>
            <div className="eyebrow">XP</div>
          </div>
          {state.gems > 0 ? <span className="gem-pill num shrink-0">◆ {state.gems}</span> : null}
        </div>

        {/* ------------------------------ the world ------------------------------
          Full bleed and vignetted, so it is the ground the page stands on rather than an
          illustration inside a card.
        */}
        <section className="bleed rise rise-1" data-world={state.theme.key}>
          <div className="world-stage relative">
            <World w={state.world} theme={state.theme.key} rest={resting} />
            {/*
              Top left, not bottom left. Every theme puts the home, the path and the figure along the
              lower band, which is the point of the drawing, and a title laid over that is two things
              fighting for the same pixels. The sky is the one region of the frame the scene keeps
              deliberately empty, so that is where the words go.
            */}
            <div className="absolute inset-x-0 top-0 p-5 md:p-7">
              <div className="eyebrow on-film" style={{ color: "var(--gold)" }}>
                Life Quest
              </div>
              <h1 className="on-film mt-0.5">{level.region.name}</h1>
              <p className="on-film text-sm mt-1 prose-measure" style={{ color: "var(--ink-soft)" }}>
                {level.region.blurb}
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------ what's new ------------------------------
          The first thing read after the world itself, and the reason to open the app at all. It
          is silent when nothing has happened: inventing news is how a discovery feed becomes
          something people learn to skip.
        */}
        {q.news.length ? (
          <section className="mt-4 rise rise-2">
            <div className="flex items-end justify-between gap-3 mb-2">
              <h2>What&apos;s new</h2>
              <form action={seenTheWorld}>
                <button className="btn btn-ghost btn-sm" type="submit">
                  Seen it
                </button>
              </form>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {q.news.map((n, i) => (
                <article key={n.id} className="card p-4 award-pop" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="eyebrow" style={{ color: "var(--bloom)" }}>
                    {n.kind === "arrival"
                      ? "Someone arrived"
                      : n.kind === "sighting"
                        ? "You noticed something"
                        : n.kind === "growth"
                          ? "While you were away"
                          : n.kind === "landmark"
                            ? "Visible from here"
                            : "The season turned"}
                  </div>
                  <h3 className="mt-0.5">{n.title}</h3>
                  <p className="text-sm mt-1 prose-measure">{n.body}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <p className="hint mt-3">
          XP comes from things you decided to do. It is never earned or lost because of a reading, and nothing here
          ever goes down.
        </p>

        {/* --------------------------- coming back ---------------------------- */}
        {standing.returning ? (
          <Card className="mt-4 rise rise-3" as="section">
            <div className="eyebrow">{guardian.glyph} {guardian.name}, {guardian.animal}</div>
            <h2 className="mt-1">{standing.headline}</h2>
            <p className="mt-1 prose-measure">{standing.body}</p>
            <p className="mt-2 text-sm muted prose-measure">&ldquo;{guardian.onReturn}&rdquo;</p>
          </Card>
        ) : null}

        {/* --------------------------- what just landed ------------------------ */}
        {fresh.length ? (
          <section className="mt-6">
            <div className="flex items-end justify-between gap-3 mb-3">
              <h2>What you earned</h2>
              <form action={acknowledge}>
                <button className="btn btn-ghost btn-sm" type="submit">
                  Got it
                </button>
              </form>
            </div>
            {/*
              The guardian speaks ABOUT what the engine granted, never instead of it. The award cards
              below carry the real figures, so a narration that went missing costs nothing.
            */}
            {q.celebration ? (
              <Card className="mb-3">
                <div className="eyebrow">{guardian.glyph} {guardian.name}, {guardian.animal}</div>
                <p className="mt-2 prose-measure font-display text-lg">{q.celebration.text}</p>
              </Card>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {fresh.map((a, i) => (
                <article key={i} className="card p-4 award-pop" style={{ animationDelay: `${i * 60}ms` }}>
                  {a.achievement ? <div className="eyebrow">🏆 {a.achievement.title}</div> : null}
                  <h3 className="mt-0.5">{a.title}</h3>
                  <p className="text-sm mt-1">{a.body}</p>
                  <p className="hint mt-2">{a.evidence}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {a.xp > 0 ? <span className="pill num" style={{ background: "var(--bloom-soft)", color: "var(--bloom)" }}>+{a.xp} XP</span> : null}
                    {a.gems > 0 ? <span className="gem-pill num">◆ +{a.gems}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* ------------------------------ rest mode ---------------------------- */}
        {resting ? (
          <Card className="mt-6" as="section">
            <div className="eyebrow">Rest mode</div>
            <h2 className="mt-1">The world is quiet</h2>
            <p className="mt-1 prose-measure">
              No quests, nothing counting down, nothing expiring. Everything you have built is exactly where you left
              it and it stays there.
            </p>
            <p className="mt-2 text-sm muted prose-measure">
              {guardian.glyph} &ldquo;{guardian.onRest}&rdquo; {guardian.name}, {guardian.animal}
            </p>
            {restUntil ? <p className="hint mt-2">Quiet until {fmtDayLong(restUntil)}, unless you end it sooner.</p> : null}
            <form action={leaveRest} className="mt-3">
              <button className="btn btn-secondary btn-sm" type="submit">
                I am ready to carry on
              </button>
            </form>
          </Card>
        ) : (
          <>
            {/* ---------------------------- today ---------------------------- */}
            <section className="mt-6 grid gap-4 md:grid-cols-[1.1fr_1fr]">
              <Card>
                <div className="eyebrow">
                  {guardian.glyph} {guardian.name}, {guardian.animal}
                </div>
                <p className="mt-2 prose-measure font-display text-xl">&ldquo;{q.guardianLine}&rdquo;</p>
                <div className="divider my-4" />
                <div className="eyebrow">Today</div>
                <h3 className="mt-1">{todayQuest.title}</h3>
                <p className="text-sm mt-1 prose-measure">{todayQuest.ask}</p>
                {todayQuest.xp > 0 ? (
                  <Link href={todayQuest.href} className="btn btn-sm mt-3">
                    Do it now · +{todayQuest.xp} XP
                  </Link>
                ) : null}
              </Card>

              <Card>
                <div className="eyebrow">This week</div>
                <h3 className="mt-1">{adventure.name}</h3>
                <p className="text-sm mt-1 prose-measure muted">{adventure.opening}</p>
                <p className="hint mt-2">
                  Finish {quests.length === 1 ? "it" : `all ${quests.length}`} and {adventure.reward} opens. {questsDone} of{" "}
                  {quests.length} done.
                </p>
                <div className="grid gap-2 mt-3">
                  {quests.map((x) => (
                    <div key={x.id} className={`card-sunk p-3 ${x.completedAt ? "quest-done" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="quest-title font-display">{x.title}</div>
                          <p className="text-sm mt-0.5">{x.ask}</p>
                          <p className="hint mt-1">{x.why}</p>
                        </div>
                        <span className="pill num shrink-0" style={{ background: "var(--bloom-soft)", color: "var(--bloom)" }}>
                          +{x.xp}
                        </span>
                      </div>
                      <div className="mt-2">
                        {x.completedAt ? (
                          <span className="hint">
                            Done · {x.verifiedBy === "engine" ? "confirmed from your logs" : "marked by you"}
                          </span>
                        ) : x.kind === "manual" ? (
                          <form action={markQuestDone}>
                            <input type="hidden" name="key" value={x.key} />
                            <button className="btn btn-secondary btn-sm" type="submit">
                              I did this
                            </button>
                          </form>
                        ) : (
                          <span className="hint">This one ticks itself off from what you log.</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          </>
        )}

        {/* ---------------------------- who you are ---------------------------- */}
        <section className="mt-8">
          <div className="flex items-end justify-between gap-3 mb-3">
            <div>
              <h2>Who you are becoming</h2>
              {q.archetype ? (
                <p className="hint mt-1">
                  {q.archetype.glyph} {q.archetype.name}, so {q.dimensions[0].name} leads the list. The order is the only thing your
                  choice changes here: nothing below is worth more or less for it.
                </p>
              ) : null}
              <p className="hint mt-1 prose-measure">
                Seven of these, and not one is a score. There is no overall number here and there never will be.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dimensions.map((d) => (
              <div key={d.key} className="card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3>{d.name}</h3>
                  <span className="hint">{d.rankName}</span>
                </div>
                <div className="xp-bar mt-2">
                  <span style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </div>
                <p className="hint mt-2">{d.blurb}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------ the rest ----------------------------- */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-6">
          <Link href="/quest/plate" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Build your plate</h3>
            <p className="hint mt-1">Put a meal together and see what you are working with.</p>
          </Link>
          <Link href="/quest/guess" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Guess the Carbs</h3>
            <p className="hint mt-1">Build a feel for a portion. No score, and nothing to get wrong.</p>
          </Link>
          <Link href="/quest/forest" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>The Food Forest</h3>
            <p className="hint mt-1">Everything you have eaten, grown into a place.</p>
          </Link>
          <Link href="/quest/recap" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Your world, 90 days</h3>
            <p className="hint mt-1">The whole stretch, played back one beat at a time.</p>
          </Link>
          <Link href="/quest/journey" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Your journey</h3>
            <p className="hint mt-1">The whole story, month by month, in your own numbers.</p>
          </Link>
          <Link href="/quest/you" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>{q.archetype ? q.archetype.name : "Who are you here?"}</h3>
            <p className="hint mt-1">
              {q.archetype ? q.archetype.line : "Not a personality test. It changes what the world offers you, never what it pays."}
            </p>
          </Link>
          <Link href="/quest/world" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Change your world</h3>
            <p className="hint mt-1">Forest, coast or city. Nothing is lost by moving.</p>
          </Link>
          <Link href="/quest/journal" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Explorer Journal</h3>
            <p className="hint mt-1">{q.discoveries} thing{q.discoveries === 1 ? "" : "s"} you noticed and kept.</p>
          </Link>
          {!resting ? (
            <Card>
              <h3>Need a quiet week?</h3>
              <p className="hint mt-1">Rest mode stops every ask. Nothing is lost and nothing expires.</p>
              <form action={enterRest} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="days" value="7" />
                <button className="btn btn-ghost btn-sm" type="submit">
                  Rest for a week
                </button>
              </form>
            </Card>
          ) : null}
        </div>

        <div className="mt-6">
          <Notice>
            Life Quest never scores your glucose. XP comes from what you chose to do; progress gems come only from a
            sustained change in your own trend across a fortnight, measured by the same engine that draws your charts.
            Nothing here is medical advice, and nothing here ever goes down. {TREND_REVIEW_NOTE}
          </Notice>
        </div>
      </div>
    );
  });
}
