import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, conversations, messages as messagesTable } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice, EmptyState } from "@/components/ui";
import { getProfile, loadCopilotContext } from "@/lib/data/snapshot";
import { aiAvailable, AI_MODEL } from "@/lib/ai/client";
import { relative } from "@/lib/time";
import { sendAndGo } from "./actions";
import { Composer } from "./Composer";

export const dynamic = "force-dynamic";

const MODES = [
  { mode: "symptoms", href: "/copilot/symptoms", title: "Check my symptoms", body: "A guided walk through what is happening, what your data shows, and whether it needs a professional." },
  { mode: "labs", href: "/toolkit/labs", title: "Explain my labs", body: "Enter your results, verify what was read, and get plain language on what each test measures." },
  { mode: "appointment", href: "/copilot/appointment", title: "Prepare for my appointment", body: "Turn the last month into a brief you can hand over, plus the questions you actually want answered." },
  { mode: "checkin", href: "/copilot/checkin", title: "Daily check-in", body: "Three quick questions, adapted to what you logged today." },
] as const;

export default async function CopilotHome({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const sp = await searchParams;
  return requireAccount(async () => {
  const [profile, ctx, convs] = await Promise.all([
    getProfile(),
    loadCopilotContext(),
    db
      .select({ id: conversations.id, mode: conversations.mode, title: conversations.title, updatedAt: conversations.updatedAt, n: sql<number>`(select count(*) from ${messagesTable} where ${messagesTable.conversationId} = ${conversations.id})` })
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(8),
  ]);

  const attention = ctx.patterns.patterns.filter((p) => p.severity === "attention" || p.severity === "watch").slice(0, 2);
  const suggestions = [
    "My glucose has been weird lately.",
    "Why am I so tired?",
    "My morning numbers are higher than they used to be.",
    "I feel shaky.",
    "What should I eat tonight?",
    "I am exhausted by all of this.",
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Clinical Copilot"
        title="Tell me what's going on."
        lede="Speak plainly. I will ask what I need to know, look at what you have logged, explain what I can and cannot tell from it, and help you decide whether this needs a professional."
      />

      {sp.error ? <p className="error mb-4">{sp.error}</p> : null}

      <Card className="mb-4">
        <Composer action={sendAndGo as unknown as (fd: FormData) => Promise<never>} mode="talk" placeholder="I have been feeling weird lately." suggestions={suggestions} autoFocus />
      </Card>

      <Notice>
        <strong>What I am and am not.</strong> I am a diabetes health assistant and a care-preparation assistant. I am not a doctor or a nurse, no clinician has reviewed anything here, and I never suggest or change a medication or insulin dose. A deterministic safety check runs on every message before I answer, and its verdict sits above whatever I write.
        {!aiAvailable() ? (
          <>
            {" "}
            <strong>No API key is set</strong>, so replies come from this app&apos;s own engine over your real data, clearly labelled. Nothing is faked.
          </>
        ) : (
          <> Running on {AI_MODEL}.</>
        )}
      </Notice>

      <h2 className="mt-8 mb-3">Or start something specific</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => (
          <Link key={m.mode} href={m.href} className="card p-4 hover:shadow-[var(--shadow-lift)] transition-shadow">
            <h3>{m.title}</h3>
            <p className="muted text-sm mt-1">{m.body}</p>
          </Link>
        ))}
      </div>

      {attention.length ? (
        <>
          <h2 className="mt-8 mb-3">Things I would ask you about</h2>
          <div className="grid gap-3">
            {attention.map((p) => (
              <Card key={p.key} className={`sev-${p.severity}`}>
                <h3>{p.title}</h3>
                <p className="text-sm mt-1">{p.evidence}</p>
                <form action={sendAndGo} className="mt-3">
                  <input type="hidden" name="mode" value="talk" />
                  <input type="hidden" name="body" value={`Can we talk about this: ${p.title}. ${p.evidence}`} />
                  <button className="btn btn-secondary btn-sm">Talk about this</button>
                </form>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="mt-8 mb-3">Earlier conversations</h2>
      {convs.length === 0 ? (
        <EmptyState title="Nothing yet" body="Whatever you start above will be here afterwards, so you can pick it back up." />
      ) : (
        <div className="grid gap-2">
          {convs.map((c) => (
            <Link key={c.id} href={`/copilot/${c.id}`} className="card-quiet p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate">{c.title || "Conversation"}</div>
                <div className="hint">
                  {c.mode === "symptoms" ? "Symptom check" : c.mode === "labs" ? "Labs" : c.mode === "appointment" ? "Appointment prep" : c.mode === "checkin" ? "Check-in" : "Conversation"} · {c.n} messages · {relative(c.updatedAt)}
                </div>
              </div>
              <span className="faint">→</span>
            </Link>
          ))}
        </div>
      )}

      <p className="hint mt-8 prose-measure">
        Your data stays on this device. When an API key is set, the text of your message and a summary the engine writes from your numbers are sent to the model to compose a reply. Your raw readings are never uploaded. Profile: {profile.copilotStyle} language, targets {profile.targetLowMgdl} to {profile.targetHighMgdl} mg/dL.
      </p>
    </div>
  );
  });
}
