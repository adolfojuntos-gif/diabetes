import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { ecosystem, recentByBiome, compass, lastMeal } from "@/lib/data/fuel";
import { relative } from "@/lib/time";
import { BIOMES, BIOME_INFO } from "@/lib/engines/fuel";

export const dynamic = "force-dynamic";

/** Grams read badly at scale. Kilos once it stops being a plate. */
function mass(g: number): string {
  if (g <= 0) return "nothing yet";
  if (g < 1000) return `${Math.round(g)} g`;
  return `${(g / 1000).toFixed(g < 10_000 ? 1 : 0)} kg`;
}

/**
 * THE FOOD FOREST.
 *
 * Somebody's food journal, drawn as a place they have been building. Fruit grew an orchard,
 * vegetables a garden, fibre a forest, starches the fields, protein the pasture, fats the springs.
 *
 * WHAT THIS PAGE REFUSES TO DO. It does not rank the six, it does not say a biome is small, and it
 * has no "balance" reading. A person whose fields are large and whose garden is empty is not shown
 * a problem, because a food diary is not a report card and the moment this page grades one, it
 * becomes the thing people quietly stop logging into honestly. Every figure here is a count of what
 * they recorded, and counting is all it does.
 */
export default async function ForestPage() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const [eco, recent, week, last] = await Promise.all([ecosystem(), recentByBiome(5), compass(7), lastMeal()]);
    const ordered = [...BIOMES].sort((a, b) => eco.grams[b] - eco.grams[a]);
    const biggest = Math.max(1, ...BIOMES.map((b) => eco.grams[b]));

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="The Food Forest"
          lede="Everything you have logged, grown into a place. No part of it is better than another, and nothing here is a score."
          action={
            <Link href="/" className="btn btn-secondary btn-sm">
              Back to your world
            </Link>
          }
        />

        {eco.totalGrams === 0 ? (
          <EmptyState
            title="Nothing has been planted yet"
            body="Log a meal with what was actually in it and this starts growing. Every food goes somewhere, and there is no wrong thing to log."
            cta="Log a meal"
            href="/log/meal"
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3 mb-6">
              <Card>
                <div className="eyebrow">Foods tried</div>
                <div className="num text-3xl font-display mt-1">{eco.foodsTried}</div>
                <div className="hint mt-1">distinct things you have logged, ever</div>
              </Card>
              <Card>
                <div className="eyebrow">Grown</div>
                <div className="num text-3xl font-display mt-1">{mass(eco.totalGrams)}</div>
                <div className="hint mt-1">of food recorded into your world</div>
              </Card>
              <Card>
                <div className="eyebrow">This week</div>
                <div className="num text-3xl font-display mt-1">{week.meals}</div>
                <div className="hint mt-1">meal{week.meals === 1 ? "" : "s"} logged in the last 7 days</div>
              </Card>
            </div>

            {/* ------------------------------- the last fuel ----------------------------
              A meal in the game's language. Energy is the calorie figure relabelled and nothing
              else: the number is the engine's, only the word changed. The profile describes the
              shape of the plate and is never a verdict, which is why no two profiles can be
              ranked against each other.
            */}
            {last ? (
              <Card className="mb-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">The last thing you fuelled with</div>
                    <h3 className="mt-0.5">{last.name}</h3>
                    <div className="hint mt-0.5">{relative(last.at)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {last.energy > 0 ? (
                      <span className="pill pill-xp num">⚡ {last.energy.toLocaleString()} energy</span>
                    ) : null}
                    <span className="pill num">🌾 {last.carbsG} g carbohydrate</span>
                  </div>
                </div>
                <p className="mt-3 prose-measure">
                  🧭 <strong>{last.profile.name}.</strong> {last.profile.note}
                </p>
                {last.thin ? (
                  <p className="hint mt-2 prose-measure">Logging through the plate builder fills the rest in.</p>
                ) : null}
              </Card>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {ordered.map((b) => {
                const info = BIOME_INFO[b];
                const g = eco.grams[b];
                const width = Math.round((g / biggest) * 100);
                return (
                  <Card key={b} className={g === 0 ? "card-quiet" : ""}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="eyebrow">
                          {info.glyph} from {info.from}
                        </div>
                        <h3 className="mt-0.5">{info.name}</h3>
                      </div>
                      <span className="hint num shrink-0">{mass(g)}</span>
                    </div>

                    {/*
                      A bar only where there is something to draw. An empty track next to a full one is a
                      bar chart of somebody's diet, and reads as five deficiencies however carefully the
                      words underneath are chosen. A biome with nothing in it is unexplored country here,
                      not a gap: it gets an invitation and no measurement at all.

                      Where a bar is drawn it is relative to their own largest biome, never to a target,
                      so it shows the shape of what they eat and cannot be read as a percentage of
                      anything they ought to hit.
                    */}
                    {g > 0 ? (
                      <div className="xp-bar mt-3">
                        <span style={{ width: `${Math.max(3, width)}%` }} />
                      </div>
                    ) : null}

                    <p className="hint mt-2">
                      {g === 0
                        ? `Nothing from ${info.from} logged yet. It grows the moment something is.`
                        : `${eco.variety[b]} distinct food${eco.variety[b] === 1 ? "" : "s"}, growing ${info.grows}.`}
                    </p>

                    {recent[b].length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {recent[b].map((n) => (
                          <span key={n} className="pill">
                            {n}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/quest/compass" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>The Carb Compass</h3>
            <p className="hint mt-1">Where your carbohydrate sat across the day, described rather than scored.</p>
          </Link>
          <Link href="/log/meal" className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>Log a meal</h3>
            <p className="hint mt-1">Everything you add grows part of this.</p>
          </Link>
        </div>

        <div className="mt-6">
          <Notice>
            Which part of the world a food grows is worked out from its grams of carbohydrate,
            protein, fat and fibre, by this app&apos;s own engine. It is a game mapping and not a
            nutritional judgement: no biome here is healthier than another, and nothing on this page
            is advice about what to eat.
          </Notice>
        </div>
      </div>
    );
  });
}
