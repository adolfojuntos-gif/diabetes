/**
 * Profile and preferences. There is exactly one profile row (id 1).
 *
 * Units are a display preference only: glucose is stored in mg/dL, always. The target inputs are
 * read in whatever unit the form was rendered in (a hidden field), so switching the unit here
 * changes what you see and never what is stored.
 */
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, profile as profileTable, DIABETES_TYPES, INSULIN_REGIMENS, UNITS, type DiabetesType, type InsulinRegimen } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { parseForm, zNum, zOptNum, zStr } from "@/lib/actions";
import { formatGlucose, toMgdl, unitLabel } from "@/lib/units";
import type { Units } from "@/lib/db/schema";
import { PageHeader, Card, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { FormError, FormNote, param, type SP } from "../toolkit/_shared/ui";
import { failTo, noteTo } from "../toolkit/_shared/server";

const PATH = "/settings";

const TYPE_LABEL: Record<DiabetesType, string> = {
  type1: "Type 1",
  type2: "Type 2",
  gestational: "Gestational",
  prediabetes: "Prediabetes",
  lada: "LADA",
  other: "Other, or not sure yet",
};

const REGIMEN_LABEL: Record<InsulinRegimen, string> = {
  none: "No insulin",
  basal: "Basal (background) insulin only",
  basal_bolus: "Basal and mealtime insulin",
  pump: "Insulin pump",
  other: "Something else",
};

const STYLES = [
  { value: "simple", label: "Simple", body: "Short sentences, everyday words, one idea at a time." },
  { value: "standard", label: "Standard", body: "Plain English with the numbers included. The default." },
  { value: "clinical", label: "Clinical", body: "Clinical terms and the full statistics, for when you want the detail." },
] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_TARGET_MGDL = 50;
const MAX_TARGET_MGDL = 300;

function cleanTimes(raw: string): { times: string[]; bad: string | null } {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) if (!TIME_RE.test(p)) return { times: [], bad: p };
  return { times: parts, bad: null };
}

async function saveProfile(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const r = parseForm(
    z.object({
      renderedUnits: z.enum(UNITS),
      name: zStr(80),
      diabetesType: z.enum(DIABETES_TYPES),
      units: z.enum(UNITS),
      targetLow: zNum(1, 600),
      targetHigh: zNum(1, 600),
      insulinRegimen: z.enum(INSULIN_REGIMENS),
      // Checkboxes: absent when unchecked, "on" when checked. Anything else is treated as off.
      usesCgm: z.string().max(8).optional(),
      pregnant: z.string().max(8).optional(),
      hydrationGoalMl: zNum(200, 8000),
      sleepGoalHours: zNum(3, 14),
      dailyCarbTargetG: zOptNum(20, 600),
      birthYear: zOptNum(1900, new Date().getFullYear()),
      goals: zStr(1000),
      copilotStyle: z.enum(["simple", "standard", "clinical"]),
      reminderTimes: zStr(200),
      quietStart: z.string().regex(TIME_RE, "must be a time like 22:00"),
      quietEnd: z.string().regex(TIME_RE, "must be a time like 07:00"),
    }),
    fd,
  );
  if ("error" in r) failTo(PATH, r.error);
  const d = r.data;

  // Targets are typed in the unit the form was showing, then stored in mg/dL. Always.
  const low = toMgdl(d.targetLow, d.renderedUnits);
  const high = toMgdl(d.targetHigh, d.renderedUnits);
  if (low >= high) failTo(PATH, "The low end of your target has to be below the high end.");
  if (low < MIN_TARGET_MGDL || high > MAX_TARGET_MGDL) {
    failTo(
      PATH,
      `Targets need to sit between ${formatGlucose(MIN_TARGET_MGDL, d.renderedUnits)} and ${formatGlucose(MAX_TARGET_MGDL, d.renderedUnits)} ${unitLabel(d.renderedUnits)}. Anything outside that is a conversation for your care team, not a setting.`,
    );
  }

  const { times, bad } = cleanTimes(d.reminderTimes);
  if (bad) failTo(PATH, `“${bad}” is not a time. Use 24-hour times separated by commas, like 08:00, 13:00, 21:30.`);

  await db
    .update(profileTable)
    .set({
      name: d.name,
      diabetesType: d.diabetesType,
      units: d.units,
      targetLowMgdl: low,
      targetHighMgdl: high,
      insulinRegimen: d.insulinRegimen,
      usesCgm: d.usesCgm === "on",
      pregnant: d.pregnant === "on",
      hydrationGoalMl: Math.round(d.hydrationGoalMl),
      sleepGoalMinutes: Math.round(d.sleepGoalHours * 60),
      dailyCarbTargetG: d.dailyCarbTargetG === null ? null : Math.round(d.dailyCarbTargetG),
      birthYear: d.birthYear === null ? null : Math.round(d.birthYear),
      goals: d.goals,
      copilotStyle: d.copilotStyle,
      reminderTimes: times.join(","),
      quietStart: d.quietStart,
      quietEnd: d.quietEnd,
      onboarded: true,
      updatedAt: new Date(),
    })
    .where(eq(profileTable.id, 1));

  revalidatePath("/", "layout");
  noteTo(PATH, "Saved.");
  });
}

export default async function SettingsPage({ searchParams }: { searchParams?: SP }) {
  const [error, note] = await Promise.all([param(searchParams, "e"), param(searchParams, "m")]);
  return requireAccount(async () => {
  const p = await getProfile();
  const u: Units = p.units;
  const step = u === "mmol" ? "0.1" : "1";

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings"
        title="Your setup"
        lede="Everything on this page is yours to change. None of it is a medical instruction, and none of it changes a dose."
      />

      <FormError message={error} />
      <FormNote message={note} />

      <form action={saveProfile} className="grid gap-4">
        <input type="hidden" name="renderedUnits" value={u} />

        <Card>
          <h2>You</h2>
          <div className="grid gap-3 md:grid-cols-2 mt-3">
            <div className="field">
              <label className="label" htmlFor="name">
                What should Steady call you
              </label>
              <input id="name" name="name" className="input" defaultValue={p.name} maxLength={80} placeholder="Your first name" />
            </div>
            <div className="field">
              <label className="label" htmlFor="diabetesType">
                Type of diabetes
              </label>
              <select id="diabetesType" name="diabetesType" className="select" defaultValue={p.diabetesType}>
                {DIABETES_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="birthYear">
                Year you were born (optional)
              </label>
              <input
                id="birthYear"
                name="birthYear"
                type="number"
                className="input num"
                min={1900}
                max={new Date().getFullYear()}
                defaultValue={p.birthYear ?? ""}
              />
              <span className="hint">Used only to phrase things sensibly. It never changes a target on its own.</span>
            </div>
            <div className="field">
              <span className="label">Pregnancy</span>
              <label className="flex items-center gap-2 text-sm" htmlFor="pregnant">
                <input id="pregnant" type="checkbox" name="pregnant" defaultChecked={p.pregnant} className="w-5 h-5" />
                I am pregnant
              </label>
              <span className="hint">
                Pregnancy changes glucose targets and how often you are asked to check. Your care team leads that, and Steady
                will not set a pregnancy target for you.
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <h2>Numbers</h2>
          <div className="grid gap-3 md:grid-cols-2 mt-3">
            <div className="field">
              <label className="label" htmlFor="units">
                Units for glucose
              </label>
              <select id="units" name="units" className="select" defaultValue={p.units}>
                <option value="mgdl">mg/dL</option>
                <option value="mmol">mmol/L</option>
              </select>
              <span className="hint">
                A display choice only. Every reading is stored in mg/dL, so switching this does not change a single saved
                number.
              </span>
            </div>
            <div />
            <div className="field">
              <label className="label" htmlFor="targetLow">
                Target low ({unitLabel(u)})
              </label>
              <input
                id="targetLow"
                name="targetLow"
                type="number"
                step={step}
                className="input num"
                defaultValue={formatGlucose(p.targetLowMgdl, u)}
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="targetHigh">
                Target high ({unitLabel(u)})
              </label>
              <input
                id="targetHigh"
                name="targetHigh"
                type="number"
                step={step}
                className="input num"
                defaultValue={formatGlucose(p.targetHighMgdl, u)}
                required
              />
              <span className="hint">
                The international consensus range is {formatGlucose(70, u)} to {formatGlucose(180, u)} {unitLabel(u)}. Your
                own range is the one your care team set with you. Type these in the unit shown above.
              </span>
            </div>
            <div className="field">
              <label className="label" htmlFor="insulinRegimen">
                Insulin
              </label>
              <select id="insulinRegimen" name="insulinRegimen" className="select" defaultValue={p.insulinRegimen}>
                {INSULIN_REGIMENS.map((t) => (
                  <option key={t} value={t}>
                    {REGIMEN_LABEL[t]}
                  </option>
                ))}
              </select>
              <span className="hint">This only decides which screens and packing items you are shown.</span>
            </div>
            <div className="field">
              <span className="label">Continuous glucose monitor</span>
              <label className="flex items-center gap-2 text-sm" htmlFor="usesCgm">
                <input id="usesCgm" type="checkbox" name="usesCgm" defaultChecked={p.usesCgm} className="w-5 h-5" />
                I wear a CGM
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="dailyCarbTargetG">
                Daily carbohydrate target in grams (optional)
              </label>
              <input
                id="dailyCarbTargetG"
                name="dailyCarbTargetG"
                type="number"
                className="input num"
                min={20}
                max={600}
                defaultValue={p.dailyCarbTargetG ?? ""}
              />
              <span className="hint">Leave this blank unless you and your care team agreed a number.</span>
            </div>
            <div />
            <div className="field">
              <label className="label" htmlFor="hydrationGoalMl">
                Water goal (ml a day)
              </label>
              <input
                id="hydrationGoalMl"
                name="hydrationGoalMl"
                type="number"
                className="input num"
                min={200}
                max={8000}
                step={100}
                defaultValue={p.hydrationGoalMl}
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="sleepGoalHours">
                Sleep goal (hours a night)
              </label>
              <input
                id="sleepGoalHours"
                name="sleepGoalHours"
                type="number"
                className="input num"
                min={3}
                max={14}
                step={0.5}
                defaultValue={(p.sleepGoalMinutes / 60).toFixed(1)}
                required
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2>What you are working on</h2>
          <div className="field mt-3">
            <label className="label" htmlFor="goals">
              In your own words
            </label>
            <textarea
              id="goals"
              name="goals"
              className="textarea"
              rows={3}
              defaultValue={p.goals}
              maxLength={1000}
              placeholder="Walk after dinner most nights. Stop skipping breakfast. Fewer lows at work."
            />
            <span className="hint">This is shown in your morning brief and handed to the Copilot as context.</span>
          </div>
        </Card>

        <Card>
          <h2>How the Copilot talks to you</h2>
          <fieldset className="mt-3">
            <legend className="sr-only">Copilot style</legend>
            <div className="grid gap-2">
              {STYLES.map((s) => (
                <label key={s.value} className="card-quiet p-3 flex items-start gap-3 cursor-pointer" htmlFor={`style-${s.value}`}>
                  <input
                    id={`style-${s.value}`}
                    type="radio"
                    name="copilotStyle"
                    value={s.value}
                    defaultChecked={p.copilotStyle === s.value}
                    className="w-5 h-5 mt-0.5"
                  />
                  <span>
                    <strong>{s.label}</strong>
                    <span className="block text-sm muted">{s.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card>
          <h2>Reminders and quiet hours</h2>
          <div className="grid gap-3 md:grid-cols-3 mt-3">
            <div className="field md:col-span-3">
              <label className="label" htmlFor="reminderTimes">
                Times you want a nudge
              </label>
              <input
                id="reminderTimes"
                name="reminderTimes"
                className="input num"
                defaultValue={p.reminderTimes}
                maxLength={200}
                placeholder="08:00, 13:00, 21:30"
              />
              <span className="hint">24-hour times separated by commas. Leave it empty for no reminders.</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="quietStart">
                Quiet hours start
              </label>
              <input id="quietStart" name="quietStart" type="time" className="input num" defaultValue={p.quietStart} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="quietEnd">
                Quiet hours end
              </label>
              <input id="quietEnd" name="quietEnd" type="time" className="input num" defaultValue={p.quietEnd} required />
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-lg" pendingText="Saving…">
            Save settings
          </SubmitButton>
          <Link href="/settings/billing" className="btn btn-secondary">
            Plan and billing
          </Link>
          <Link href="/settings/data" className="btn btn-secondary">
            Data and privacy
          </Link>
          <Link href="/settings/about" className="btn btn-ghost">
            What this is and is not
          </Link>
        </div>
      </form>

      <div className="mt-6">
        <Notice>
          Nothing on this page is a medical setting. A target range, a carbohydrate number or a sleep goal here is a
          preference for how Steady shows your own data back to you. Changing any of it does not change a medicine, a dose,
          or anything your care team decided.
        </Notice>
      </div>
    </div>
  );
  });
}
