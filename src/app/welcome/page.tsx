import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, profile as profileTable, DIABETES_TYPES, INSULIN_REGIMENS } from "@/lib/db";
import { Card, Notice } from "@/components/ui";
import { HeroVideo } from "@/components/HeroVideo";
import { SubmitButton } from "@/components/Form";
import { requireAccount } from "@/lib/auth/session";
import { getProfile } from "@/lib/data/snapshot";
import { APP_NAME } from "@/lib/brand";
import { toMgdl, unitLabel } from "@/lib/units";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<(typeof DIABETES_TYPES)[number], string> = {
  type1: "Type 1",
  type2: "Type 2",
  gestational: "Gestational",
  prediabetes: "Prediabetes",
  lada: "LADA",
  other: "Something else",
};
const REGIMEN_LABEL: Record<(typeof INSULIN_REGIMENS)[number], string> = {
  none: "No insulin",
  basal: "Background insulin only",
  basal_bolus: "Background plus mealtime insulin",
  pump: "An insulin pump",
  other: "Something else",
};

async function save(fd: FormData) {
  "use server";
  return requireAccount(async () => {
  const units = fd.get("units") === "mmol" ? "mmol" : "mgdl";
  const lowIn = Number(fd.get("targetLow"));
  const highIn = Number(fd.get("targetHigh"));
  const low = Number.isFinite(lowIn) && lowIn > 0 ? toMgdl(lowIn, units) : 70;
  const high = Number.isFinite(highIn) && highIn > 0 ? toMgdl(highIn, units) : 180;
  const now = new Date();
  await db
    .update(profileTable)
    .set({
      name: String(fd.get("name") ?? "").trim().slice(0, 60),
      diabetesType: (DIABETES_TYPES as readonly string[]).includes(String(fd.get("diabetesType"))) ? (String(fd.get("diabetesType")) as (typeof DIABETES_TYPES)[number]) : "type2",
      units,
      targetLowMgdl: Math.max(50, Math.min(150, low < high ? low : 70)),
      targetHighMgdl: Math.max(100, Math.min(300, high > low ? high : 180)),
      insulinRegimen: (INSULIN_REGIMENS as readonly string[]).includes(String(fd.get("insulinRegimen"))) ? (String(fd.get("insulinRegimen")) as (typeof INSULIN_REGIMENS)[number]) : "none",
      usesCgm: fd.get("usesCgm") === "on",
      pregnant: fd.get("pregnant") === "on",
      copilotStyle: ["simple", "standard", "clinical"].includes(String(fd.get("copilotStyle"))) ? (String(fd.get("copilotStyle")) as "simple" | "standard" | "clinical") : "standard",
      goals: String(fd.get("goals") ?? "").trim().slice(0, 600),
      onboarded: true,
      updatedAt: now,
    })
    .where(eq(profileTable.id, 1));
  redirect("/");
  });
}

export default async function Welcome() {
  return requireAccount(async () => {
  const p = await getProfile();
  if (p.onboarded) redirect("/");

  return (
    <>
      <HeroVideo name="morning" height="h-[46vh] min-h-[18rem]">
        <div className="eyebrow mb-2">Welcome to {APP_NAME}</div>
        <h1>Let&apos;s set this up once.</h1>
        <p className="lede mt-2 prose-measure">
          Nine questions, then you never see this page again. Everything here can be changed later in Settings.
        </p>
      </HeroVideo>
      <div className="page max-w-2xl">

      <Notice>
        <strong>What {APP_NAME} does and does not do.</strong> It tracks your glucose, food, insulin, movement, sleep and water, finds patterns in what you logged, and helps you get ready for appointments. It is not a medical device, it does not diagnose, and it never suggests or changes a medication or insulin dose. Your data stays on this device.
      </Notice>

      <form action={save} className="grid gap-5 mt-5">
        <Card>
          <div className="field">
            <label className="label" htmlFor="name">What should I call you?</label>
            <input id="name" name="name" className="input" maxLength={60} placeholder="Your first name" autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            <div className="field">
              <label className="label" htmlFor="diabetesType">Which kind of diabetes do you have?</label>
              <select id="diabetesType" name="diabetesType" className="select" defaultValue="type2">
                {DIABETES_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="units">Which units do you read your glucose in?</label>
              <select id="units" name="units" className="select" defaultValue="mgdl">
                <option value="mgdl">mg/dL (United States)</option>
                <option value="mmol">mmol/L (most other places)</option>
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <div className="eyebrow mb-2">Your target range</div>
          <p className="hint mb-3">
            The usual starting point is 70 to 180 {unitLabel("mgdl")}, or 3.9 to 10.0 mmol/L. If your care team gave you different numbers, use theirs. Enter them in the units you picked above.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="targetLow">Low end</label>
              <input id="targetLow" name="targetLow" className="input" type="number" step="0.1" defaultValue={70} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="targetHigh">High end</label>
              <input id="targetHigh" name="targetHigh" className="input" type="number" step="0.1" defaultValue={180} required />
            </div>
          </div>
        </Card>

        <Card>
          <div className="field">
            <label className="label" htmlFor="insulinRegimen">Do you take insulin?</label>
            <select id="insulinRegimen" name="insulinRegimen" className="select" defaultValue="none">
              {INSULIN_REGIMENS.map((r) => (
                <option key={r} value={r}>{REGIMEN_LABEL[r]}</option>
              ))}
            </select>
            <span className="hint">This only changes which screens you see. Steady records doses and never suggests them.</span>
          </div>
          <label className="flex items-start gap-2 text-sm mt-4">
            <input type="checkbox" name="usesCgm" className="mt-1" />
            <span>I wear a continuous glucose monitor, so I will be importing readings rather than typing them.</span>
          </label>
          <label className="flex items-start gap-2 text-sm mt-3">
            <input type="checkbox" name="pregnant" className="mt-1" />
            <span>I am pregnant. Targets are tighter in pregnancy and your specialist team leads that, so Steady will flag things sooner.</span>
          </label>
        </Card>

        <Card>
          <div className="field">
            <label className="label" htmlFor="copilotStyle">How should the Copilot talk to you?</label>
            <select id="copilotStyle" name="copilotStyle" className="select" defaultValue="standard">
              <option value="simple">Simple. Everyday words, short answers.</option>
              <option value="standard">Standard. Clear, with a term explained when it helps.</option>
              <option value="clinical">Clinical. More detail and proper terminology.</option>
            </select>
          </div>
          <div className="field mt-4">
            <label className="label" htmlFor="goals">What are you hoping to get out of this?</label>
            <textarea id="goals" name="goals" className="textarea" rows={3} maxLength={600} placeholder="Understand why my mornings run high. Stop feeling shaky in the afternoons. Walk more." />
            <span className="hint">In your own words. The Copilot reads this, and you can change it any time.</span>
          </div>
        </Card>

        <SubmitButton className="btn btn-lg" pendingText="Setting up…">Start using {APP_NAME}</SubmitButton>
      </form>
      </div>
    </>
  );
  });
}
