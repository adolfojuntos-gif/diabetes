import Link from "next/link";
import { desc, gte } from "drizzle-orm";
import { db, glucoseReadings, SYMPTOMS, type Symptom } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { PageHeader, Card, Notice, TriageBanner, GlucoseChip } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { getProfile, usesInsulin } from "@/lib/data/snapshot";
import { runTriage, submitSymptomStepAndGo } from "../actions";
import { fmtTime, fmtDay, addDays } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Plain English for every symptom key. The enum is never shown raw. */
export const SYMPTOM_LABEL: Record<Symptom, string> = {
  shaky: "Shaky or trembling",
  sweaty: "Sweaty or clammy",
  confused: "Confused or foggy",
  dizzy: "Dizzy or lightheaded",
  headache: "Headache",
  blurred_vision: "Blurred vision",
  very_thirsty: "Very thirsty",
  frequent_urination: "Urinating a lot",
  fatigue: "Tired or no energy",
  nausea: "Nauseous",
  vomiting: "Vomiting",
  abdominal_pain: "Stomach pain",
  fruity_breath: "Breath smells fruity or sweet",
  rapid_breathing: "Breathing fast or deeply",
  chest_pain: "Chest pain or pressure",
  short_of_breath: "Short of breath",
  numbness_tingling: "Numbness or tingling",
  foot_wound: "A wound or sore on my foot",
  fever: "Fever or chills",
  unable_to_keep_fluids: "Cannot keep fluids down",
  one_sided_weakness: "Weakness on one side",
  slurred_speech: "Slurred speech",
  fainted: "Fainted or passed out",
  seizure: "Had a seizure",
  irritable: "Irritable",
  hungry: "Very hungry",
  heart_racing: "Heart racing or pounding",
  slow_healing: "Something is not healing",
  other: "Something else",
};

/** Grouped so the urgent ones are visible without hunting, but not alarming. */
const GROUPS: { title: string; keys: Symptom[] }[] = [
  { title: "Might be a low", keys: ["shaky", "sweaty", "dizzy", "hungry", "irritable", "heart_racing", "confused"] },
  { title: "Might be a high", keys: ["very_thirsty", "frequent_urination", "fatigue", "blurred_vision", "headache"] },
  { title: "Stomach and illness", keys: ["nausea", "vomiting", "abdominal_pain", "unable_to_keep_fluids", "fever"] },
  { title: "Breathing and chest", keys: ["short_of_breath", "rapid_breathing", "chest_pain", "fruity_breath"] },
  { title: "Nerves, feet and skin", keys: ["numbness_tingling", "foot_wound", "slow_healing"] },
  { title: "Serious signs", keys: ["one_sided_weakness", "slurred_speech", "fainted", "seizure"] },
  { title: "Other", keys: ["other"] },
];

export default async function SymptomCheck({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return requireAccount(async () => {
  const profile = await getProfile();
  const recent = await db.select().from(glucoseReadings).where(gte(glucoseReadings.at, addDays(new Date(), -1))).orderBy(desc(glucoseReadings.at)).limit(6);
  // A baseline triage with no symptoms, so the page can already show if the numbers alone need action.
  const baseline = await runTriage({});
  const insulin = usesInsulin(profile);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Check my symptoms"
        title="What is happening?"
        lede="Pick whatever fits, add anything in your own words, and I will look at it together with your recent readings. A fixed safety check decides the urgency, not the conversation."
      />

      {sp.error ? <p className="error mb-4">{sp.error}</p> : null}

      {baseline.level !== "general" ? (
        <div className="mb-5">
          <div className="eyebrow mb-2">Before you even answer, your recent readings say this</div>
          <TriageBanner t={baseline} />
        </div>
      ) : null}

      <Card className="mb-4">
        <div className="eyebrow mb-2">Your last readings</div>
        {recent.length === 0 ? (
          <p className="muted text-sm">
            No readings in the last day. If you can, <Link href="/log/glucose" className="underline">take one now</Link> and come back, since it changes what any of this means.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <span key={r.id} className="card-quiet px-3 py-2 text-sm flex items-center gap-2">
                <GlucoseChip mgdl={r.valueMgdl} units={profile.units} low={profile.targetLowMgdl} high={profile.targetHighMgdl} />
                <span className="hint">
                  {fmtDay(r.at)} {fmtTime(r.at)}
                </span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <form action={submitSymptomStepAndGo} className="grid gap-5">
        <Card>
          <h2 className="mb-1">Step 1. What are you noticing?</h2>
          <p className="hint mb-3">Pick everything that applies.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="card-quiet p-3">
                <legend className="eyebrow px-1">{g.title}</legend>
                <div className="grid gap-1.5 mt-1">
                  {g.keys.map((k) => (
                    <label key={k} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="symptoms[]" value={k} className="mt-1" />
                      <span>{SYMPTOM_LABEL[k]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="field mt-4">
            <label className="label" htmlFor="note">
              In your own words
            </label>
            <textarea id="note" name="note" className="textarea" rows={3} maxLength={1000} placeholder="I woke up with a headache and I have felt off since lunch." />
          </div>
        </Card>

        <Card>
          <h2 className="mb-3">Step 2. How bad, and how long?</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="field">
              <legend className="label">How bad is it right now?</legend>
              <div className="seg mt-1" role="radiogroup">
                {[
                  { v: 1, l: "Mild" },
                  { v: 2, l: "Moderate" },
                  { v: 3, l: "Severe" },
                ].map((o) => (
                  <label key={o.v} className="cursor-pointer">
                    <input type="radio" name="severity" value={o.v} defaultChecked={o.v === 2} className="sr-only" />
                    {o.l}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label className="label" htmlFor="sinceDays">
                How many days has this been going on?
              </label>
              <input id="sinceDays" name="sinceDays" type="number" min={0} max={365} defaultValue={0} className="input" />
              <span className="hint">0 means it started today.</span>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3">Step 3. Two safety questions</h2>
          <div className="grid gap-4">
            <div className="field">
              <label className="label" htmlFor="ketones">
                Have you checked ketones?
              </label>
              <select id="ketones" name="ketones" className="select" defaultValue="unknown">
                <option value="unknown">I have not checked</option>
                <option value="none">Checked, none</option>
                <option value="trace_small">Checked, trace or small</option>
                <option value="moderate_large">Checked, moderate or large</option>
              </select>
              <span className="hint">If you do not have strips, leave this as it is.</span>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="lowNotResponding" className="mt-1" />
              <span>I have treated a low twice and it still has not come up.</span>
            </label>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <SubmitButton className="btn btn-slate btn-lg" pendingText="Checking…">
            Check this
          </SubmitButton>
          <Link href="/copilot" className="btn btn-ghost">
            Just talk instead
          </Link>
        </div>
      </form>

      <div className="mt-6 grid gap-3 prose-measure">
        <Notice tone="amber">
          If you have chest pain, trouble breathing, weakness on one side, slurred speech, a seizure, or someone is unresponsive, stop filling in this form and call your local emergency number now. In the US that is 911.
        </Notice>
        <Notice>
          What you pick is saved as a symptom log, so it shows up in your trends and in an appointment brief. Nothing here is a diagnosis.
          {insulin ? " Because you use insulin, keep fast-acting carbohydrate within reach while you do this." : ""}
        </Notice>
      </div>
    </div>
  );
  });
}
