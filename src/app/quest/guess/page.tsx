import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { getProfile } from "@/lib/data/snapshot";
import { nextRound, answer, history, playedCount } from "@/lib/data/guess";
import { submitGuess } from "../actions";
import { fmtDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * GUESS THE CARBS.
 *
 * Show a food and a portion, ask for an estimate, show what the reference says.
 *
 * THE ANSWER IS NOT ON THIS PAGE UNTIL A GUESS IS IN. `nextRound` deliberately returns everything
 * except the carbohydrate figure, so it is not in the markup, not in the payload, and not in the
 * network tab. Somebody who wanted to cheat at a game with no score would have to work for it, and
 * more to the point nobody can do it by accident.
 *
 * NOTHING HERE IS A TEST. No score, no streak of rightness, no running accuracy, and the word wrong
 * appears nowhere. The XP is for playing and is the same whatever the guess, which is asserted in
 * `tests/guess.test.ts` because it is the property the whole feature stands on.
 *
 * IT IS NOT A DOSING TOOL, and it says so on the screen. Somebody who counts carbohydrate for
 * insulin works from the reference, a label, or their care team, and never from how they did here.
 */
export default async function GuessPage({ searchParams }: { searchParams: Promise<{ r?: string; g?: string }> }) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const sp = await searchParams;
    const result = sp.r && sp.g ? await answer(sp.r, Number(sp.g)) : null;
    const [round, past, played] = await Promise.all([nextRound(), history(8), playedCount()]);

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="Guess the Carbs"
          lede="Build a feel for what is in a portion. There is no score here and nothing you can get wrong."
          action={
            <Link href="/quest/forest" className="btn btn-secondary btn-sm">
              The Food Forest
            </Link>
          }
        />

        {/* ------------------------------- the reveal ------------------------------ */}
        {result ? (
          <Card className="award-pop mb-5">
            <div className="eyebrow">{result.portionLabel} of {result.foodName}</div>
            <h2 className="mt-1">{result.headline}</h2>

            <div className="grid gap-3 sm:grid-cols-2 mt-4">
              <div className="card-sunk p-3">
                <div className="eyebrow">Your estimate</div>
                <div className="num text-2xl font-display mt-1">
                  {result.guessG}
                  <span className="text-sm font-body muted ml-1">g</span>
                </div>
              </div>
              <div className="card-sunk p-3">
                <div className="eyebrow">The reference</div>
                <div className="num text-2xl font-display mt-1">
                  {result.referenceCarbsG}
                  <span className="text-sm font-body muted ml-1">g</span>
                </div>
                <div className="hint mt-1 num">
                  portions of this vary between about {result.band.low} and {result.band.high} g
                </div>
              </div>
            </div>

            <p className="mt-3 prose-measure">{result.line}</p>
            <p className="hint mt-2 prose-measure">{result.note}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {result.paid ? (
                <span className="pill pill-xp num">+{result.xp} XP for playing</span>
              ) : (
                <span className="hint">
                  Today&apos;s XP for this is already earned. The round still counts and you can keep going.
                </span>
              )}
            </div>
          </Card>
        ) : null}

        {/* -------------------------------- the round ------------------------------ */}
        {!round ? (
          <EmptyState
            title="No food to ask about yet"
            body="This plays from your own carbohydrate reference, so it needs some foods in it first. The reference comes with the app; if it looks empty, something has gone wrong with it."
            cta="Open the food reference"
            href="/log/food"
          />
        ) : (
          <Card>
            <div className="eyebrow">
              Round {round.index}
              {round.paying ? ` of ${round.ofPaying} paying today` : " · beyond today's XP, and still worth playing"}
            </div>
            <h2 className="mt-1">{round.foodName}</h2>
            {round.brand ? <div className="hint mt-0.5">{round.brand}</div> : null}

            <p className="mt-3 prose-measure">
              How much carbohydrate do you think is in{" "}
              <strong>
                {round.portionLabel}
                {round.portionLabel.includes(String(Math.round(round.grams))) ? "" : `, about ${Math.round(round.grams)} g`}
              </strong>
              ?
            </p>

            <form action={submitGuess} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="roundKey" value={round.roundKey} />
              <div className="field">
                <label className="label" htmlFor="guess">
                  Your estimate, in grams
                </label>
                <input
                  id="guess"
                  name="guess"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={500}
                  required
                  autoFocus
                  className="input input-big"
                  style={{ maxWidth: "10rem" }}
                  placeholder="?"
                />
              </div>
              <SubmitButton className="btn btn-lg" pendingText="Checking…">
                Lock it in
              </SubmitButton>
            </form>

            <p className="hint mt-3 prose-measure">
              A rough number is the right answer here. The whole point is getting closer over time, not being right
              today, and the XP is the same either way.
            </p>
          </Card>
        )}

        {/* ------------------------------- looking back ---------------------------- */}
        {past.length > 0 ? (
          <>
            <div className="flex items-end justify-between gap-3 mt-8 mb-3">
              <h2>What you have guessed</h2>
              <span className="hint num">
                {played} round{played === 1 ? "" : "s"} played
              </span>
            </div>
            <ul className="card divide-y">
              {past.map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-3 md:p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.foodName}</div>
                    <div className="hint">
                      {p.portionLabel} · {fmtDay(p.at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="num text-sm">
                      you {Math.round(p.guessG)} g · reference {Math.round(p.referenceCarbsG)} g
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-6">
          <Notice tone="amber">
            <strong>This is for building intuition, not for dosing.</strong> Every reference figure here comes from
            Steady&apos;s carbohydrate reference and is real, but a game is not where you work out a meal. If you count
            carbohydrate to decide an insulin dose, use the food reference, the label, or the figure your care team
            gave you. Nothing about how you did here changes any of that.
          </Notice>
        </div>
      </div>
    );
  });
}
