import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  symptomLogs,
  weightLogs,
  bloodPressureLogs,
  medications,
  medicationTaken,
  SYMPTOMS,
  type Symptom,
} from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm, zLocalDateTime, zNum, zOptNum, zOptStr, zStr } from "@/lib/actions";
import { fmtDay, fmtTime, toDateTimeInput } from "@/lib/time";
import { newId } from "@/lib/ids";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { ActionForm, DeleteButton } from "../ActionForm";
import { deleteSymptom, deleteWeight, deleteBloodPressure, deleteMedicationTaken, archiveMedication } from "../actions";
import { revalidateLog } from "../revalidate";
import { SYMPTOM_LABEL, SEVERITY_LABEL } from "../labels";
import type { LogResult } from "../types";

const LB_PER_KG = 0.45359237;

/* ------------------------------ symptoms ------------------------------ */

const SymptomForm = z.object({ at: zLocalDateTime, severity: zNum(1, 3), note: zOptStr(500) });

async function logSymptoms(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const picked = z
    .array(z.enum(SYMPTOMS))
    .min(1)
    .safeParse(fd.getAll("symptoms[]").map(String));
  if (!picked.success) return fail("Choose at least one symptom, or tick Something else and write it in the note.");

  const parsed = parseForm(SymptomForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  const { at, severity, note } = parsed.data;

  const unique = [...new Set(picked.data)];
  const id = newId();
  try {
    await db.insert(symptomLogs).values({
      id,
      at,
      symptoms: unique.join(","),
      severity: Math.round(severity),
      note,
      createdAt: new Date(),
    });
  } catch {
    return fail("Could not save that. Please try again.");
  }

  revalidateLog("/log/more", "/copilot");
  return {
    ok: true,
    id,
    message: `Written down: ${unique.map((s) => SYMPTOM_LABEL[s].toLowerCase()).join(", ")} at ${fmtTime(at)}.`,
    copilot: {
      mode: "symptoms",
      text: "If you want to go through this properly, the Copilot will ask you a few questions and tell you what the safety rules say.",
      cta: "Talk this through with the Copilot",
    },
  };
  });
}

/* ------------------------------- weight ------------------------------- */

const WeightForm = z.object({ at: zLocalDateTime, kg: zOptNum(10, 500), lb: zOptNum(20, 1100) });

async function logWeight(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(WeightForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  const { at, kg, lb } = parsed.data;
  if (kg === null && lb === null) return fail("Fill in either the kilograms box or the pounds box.");

  const finalKg = kg !== null ? kg : Math.round(lb! * LB_PER_KG * 100) / 100;
  const id = newId();
  try {
    await db.insert(weightLogs).values({ id, at, kg: finalKg, createdAt: new Date() });
  } catch {
    return fail("Could not save that. Please try again.");
  }
  revalidateLog("/log/more", "/trends", "/review");
  return {
    ok: true,
    id,
    message: `Saved ${finalKg} kg (${Math.round((finalKg / LB_PER_KG) * 10) / 10} lb) for ${fmtDay(at)}.`,
  };
  });
}

/* --------------------------- blood pressure --------------------------- */

const BpForm = z.object({ at: zLocalDateTime, systolic: zNum(50, 300), diastolic: zNum(20, 200), pulse: zOptNum(20, 250) });

async function logBloodPressure(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(BpForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  const { at, systolic, diastolic, pulse } = parsed.data;
  if (diastolic >= systolic) return fail("The top number is usually the higher of the two. Check which way round they are.");

  const id = newId();
  try {
    await db.insert(bloodPressureLogs).values({
      id,
      at,
      systolic: Math.round(systolic),
      diastolic: Math.round(diastolic),
      pulse: pulse === null ? null : Math.round(pulse),
      createdAt: new Date(),
    });
  } catch {
    return fail("Could not save that. Please try again.");
  }
  revalidateLog("/log/more", "/review");
  return { ok: true, id, message: `Saved ${Math.round(systolic)} over ${Math.round(diastolic)} at ${fmtTime(at)}.` };
  });
}

/* ----------------------------- medications ---------------------------- */

const MedForm = z.object({
  name: zStr(120).min(1, "what is it called"),
  /** The person's own words. Stored exactly as typed: never parsed, never corrected. */
  doseText: z.string(),
  startedOn: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use the date picker")])
    .optional()
    .transform((v) => (v ? v : null)),
});

async function addMedication(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(MedForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  const { name, doseText, startedOn } = parsed.data;
  const id = newId();
  try {
    await db.insert(medications).values({ id, name, doseText, startedOn, active: true, createdAt: new Date() });
  } catch {
    return fail("Could not add that. Please try again.");
  }
  revalidateLog("/log/more", "/copilot", "/toolkit");
  return { ok: true, id, message: `Added ${name}. Your wording is kept exactly as you typed it.` };
  });
}

const TakeForm = z.object({ id: z.string().min(1).max(40) });

async function takeMedication(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(TakeForm, fd);
  if ("error" in parsed) return fail(parsed.error);
  const med = await db.select({ id: medications.id, name: medications.name }).from(medications).where(eq(medications.id, parsed.data.id)).limit(1);
  if (med.length === 0) return fail("That medication is no longer on your list.");

  const now = new Date();
  try {
    await db.insert(medicationTaken).values({ id: newId(), medicationId: med[0].id, at: now });
  } catch {
    return fail("Could not write that down. Please try again.");
  }
  revalidateLog("/log/more");
  return { ok: true, message: `${med[0].name} written down at ${fmtTime(now)}.` };
  });
}

/* -------------------------------- screen ------------------------------- */

export default async function LogMorePage() {
  return requireAccount(async () => {
  const now = new Date();
  const whenDefault = toDateTimeInput(now);

  const [symptomRows, weightRows, bpRows, meds, takenRows] = await Promise.all([
    db.select().from(symptomLogs).orderBy(desc(symptomLogs.at)).limit(10),
    db.select().from(weightLogs).orderBy(desc(weightLogs.at)).limit(10),
    db.select().from(bloodPressureLogs).orderBy(desc(bloodPressureLogs.at)).limit(10),
    db.select().from(medications).where(eq(medications.active, true)).orderBy(desc(medications.createdAt)),
    db.select().from(medicationTaken).orderBy(desc(medicationTaken.at)).limit(10),
  ]);

  const medName = new Map(meds.map((m) => [m.id, m.name]));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Log"
        title="Everything else"
        lede="Symptoms, weight, blood pressure and your medications, all on one page so you are not hunting for the right screen."
      />

      {/* ------------------------------ symptoms ------------------------------ */}
      <section id="symptoms" className="mb-10 scroll-mt-6">
        <h2 className="mb-3">How you are feeling</h2>
        <Card>
          <ActionForm action={logSymptoms} pendingText="Writing it down…">
            <fieldset className="field">
              <legend className="label">What are you noticing</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {SYMPTOMS.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="symptoms[]" value={s} />
                    {SYMPTOM_LABEL[s]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="field">
                <legend className="label">How strong</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {[1, 2, 3].map((v) => (
                    <label key={v} className="pill cursor-pointer">
                      <input type="radio" name="severity" value={v} defaultChecked={v === 2} /> {SEVERITY_LABEL[v]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <label className="label" htmlFor="sym-at">
                  When
                </label>
                <input id="sym-at" name="at" type="datetime-local" className="input" defaultValue={whenDefault} required />
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="sym-note">
                Anything you want to add
              </label>
              <textarea id="sym-note" name="note" className="textarea" rows={2} maxLength={500} placeholder="Started about an hour after lunch" />
            </div>

            <div>
              <SubmitButton className="btn btn-lg">Write it down</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="mt-4">
          {symptomRows.length === 0 ? (
            <EmptyState title="Nothing written down yet" body="What you note here is what the Copilot's safety rules look at when you ask it about symptoms." />
          ) : (
            <ul className="card divide-y">
              {symptomRows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                  <div className="w-28 shrink-0">
                    <div className="text-sm">{fmtDay(r.at)}</div>
                    <div className="hint num">{fmtTime(r.at)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      {r.symptoms
                        .split(",")
                        .map((s) => SYMPTOM_LABEL[s.trim() as Symptom] ?? s.trim())
                        .join(", ")}
                    </div>
                    <div className="hint">{SEVERITY_LABEL[r.severity] ?? "Moderate"}</div>
                    {r.note ? <div className="hint truncate">{r.note}</div> : null}
                  </div>
                  <DeleteButton action={deleteSymptom} id={r.id} what="symptom note" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ------------------------------- weight ------------------------------- */}
      <section id="weight" className="mb-10 scroll-mt-6">
        <h2 className="mb-3">Weight</h2>
        <Card>
          <ActionForm action={logWeight} pendingText="Saving…">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="field">
                <label className="label" htmlFor="w-kg">
                  Kilograms
                </label>
                <input id="w-kg" name="kg" className="input num" inputMode="decimal" step="0.1" min={10} max={500} placeholder="78.4" />
              </div>
              <div className="field">
                <label className="label" htmlFor="w-lb">
                  Or pounds
                </label>
                <input id="w-lb" name="lb" className="input num" inputMode="decimal" step="0.1" min={20} max={1100} placeholder="173" />
                <p className="hint">Pounds are converted and stored in kilograms, so the chart never jumps.</p>
              </div>
              <div className="field">
                <label className="label" htmlFor="w-at">
                  When
                </label>
                <input id="w-at" name="at" type="datetime-local" className="input" defaultValue={whenDefault} required />
              </div>
            </div>
            <div>
              <SubmitButton>Save weight</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="mt-4">
          {weightRows.length === 0 ? (
            <EmptyState title="No weights yet" body="Whenever you step on the scales, it goes here." />
          ) : (
            <ul className="card divide-y">
              {weightRows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                  <div className="w-28 shrink-0">
                    <div className="text-sm">{fmtDay(r.at)}</div>
                    <div className="hint num">{fmtTime(r.at)}</div>
                  </div>
                  <div className="min-w-0 flex-1 num">
                    {Math.round(r.kg * 10) / 10} kg
                    <span className="hint"> · {Math.round((r.kg / LB_PER_KG) * 10) / 10} lb</span>
                  </div>
                  <DeleteButton action={deleteWeight} id={r.id} what="weight entry" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* --------------------------- blood pressure --------------------------- */}
      <section id="blood-pressure" className="mb-10 scroll-mt-6">
        <h2 className="mb-3">Blood pressure</h2>
        <Card>
          <ActionForm action={logBloodPressure} pendingText="Saving…">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="field">
                <label className="label" htmlFor="bp-sys">
                  Top number
                </label>
                <input id="bp-sys" name="systolic" className="input num" inputMode="numeric" step="1" min={50} max={300} placeholder="124" required />
              </div>
              <div className="field">
                <label className="label" htmlFor="bp-dia">
                  Bottom number
                </label>
                <input id="bp-dia" name="diastolic" className="input num" inputMode="numeric" step="1" min={20} max={200} placeholder="78" required />
              </div>
              <div className="field">
                <label className="label" htmlFor="bp-pulse">
                  Pulse, if shown
                </label>
                <input id="bp-pulse" name="pulse" className="input num" inputMode="numeric" step="1" min={20} max={250} placeholder="68" />
              </div>
              <div className="field">
                <label className="label" htmlFor="bp-at">
                  When
                </label>
                <input id="bp-at" name="at" type="datetime-local" className="input" defaultValue={whenDefault} required />
              </div>
            </div>
            <div>
              <SubmitButton>Save reading</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="mt-4">
          {bpRows.length === 0 ? (
            <EmptyState title="No blood pressure readings yet" body="Numbers here are kept as your monitor showed them." />
          ) : (
            <ul className="card divide-y">
              {bpRows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                  <div className="w-28 shrink-0">
                    <div className="text-sm">{fmtDay(r.at)}</div>
                    <div className="hint num">{fmtTime(r.at)}</div>
                  </div>
                  <div className="min-w-0 flex-1 num">
                    {r.systolic}/{r.diastolic}
                    {r.pulse ? <span className="hint"> · pulse {r.pulse}</span> : null}
                  </div>
                  <DeleteButton action={deleteBloodPressure} id={r.id} what="blood pressure entry" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ----------------------------- medications ---------------------------- */}
      <section id="medications" className="scroll-mt-6">
        <h2 className="mb-3">Medications</h2>
        <div className="mb-4">
          <Notice>
            Your medications are kept in your own words. Steady never changes a dose, suggests one, or tells you to stop or start anything. Any
            change comes from your prescriber.
          </Notice>
        </div>

        {meds.length === 0 ? (
          <EmptyState title="No medications on your list" body="Add one below and a Took it button will appear next to it." />
        ) : (
          <ul className="card divide-y mb-4">
            {meds.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-3 md:p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{m.name}</div>
                  {m.doseText ? <div className="text-sm muted">{m.doseText}</div> : null}
                  {m.startedOn ? <div className="hint">Started {m.startedOn}</div> : null}
                </div>
                <ActionForm action={takeMedication} className="shrink-0" pendingText="Writing it down…">
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton className="btn btn-secondary btn-sm">Took it</SubmitButton>
                </ActionForm>
                <DeleteButton action={archiveMedication} id={m.id} what="medication" label="Put away" ariaLabel={`Put away ${m.name}`} />
              </li>
            ))}
          </ul>
        )}

        <Card>
          <div className="eyebrow mb-3">Add a medication</div>
          <ActionForm action={addMedication} pendingText="Adding…">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="field">
                <label className="label" htmlFor="med-name">
                  Name
                </label>
                <input id="med-name" name="name" className="input" maxLength={120} placeholder="Metformin" required />
              </div>
              <div className="field">
                <label className="label" htmlFor="med-dose">
                  Dose, in your words
                </label>
                <input id="med-dose" name="doseText" className="input" placeholder="500 mg twice a day with food" />
                <p className="hint">Written down exactly as you type it.</p>
              </div>
              <div className="field">
                <label className="label" htmlFor="med-started">
                  Started on, if you know
                </label>
                <input id="med-started" name="startedOn" type="date" className="input" />
              </div>
            </div>
            <div>
              <SubmitButton>Add it</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <div className="mt-4">
          <h3 className="mb-2">Recently taken</h3>
          {takenRows.length === 0 ? (
            <p className="muted text-sm">Nothing written down yet.</p>
          ) : (
            <ul className="card divide-y">
              {takenRows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                  <div className="w-28 shrink-0">
                    <div className="text-sm">{fmtDay(r.at)}</div>
                    <div className="hint num">{fmtTime(r.at)}</div>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">{medName.get(r.medicationId) ?? "A medication you have since put away"}</div>
                  <DeleteButton action={deleteMedicationTaken} id={r.id} what="medication entry" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
  });
}
