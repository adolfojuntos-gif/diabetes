import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { World } from "@/components/World";
import { getProfile } from "@/lib/data/snapshot";
import { getPlayer } from "@/lib/data/lifequest";
import { journeyState } from "@/lib/data/journey";
import { THEMES, THEME_KEYS } from "@/lib/game/themes";
import { chooseWorld } from "../actions";

export const dynamic = "force-dynamic";

/**
 * CHOOSING A WORLD.
 *
 * Three places, previewed at the person's actual level so they are comparing what they would
 * really see rather than a marketing frame. Switching costs nothing and can be done as often as
 * they like, because the theme is a skin: the ledger, the levels, the thresholds and every point
 * already earned are identical in all three, and the page says so plainly rather than leaving
 * somebody to worry that picking the coast will cost them their forest.
 */
export default async function WorldPicker() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const player = await getPlayer();
    const state = await journeyState(player.worldTheme);

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="Where are you building?"
          lede="Three places, the same journey. Switching changes the view and nothing else: every point, every milestone and every chapter comes with you."
          action={
            <Link href="/" className="btn btn-secondary btn-sm">
              Back to your world
            </Link>
          }
        />

        <div className="grid gap-5">
          {THEME_KEYS.map((k) => {
            const t = THEMES[k];
            const current = player.worldTheme === k;
            return (
              <Card key={k} className={current ? "sev-win" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="eyebrow">{current ? "Your world" : "Another way to build it"}</div>
                    <h2 className="mt-0.5">{t.name}</h2>
                    <p className="muted text-sm mt-1 prose-measure">{t.blurb}</p>
                  </div>
                  {current ? (
                    <span className="pill pill-juniper shrink-0">Currently yours</span>
                  ) : (
                    <form action={chooseWorld} className="shrink-0">
                      <input type="hidden" name="theme" value={k} />
                      <SubmitButton className="btn btn-secondary btn-sm" pendingText="Moving…">
                        Build here instead
                      </SubmitButton>
                    </form>
                  )}
                </div>

                {/* Previewed at their real level, so nothing on this page is a promise. */}
                <div data-world={k} className="world-stage">
                  <World w={state.world} theme={k} />
                </div>

                <p className="hint mt-3">
                  At your level this is {t.regions.find((r) => r.level === state.level.level)?.name ?? t.regions[0].name}.
                  {t.regions.find((r) => r.level === state.level.level + 1)
                    ? ` Next would be ${t.regions.find((r) => r.level === state.level.level + 1)!.name}.`
                    : " The map is fully open."}
                </p>
              </Card>
            );
          })}
        </div>

        <div className="mt-6">
          <Notice>
            The world you pick changes the picture, the names of the places and which guardian speaks. It changes
            nothing about what anything is worth. Level {state.level.level} is level {state.level.level} in all three,
            and no theme makes progress faster or slower than another.
          </Notice>
        </div>
      </div>
    );
  });
}
