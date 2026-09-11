/**
 * The inbox. Every item was written by an engine from the person's own rows: no item is a
 * recommendation, and none of them can change a dose.
 */
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, nudges, type Nudge, type NudgeKind } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { inbox, refreshDerived } from "@/lib/data/nudges";
import { parseForm, zStr } from "@/lib/actions";
import { relative } from "@/lib/time";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, param, type SP } from "../_shared/ui";
import { failTo } from "../_shared/server";

const PATH = "/toolkit/inbox";

const KIND_LABEL: Record<NudgeKind, string> = {
  pattern: "Pattern",
  gap: "Gap",
  win: "Win",
  safety: "Safety",
  reminder: "Reminder",
};

/** Safety is a safety level, win is a glucose-adjacent good thing. Nothing else gets colour. */
function kindPillClass(kind: NudgeKind): string {
  if (kind === "safety") return "pill pill-coral";
  if (kind === "win") return "pill pill-juniper";
  return "pill";
}

const idSchema = z.object({ id: zStr(40) });

async function markRead(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(nudges).set({ readAt: new Date() }).where(eq(nudges.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  revalidatePath("/");
  });
}

async function dismiss(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  const now = new Date();
  await db.update(nudges).set({ dismissedAt: now, readAt: now }).where(eq(nudges.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  revalidatePath("/");
  });
}

async function markAllRead() {
  "use server";
  return requireAccount(async () => {
  await db
    .update(nudges)
    .set({ readAt: new Date() })
    .where(and(isNull(nudges.dismissedAt), isNull(nudges.readAt)));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  revalidatePath("/");
  });
}

function NudgeRow({ n }: { n: Nudge }) {
  return (
    <article className={`card p-4 ${n.readAt ? "" : "sev-info"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={kindPillClass(n.kind)}>{KIND_LABEL[n.kind]}</span>
        {!n.readAt ? <span className="pill">New</span> : null}
        <span className="hint ml-auto">{relative(n.createdAt)}</span>
      </div>
      <h3 className="mt-2">{n.title}</h3>
      <p className="text-sm mt-1 prose-measure">{n.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {n.href ? (
          <Link href={n.href} className="btn btn-secondary btn-sm">
            Look at this
          </Link>
        ) : null}
        {!n.readAt ? (
          <form action={markRead}>
            <input type="hidden" name="id" value={n.id} />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Marking…">
              Mark read
            </SubmitButton>
          </form>
        ) : null}
        <form action={dismiss}>
          <input type="hidden" name="id" value={n.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Dismissing…">
            Dismiss
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}

function Group({ title, items, note }: { title: string; items: Nudge[]; note?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h2>{title}</h2>
      {note ? <p className="muted text-sm mt-1 prose-measure">{note}</p> : null}
      <div className="grid gap-3 mt-3">
        {items.map((n) => (
          <NudgeRow key={n.id} n={n} />
        ))}
      </div>
    </section>
  );
}

export default async function InboxPage({ searchParams }: { searchParams?: SP }) {
  const error = await param(searchParams, "e");
  return requireAccount(async () => {
  await refreshDerived();
  const items = await inbox(60);

  const attention = items.filter((n) => n.kind === "safety");
  const patterns = items.filter((n) => n.kind === "pattern");
  const wins = items.filter((n) => n.kind === "win");
  const small = items.filter((n) => n.kind === "gap" || n.kind === "reminder");
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Inbox"
        lede="Everything here was worked out from the readings, meals, movement and notes you logged yourself. Nothing was added from outside your data."
        action={
          unread > 0 ? (
            <form action={markAllRead} className="no-print">
              <SubmitButton className="btn btn-secondary" pendingText="Marking…">
                Mark all read
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <FormError message={error} />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="When you have logged a few days, the engines start noticing things here: a pattern, a gap in the log, or something that went well."
          cta="Log a reading"
          href="/log"
        />
      ) : (
        <>
          <Group
            title="Needs attention"
            items={attention}
            note="These come from the deterministic safety rules, not from a model. They point at something worth telling your care team."
          />
          <Group title="Patterns" items={patterns} note="Repeated things in your numbers, with the sample size they were counted from." />
          <Group title="Wins" items={wins} />
          <Group title="Small gaps" items={small} note="Missing pieces in the log, and reminders you asked for." />
        </>
      )}

      <div className="mt-8">
        <Card>
          <h3>Where these come from</h3>
          <p className="text-sm mt-1 prose-measure">
            The pattern engine runs over your last 14 days each time you open this screen, and writes one item per finding per
            week so the same thing does not repeat. Dismissing an item removes it from the list. It does not change your data.
          </p>
          <div className="mt-3">
            <Notice>No item in this inbox can suggest a dose, a medication change, or a diagnosis.</Notice>
          </div>
        </Card>
      </div>
    </div>
  );
  });
}
