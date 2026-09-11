import Link from "next/link";
import { desc, and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, glucoseReadings, READING_CONTEXTS } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm, zLocalDateTime, zOptStr } from "@/lib/actions";
import { getProfile } from "@/lib/data/snapshot";
import { toMgdl, formatGlucose, unitLabel, bandOf, BAND_LABEL, GLUCOSE_MIN_MGDL, GLUCOSE_MAX_MGDL, LOW_MGDL, VERY_HIGH_MGDL } from "@/lib/units";
import { toDateTimeInput, fmtTime, fmtDay, startOfDay } from "@/lib/time";
import { newId } from "@/lib/ids";
import { PageHeader, Card, GlucoseChip, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { ActionForm, DeleteButton } from "../ActionForm";
import { deleteGlucose } from "../actions";
import { revalidateLog } from "../revalidate";
import { CONTEXT_LABEL } from "../labels";
import type { LogResult } from "../types";

const Form = z.object({
  value: z.coerce.number().refine((n) => Number.isFinite(n) && n > 0, "type the number your meter showed"),
  at: zLocalDateTime,
  context: z.enum(READING_CONTEXTS),
  note: zOptStr(300),
});

async function logGlucose(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const profile = await getProfile();
  const u = profile.units;
  const parsed = parseForm(Form, fd);
  if ("error" in parsed) return fail(parsed.error);
  const { value, at, context, note } = parsed.data;

  const mgdl = toMgdl(value, u);
  if (mgdl < GLUCOSE_MIN_MGDL || mgdl > GLUCOSE_MAX_MGDL) {
    return fail(
      `That is outside what a meter can read. Please enter a number between ${formatGlucose(GLUCOSE_MIN_MGDL, u)} and ${formatGlucose(GLUCOSE_MAX_MGDL, u)} ${unitLabel(u)}.`,
    );
  }

  const clash = await db
    .select({ id: glucoseReadings.id })
    .from(glucoseReadings)
    .where(and(eq(glucoseReadings.at, at), eq(glucoseReadings.source, "manual")))
    .limit(1);
  if (clash.length) {
    return fail("You already have a manual reading at that time. Change the time by a minute, or delete the one that is already there.");
  }

  const id = newId();
  try {
    await db.insert(glucoseReadings).values({ id, at, valueMgdl: mgdl, source: "manual", context, note, createdAt: new Date() });
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    if (/unique|constraint/i.test(m)) {
      return fail("You already have a manual reading at that time. Change the time by a minute, or delete the one that is already there.");
    }
    return fail("Could not save that reading. Please try again.");
  }

  revalidateLog("/log/glucose", "/trends", "/review");

  const band = bandOf(mgdl, profile.targetLowMgdl, profile.targetHighMgdl);
  const low = mgdl < LOW_MGDL;
  const high = mgdl > VERY_HIGH_MGDL;
  return {
    ok: true,
    id,
    message: `Saved. ${formatGlucose(mgdl, u)} ${unitLabel(u)} at ${fmtTime(at)} lands in ${BAND_LABEL[band]}.`,
    detail: low || high ? undefined : "Thanks for writing it down.",
    copilot:
      low || high
        ? {
            mode: "symptoms",
            text: `That is ${low ? "a low" : "a very high"} reading. The Copilot can check symptoms with you and tell you what the safety rules say.`,
            cta: "Check symptoms with the Copilot",
          }
        : undefined,
  };
  });
}

export default async function LogGlucosePage() {
  return requireAccount(async () => {
  const profile = await getProfile();
  const u = profile.units;
  const now = new Date();
  const today = startOfDay(now);
  const recent = await db.select().from(glucoseReadings).orderBy(desc(glucoseReadings.at)).limit(10);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Log"
        title="Glucose"
        lede={`Type it in ${unitLabel(u)}, the way your meter shows it. Steady stores every reading the same way underneath, so the numbers always line up.`}
        action={
          <Link href="/log/glucose/import" className="btn btn-secondary">
            Import from CGM
          </Link>
        }
      />

      <Card>
        <ActionForm action={logGlucose} pendingText="Saving your reading…">
          <div className="field">
            <label className="label" htmlFor="value">
              Reading in {unitLabel(u)}
            </label>
            <input
              id="value"
              name="value"
              className="input input-big"
              inputMode="decimal"
              autoComplete="off"
              step={u === "mmol" ? "0.1" : "1"}
              placeholder={u === "mmol" ? "6.5" : "118"}
              required
              autoFocus
            />
            <p className="hint">
              Anything between {formatGlucose(GLUCOSE_MIN_MGDL, u)} and {formatGlucose(GLUCOSE_MAX_MGDL, u)} {unitLabel(u)}.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="at">
                When
              </label>
              <input id="at" name="at" type="datetime-local" className="input" defaultValue={toDateTimeInput(now)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="context">
                What was happening
              </label>
              <select id="context" name="context" className="select" defaultValue="before_meal">
                {READING_CONTEXTS.map((c) => (
                  <option key={c} value={c}>
                    {CONTEXT_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="note">
              Note, if you want one
            </label>
            <input id="note" name="note" className="input" placeholder="Woke up with a headache" maxLength={300} />
          </div>

          <div>
            <SubmitButton className="btn btn-lg">Save reading</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <section className="mt-8">
        <h2 className="mb-3">Your last ten</h2>
        {recent.length === 0 ? (
          <EmptyState title="No readings yet" body="The first one you save will show up here, newest at the top." />
        ) : (
          <ul className="card divide-y">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3 md:p-4">
                <div className="w-28 shrink-0">
                  <div className="num text-sm">{fmtTime(r.at)}</div>
                  <div className="hint">{r.at >= today ? "Today" : fmtDay(r.at)}</div>
                </div>
                <GlucoseChip mgdl={r.valueMgdl} units={u} low={profile.targetLowMgdl} high={profile.targetHighMgdl} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{r.context ? CONTEXT_LABEL[r.context] : "No context"}</div>
                  {r.note ? <div className="hint truncate">{r.note}</div> : null}
                  {r.source !== "manual" ? <div className="hint">{r.source === "cgm_import" ? "From an import" : "From a meter"}</div> : null}
                </div>
                <DeleteButton action={deleteGlucose} id={r.id} what="reading" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6">
        <Notice>
          Steady records your readings and shows you the patterns in them. It never tells you what dose to take. That belongs to you and your
          prescriber.
        </Notice>
      </div>
    </div>
  );
  });
}
