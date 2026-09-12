/**
 * Export everything as one JSON file. Reads every table and streams it back as a download. No
 * network call is made and nothing is sent anywhere.
 *
 * A route handler can read cookies, so it resolves its own account the same way a page does. That
 * matters more here than anywhere else on this screen: with no account in context the tables read
 * would not be this caller's, and an unscoped export hands one person another person's records in
 * a single file.
 */
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
import { requireAccount } from "@/lib/auth/session";
import { KNOWLEDGE_VERSION } from "@/lib/knowledge/clinical";
import { dateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  return requireAccount(async () => {
  const [
    profileRows,
    glucose,
    mealRows,
    insulin,
    exercise,
    sleep,
    hydration,
    journal,
    nudgeRows,
    questions,
    recipeRows,
    plan,
    grocery,
    packing,
    tripRows,
    ideas,
    meds,
    medTaken,
    symptoms,
    weights,
    bp,
    labs,
    appts,
    checkins,
    convos,
    msgs,
    audit,
    memory,
    cgs,
    cgComments,
  ] = await Promise.all([
    db.select().from(profile),
    db.select().from(glucoseReadings),
    db.select().from(meals),
    db.select().from(insulinDoses),
    db.select().from(exerciseSessions),
    db.select().from(sleepLogs),
    db.select().from(hydrationLogs),
    db.select().from(journalEntries),
    db.select().from(nudges),
    db.select().from(doctorQuestions),
    db.select().from(recipes),
    db.select().from(mealPlan),
    db.select().from(groceryItems),
    db.select().from(packingItems),
    db.select().from(trips),
    db.select().from(exerciseIdeas),
    db.select().from(medications),
    db.select().from(medicationTaken),
    db.select().from(symptomLogs),
    db.select().from(weightLogs),
    db.select().from(bloodPressureLogs),
    db.select().from(labResults),
    db.select().from(appointments),
    db.select().from(wellbeingCheckins),
    db.select().from(conversations),
    db.select().from(messages),
    db.select().from(aiAudit),
    db.select().from(memoryFacts),
    db.select().from(caregivers),
    db.select().from(caregiverComments),
  ]);

  const payload = {
    app: "Steady",
    exportedAt: new Date().toISOString(),
    knowledgeVersion: KNOWLEDGE_VERSION,
    note: "Glucose values are in mg/dL, which is how they are stored. Insulin and medication rows are what was recorded, never what was recommended.",
    tables: {
      profile: profileRows,
      glucoseReadings: glucose,
      meals: mealRows,
      insulinDoses: insulin,
      exerciseSessions: exercise,
      sleepLogs: sleep,
      hydrationLogs: hydration,
      journalEntries: journal,
      nudges: nudgeRows,
      doctorQuestions: questions,
      recipes: recipeRows,
      mealPlan: plan,
      groceryItems: grocery,
      packingItems: packing,
      trips: tripRows,
      exerciseIdeas: ideas,
      medications: meds,
      medicationTaken: medTaken,
      symptomLogs: symptoms,
      weightLogs: weights,
      bloodPressureLogs: bp,
      labResults: labs,
      appointments: appts,
      wellbeingCheckins: checkins,
      conversations: convos,
      messages: msgs,
      aiAudit: audit,
      memoryFacts: memory,
      /**
       * SHARE TOKENS ARE NOT EXPORTED.
       *
       * The export used to include the `caregivers` table verbatim, tokens and all. On a hosted
       * deployment everyone who has the demo passphrase can fetch this file, and `/share/*` sits
       * outside that gate by design, so one download handed someone permanent ungated read access
       * to the patient's health data that survived rotating the passphrase. There is no
       * token-rotation screen either, so the only remedy was delete and recreate every link.
       *
       * What a person actually needs from an export is the list of who they have shared with and
       * what each one can see. The credential itself is not data about them, it is a key, and keys
       * do not belong in a backup file.
       */
      caregivers: cgs.map((c) => ({
        id: c.id,
        name: c.name,
        relationship: c.relationship,
        canView: c.canView,
        canComment: c.canComment,
        alertKinds: c.alertKinds,
        status: c.status,
        createdAt: c.createdAt,
        lastSeenAt: c.lastSeenAt,
        token: "[not exported: a share link is a key, not a record]",
      })),
      caregiverComments: cgComments,
    },
  };

  const body = JSON.stringify(payload, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="steady-export-${dateKey(new Date())}.json"`,
      "Cache-Control": "no-store",
    },
  });
  });
}
