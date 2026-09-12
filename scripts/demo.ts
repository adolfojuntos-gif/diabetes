/**
 * DEMO DATA — for looking at the app with something in it. Every row it writes is fictional and
 * it says so. `npm run demo:clear` removes exactly what it added and nothing else.
 *
 * The generator is a crude physiological sketch, not a model of anyone: a basal curve with a dawn
 * rise, meal bumps sized by carbohydrate, a dip after exercise, occasional lows in the small hours,
 * and one deliberately bad weekend. It exists so the pattern engine has something to find.
 *
 * It takes an ACCOUNT, because there is no single database any more. Without one every write here
 * would throw `NoAccountContextError`, which is the fail-closed default working as intended: this
 * script wrote to whatever database was in context, and after the split there is none.
 *
 *   npm run demo -- you@example.com
 *   npm run demo -- you@example.com --clear
 */
import "dotenv/config";
import { like, or, eq } from "drizzle-orm";
import { withAccount } from "../src/lib/db";
import { controlDb, accounts } from "../src/lib/db/control";
import { normalizeEmail } from "../src/lib/auth/passwords";
import {
  db,
  profile,
  glucoseReadings,
  meals,
  insulinDoses,
  exerciseSessions,
  sleepLogs,
  hydrationLogs,
  weightLogs,
  bloodPressureLogs,
  medications,
  labResults,
  appointments,
  wellbeingCheckins,
  journalEntries,
  nudges,
  doctorQuestions,
  memoryFacts,
  symptomLogs,
  conversations,
  messages,
  aiAudit,
} from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { dateKey, startOfDay, addDays } from "../src/lib/time";

const DEMO_TAG = "demo";
const DAYS = 45;

/** Deterministic pseudo-random so re-running gives the same demo. */
let seed = 20260911;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const jitter = (n: number) => (rnd() - 0.5) * 2 * n;

type MealSpec = { name: string; slot: "breakfast" | "lunch" | "dinner" | "snack"; hour: number; carbs: number; tags: string };

const WEEKDAY_MEALS: MealSpec[] = [
  { name: "Overnight oats with chia", slot: "breakfast", hour: 7.5, carbs: 34, tags: "homemade,high fibre" },
  { name: "Greek salad with chicken", slot: "lunch", hour: 12.5, carbs: 18, tags: "homemade" },
  { name: "Salmon, rice and broccoli", slot: "dinner", hour: 19, carbs: 45, tags: "homemade,rice" },
];
const WEEKEND_MEALS: MealSpec[] = [
  { name: "Pancakes and syrup", slot: "breakfast", hour: 10, carbs: 72, tags: "large portion" },
  { name: "Takeout pizza", slot: "lunch", hour: 14, carbs: 85, tags: "takeout,restaurant,large portion" },
  { name: "Pasta bolognese", slot: "dinner", hour: 20.5, carbs: 68, tags: "pasta,late" },
];

function glucoseAt(hour: number, dayMeals: MealSpec[], exerciseHour: number | null, badDay: boolean, shortSleep: boolean): number {
  let g = 105 + (badDay ? 28 : 0) + (shortSleep ? 16 : 0);
  // dawn rise 4am → 8am
  if (hour >= 3 && hour <= 9) g += 26 * Math.sin(((hour - 3) / 6) * Math.PI);
  // overnight drift down
  if (hour >= 0 && hour < 3) g -= 10;
  for (const m of dayMeals) {
    const dt = hour - m.hour;
    if (dt >= 0 && dt < 5) {
      const peak = m.carbs * (badDay ? 1.5 : 1.05);
      g += peak * Math.exp(-Math.pow((dt - 1.4) / 1.1, 2));
    }
  }
  if (exerciseHour !== null) {
    const dt = hour - exerciseHour;
    if (dt >= 0 && dt < 5) g -= 34 * Math.exp(-Math.pow((dt - 1.2) / 1.4, 2));
  }
  return Math.max(42, Math.min(360, Math.round(g + jitter(11))));
}

async function clear() {
  // Demo rows are tagged: meals/exercise/hydration carry note "demo"; readings carry importBatch "demo".
  await db.delete(glucoseReadings).where(eq(glucoseReadings.importBatch, DEMO_TAG));
  await db.delete(meals).where(eq(meals.note, DEMO_TAG));
  await db.delete(insulinDoses).where(eq(insulinDoses.note, DEMO_TAG));
  await db.delete(exerciseSessions).where(eq(exerciseSessions.note, DEMO_TAG));
  await db.delete(sleepLogs).where(eq(sleepLogs.note, DEMO_TAG));
  await db.delete(hydrationLogs);
  await db.delete(weightLogs);
  await db.delete(bloodPressureLogs);
  await db.delete(symptomLogs).where(eq(symptomLogs.note, DEMO_TAG));
  await db.delete(labResults).where(eq(labResults.note, DEMO_TAG));
  await db.delete(medications).where(eq(medications.note, DEMO_TAG));
  await db.delete(appointments).where(eq(appointments.note, DEMO_TAG));
  await db.delete(wellbeingCheckins);
  await db.delete(journalEntries);
  await db.delete(nudges);
  await db.delete(doctorQuestions);
  await db.delete(memoryFacts);
  await db.delete(aiAudit);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(profile).where(or(like(profile.name, "Demo%"), eq(profile.name, "")));
  console.log("Demo data removed. Seeded recipes, exercise ideas and packing items were left alone.");
}

/**
 * Exported so the deployment bootstrap can call it directly rather than spawning this file.
 * Spawning meant a shell command path, and a shell command path means one behaviour on Linux and
 * another on Windows, which is a difference nobody wants to discover during a boot.
 *
 * Assumes an account is already in context. `run()` below is the command-line wrapper.
 */
export async function writeDemoData() {
  if (process.argv.includes("--clear")) return clear();
  await clear();

  const now = new Date();
  await db
    .insert(profile)
    .values({
      id: 1,
      name: "Demo",
      diabetesType: "type2",
      units: "mgdl",
      targetLowMgdl: 70,
      targetHighMgdl: 180,
      insulinRegimen: "basal",
      usesCgm: false,
      hydrationGoalMl: 2000,
      sleepGoalMinutes: 450,
      dailyCarbTargetG: 150,
      copilotStyle: "standard",
      goals: "Walk after dinner most nights. Understand why my mornings run high.",
      onboarded: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: profile.id,
      set: { name: "Demo", onboarded: true, insulinRegimen: "basal", goals: "Walk after dinner most nights. Understand why my mornings run high.", updatedAt: now },
    });

  let nReadings = 0;
  let nMeals = 0;

  for (let d = DAYS - 1; d >= 0; d--) {
    const day = startOfDay(addDays(now, -d));
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    const dayMeals = weekend ? WEEKEND_MEALS : WEEKDAY_MEALS;
    const badDay = weekend && rnd() < 0.8;
    const shortSleep = rnd() < 0.25;
    const exerciseHour = !weekend && rnd() < 0.6 ? 20 : rnd() < 0.25 ? 17 : null;
    // A few days with nothing logged, because real life has those.
    const skipDay = rnd() < 0.12;

    // sleep
    const sleepMin = shortSleep ? 300 + Math.round(jitter(25)) : 430 + Math.round(jitter(45));
    const wake = new Date(day);
    wake.setHours(7, Math.round(rnd() * 40), 0, 0);
    const bed = new Date(wake.getTime() - sleepMin * 60_000);
    await db
      .insert(sleepLogs)
      .values({ id: newId(), wakeDate: dateKey(day), bedAt: bed, wakeAt: wake, minutes: sleepMin, quality: shortSleep ? 2 : rnd() < 0.5 ? 4 : 3, note: DEMO_TAG, createdAt: wake })
      .onConflictDoNothing();

    if (skipDay) continue;

    // readings: 4–6 a day, at plausible times
    const hours = [7.2, ...dayMeals.map((m) => m.hour + 2), 22.5];
    if (rnd() < 0.3) hours.push(2.5);
    for (const h of hours) {
      const at = new Date(day);
      at.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
      if (at > now) continue;
      let v = glucoseAt(h, dayMeals, exerciseHour, badDay, shortSleep);
      // a handful of real lows in the small hours, and one very low
      if (h < 4 && rnd() < 0.35) v = 58 - Math.round(rnd() * 10);
      if (d === 9 && h < 4) v = 51;
      await db
        .insert(glucoseReadings)
        .values({ id: newId(), at, valueMgdl: v, source: "manual", context: h < 8 ? "fasting" : h > 22 ? "bedtime" : "after_meal", importBatch: DEMO_TAG, createdAt: at })
        .onConflictDoNothing();
      nReadings++;
    }

    // meals
    for (const m of dayMeals) {
      const at = new Date(day);
      at.setHours(Math.floor(m.hour), Math.round((m.hour % 1) * 60), 0, 0);
      if (at > now) continue;
      await db.insert(meals).values({
        id: newId(),
        at,
        slot: m.slot,
        name: m.name,
        carbsG: m.carbs + Math.round(jitter(5)),
        proteinG: 20 + Math.round(jitter(8)),
        fiberG: m.tags.includes("fibre") ? 9 : 4,
        tags: m.tags,
        estimateSource: "manual",
        note: DEMO_TAG,
        createdAt: at,
      });
      nMeals++;
    }

    // basal insulin, recorded
    const basalAt = new Date(day);
    basalAt.setHours(22, 15, 0, 0);
    if (basalAt <= now) await db.insert(insulinDoses).values({ id: newId(), at: basalAt, kind: "basal", insulinName: "Glargine", units: 22, note: DEMO_TAG, createdAt: basalAt });

    // exercise
    if (exerciseHour !== null) {
      const at = new Date(day);
      at.setHours(exerciseHour, 10, 0, 0);
      if (at <= now) await db.insert(exerciseSessions).values({ id: newId(), at, kind: "walk", minutes: 22 + Math.round(jitter(8)), intensity: "moderate", note: DEMO_TAG, createdAt: at });
    }

    // water, 3–7 entries
    const glasses = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < glasses; i++) {
      const at = new Date(day);
      at.setHours(8 + i * 2, 0, 0, 0);
      if (at <= now) await db.insert(hydrationLogs).values({ id: newId(), at, ml: 250, createdAt: at });
    }

    // weight weekly, BP fortnightly
    if (d % 7 === 0) await db.insert(weightLogs).values({ id: newId(), at: wake, kg: 86.5 - (DAYS - d) * 0.03, createdAt: wake });
    if (d % 14 === 0) await db.insert(bloodPressureLogs).values({ id: newId(), at: wake, systolic: 134 + Math.round(jitter(6)), diastolic: 84 + Math.round(jitter(4)), pulse: 72, createdAt: wake });

    // check-ins on most days
    if (rnd() < 0.6)
      await db
        .insert(wellbeingCheckins)
        .values({ id: newId(), date: dateKey(day), feeling: shortSleep ? 2 : 4, energy: shortSleep ? 2 : 4, stress: badDay ? 4 : 2, unusual: shortSleep ? "Slept badly, felt foggy all morning." : null, wantToDiscuss: null, createdAt: wake })
        .onConflictDoNothing();
  }

  // one symptom episode
  const symAt = addDays(now, -9);
  symAt.setHours(3, 20, 0, 0);
  await db.insert(symptomLogs).values({ id: newId(), at: symAt, symptoms: "shaky,sweaty", severity: 2, note: DEMO_TAG, createdAt: symAt });

  // medications and labs
  await db.insert(medications).values([
    { id: newId(), name: "Metformin", doseText: "1000 mg twice a day with food", knowledgeId: "metformin", startedOn: "2023-04-10", active: true, note: DEMO_TAG, createdAt: now },
    { id: newId(), name: "Glargine", doseText: "22 units at bedtime", knowledgeId: "insulin_basal", startedOn: "2025-02-01", active: true, note: DEMO_TAG, createdAt: now },
    { id: newId(), name: "Atorvastatin", doseText: "20 mg at night", knowledgeId: "statin", startedOn: "2024-01-15", active: true, note: DEMO_TAG, createdAt: now },
  ]);

  const labDates = [addDays(now, -280), addDays(now, -190), addDays(now, -95), addDays(now, -12)];
  const a1cs = [8.4, 7.9, 7.5, 7.2];
  for (let i = 0; i < labDates.length; i++) {
    await db.insert(labResults).values({ id: newId(), at: labDates[i], testKey: "a1c", name: "Hemoglobin A1C", value: a1cs[i], unit: "%", refLow: null, refHigh: 5.7, labFlag: "H", verified: true, note: DEMO_TAG, createdAt: labDates[i] });
  }
  await db.insert(labResults).values([
    { id: newId(), at: labDates[3], testKey: "ldl", name: "LDL cholesterol", value: 104, unit: "mg/dL", refLow: null, refHigh: 100, labFlag: "H", verified: true, note: DEMO_TAG, createdAt: labDates[3] },
    { id: newId(), at: labDates[3], testKey: "egfr", name: "eGFR (kidney filtration)", value: 88, unit: "mL/min/1.73m2", refLow: 60, refHigh: null, labFlag: null, verified: true, note: DEMO_TAG, createdAt: labDates[3] },
    { id: newId(), at: labDates[3], testKey: "uacr", name: "Urine albumin-to-creatinine ratio", value: 14, unit: "mg/g", refLow: null, refHigh: 30, labFlag: null, verified: true, note: DEMO_TAG, createdAt: labDates[3] },
  ]);

  const apptAt = addDays(now, 11);
  apptAt.setHours(10, 30, 0, 0);
  await db.insert(appointments).values({ id: newId(), at: apptAt, withWhom: "Dr Alvarez", kind: "Diabetes review", location: "Clinic, 2nd floor", note: DEMO_TAG, createdAt: now });

  console.log(`Demo data written: ${nReadings} readings, ${nMeals} meals, ${DAYS} days of sleep, plus medications, labs and an appointment.`);
  console.log("All of it is fictional. Run `npm run demo:clear` to remove it.");
  console.log("Open the app and the pattern engine should find: weekend highs, a dawn rise, overnight lows, short-sleep days running higher, and post-meal spikes on the takeout meals.");
}

/** Resolve the account named on the command line, then run everything inside its context. */
async function run() {
  const email = process.argv.slice(2).find((a) => a.includes("@"));
  if (!email) {
    console.error("Which account? Pass an email:  npm run demo -- you@example.com");
    process.exit(2);
  }

  const rows = await controlDb().select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).limit(1);
  const account = rows[0];
  if (!account) {
    console.error(`No account for ${email}. Sign up first, or check the address.`);
    process.exit(2);
  }
  if (!account.provisionedAt) {
    console.error(`${email} has no database yet, so its signup did not finish.`);
    process.exit(2);
  }

  console.log(`Writing demo data into ${account.email} (${account.dbRef}).`);
  await withAccount({ accountId: account.id, dbRef: account.dbRef }, () => writeDemoData());
}

/**
 * Only run the command-line path when this file IS the command.
 *
 * Without the guard, importing it for its exported function runs the CLI wrapper as a side effect
 * of the import, which resolves an account from `process.argv` and exits the whole process with
 * "Which account?" before the caller gets anywhere. That is what the deployment bootstrap does, so
 * the boot would have died on an import.
 */
if (process.argv[1]?.endsWith("demo.ts")) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
