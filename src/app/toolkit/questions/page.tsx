/**
 * Questions to ask the doctor. The engine writes some of these from patterns, with the numbers
 * attached; the rest you write yourself. Nothing here is an answer.
 */
import { revalidatePath } from "next/cache";
import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, doctorQuestions, type DoctorQuestion } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { STANDING_QUESTIONS } from "@/lib/engines/doctorQuestions";
import { newId } from "@/lib/ids";
import { parseForm, zStr, zOptStr } from "@/lib/actions";
import { fmtDay } from "@/lib/time";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, FormNote, param, type SP } from "../_shared/ui";
import { failTo, noteTo } from "../_shared/server";
import { PrintButton } from "../_shared/client";

const PATH = "/toolkit/questions";

const idSchema = z.object({ id: zStr(40) });

async function addQuestion(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ text: zStr(500) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  const text = r.data.text.trim();
  if (text.length < 4) failTo(PATH, "Write the question out so it still makes sense at the appointment.");
  await db.insert(doctorQuestions).values({ id: newId(), text, evidence: null, source: "manual", createdAt: new Date() });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function markAsked(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(doctorQuestions).set({ asked: true }).where(eq(doctorQuestions.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function reopen(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(doctorQuestions).set({ asked: false }).where(eq(doctorQuestions.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function saveAnswer(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(z.object({ id: zStr(40), answer: zOptStr(2000) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  await db
    .update(doctorQuestions)
    .set({ answer: r.data.answer, asked: r.data.answer ? true : undefined })
    .where(eq(doctorQuestions.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function removeQuestion(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.delete(doctorQuestions).where(eq(doctorQuestions.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

/** Add the standing questions that are not already on the list, matched on their pattern key. */
async function suggestFromMyData() {
  "use server";
  return requireAccount(async () => {
  const existing = await db
    .select({ patternKey: doctorQuestions.patternKey })
    .from(doctorQuestions)
    .where(isNotNull(doctorQuestions.patternKey));
  const have = new Set(existing.map((r) => r.patternKey));
  const missing = STANDING_QUESTIONS.filter((q) => q.patternKey && !have.has(q.patternKey));
  const now = new Date();
  for (const q of missing) {
    await db
      .insert(doctorQuestions)
      .values({ id: newId(), text: q.text, evidence: q.evidence, source: "pattern", patternKey: q.patternKey, createdAt: now })
      .onConflictDoNothing();
  }
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  noteTo(
    PATH,
    missing.length === 0
      ? "Every standing question is already on your list."
      : `Added ${missing.length} question${missing.length === 1 ? "" : "s"}. Pattern questions appear on their own as the engine finds them.`,
  );
  });
}

function QuestionCard({ q }: { q: DoctorQuestion }) {
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="prose-measure">{q.text}</p>
        <span className="pill shrink-0">{q.source === "pattern" ? "From your data" : "Yours"}</span>
      </div>
      {q.evidence ? <p className="text-sm muted mt-2 prose-measure">{q.evidence}</p> : null}
      {q.answer ? (
        <div className="card-sunk p-3 mt-3">
          <div className="eyebrow">What you were told</div>
          <p className="text-sm mt-1 whitespace-pre-wrap">{q.answer}</p>
        </div>
      ) : null}

      <div className="no-print mt-3 flex flex-wrap items-center gap-2">
        {q.asked ? (
          <form action={reopen}>
            <input type="hidden" name="id" value={q.id} />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…">
              Still to ask
            </SubmitButton>
          </form>
        ) : (
          <form action={markAsked}>
            <input type="hidden" name="id" value={q.id} />
            <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
              Mark as asked
            </SubmitButton>
          </form>
        )}
        <form action={removeQuestion}>
          <input type="hidden" name="id" value={q.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
            Delete
          </SubmitButton>
        </form>
        <span className="hint ml-auto">Added {fmtDay(q.createdAt)}</span>
      </div>

      <form action={saveAnswer} className="no-print mt-3">
        <input type="hidden" name="id" value={q.id} />
        <div className="field">
          <label className="label" htmlFor={`answer-${q.id}`}>
            What they said
          </label>
          <textarea
            id={`answer-${q.id}`}
            name="answer"
            className="textarea"
            rows={2}
            defaultValue={q.answer ?? ""}
            placeholder="Write it down while you remember it."
          />
        </div>
        <div className="mt-2">
          <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
            Save the answer
          </SubmitButton>
        </div>
      </form>
    </article>
  );
}

export default async function QuestionsPage({ searchParams }: { searchParams?: SP }) {
  const [error, note] = await Promise.all([param(searchParams, "e"), param(searchParams, "m")]);
  return requireAccount(async () => {
  const rows = await db.select().from(doctorQuestions).orderBy(asc(doctorQuestions.asked), desc(doctorQuestions.createdAt));
  const open = rows.filter((q) => !q.asked);
  const asked = rows.filter((q) => q.asked);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Questions for your doctor"
        lede="Questions arrive here with the numbers that prompted them, so you are not trying to remember the evidence in the room."
        action={
          <div className="no-print flex gap-2">
            <form action={suggestFromMyData}>
              <SubmitButton className="btn btn-secondary" pendingText="Adding…">
                Suggest from my data
              </SubmitButton>
            </form>
            <PrintButton label="Print list" className="btn btn-secondary" />
          </div>
        }
      />

      <FormError message={error} />
      <FormNote message={note} />

      <Card className="no-print">
        <form action={addQuestion}>
          <div className="field">
            <label className="label" htmlFor="new-question">
              Add your own question
            </label>
            <textarea
              id="new-question"
              name="text"
              className="textarea"
              rows={2}
              required
              placeholder="Something you want to remember to ask."
            />
          </div>
          <div className="mt-3">
            <SubmitButton pendingText="Adding…">Add question</SubmitButton>
          </div>
        </form>
      </Card>

      <section className="mt-6">
        <h2>Still to ask{open.length ? ` (${open.length})` : ""}</h2>
        {open.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No open questions"
              body="Add one above, or use Suggest from my data for the standing questions most people want answered at some point."
            />
          </div>
        ) : (
          <div className="grid gap-3 mt-3">
            {open.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>
        )}
      </section>

      {asked.length > 0 ? (
        <section className="mt-8">
          <h2>Already asked</h2>
          <div className="grid gap-3 mt-3">
            {asked.map((q) => (
              <QuestionCard key={q.id} q={q} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-8 no-print">
        <Notice>
          Steady writes the question, never the answer. If something here needs a decision about a medicine or a dose, that
          decision belongs to the person prescribing it.
        </Notice>
      </div>
    </div>
  );
  });
}
