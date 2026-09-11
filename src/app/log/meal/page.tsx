import { asc, desc, gte } from "drizzle-orm";
import { z } from "zod";
import { db, meals, glucoseReadings, MEAL_SLOTS } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { fail, parseForm, zLocalDateTime, zNum, zOptNum, zOptStr, zStr } from "@/lib/actions";
import { getProfile } from "@/lib/data/snapshot";
import { estimateMealFromPhoto } from "@/lib/ai/mealPhoto";
import { mealResponse } from "@/lib/engines/mealResponse";
import { formatGlucose, unitLabel } from "@/lib/units";
import { addDays, dateKey, fmtDay, fmtTime, startOfDay, toDateTimeInput } from "@/lib/time";
import { newId } from "@/lib/ids";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/Form";
import { ActionForm, DeleteButton } from "../ActionForm";
import { deleteMeal } from "../actions";
import { revalidateLog } from "../revalidate";
import { SLOT_LABEL } from "../labels";
import { PhotoEstimate } from "./PhotoEstimate";
import { TagChips } from "./TagChips";
import type { LogResult, PhotoResult } from "../types";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

const ItemsSchema = z.array(
  z.object({
    name: z.string().max(80),
    portion: z.string().max(60),
    carbsG: z.coerce.number().min(0).max(1000),
    caloriesKcal: z.coerce.number().min(0).max(10000),
    confidence: z.enum(["low", "medium", "high"]),
  }),
);

const Form = z.object({
  name: zStr(200).min(1, "give the meal a name, even a rough one"),
  at: zLocalDateTime,
  slot: z.enum(MEAL_SLOTS),
  carbsG: zNum(0, 400),
  proteinG: zOptNum(0, 400),
  fatG: zOptNum(0, 400),
  fiberG: zOptNum(0, 200),
  caloriesKcal: zOptNum(0, 5000),
  tags: zStr(200).optional(),
  note: zOptStr(500),
  estimateSource: z.enum(["manual", "photo", "recipe"]).optional(),
  items: z.string().max(20000).optional(),
});

async function logMeal(_prev: LogResult | null, fd: FormData): Promise<LogResult> {
  "use server";
  return requireAccount(async () => {
  const parsed = parseForm(Form, fd);
  if ("error" in parsed) return fail(parsed.error);
  const d = parsed.data;

  const estimateSource = d.estimateSource ?? "manual";
  let itemsJson: string | null = null;
  if (estimateSource === "photo" && d.items && d.items.trim().length > 0) {
    let raw: unknown;
    try {
      raw = JSON.parse(d.items);
    } catch {
      return fail("Something went wrong with the photo estimate. Discard it above and the rest of the form will still save.");
    }
    const checked = ItemsSchema.safeParse(raw);
    if (!checked.success) {
      return fail("Something went wrong with the photo estimate. Discard it above and the rest of the form will still save.");
    }
    itemsJson = JSON.stringify(checked.data);
  }

  const id = newId();
  try {
    await db.insert(meals).values({
      id,
      at: d.at,
      slot: d.slot,
      name: d.name,
      carbsG: d.carbsG,
      proteinG: d.proteinG,
      fatG: d.fatG,
      fiberG: d.fiberG,
      caloriesKcal: d.caloriesKcal,
      tags: (d.tags ?? "").trim(),
      estimateSource: itemsJson ? "photo" : estimateSource === "photo" ? "manual" : estimateSource,
      items: itemsJson,
      note: d.note,
      createdAt: new Date(),
    });
  } catch {
    return fail("Could not save that meal. Please try again.");
  }

  revalidateLog("/log/meal", "/trends", "/plan", "/review");
  return {
    ok: true,
    id,
    message: `Saved. ${d.name}, ${Math.round(d.carbsG)} g carbs at ${fmtTime(d.at)}.`,
    detail: itemsJson ? "Marked as estimated from a photo, with the per-item confidence kept alongside it." : undefined,
  };
  });
}

async function estimatePhoto(_prev: PhotoResult | null, fd: FormData): Promise<PhotoResult> {
  "use server";
  return requireAccount(async () => {
  const f = fd.get("photo");
  if (!(f instanceof File) || f.size === 0) return { ok: false, error: "Choose a photo first." };
  if (!PHOTO_TYPES.includes(f.type)) return { ok: false, error: "Please choose a JPEG, PNG, WebP or GIF photo." };
  if (f.size > MAX_BYTES) return { ok: false, error: "That photo is over 5 MB. A smaller one works just as well." };

  const base64 = Buffer.from(await f.arrayBuffer()).toString("base64");
  const est = await estimateMealFromPhoto(base64, f.type);
  if ("error" in est) return { ok: false, error: est.error };
  return { ok: true, items: est.items, note: est.note, totalCarbsG: est.totalCarbsG, totalCaloriesKcal: est.totalCaloriesKcal };
  });
}

const RISE_LABEL = { gentle: "gentle rise", moderate: "moderate rise", spike: "big rise" } as const;

/** A rise can come out negative when the reading afterwards is lower. Say so plainly. */
function riseText(rise: number, band: keyof typeof RISE_LABEL, units: "mgdl" | "mmol"): string {
  if (rise < 0) return `${formatGlucose(Math.abs(rise), units)} ${unitLabel(units)} lower afterwards`;
  return `up ${formatGlucose(rise, units)} ${unitLabel(units)}, ${RISE_LABEL[band]}`;
}

export default async function LogMealPage() {
  return requireAccount(async () => {
  const profile = await getProfile();
  const u = profile.units;
  const now = new Date();
  const from = addDays(startOfDay(now), -6);

  const [mealRows, readings] = await Promise.all([
    db.select().from(meals).where(gte(meals.at, from)).orderBy(desc(meals.at)),
    db
      .select({ at: glucoseReadings.at, valueMgdl: glucoseReadings.valueMgdl })
      .from(glucoseReadings)
      .where(gte(glucoseReadings.at, addDays(from, -1)))
      .orderBy(asc(glucoseReadings.at)),
  ]);

  const todayKey = dateKey(now);
  const byDay = new Map<string, typeof mealRows>();
  for (const m of mealRows) {
    const k = dateKey(m.at);
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }
  const days = [...byDay.keys()].sort().reverse();

  return (
    <div className="page">
      <PageHeader
        eyebrow="Log"
        title="A meal"
        lede="Carbs are the number Trends leans on, so that one is worth getting roughly right. Everything else is optional."
      />

      <Card className="mb-6">
        <div className="eyebrow">Start from a photo, if that is easier</div>
        <div className="mt-3">
          <PhotoEstimate action={estimatePhoto} available={Boolean(process.env.ANTHROPIC_API_KEY)} />
        </div>
      </Card>

      <Card>
        <ActionForm action={logMeal} id="meal-form" pendingText="Saving the meal…">
          <input type="hidden" name="estimateSource" id="meal-estimate-source" defaultValue="manual" />
          <input type="hidden" name="items" id="meal-items" defaultValue="" />

          <div className="field">
            <label className="label" htmlFor="meal-name">
              What was it
            </label>
            <input id="meal-name" name="name" className="input" placeholder="Chicken and rice" maxLength={200} required />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="field">
              <label className="label" htmlFor="meal-at">
                When
              </label>
              <input id="meal-at" name="at" type="datetime-local" className="input" defaultValue={toDateTimeInput(now)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="meal-slot">
                Which meal
              </label>
              <select id="meal-slot" name="slot" className="select" defaultValue="snack">
                {MEAL_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="meal-carbs">
                Carbs in grams
              </label>
              <input
                id="meal-carbs"
                name="carbsG"
                className="input num"
                inputMode="decimal"
                step="1"
                min={0}
                max={400}
                placeholder="45"
                required
              />
            </div>
          </div>

          <details className="card-quiet p-3">
            <summary className="label cursor-pointer">The rest of the numbers, if you have them</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="field">
                <label className="label" htmlFor="meal-protein">
                  Protein g
                </label>
                <input id="meal-protein" name="proteinG" className="input num" inputMode="decimal" step="1" min={0} max={400} />
              </div>
              <div className="field">
                <label className="label" htmlFor="meal-fat">
                  Fat g
                </label>
                <input id="meal-fat" name="fatG" className="input num" inputMode="decimal" step="1" min={0} max={400} />
              </div>
              <div className="field">
                <label className="label" htmlFor="meal-fiber">
                  Fibre g
                </label>
                <input id="meal-fiber" name="fiberG" className="input num" inputMode="decimal" step="1" min={0} max={200} />
              </div>
              <div className="field">
                <label className="label" htmlFor="meal-calories">
                  Calories
                </label>
                <input id="meal-calories" name="caloriesKcal" className="input num" inputMode="decimal" step="1" min={0} max={5000} />
              </div>
            </div>
          </details>

          <TagChips />

          <div className="field">
            <label className="label" htmlFor="meal-note">
              Note
            </label>
            <textarea id="meal-note" name="note" className="textarea" rows={2} maxLength={500} placeholder="Ate later than usual" />
          </div>

          <div>
            <SubmitButton className="btn btn-lg">Save meal</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <section className="mt-8">
        <h2 className="mb-1">Today and the week behind you</h2>
        <p className="lede mb-3 prose-measure">
          The rise is the highest reading one to three hours after the meal minus the reading nearest to it. It only appears when both readings
          exist.
        </p>
        {mealRows.length === 0 ? (
          <EmptyState title="No meals logged in the last seven days" body="Save one above and it will appear here with its rise, once there are readings on both sides of it." />
        ) : (
          <div className="grid gap-4">
            {days.map((k) => (
              <div key={k}>
                <div className="eyebrow mb-2">{k === todayKey ? "Today" : fmtDay(byDay.get(k)![0].at)}</div>
                <ul className="card divide-y">
                  {byDay.get(k)!.map((m) => {
                    const r = mealResponse(m, readings);
                    return (
                      <li key={m.id} className="flex items-center gap-3 p-3 md:p-4">
                        <div className="w-16 shrink-0 num text-sm">{fmtTime(m.at)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{m.name}</span>
                            <span className="pill">{SLOT_LABEL[m.slot]}</span>
                            <span className="pill num">{Math.round(m.carbsG)} g carbs</span>
                            {r.rise !== null && r.band ? (
                              <span className="pill num">{riseText(r.rise, r.band, u)}</span>
                            ) : (
                              <span className="hint">No readings either side</span>
                            )}
                            {m.estimateSource === "photo" ? <span className="pill pill-slate">Photo estimate</span> : null}
                          </div>
                          {r.tags.length ? <div className="hint">{r.tags.join(", ")}</div> : null}
                          {m.note ? <div className="hint truncate">{m.note}</div> : null}
                        </div>
                        <DeleteButton action={deleteMeal} id={m.id} what="meal" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <Notice>
          Carb numbers here are for spotting your own patterns. Steady never turns them into a dose. What to do with insulin is between you and
          your prescriber.
        </Notice>
      </div>
    </div>
  );
  });
}
