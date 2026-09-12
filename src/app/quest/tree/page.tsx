import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { loadTree } from "@/lib/data/knowledge";
import { KNOWLEDGE_REVIEW_NOTE, TIER_NOTE } from "@/lib/engines/knowledge";

export const dynamic = "force-dynamic";

/**
 * THE NUTRITION KNOWLEDGE TREE.
 *
 * Five tiers, and you move through them by reading. Nothing here opens because a glucose reading
 * was good or a week was tidy, and nothing closes because they were not.
 *
 * Everything on this screen is about how Steady's own reference and arithmetic work, or about the
 * person's own logs. Lessons that would make a claim about food and the body are written into
 * `engines/knowledge.ts` and deliberately not rendered, because no clinician has reviewed them.
 * That gate lives in the engine rather than here, so this page cannot forget it.
 */
export default async function KnowledgeTree() {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const { state } = await loadTree();

    return (
      <div className="page">
        <PageHeader
          eyebrow="Life Quest"
          title="The Knowledge Tree"
          lede="Nutrition you unlock by reading, never by eating a particular way. Every lesson here is about where Steady's figures come from and what they are not telling you."
          action={
            <Link href="/quest/forge" className="btn btn-secondary btn-sm">
              The Fuel Forge
            </Link>
          }
        />

        <div className="card p-4 mb-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="tree-standing-glyph" aria-hidden>
                {state.standing.glyph}
              </span>
              <div>
                <div className="eyebrow">Where you are</div>
                <div className="font-display text-xl">{state.standing.name}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="num text-xl font-display">
                {state.learned}
                <span className="muted text-sm font-body"> of {state.total} read</span>
              </div>
            </div>
          </div>
          <p className="hint mt-3 prose-measure">{TIER_NOTE}</p>
        </div>

        {state.finished ? (
          <div className="mb-5">
            <Notice tone="juniper">
              You have read the whole tree. There is more to know about food than this app is allowed to teach you, and the
              last lesson says who to ask.
            </Notice>
          </div>
        ) : null}

        {/* --------------------------------- the tiers -------------------------------- */}
        <div className="grid gap-4">
          {state.tiers.map((t) => (
            <section key={t.tier} className={`tree-tier ${t.open ? "" : "tree-tier-shut"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-2">
                  <span aria-hidden>{t.glyph}</span> {t.name}
                </h2>
                <span className="hint num">
                  {t.open ? `${t.learnedCount} of ${t.total}` : "opens when the tier above is read"}
                </span>
              </div>
              <p className="hint mt-1 prose-measure">{t.about}</p>

              {t.emptyForNow ? (
                <p className="muted mt-3 prose-measure">
                  Nothing here yet. The lessons for this tier make claims about food and the body, so they are waiting on a
                  clinician rather than being written by this app. The tier is open so it never blocks the way through.
                </p>
              ) : (
                <ul className="grid gap-2 mt-3">
                  {t.lessons.map(({ lesson, learned }) => (
                    <li key={lesson.key}>
                      {t.open ? (
                        <Link href={`/quest/tree/${lesson.key}`} className={`tree-lesson ${learned ? "tree-lesson-read" : ""}`}>
                          <span className="tree-lesson-mark" aria-hidden>
                            {learned ? "✓" : "○"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block">{lesson.title}</span>
                            <span className="hint">{learned ? "Read. Open it again whenever you like." : "Not read yet"}</span>
                          </span>
                        </Link>
                      ) : (
                        <div className="tree-lesson tree-lesson-shut">
                          <span className="tree-lesson-mark" aria-hidden>
                            ·
                          </span>
                          <span className="muted">{lesson.title}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-6">
          <Notice>{KNOWLEDGE_REVIEW_NOTE}</Notice>
        </div>
      </div>
    );
  });
}
