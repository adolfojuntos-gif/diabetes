/**
 * Data and privacy. Counts read straight from the tables, a full JSON export, and a delete that
 * really deletes. The only content kept back is the seeded reference content (recipes, exercise
 * ideas and the packing template), which is not about the person.
 */
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { count } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  db,
  aiAudit,
  appointments,
  bloodPressureLogs,
  caregiverComments,
  caregivers,
  conversations,
  doctorQuestions,
  exerciseIdeas,
  exerciseSessions,
  glucoseReadings,
  groceryItems,
  hydrationLogs,
  insulinDoses,
  journalEntries,
  labResults,
  mealPlan,
  meals,
  medicationTaken,
  medications,
  memoryFacts,
  messages,
  nudges,
  packingItems,
  profile,
  recipes,
  sleepLogs,
  symptomLogs,
  trips,
  weightLogs,
  wellbeingCheckins,
} from "@/lib/db";
import { PageHeader, Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { parseForm } from "@/lib/actions";
import { requireAccount } from "@/lib/auth/session";
import { spendUsage } from "@/lib/data/aiAudit";
import { FormError, FormNote, param, type SP } from "../../toolkit/_shared/ui";
import { failTo, noteTo } from "../../toolkit/_shared/server";

const FEATURE_LABEL: Record<string, string> = {
  copilot: "Copilot replies",
  coach: "Written check-ins",
  photo: "Photo estimates",
};

const PATH = "/settings/data";

type TableRow = { label: string; table: SQLiteTable; kept?: boolean };

const TABLES: TableRow[] = [
  { label: "Profile", table: profile },
  { label: "Glucose readings", table: glucoseReadings },
  { label: "Meals", table: meals },
  { label: "Insulin entries", table: insulinDoses },
  { label: "Movement sessions", table: exerciseSessions },
  { label: "Sleep nights", table: sleepLogs },
  { label: "Water entries", table: hydrationLogs },
  { label: "Journal entries", table: journalEntries },
  { label: "Inbox items", table: nudges },
  { label: "Questions for the doctor", table: doctorQuestions },
  { label: "Meal plan cells", table: mealPlan },
  { label: "Grocery items", table: groceryItems },
  { label: "Trip settings", table: trips },
  { label: "Medications", table: medications },
  { label: "Medication taken", table: medicationTaken },
  { label: "Symptom entries", table: symptomLogs },
  { label: "Weight entries", table: weightLogs },
  { label: "Blood pressure entries", table: bloodPressureLogs },
  { label: "Lab results", table: labResults },
  { label: "Appointments", table: appointments },
  { label: "Daily check-ins", table: wellbeingCheckins },
  { label: "Copilot conversations", table: conversations },
  { label: "Copilot messages", table: messages },
  { label: "AI audit rows", table: aiAudit },
  { label: "Memory facts", table: memoryFacts },
  { label: "Caregivers", table: caregivers },
  { label: "Caregiver comments", table: caregiverComments },
  { label: "Recipes (reference content)", table: recipes, kept: true },
  { label: "Exercise ideas (reference content)", table: exerciseIdeas, kept: true },
  { label: "Packing template (reference content)", table: packingItems, kept: true },
];

async function deleteEverything(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  /**
   * The only irreversible action in the app, so it asks for two things rather than one.
   *
   * Typing DELETE was the whole guard, and on a hosted deployment the demo passphrase is shared
   * with every prospect, which made a stranger knowing one English word the last line between them
   * and the patient's entire history. The second factor is the count of glucose readings currently
   * stored: it is on the screen directly above the form, it changes as the person uses the app, and
   * nobody who has not actually looked at this page can supply it.
   */
  const r = parseForm(z.object({ confirm: z.string().max(40), readings: z.coerce.number().int().min(0) }), fd);
  if ("error" in r) failTo(PATH, r.error);
  if (r.data.confirm !== "DELETE") {
    failTo(PATH, "Nothing was deleted. Type DELETE exactly, in capitals, if that is really what you want.");
  }
  const actualReadings = (await db.select({ id: glucoseReadings.id }).from(glucoseReadings)).length;
  if (r.data.readings !== actualReadings) {
    failTo(
      PATH,
      `Nothing was deleted. The number of readings did not match, so this page may be out of date. Reload it and try again.`,
    );
  }

  // Everything about the person goes.
  await db.delete(glucoseReadings);
  await db.delete(meals);
  await db.delete(insulinDoses);
  await db.delete(exerciseSessions);
  await db.delete(sleepLogs);
  await db.delete(hydrationLogs);
  await db.delete(journalEntries);
  await db.delete(nudges);
  await db.delete(doctorQuestions);
  await db.delete(mealPlan);
  await db.delete(groceryItems);
  await db.delete(trips);
  await db.delete(medicationTaken);
  await db.delete(medications);
  await db.delete(symptomLogs);
  await db.delete(weightLogs);
  await db.delete(bloodPressureLogs);
  await db.delete(labResults);
  await db.delete(appointments);
  await db.delete(wellbeingCheckins);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(aiAudit);
  await db.delete(memoryFacts);
  await db.delete(caregiverComments);
  await db.delete(caregivers);
  await db.delete(profile);

  // The packing template stays, but the items you added and the boxes you ticked are yours.
  await db.delete(packingItems).where(eq(packingItems.custom, true));
  await db.update(packingItems).set({ checked: false });

  revalidatePath("/", "layout");
  noteTo(PATH, "Everything about you has been deleted. What is left is the recipe, exercise and packing reference content.");
  });
}

export default async function DataPage({ searchParams }: { searchParams?: SP }) {
  const [error, note] = await Promise.all([param(searchParams, "e"), param(searchParams, "m")]);
  return requireAccount(async () => {
  const spend = await spendUsage();
  const counts = await Promise.all(TABLES.map((t) => db.select({ c: count() }).from(t.table)));
  const rows = TABLES.map((t, i) => ({ ...t, n: counts[i][0]?.c ?? 0 }));
  const yours = rows.filter((r) => !r.kept);
  const kept = rows.filter((r) => r.kept);
  const total = yours.reduce((a, r) => a + r.n, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings"
        title="Data and privacy"
        lede="Steady runs on this device against a file on this device. This page tells you exactly what is in it, hands you all of it, and deletes all of it."
      />

      <FormError message={error} />
      <FormNote message={note} />

      <Card>
        <h2>What leaves this device</h2>
        <p className="mt-2 prose-measure">Nothing, with three exceptions, and only when you choose them.</p>
        <ul className="mt-3 grid gap-2 text-sm prose-measure list-disc pl-5">
          <li>
            When an Anthropic API key is set and you send a Copilot message, the text of that message and the engine summary
            built from your own data are sent to Anthropic so the reply can be written. The summary is numbers and short
            lines, not your whole database.
          </li>
          <li>
            When you use a photo estimate for a meal, the photo is sent for the estimate and is never stored by Steady. The
            numbers you accept are stored; the picture is not.
          </li>
          <li>
            When you create a caregiver link and send it to someone, that person can load the sections you ticked over the
            network from wherever this app is running.
          </li>
        </ul>
        <p className="mt-3 prose-measure">
          With no API key set, every screen, every guided flow and the safety engine still work, and nothing leaves the
          device at all. There are no analytics, no crash reporting and no accounts.
        </p>
      </Card>

      <Card className="mt-4">
        <h2>What the model has been asked to do</h2>
        <p className="text-sm muted mt-1">
          Three features in this app call a paid model, and each one is capped so a shared link
          cannot run up a bill. These counts come from the audit log, so they are what actually
          happened rather than a separate tally. The dollar figures are rough estimates at Claude
          Opus 5 rates, not an invoice.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {spend.map((s) => (
            <div key={s.feature} className="card-sunk p-3">
              <div className="eyebrow">{FEATURE_LABEL[s.feature]}</div>
              {s.windows.map((w) => (
                <div key={w.label} className="mt-1">
                  <div className="num text-lg">
                    {w.used}
                    <span className="muted text-sm"> of {w.max}</span>
                  </div>
                  <div className="hint">
                    this {w.label}
                    {w.spentUsd > 0 ? `, about $${w.spentUsd.toFixed(2)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="hint mt-3 prose-measure">
          Over a cap, the feature falls back to this app&rsquo;s own engine, which costs nothing and
          says so in the reply. Nothing stops working. The one hard limit that matters lives in your
          Anthropic console as a monthly spend cap, and this app cannot set that for you.
        </p>
      </Card>

      <Card className="mt-4">
        <h2>What is in your database</h2>
        <p className="text-sm muted mt-1">{total} rows that are about you, across {yours.length} tables.</p>
        <div className="mt-3 grid gap-1 sm:grid-cols-2">
          {yours.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3 divider py-1.5">
              <span className="text-sm">{r.label}</span>
              <span className="num">{r.n}</span>
            </div>
          ))}
        </div>
        <h3 className="mt-5">Reference content, not about you</h3>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {kept.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3 divider py-1.5">
              <span className="text-sm">{r.label}</span>
              <span className="num">{r.n}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <h2>Take it with you</h2>
        <p className="text-sm muted mt-1 prose-measure">
          One JSON file with every row from every table, including the reference content. Glucose is in mg/dL, which is how
          it is stored.
        </p>
        <div className="mt-3">
          <a href="/settings/data/export" className="btn" download>
            Export everything as JSON
          </a>
        </div>
      </Card>

      <Card className="mt-4">
        <h2>Delete all my data</h2>
        <p className="text-sm mt-1 prose-measure">
          This empties every table that holds anything about you: readings, meals, insulin entries, movement, sleep, water,
          journal, inbox, questions, appointments, labs, medications, symptoms, check-ins, Copilot conversations, the audit
          rows, your memory facts, your caregivers and their comments, and your profile. The recipes, exercise ideas and
          packing template stay, because they are reference content rather than your data. Anything you added to the packing
          list yourself is deleted with the rest.
        </p>
        <p className="text-sm mt-2 prose-measure">
          It cannot be undone. If you might want any of it later, export it first.
        </p>
        <form action={deleteEverything} className="mt-3 grid gap-3 md:max-w-sm">
          {/* The second factor. It is a number only someone looking at this page can know, which is
              what stops a crafted link or a shared passphrase from being the whole guard. */}
          <input type="hidden" name="readings" value={rows.find((x) => x.label === "Glucose readings")?.n ?? -1} />
          <div className="field">
            <label className="label" htmlFor="confirm">
              Type DELETE to confirm
            </label>
            <input id="confirm" name="confirm" className="input" autoComplete="off" placeholder="DELETE" required />
            <span className="hint">
              This checks against the {rows.find((x) => x.label === "Glucose readings")?.n ?? 0} readings counted above, so a
              stale page cannot delete anything.
            </span>
          </div>
          <div>
            <SubmitButton className="btn btn-danger" pendingText="Deleting…">
              Delete all my data
            </SubmitButton>
          </div>
        </form>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/settings" className="btn btn-secondary">
          Back to settings
        </Link>
        <Link href="/settings/about" className="btn btn-ghost">
          What this is and is not
        </Link>
      </div>

      <div className="mt-6">
        <Notice>
          Caregiver links are the one part of this app that can be read by someone else. Revoking a link on the caregiver
          screen takes effect immediately, and deleting your data removes every link as well.
        </Notice>
      </div>
    </div>
  );
  });
}
