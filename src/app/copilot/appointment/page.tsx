import Link from "next/link";
import { asc, desc, eq, gte } from "drizzle-orm";
import { db, appointments, doctorQuestions } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice } from "@/components/ui";
import { startOfDay, fmtDayLong } from "@/lib/time";
import { sendAndGo } from "../actions";
import { Composer } from "../Composer";

export const dynamic = "force-dynamic";

export default async function AppointmentPrep() {
  return requireAccount(async () => {
  const [next, questions] = await Promise.all([
    db.select().from(appointments).where(gte(appointments.at, startOfDay(new Date()))).orderBy(asc(appointments.at)).limit(1),
    db.select().from(doctorQuestions).where(eq(doctorQuestions.asked, false)).orderBy(desc(doctorQuestions.createdAt)).limit(12),
  ]);
  const appt = next[0];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Prepare for my appointment"
        title="Let's get you ready for the room"
        lede="Appointments are short and it is easy to forget the thing that actually bothered you. Answer a few questions and we will turn them into a brief you can hand over."
      />

      {appt ? (
        <Notice tone="juniper">
          Next appointment: {fmtDayLong(appt.at)} with {appt.withWhom || "your care team"}
          {appt.kind ? ` (${appt.kind})` : ""}.{" "}
          <Link href="/toolkit/appointments" className="underline">
            Build the engine&apos;s own summary from your data
          </Link>
          , which is the numbers half of this.
        </Notice>
      ) : (
        <Notice>
          No appointment saved yet.{" "}
          <Link href="/toolkit/appointments" className="underline">
            Add one
          </Link>{" "}
          so Steady can remind you to prepare.
        </Notice>
      )}

      <Card className="mt-4">
        <Composer
          action={sendAndGo as unknown as (fd: FormData) => Promise<never>}
          mode="appointment"
          placeholder="What has been bothering you most since the last visit?"
          suggestions={[
            "What has been bothering me is my mornings.",
            "Something changed recently and I do not know why.",
            "I want to ask about my medication but do not know how to put it.",
            "I always forget things in the room.",
          ]}
          autoFocus
        />
      </Card>

      {questions.length ? (
        <>
          <h2 className="mt-8 mb-3">Questions already waiting for this visit</h2>
          <div className="grid gap-2">
            {questions.map((q) => (
              <div key={q.id} className="card-quiet p-3">
                <div>{q.text}</div>
                {q.evidence ? <div className="hint mt-1">{q.evidence}</div> : null}
              </div>
            ))}
          </div>
          <Link href="/toolkit/questions" className="btn btn-secondary btn-sm mt-3">
            Manage and print the list
          </Link>
        </>
      ) : null}
    </div>
  );
  });
}
