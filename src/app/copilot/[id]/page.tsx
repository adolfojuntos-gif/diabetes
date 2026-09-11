import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, conversations, messages as messagesTable, aiAudit, type TriageLevel } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice } from "@/components/ui";
import { ACTION_TEXT, type TriageAction } from "@/lib/engines/triage";
import { knowledgeById, KNOWLEDGE_VERSION } from "@/lib/knowledge/clinical";
import { medicationById } from "@/lib/knowledge/medications";
import { fmtTime, fmtDay } from "@/lib/time";
import { sendAndGo, deleteConversation, confirmMemoryFromReply } from "../actions";
import { Composer } from "../Composer";

export const dynamic = "force-dynamic";

const LEVEL_LABEL: Record<TriageLevel, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  clinic: "For your care team",
  general: "General information",
};

type Meta = { followUps?: string[]; category?: string; knowledgeUsed?: string[]; responder?: string; triageReasons?: string[]; triageActions?: TriageAction[] };

function parseMeta(s: string | null): Meta {
  if (!s) return {};
  try {
    return JSON.parse(s) as Meta;
  } catch {
    return {};
  }
}

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return requireAccount(async () => {
  const conv = (await db.select().from(conversations).where(eq(conversations.id, id)).limit(1))[0];
  if (!conv) notFound();
  const [msgs, audits] = await Promise.all([
    db.select().from(messagesTable).where(eq(messagesTable.conversationId, id)).orderBy(asc(messagesTable.createdAt)),
    db.select().from(aiAudit).where(eq(aiAudit.conversationId, id)).orderBy(asc(aiAudit.at)),
  ]);

  const modeLabel =
    conv.mode === "symptoms" ? "Symptom check" : conv.mode === "labs" ? "Labs" : conv.mode === "appointment" ? "Appointment prep" : conv.mode === "checkin" ? "Daily check-in" : "Conversation";
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const lastMeta = parseMeta(lastAssistant?.meta ?? null);
  const anyFiltered = audits.some((a) => a.filtered);

  return (
    <div className="page">
      <PageHeader
        eyebrow={modeLabel}
        title={conv.title || "Conversation"}
        action={
          <div className="flex gap-2">
            <Link href="/copilot" className="btn btn-secondary btn-sm">
              All conversations
            </Link>
            <form action={deleteConversation}>
              <input type="hidden" name="id" value={conv.id} />
              <button className="btn btn-danger btn-sm">Delete</button>
            </form>
          </div>
        }
      />

      <div className="grid gap-4 prose-measure">
        {msgs.map((m) => {
          const meta = parseMeta(m.meta);
          if (m.role === "user") {
            return (
              <div key={m.id} className="justify-self-end max-w-[90%]">
                <div className="card-sunk px-4 py-3">{m.body}</div>
                <div className="hint text-right mt-1">
                  {fmtDay(m.createdAt)} {fmtTime(m.createdAt)}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id}>
              {m.triageLevel && m.triageLevel !== "general" ? (
                <div className={`triage triage-${m.triageLevel} mb-2`} role={m.triageLevel === "emergency" || m.triageLevel === "urgent" ? "alert" : "status"}>
                  <div className="eyebrow" style={{ color: "inherit", opacity: 0.8 }}>
                    Safety check: {LEVEL_LABEL[m.triageLevel]}
                  </div>
                  {meta.triageReasons?.length ? (
                    <ul className="mt-1 text-sm list-disc pl-5">
                      {meta.triageReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                  {meta.triageActions?.length ? (
                    <div className="mt-2 grid gap-2">
                      {meta.triageActions.map((a) => (
                        <div key={a} className="rounded-lg px-3 py-2 text-sm" style={{ background: "rgb(255 255 255 / 0.25)" }}>
                          {ACTION_TEXT[a]}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <article className="card p-4" style={{ borderLeft: "3px solid var(--slate)" }}>
                <div className="eyebrow mb-2" style={{ color: "var(--slate)" }}>
                  Copilot {meta.responder === "engine" ? "· engine reply" : ""}
                </div>
                {m.body.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className={i ? "mt-3" : ""}>
                    {para}
                  </p>
                ))}
                {meta.knowledgeUsed?.length ? (
                  <details className="mt-3">
                    <summary className="hint cursor-pointer">Where this came from ({meta.knowledgeUsed.length} source{meta.knowledgeUsed.length === 1 ? "" : "s"})</summary>
                    <ul className="mt-2 grid gap-2">
                      {meta.knowledgeUsed.map((k) => {
                        if (k.startsWith("med:")) {
                          const med = medicationById(k.slice(4));
                          if (!med) return null;
                          return (
                            <li key={k} className="card-quiet p-3 text-sm">
                              <strong>{med.displayName}</strong> · {med.drugClass}
                              <div className="hint mt-1">
                                {med.source} · v{med.version} · reviewed {med.reviewDate} · status: {med.reviewStatus.replace(/_/g, " ")}
                              </div>
                            </li>
                          );
                        }
                        const item = knowledgeById(k);
                        if (!item) return null;
                        return (
                          <li key={k} className="card-quiet p-3 text-sm">
                            <strong>{item.topic}</strong>
                            <div className="mt-1">{item.statement}</div>
                            <div className="hint mt-1">
                              {item.source} · {item.sourceType} · written {item.updated} · status: {item.reviewStatus.replace(/_/g, " ")}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="hint mt-2">Knowledge base v{KNOWLEDGE_VERSION}.</div>
                  </details>
                ) : null}
                <div className="hint mt-3">
                  {fmtDay(m.createdAt)} {fmtTime(m.createdAt)}
                </div>
              </article>
            </div>
          );
        })}
      </div>

      {lastMeta.followUps?.length ? (
        <div className="mt-5 prose-measure">
          <div className="eyebrow mb-2">The Copilot would like to know</div>
          <div className="grid gap-2">
            {lastMeta.followUps.map((q) => (
              <form key={q} action={sendAndGo} className="card-quiet p-3 flex items-center justify-between gap-3">
                <input type="hidden" name="mode" value={conv.mode} />
                <input type="hidden" name="conversationId" value={conv.id} />
                <input type="hidden" name="body" value={q} />
                <span className="text-sm">{q}</span>
                <button className="btn btn-ghost btn-sm shrink-0">Answer</button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 prose-measure">
        <Card>
          <Composer action={sendAndGo as unknown as (fd: FormData) => Promise<never>} mode={conv.mode} conversationId={conv.id} placeholder="Add more, or ask something else." />
        </Card>
      </div>

      {lastAssistant ? (
        <form action={confirmMemoryFromReply} className="mt-4 prose-measure">
          <input type="hidden" name="text" value={lastAssistant.body.slice(0, 280)} />
          <button className="btn btn-ghost btn-sm">That matches what I see. Remember it.</button>
        </form>
      ) : null}

      {anyFiltered ? (
        <div className="mt-6 prose-measure">
          <Notice tone="amber">
            Part of a reply in this conversation read like dosing advice, so this app replaced it with a pointer to your prescriber. That is recorded in the audit log.
          </Notice>
        </div>
      ) : null}

      <details className="mt-6 prose-measure">
        <summary className="hint cursor-pointer">Audit log for this conversation ({audits.length} response{audits.length === 1 ? "" : "s"})</summary>
        <div className="grid gap-2 mt-2">
          {audits.map((a) => (
            <div key={a.id} className="card-quiet p-3 text-xs faint">
              <div>
                {fmtDay(a.at)} {fmtTime(a.at)} · mode {a.mode} · level <strong>{a.triageLevel}</strong> · answered by {a.responder}
                {a.model ? ` (${a.model})` : ""} {a.filtered ? "· dose language filtered" : ""}
              </div>
              <div className="mt-1">Data consulted: {(JSON.parse(a.dataAccessed) as string[]).join(", ")}</div>
              <div>Knowledge: {(JSON.parse(a.knowledgeUsed) as string[]).join(", ") || "none"}</div>
              <div>Safety rules fired: {(JSON.parse(a.safetyRules) as string[]).join(", ") || "none"}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
  });
}
