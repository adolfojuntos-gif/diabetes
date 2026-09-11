/**
 * What Steady knows about you. memory_facts is the only memory the Copilot has, so this screen is
 * the whole of it: readable, correctable, deletable.
 */
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, memoryFacts, MEMORY_KINDS, type MemoryFact, type MemoryKind } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { parseForm, zStr, zOptStr } from "@/lib/actions";
import { fmtDay } from "@/lib/time";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, param, type SP } from "../_shared/ui";
import { failTo } from "../_shared/server";

const PATH = "/toolkit/memory";

const KIND_HEADING: Record<MemoryKind, string> = {
  pattern: "Patterns in your data",
  question_asked: "Things you have asked",
  goal: "Your goals",
  preferred_food: "Foods you prefer",
  routine: "Your routines",
  appointment_summary: "Appointment summaries",
  confirmed_observation: "Things you confirmed",
  note: "Your notes",
};

const OWN_KINDS = ["goal", "preferred_food", "routine", "note"] as const;
const OWN_KIND_LABEL: Record<(typeof OWN_KINDS)[number], string> = {
  goal: "A goal of mine",
  preferred_food: "A food I like",
  routine: "A routine of mine",
  note: "A note",
};

const SOURCE_LABEL: Record<MemoryFact["source"], string> = {
  engine: "worked out by the engine",
  user: "written by you",
  copilot: "noted from a Copilot conversation",
};

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("-")
    .slice(0, 60);
}

/* ------------------------------- actions ------------------------------- */

async function confirmFact(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(memoryFacts).set({ confirmed: true, lastSeen: new Date() }).where(eq(memoryFacts.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function deleteFact(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.delete(memoryFacts).where(eq(memoryFacts.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function editFact(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40), text: zStr(500), evidence: zOptStr(500) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  if (r.data.text.trim().length < 2) failTo(PATH, "The fact needs some words in it.");
  await db
    .update(memoryFacts)
    .set({ text: r.data.text.trim(), evidence: r.data.evidence, lastSeen: new Date() })
    .where(eq(memoryFacts.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function addFact(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ kind: z.enum(OWN_KINDS), text: zStr(500) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  const text = r.data.text.trim();
  if (text.length < 2) failTo(PATH, "Write the fact out so the Copilot can use it.");
  const now = new Date();
  await db
    .insert(memoryFacts)
    .values({
      id: newId(),
      kind: r.data.kind,
      key: slug(text) || newId(),
      text,
      evidence: null,
      source: "user",
      confirmed: true,
      firstSeen: now,
      lastSeen: now,
      timesSeen: 1,
    })
    .onConflictDoNothing();
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

/* -------------------------------- pieces -------------------------------- */

function FactRow({ f }: { f: MemoryFact }) {
  const editable = f.source === "user";
  return (
    <article className="divider py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="prose-measure">{f.text}</p>
        {f.confirmed ? <span className="pill pill-juniper shrink-0">You confirmed this</span> : null}
      </div>
      {f.evidence ? <p className="text-sm muted mt-1 prose-measure">{f.evidence}</p> : null}
      <p className="hint mt-1">
        First seen {fmtDay(f.firstSeen)}. Last seen {fmtDay(f.lastSeen)}. Seen {f.timesSeen} time
        {f.timesSeen === 1 ? "" : "s"}. Source: {SOURCE_LABEL[f.source]}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {f.confirmed ? null : (
          <form action={confirmFact}>
            <input type="hidden" name="id" value={f.id} />
            <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
              That&rsquo;s right
            </SubmitButton>
          </form>
        )}
        <form action={deleteFact}>
          <input type="hidden" name="id" value={f.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
            Not true
          </SubmitButton>
        </form>
      </div>
      {editable ? (
        <details className="mt-2">
          <summary className="hint cursor-pointer">Edit this</summary>
          <form action={editFact} className="mt-2 grid gap-2">
            <input type="hidden" name="id" value={f.id} />
            <div className="field">
              <label className="label" htmlFor={`text-${f.id}`}>
                The fact
              </label>
              <textarea id={`text-${f.id}`} name="text" className="textarea" rows={2} defaultValue={f.text} />
            </div>
            <div className="field">
              <label className="label" htmlFor={`ev-${f.id}`}>
                Anything that backs it up (optional)
              </label>
              <input id={`ev-${f.id}`} name="evidence" className="input" defaultValue={f.evidence ?? ""} maxLength={500} />
            </div>
            <div>
              <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
        </details>
      ) : null}
    </article>
  );
}

/* --------------------------------- page --------------------------------- */

export default async function MemoryPage({ searchParams }: { searchParams?: SP }) {
  const error = await param(searchParams, "e");
  return requireAccount(async () => {
  const facts = await db.select().from(memoryFacts).orderBy(desc(memoryFacts.lastSeen));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="What Steady knows about you"
        lede="This list is the whole of it. The Copilot is handed this table and nothing else, so what is written here is what it can know."
      />

      <FormError message={error} />

      <Card>
        <p className="prose-measure">
          Every fact below names where it came from: the pattern engine, a Copilot conversation, or you. You can correct any
          of it and you can delete any of it. Deleting a fact means the Copilot stops knowing it, from the next message
          onwards. Facts the engine works out from your readings can come back if the same pattern shows up again in your
          data.
        </p>
      </Card>

      {facts.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing written down yet"
            body="Once you have logged a few days, the pattern engine starts writing what it notices here. You can also add facts of your own below."
          />
        </div>
      ) : (
        <div className="grid gap-3 mt-6">
          {MEMORY_KINDS.map((kind) => {
            const inKind = facts.filter((f) => f.kind === kind);
            if (inKind.length === 0) return null;
            return (
              <Card key={kind}>
                <h2>{KIND_HEADING[kind]}</h2>
                <div className="mt-2">
                  {inKind.map((f) => (
                    <FactRow key={f.id} f={f} />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6">
        <h2>Add something yourself</h2>
        <p className="text-sm muted mt-1 prose-measure">
          Anything you write here is handed to the Copilot as a fact about you, so keep it to things you want it to remember.
        </p>
        <form action={addFact} className="mt-3 grid gap-3">
          <div className="field md:max-w-xs">
            <label className="label" htmlFor="fact-kind">
              What kind of thing is it
            </label>
            <select id="fact-kind" name="kind" className="select" defaultValue="note">
              {OWN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {OWN_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="fact-text">
              The fact
            </label>
            <textarea
              id="fact-text"
              name="text"
              className="textarea"
              rows={2}
              required
              placeholder="I walk the dog after dinner most evenings."
            />
          </div>
          <div>
            <SubmitButton pendingText="Saving…">Remember this</SubmitButton>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        <Notice>
          Steady keeps no other memory of you. There is no profile built somewhere else, no history the Copilot can reach
          that is not on this page, and nothing here is shared with anyone unless you create a caregiver link yourself.
        </Notice>
      </div>
    </div>
  );
  });
}
