import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { getProfile } from "@/lib/data/snapshot";
import { getPlayer } from "@/lib/data/lifequest";
import { ARCHETYPES } from "@/lib/game/archetypes";
import { chooseArchetype } from "../actions";

export const dynamic = "force-dynamic";

/**
 * WHO YOU ARE HERE.
 *
 * A person with diabetes is asked to be a patient all day. This is the one screen where they get to
 * be something else.
 *
 * THE CHOICE IS THEIRS AND IT IS NOT A TEST. Nothing here is inferred from their data, nothing is
 * scored, there is no wrong answer and it can be changed as often as they like. The page says all
 * of that in plain words, because an app that asks you to describe yourself and then goes quiet
 * about what it does with the answer has asked for something it did not explain.
 *
 * IT CHANGES WHAT IS OFFERED, NEVER WHAT IS PAID. That sentence is on the screen as well as in the
 * engine, because it is the thing somebody would reasonably worry about: picking wrong at signup
 * and quietly losing months. `tests/archetype.test.ts` proves it over a simulated year.
 */
export default async function YouPage() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");
    const player = await getPlayer();

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="Who are you here?"
          lede="Not a personality test, and there is no wrong answer. It changes what the world offers you, and nothing about what anything is worth."
          action={
            <Link href="/" className="btn btn-secondary btn-sm">
              Back to your world
            </Link>
          }
        />

        <div className="grid gap-3 md:grid-cols-2">
          {ARCHETYPES.map((a) => {
            const current = player.archetype === a.key;
            return (
              <Card key={a.key} className={current ? "sev-win" : "lift"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="eyebrow">
                      {a.glyph} {current ? "This is you" : "Another way to be here"}
                    </div>
                    <h2 className="mt-0.5">{a.name}</h2>
                  </div>
                  {current ? <span className="pill pill-juniper shrink-0">Chosen</span> : null}
                </div>
                <p className="mt-2 prose-measure font-display text-lg">{a.line}</p>
                <p className="hint mt-2 prose-measure">{a.detail}</p>
                {!current ? (
                  <form action={chooseArchetype} className="mt-4">
                    <input type="hidden" name="archetype" value={a.key} />
                    <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">
                      Be {a.name.replace("The ", "the ")}
                    </SubmitButton>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>

        <div className="mt-6">
          <Notice>
            Your choice tilts which quests come up and which of the seven identities is read first.
            It cannot make anything earn more or less, it cannot put a milestone out of reach, and
            changing it costs nothing: every point, every gem and every chapter stays exactly where
            it is. Nothing here is taken from your health records, and nothing here is shared with
            anybody.
          </Notice>
        </div>
      </div>
    );
  });
}
