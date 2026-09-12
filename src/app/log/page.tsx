import Link from "next/link";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  glucoseReadings,
  meals,
  insulinDoses,
  exerciseSessions,
  hydrationLogs,
  sleepLogs,
  symptomLogs,
  weightLogs,
  bloodPressureLogs,
  medicationTaken,
  medications,
  type Symptom,
} from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { getProfile, usesInsulin } from "@/lib/data/snapshot";
import { unitLabel } from "@/lib/units";
import { dateKey, endOfDay, fmtTime, parseDateKey, startOfDay } from "@/lib/time";
import { PageHeader, GlucoseChip, EmptyState } from "@/components/ui";
import { XP } from "@/lib/game/naming";
import { DeleteButton } from "./ActionForm";
import {
  deleteGlucose,
  deleteMeal,
  deleteInsulin,
  deleteExercise,
  deleteSleep,
  deleteSymptom,
  deleteWeight,
  deleteBloodPressure,
  deleteMedicationTaken,
} from "./actions";
import { CONTEXT_LABEL, SLOT_LABEL, INSULIN_KIND_LABEL, INTENSITY_LABEL, QUALITY_LABEL, SEVERITY_LABEL, SYMPTOM_LABEL, group } from "./labels";

const LB_PER_KG = 0.45359237;

type Row = {
  key: string;
  at: Date;
  kind: string;
  body: React.ReactNode;
  action: React.ReactNode;
};

export default async function LogHubPage() {
  return requireAccount(async () => {
  const profile = await getProfile();
  const u = profile.units;
  const now = new Date();
  const from = startOfDay(now);
  const to = endOfDay(now);
  const todayKey = dateKey(now);

  const [readings, mealRows, doses, exercise, water, nights, symptoms, weights, bps, taken, meds] = await Promise.all([
    db.select().from(glucoseReadings).where(and(gte(glucoseReadings.at, from), lt(glucoseReadings.at, to))).orderBy(desc(glucoseReadings.at)),
    db.select().from(meals).where(and(gte(meals.at, from), lt(meals.at, to))).orderBy(desc(meals.at)),
    db.select().from(insulinDoses).where(and(gte(insulinDoses.at, from), lt(insulinDoses.at, to))).orderBy(desc(insulinDoses.at)),
    db.select().from(exerciseSessions).where(and(gte(exerciseSessions.at, from), lt(exerciseSessions.at, to))).orderBy(desc(exerciseSessions.at)),
    db.select().from(hydrationLogs).where(and(gte(hydrationLogs.at, from), lt(hydrationLogs.at, to))).orderBy(desc(hydrationLogs.at)),
    db.select().from(sleepLogs).where(eq(sleepLogs.wakeDate, todayKey)),
    db.select().from(symptomLogs).where(and(gte(symptomLogs.at, from), lt(symptomLogs.at, to))).orderBy(desc(symptomLogs.at)),
    db.select().from(weightLogs).where(and(gte(weightLogs.at, from), lt(weightLogs.at, to))).orderBy(desc(weightLogs.at)),
    db.select().from(bloodPressureLogs).where(and(gte(bloodPressureLogs.at, from), lt(bloodPressureLogs.at, to))).orderBy(desc(bloodPressureLogs.at)),
    db.select().from(medicationTaken).where(and(gte(medicationTaken.at, from), lt(medicationTaken.at, to))).orderBy(desc(medicationTaken.at)),
    db.select({ id: medications.id, name: medications.name }).from(medications),
  ]);

  const medName = new Map(meds.map((m) => [m.id, m.name]));

  /*
   * The XP on each tile is read from the approved rule configuration, never typed in here, so a
   * screen cannot promise an amount the engine will not pay. A tile worth nothing on its own says
   * nothing rather than inventing a figure.
   */
  const targets: { href: string; label: string; hint: string; xp: number }[] = [
    { href: "/log/glucose", label: "Glucose", hint: `A reading in ${unitLabel(u)}`, xp: XP.log },
    { href: "/log/food", label: "Look up a food", hint: "Search a plate, see the carbs", xp: 0 },
    { href: "/log/meal", label: "Meal", hint: "Carbs, or a photo estimate", xp: XP.meal },
    ...(usesInsulin(profile) ? [{ href: "/log/insulin", label: "Insulin", hint: "What you took, and when", xp: 0 }] : []),
    { href: "/move", label: "Movement", hint: "Minutes and how hard", xp: XP.move },
    { href: "/log/sleep", label: "Sleep", hint: "Last night, in one go", xp: XP.sleep },
    { href: "/log/water", label: "Water", hint: "One tap a glass", xp: XP.water },
    { href: "/log/more#symptoms", label: "Symptoms", hint: "How you are feeling", xp: 0 },
    { href: "/log/more#weight", label: "Weight", hint: "Kilograms or pounds", xp: 0 },
    { href: "/log/more#blood-pressure", label: "Blood pressure", hint: "Top and bottom number", xp: 0 },
    { href: "/log/more#medications", label: "Medication taken", hint: "Tick it off your list", xp: 0 },
  ];

  const rows: Row[] = [];

  for (const r of readings) {
    rows.push({
      key: `g-${r.id}`,
      at: r.at,
      kind: "Glucose",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <GlucoseChip mgdl={r.valueMgdl} units={u} low={profile.targetLowMgdl} high={profile.targetHighMgdl} />
          <span className="text-sm muted">{r.context ? CONTEXT_LABEL[r.context] : "No context"}</span>
          {r.source === "cgm_import" ? <span className="pill">From an import</span> : null}
          {r.note ? <span className="hint">{r.note}</span> : null}
        </div>
      ),
      action: <DeleteButton action={deleteGlucose} id={r.id} what="reading" />,
    });
  }

  for (const m of mealRows) {
    rows.push({
      key: `m-${m.id}`,
      at: m.at,
      kind: "Meal",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{m.name}</span>
          <span className="pill num">{Math.round(m.carbsG)} g carbs</span>
          <span className="pill">{SLOT_LABEL[m.slot]}</span>
          {m.estimateSource === "photo" ? <span className="pill pill-slate">Photo estimate</span> : null}
        </div>
      ),
      action: <DeleteButton action={deleteMeal} id={m.id} what="meal" />,
    });
  }

  for (const d of doses) {
    rows.push({
      key: `i-${d.id}`,
      at: d.at,
      kind: "Insulin",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <span className="num font-semibold">{d.units} u</span>
          <span className="pill">{INSULIN_KIND_LABEL[d.kind]}</span>
          {d.insulinName ? <span className="text-sm muted">{d.insulinName}</span> : null}
        </div>
      ),
      action: <DeleteButton action={deleteInsulin} id={d.id} what="insulin entry" />,
    });
  }

  for (const e of exercise) {
    rows.push({
      key: `e-${e.id}`,
      at: e.at,
      kind: "Movement",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{e.kind}</span>
          <span className="pill num">{e.minutes} min</span>
          <span className="pill">{INTENSITY_LABEL[e.intensity]}</span>
        </div>
      ),
      action: <DeleteButton action={deleteExercise} id={e.id} what="movement entry" />,
    });
  }

  if (water.length) {
    const totalMl = water.reduce((a, w) => a + w.ml, 0);
    rows.push({
      key: "water-total",
      at: water[0].at,
      kind: "Water",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <span className="num font-semibold">{group(totalMl)} ml</span>
          <span className="hint">
            {water.length} {water.length === 1 ? "drink" : "drinks"} so far, goal {group(profile.hydrationGoalMl)} ml
          </span>
        </div>
      ),
      action: (
        <Link href="/log/water" className="btn btn-ghost btn-sm shrink-0">
          Open
        </Link>
      ),
    });
  }

  for (const n of nights) {
    rows.push({
      key: `s-${n.id}`,
      at: n.wakeAt,
      kind: "Sleep",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <span className="num font-semibold">{(n.minutes / 60).toFixed(1)} h</span>
          <span className="pill">{QUALITY_LABEL[n.quality] ?? "OK"}</span>
          <span className="hint num">
            {fmtTime(n.bedAt)} to {fmtTime(n.wakeAt)}
          </span>
        </div>
      ),
      action: <DeleteButton action={deleteSleep} id={n.id} what="night" />,
    });
  }

  for (const s of symptoms) {
    rows.push({
      key: `y-${s.id}`,
      at: s.at,
      kind: "Symptoms",
      body: (
        <div>
          <div className="text-sm">
            {s.symptoms
              .split(",")
              .map((k) => SYMPTOM_LABEL[k.trim() as Symptom] ?? k.trim())
              .join(", ")}
          </div>
          <div className="hint">{SEVERITY_LABEL[s.severity] ?? "Moderate"}</div>
        </div>
      ),
      action: <DeleteButton action={deleteSymptom} id={s.id} what="symptom note" />,
    });
  }

  for (const w of weights) {
    rows.push({
      key: `w-${w.id}`,
      at: w.at,
      kind: "Weight",
      body: (
        <span className="num font-semibold">
          {Math.round(w.kg * 10) / 10} kg <span className="hint">· {Math.round((w.kg / LB_PER_KG) * 10) / 10} lb</span>
        </span>
      ),
      action: <DeleteButton action={deleteWeight} id={w.id} what="weight entry" />,
    });
  }

  for (const b of bps) {
    rows.push({
      key: `b-${b.id}`,
      at: b.at,
      kind: "Blood pressure",
      body: (
        <span className="num font-semibold">
          {b.systolic}/{b.diastolic}
          {b.pulse ? <span className="hint"> · pulse {b.pulse}</span> : null}
        </span>
      ),
      action: <DeleteButton action={deleteBloodPressure} id={b.id} what="blood pressure entry" />,
    });
  }

  for (const t of taken) {
    rows.push({
      key: `t-${t.id}`,
      at: t.at,
      kind: "Medication",
      body: <span className="text-sm">{medName.get(t.medicationId) ?? "A medication you have since put away"}</span>,
      action: <DeleteButton action={deleteMedicationTaken} id={t.id} what="medication entry" />,
    });
  }

  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="page">
      <PageHeader
        eyebrow="Log"
        title="Gather"
        lede="Everything you write down here is what your world is built from. It takes a few seconds and none of it judges you."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {targets.map((t) => (
          <Link key={t.href} href={t.href} className="card flex min-h-[96px] flex-col justify-between p-4 hover:shadow-lift">
            <span className="flex items-start justify-between gap-2">
              <span className="font-display text-xl">{t.label}</span>
              {t.xp > 0 ? (
                <span className="pill num shrink-0" style={{ background: "var(--bloom-soft)", color: "var(--bloom)" }}>
                  +{t.xp}
                </span>
              ) : null}
            </span>
            <span className="hint">{t.hint}</span>
          </Link>
        ))}
      </div>

      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2>Today so far</h2>
          <span className="hint">{parseDateKey(todayKey).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing written down yet today"
            body="Pick anything above. A single reading is enough to start the day with."
            cta="Log a glucose reading"
            href="/log/glucose"
          />
        ) : (
          <ul className="card divide-y">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 p-3 md:p-4">
                <div className="w-20 shrink-0">
                  <div className="num text-sm">{fmtTime(r.at)}</div>
                  <div className="hint">{r.kind}</div>
                </div>
                <div className="min-w-0 flex-1">{r.body}</div>
                {r.action}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
  });
}
