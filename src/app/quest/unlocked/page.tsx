import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { TriageBanner } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { World } from "@/components/World";
import { getProfile } from "@/lib/data/snapshot";
import { getPlayer } from "@/lib/data/lifequest";
import { journeyState } from "@/lib/data/journey";
import { worldState } from "@/lib/engines/journey";
import { guardianFor } from "@/lib/engines/lifequest";
import { runTriage } from "../../copilot/actions";
import { enterRegion } from "../actions";

export const dynamic = "force-dynamic";

/**
 * THE UNLOCK CEREMONY.
 *
 * The one screen in the product allowed to take over the whole view, and the rules it earns that
 * with are strict:
 *
 *   IT IS SHOWN ONCE. `player_state.region_seen_level` records the ceremony, so a moment stays a
 *   moment. Reloading does not replay it and neither does coming back tomorrow.
 *
 *   IT NEVER INTERRUPTS SOMETHING THAT MATTERS MORE. The front door only sends somebody here when
 *   triage is clear. If a reading needs attention the ceremony waits, silently, until it does not,
 *   and this page draws the safety banner above itself for the case where somebody arrives by URL
 *   in the seconds after something changed.
 *
 *   IT IS DISMISSIBLE WITH ONE TAP AND HAS NO TIMER. Nothing here counts down, nothing is missed by
 *   leaving, and the region is already unlocked before this page renders. The ceremony reports a
 *   thing that has happened; it is not a gate in front of it.
 */
export default async function UnlockedPage() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const [player, triage] = await Promise.all([getPlayer(), runTriage({})]);
    const state = await journeyState(player.worldTheme);
    const level = state.level;

    // Nothing owed means nothing to show. Somebody who bookmarked this URL goes home rather than
    // being shown a celebration for a region they crossed months ago.
    if (level.level <= player.regionSeenLevel) redirect("/");

    const guardian = guardianFor(level.level);
    // The world as it was one level ago, so the two pictures either side of the line are honest.
    const before = worldState(Math.max(1, level.level - 1), state.gems);

    return (
      <div className="page ceremony" data-world={state.theme.key}>
        {triage.level !== "general" ? (
          <div className="mb-5">
            <TriageBanner t={triage} />
          </div>
        ) : null}

        <div className="ceremony-inner">
          <div className="eyebrow ceremony-eyebrow">A new region is open</div>
          <h1 className="ceremony-title">{level.region.name}</h1>
          <p className="ceremony-blurb prose-measure mx-auto">{level.region.blurb}</p>

          <div className="ceremony-world world-stage mt-6">
            <World w={state.world} theme={state.theme.key} />
          </div>

          <div className="ceremony-then mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-center">
            <div className="text-right">
              <div className="eyebrow">Before</div>
              <div className="num font-display text-xl">Level {before.level}</div>
            </div>
            <div className="ceremony-arrow" aria-hidden>
              →
            </div>
            <div className="text-left">
              <div className="eyebrow">Now</div>
              <div className="num font-display text-xl">Level {level.level}</div>
            </div>
          </div>

          <p className="ceremony-guardian mt-6 prose-measure mx-auto">
            {guardian.glyph} &ldquo;{guardian.greeting[0]}&rdquo;
            <span className="block hint mt-1">
              {guardian.name}, {guardian.animal}
            </span>
          </p>

          <p className="hint mt-6 prose-measure mx-auto">
            You reached this with {state.xp.toLocaleString()} XP, all of it earned for things you chose to do. Nothing
            here was given for a reading, and nothing here can be taken back.
          </p>

          <form action={enterRegion} className="mt-6 flex flex-wrap justify-center gap-2">
            <input type="hidden" name="level" value={level.level} />
            <SubmitButton className="btn btn-lg" pendingText="Going…">
              Walk into {level.region.name}
            </SubmitButton>
          </form>

          {/* Also acknowledges: see `enterRegion`. Deferring must not turn into a nag. */}
          <form action={enterRegion} className="mt-4">
            <input type="hidden" name="level" value={level.level} />
            <input type="hidden" name="to" value="today" />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Going…">
              Not now, show me my numbers
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  });
}
