import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { getProfile } from "@/lib/data/snapshot";
import { journal } from "@/lib/data/lifequest";
import { recordDiscovery } from "../actions";
import { fmtDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * THE EXPLORER JOURNAL.
 *
 * Everything else in Steady is a record of a body. This is a record of a life, and it is here for
 * one reason: a walk logged as "22 minutes, moderate" is exercise, and the same walk written down
 * as "the heron was back on the far bank" is somewhere you went. The second one is what gets
 * somebody out of the house again on Thursday.
 *
 * There is no validation of what a discovery is, no category list and no photo requirement, because
 * the moment this asks people to classify what they saw it stops being a journal.
 */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");
    const { error } = await searchParams;
    const entries = await journal(60);

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="Explorer Journal"
          lede="Things you saw out there and wanted to keep. Every entry is worth 50 XP, and none of them can be wrong."
          action={
            <Link href="/" className="btn btn-secondary btn-sm">
              Back to your world
            </Link>
          }
        />

        {error ? (
          <div className="mb-4">
            <Notice tone="amber">{error}</Notice>
          </div>
        ) : null}

        <Card className="rise rise-1">
          <div className="eyebrow mb-3">Add something</div>
          <form action={recordDiscovery} className="grid gap-3">
            <div className="field">
              <label className="label" htmlFor="name">
                What was it
              </label>
              <input id="name" name="name" className="input" required maxLength={80} placeholder="Heron on the far bank" />
              <span className="hint">A bird, a tree, a mural, a shortcut, a shop you had never noticed.</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="place">
                Where
              </label>
              <input id="place" name="place" className="input" maxLength={80} placeholder="The canal path" />
            </div>
            <div className="field">
              <label className="label" htmlFor="note">
                Anything else
              </label>
              <textarea id="note" name="note" className="textarea" rows={3} maxLength={400} placeholder="Same spot as last month. Stood still for about a minute." />
              <span className="hint">Optional. One line is a whole entry.</span>
            </div>
            <div>
              <SubmitButton>Add to the journal · +50 XP</SubmitButton>
            </div>
          </form>
        </Card>

        {entries.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Nothing in here yet"
              body="The next time you are out, find one thing worth looking at twice and write it down. That is the whole of it."
              cta="See this week's quests"
              href="/"
            />
          </div>
        ) : (
          <>
            <h2 className="mt-8 mb-3">
              {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {entries.map((d) => (
                <article key={d.id} className="card p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3>{d.name}</h3>
                    <span className="hint shrink-0">{fmtDay(d.at)}</span>
                  </div>
                  {d.place ? <div className="hint mt-0.5">{d.place}</div> : null}
                  {d.note ? <p className="text-sm mt-2 prose-measure">{d.note}</p> : null}
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    );
  });
}
