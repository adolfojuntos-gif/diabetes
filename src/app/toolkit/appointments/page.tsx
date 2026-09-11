/**
 * Appointments, and the brief. The brief is written by the engines from the person's own rows;
 * no model is called and nothing in it interprets a value.
 */
import { revalidatePath } from "next/cache";
import { asc, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { db, appointments, type Appointment } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { parseForm, zLocalDateTime, zStr, zOptStr } from "@/lib/actions";
import { fmtDay, fmtTime, toDateTimeInput, startOfDay, addDays } from "@/lib/time";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, param, type SP } from "../_shared/ui";
import { failTo } from "../_shared/server";
import { CopyButton, PrintButton } from "../_shared/client";
import { buildAppointmentBrief } from "./brief";

const PATH = "/toolkit/appointments";

const idSchema = z.object({ id: zStr(40) });

async function addAppointment(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(
    z.object({
      at: zLocalDateTime,
      withWhom: zStr(120),
      kind: zStr(80),
      location: zStr(160),
      note: zOptStr(1000),
    }),
    fd,
  );
  if ("error" in r) failTo(PATH, r.error);
  await db.insert(appointments).values({
    id: newId(),
    at: r.data.at,
    withWhom: r.data.withWhom,
    kind: r.data.kind,
    location: r.data.location,
    note: r.data.note,
    createdAt: new Date(),
  });
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  revalidatePath("/");
  });
}

async function removeAppointment(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.delete(appointments).where(eq(appointments.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  revalidatePath("/");
  });
}

async function generateBrief(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  const text = await buildAppointmentBrief(new Date());
  await db.update(appointments).set({ brief: text }).where(eq(appointments.id, r.data.id));
  revalidatePath(PATH);
  revalidatePath("/toolkit");
  });
}

async function clearBrief(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(idSchema, fd);
  if ("error" in r) failTo(PATH, r.error);
  await db.update(appointments).set({ brief: null }).where(eq(appointments.id, r.data.id));
  revalidatePath(PATH);
  });
}

function ApptHead({ a }: { a: Appointment }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3>
          {fmtDay(a.at)} at {fmtTime(a.at)}
        </h3>
        <p className="text-sm muted mt-1">
          {[a.withWhom || "Care team", a.kind, a.location].filter(Boolean).join(" · ")}
        </p>
        {a.note ? <p className="text-sm mt-1 prose-measure">{a.note}</p> : null}
      </div>
    </div>
  );
}

function BriefBlock({ a }: { a: Appointment }) {
  if (!a.brief) return null;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2 no-print">
        <span className="eyebrow">Your brief</span>
        <div className="ml-auto flex gap-2">
          <CopyButton text={a.brief} label="Copy" />
          <PrintButton />
          <form action={clearBrief}>
            <input type="hidden" name="id" value={a.id} />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Removing…">
              Remove
            </SubmitButton>
          </form>
        </div>
      </div>
      <pre className="card-sunk p-4 mt-2 text-sm whitespace-pre-wrap font-body overflow-x-auto">{a.brief}</pre>
    </div>
  );
}

export default async function AppointmentsPage({ searchParams }: { searchParams?: SP }) {
  const error = await param(searchParams, "e");
  return requireAccount(async () => {
  const now = new Date();
  const today = startOfDay(now);

  const [upcoming, past] = await Promise.all([
    db.select().from(appointments).where(gte(appointments.at, today)).orderBy(asc(appointments.at)),
    db.select().from(appointments).where(lt(appointments.at, today)).orderBy(desc(appointments.at)).limit(30),
  ]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Toolkit"
        title="Appointments"
        lede="Keep the dates here, then build a brief from your last 30 days so you walk in with the numbers instead of trying to recall them."
      />

      <FormError message={error} />

      <Card className="no-print">
        <h2>Add an appointment</h2>
        <form action={addAppointment} className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="at">
              When
            </label>
            <input
              id="at"
              name="at"
              type="datetime-local"
              className="input"
              required
              defaultValue={toDateTimeInput(addDays(now, 7))}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="withWhom">
              With whom
            </label>
            <input id="withWhom" name="withWhom" className="input" placeholder="Dr Rivera" maxLength={120} />
          </div>
          <div className="field">
            <label className="label" htmlFor="kind">
              Kind of visit
            </label>
            <input id="kind" name="kind" className="input" placeholder="Diabetes review, eye exam, foot check" maxLength={80} />
          </div>
          <div className="field">
            <label className="label" htmlFor="location">
              Location
            </label>
            <input id="location" name="location" className="input" placeholder="Clinic, or a video call" maxLength={160} />
          </div>
          <div className="field md:col-span-2">
            <label className="label" htmlFor="note">
              Note
            </label>
            <textarea id="note" name="note" className="textarea" rows={2} placeholder="Anything you want to remember about this one." />
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingText="Saving…">Save appointment</SubmitButton>
          </div>
        </form>
      </Card>

      <section className="mt-6">
        <h2>Coming up</h2>
        {upcoming.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Nothing booked" body="Add the next one above and the brief will be ready before you go." />
          </div>
        ) : (
          <div className="grid gap-3 mt-3">
            {upcoming.map((a) => (
              <Card key={a.id}>
                <ApptHead a={a} />
                <div className="mt-3 flex flex-wrap gap-2 no-print">
                  <form action={generateBrief}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn btn-secondary btn-sm" pendingText="Building…">
                      {a.brief ? "Rebuild my appointment brief" : "Build my appointment brief"}
                    </SubmitButton>
                  </form>
                  <form action={removeAppointment}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
                <BriefBlock a={a} />
              </Card>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 ? (
        <section className="mt-8">
          <h2>Past</h2>
          <div className="grid gap-3 mt-3">
            {past.map((a) => (
              <Card key={a.id} className="card-quiet">
                <ApptHead a={a} />
                <div className="mt-3 no-print">
                  <form action={removeAppointment}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
                <BriefBlock a={a} />
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-8 no-print">
        <Notice>
          The brief is assembled by the app itself from your own entries. It reports what you logged and what the pattern
          engine counted. It does not interpret a result, name a condition, or say anything about a dose.
        </Notice>
      </div>
    </div>
  );
  });
}
