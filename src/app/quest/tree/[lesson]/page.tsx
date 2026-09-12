import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Notice } from "@/components/ui";
import { getProfile } from "@/lib/data/snapshot";
import { learnLesson, loadTree } from "@/lib/data/knowledge";
import { parseForm, zStr } from "@/lib/actions";
import { availableLessons, canOpen, respondTo, TIER_INFO, treeState } from "@/lib/engines/knowledge";

export const dynamic = "force-dynamic";

/**
 * Answer the check.
 *
 * There is no right option. Whichever is picked, the lesson is recorded as read, the same XP is
 * paid, and the person is shown what the reference actually says. The gate on whether the lesson
 * was open at all is enforced in `learnLesson`, not here, because a form post is a form post.
 */
async function answer(fd: FormData) {
  "use server";
  return requireAccount(async () => {
    const parsed = parseForm(z.object({ lesson: zStr(80), chose: z.coerce.number().int().min(0).max(9) }), fd);
    if ("error" in parsed) redirect("/quest/tree");
    await learnLesson(parsed.data.lesson, parsed.data.chose);
    for (const p of ["/", "/quest/tree"]) revalidatePath(p);
    redirect(`/quest/tree/${encodeURIComponent(parsed.data.lesson)}?a=${parsed.data.chose}`);
  });
}

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ lesson: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  return requireAccount(async () => {
    const profile = await getProfile();
    if (!profile.onboarded) redirect("/welcome");

    const { lesson: key } = await params;
    const lesson = availableLessons().find((l) => l.key === key);
    /*
     * A lesson awaiting clinical review does not exist as far as this route is concerned. Not a
     * "coming soon" page, which would be an invitation to guess at what it says.
     */
    if (!lesson) notFound();

    const { state, chosen } = await loadTree();
    const keys = [...chosen.keys()];
    if (!canOpen(key, keys)) {
      const tier = state.tiers.find((t) => t.tier === lesson.tier);
      return (
        <div className="page">
          <PageHeader eyebrow="The Knowledge Tree" title={lesson.title} />
          <Notice tone="amber">
            This one is in {tier ? tier.name : "a later tier"}, which opens once the tier before it has been read. Nothing is
            lost by taking them in order.
          </Notice>
          <div className="mt-4">
            <Link href="/quest/tree" className="btn btn-secondary">
              Back to the tree
            </Link>
          </div>
        </div>
      );
    }

    const sp = await searchParams;
    const already = chosen.get(key);
    const picked = sp.a !== undefined ? Number(sp.a) : already;
    const answered = picked !== undefined && Number.isInteger(picked) && picked >= 0 && picked < lesson.check.options.length;
    const info = TIER_INFO[lesson.tier];

    /* What to offer next, so the tree reads as a path rather than a list to come back to. */
    const after = treeState(answered ? [...new Set([...keys, key])] : keys).next;

    return (
      <div className="page">
        <PageHeader
          eyebrow={`${info.glyph} ${info.name}`}
          title={lesson.title}
          action={
            <Link href="/quest/tree" className="btn btn-secondary btn-sm">
              The tree
            </Link>
          }
        />

        <article className="card p-5 grid gap-3">
          {lesson.body.map((p) => (
            <p key={p} className="prose-measure">
              {p}
            </p>
          ))}
        </article>

        {/* --------------------------------- the check -------------------------------- */}
        <section className="card p-5 mt-4">
          <div className="eyebrow">One question</div>
          <p className="prose-measure mt-1">{lesson.check.question}</p>

          {answered ? (
            <div className="mt-4 grid gap-3">
              <div className="card-sunk p-4">
                <div className="hint">You picked: {lesson.check.options[picked as number].label}</div>
                <p className="prose-measure mt-2">{respondTo(lesson, picked as number)}</p>
              </div>
              <p className="hint prose-measure">
                Nothing here was marked right or wrong. The answer you just read is the lesson; the question was only what
                made you read it.
              </p>
              <div className="flex flex-wrap gap-2">
                {after ? (
                  <Link href={`/quest/tree/${after.key}`} className="btn">
                    Next: {after.title}
                  </Link>
                ) : null}
                <Link href="/quest/tree" className="btn btn-secondary">
                  Back to the tree
                </Link>
              </div>
            </div>
          ) : (
            <form action={answer} className="grid gap-2 mt-4">
              <input type="hidden" name="lesson" value={lesson.key} />
              {lesson.check.options.map((o, i) => (
                <button key={o.label} type="submit" name="chose" value={i} className="tree-option">
                  {o.label}
                </button>
              ))}
            </form>
          )}
        </section>
      </div>
    );
  });
}
