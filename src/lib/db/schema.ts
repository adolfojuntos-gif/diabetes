/**
 * STEADY - schema.
 *
 * Rules the whole product rests on, enforced here rather than in a screen:
 *
 * 1. GLUCOSE IS STORED IN mg/dL, ALWAYS. `valueMgdl` is the only glucose column anywhere.
 *    mmol/L is a display preference converted at the edge (lib/units.ts). A reading can never
 *    be stored in the wrong unit because there is no column for the other unit.
 * 2. INSULIN IS RECORDED, NEVER RECOMMENDED. `insulinDoses` holds what the person took. No table
 *    and no function in this codebase produces a dose. See docs/ARCHITECTURE.md § Invariants.
 * 3. NUMBERS COME FROM THE ENGINE, NEVER THE MODEL. `journalEntries.patternsSnapshot` is the
 *    engine's computed evidence at the moment of writing; the AI reflection is text ABOUT it.
 *
 * Single-person app: there is exactly one profile row (id = 1). Written for SQLite (libsql) so it
 * runs with no services; every column type has a one-to-one Postgres equivalent.
 */
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp" });
const bool = (name: string) => integer(name, { mode: "boolean" });

/* ---------------------------- vocabularies ---------------------------- */

export const DIABETES_TYPES = ["type1", "type2", "gestational", "prediabetes", "lada", "other"] as const;
export type DiabetesType = (typeof DIABETES_TYPES)[number];

export const UNITS = ["mgdl", "mmol"] as const;
export type Units = (typeof UNITS)[number];

export const INSULIN_REGIMENS = ["none", "basal", "basal_bolus", "pump", "other"] as const;
export type InsulinRegimen = (typeof INSULIN_REGIMENS)[number];

export const READING_SOURCES = ["manual", "meter", "cgm_import"] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export const READING_CONTEXTS = [
  "fasting",
  "before_meal",
  "after_meal",
  "bedtime",
  "overnight",
  "exercise",
  "sick",
  "other",
] as const;
export type ReadingContext = (typeof READING_CONTEXTS)[number];

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const INSULIN_KINDS = ["bolus", "basal", "correction"] as const;
export type InsulinKind = (typeof INSULIN_KINDS)[number];

export const EXERCISE_INTENSITIES = ["light", "moderate", "vigorous"] as const;
export type ExerciseIntensity = (typeof EXERCISE_INTENSITIES)[number];

export const NUDGE_KINDS = ["pattern", "gap", "win", "safety", "reminder"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** What the living world can produce. Mirrored in `engines/world.ts`, which owns the rules. */
export const WORLD_EVENT_KINDS = ["growth", "arrival", "sighting", "landmark", "season"] as const;
export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number];

/** `habit` is something the person did. `milestone` is a sustained change in their own trend. */
export const AWARD_KINDS = ["habit", "milestone"] as const;
export type AwardKind = (typeof AWARD_KINDS)[number];

export const QUESTION_SOURCES = ["pattern", "manual"] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const GROCERY_AISLES = [
  "produce",
  "protein",
  "dairy",
  "grains",
  "pantry",
  "frozen",
  "snacks",
  "drinks",
  "other",
] as const;
export type GroceryAisle = (typeof GROCERY_AISLES)[number];

export const PACKING_CATEGORIES = [
  "glucose_monitoring",
  "insulin_and_delivery",
  "lows_kit",
  "documents",
  "food_and_drink",
  "comfort_and_care",
  "tech",
] as const;
export type PackingCategory = (typeof PACKING_CATEGORIES)[number];

/* ------------------------------- profile ------------------------------- */

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(), // always 1
  name: text("name").notNull().default(""),
  diabetesType: text("diabetes_type", { enum: DIABETES_TYPES }).notNull().default("type2"),
  units: text("units", { enum: UNITS }).notNull().default("mgdl"),
  /** Personal target range, mg/dL. Defaults are the international consensus 70–180. */
  targetLowMgdl: integer("target_low_mgdl").notNull().default(70),
  targetHighMgdl: integer("target_high_mgdl").notNull().default(180),
  insulinRegimen: text("insulin_regimen", { enum: INSULIN_REGIMENS }).notNull().default("none"),
  usesCgm: bool("uses_cgm").notNull().default(false),
  hydrationGoalMl: integer("hydration_goal_ml").notNull().default(2000),
  sleepGoalMinutes: integer("sleep_goal_minutes").notNull().default(450),
  dailyCarbTargetG: integer("daily_carb_target_g"), // optional, set with their care team
  /** Reminder times "HH:MM", comma separated; empty = no reminders. */
  reminderTimes: text("reminder_times").notNull().default(""),
  quietStart: text("quiet_start").notNull().default("22:00"),
  quietEnd: text("quiet_end").notNull().default("07:00"),
  copilotStyle: text("copilot_style", { enum: ["simple", "standard", "clinical"] }).notNull().default("standard"),
  /** Free text goals the person wrote for themselves; shown in the morning brief. */
  goals: text("goals").notNull().default(""),
  pregnant: bool("pregnant").notNull().default(false),
  birthYear: integer("birth_year"),
  onboarded: bool("onboarded").notNull().default(false),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/* ------------------------------- glucose ------------------------------- */

export const glucoseReadings = sqliteTable(
  "glucose_readings",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    valueMgdl: integer("value_mgdl").notNull(),
    source: text("source", { enum: READING_SOURCES }).notNull().default("manual"),
    context: text("context", { enum: READING_CONTEXTS }),
    note: text("note"),
    /** Import batch, so a bad import can be undone as a unit. */
    importBatch: text("import_batch"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("glucose_at_idx").on(t.at),
    // Same instant from the same source is the same reading. CGM re-imports are idempotent.
    uniqueIndex("glucose_at_source_uq").on(t.at, t.source),
  ],
);

/* -------------------------------- meals -------------------------------- */

export const meals = sqliteTable(
  "meals",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    slot: text("slot", { enum: MEAL_SLOTS }).notNull().default("snack"),
    name: text("name").notNull(),
    carbsG: real("carbs_g").notNull().default(0),
    proteinG: real("protein_g"),
    fatG: real("fat_g"),
    fiberG: real("fiber_g"),
    /** Comma separated free tags: "pasta,restaurant,late". */
    tags: text("tags").notNull().default(""),
    recipeId: text("recipe_id"),
    /** Estimated calories; optional and always an estimate. */
    caloriesKcal: real("calories_kcal"),
    /**
     * Where the numbers came from. "photo" means the model estimated them from a picture and the
     * person accepted or corrected them. The photo itself is never stored.
     */
    estimateSource: text("estimate_source", { enum: ["manual", "photo", "recipe"] }).notNull().default("manual"),
    /** JSON array of { name, portion, carbsG, caloriesKcal, confidence } for photo-estimated meals. */
    items: text("items"),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("meals_at_idx").on(t.at)],
);

/* ------------------------------- insulin ------------------------------- */

export const insulinDoses = sqliteTable(
  "insulin_doses",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    kind: text("kind", { enum: INSULIN_KINDS }).notNull(),
    insulinName: text("insulin_name").notNull().default(""),
    units: real("units").notNull(),
    mealId: text("meal_id"),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("insulin_at_idx").on(t.at)],
);

/* ------------------------------- exercise ------------------------------ */

export const exerciseSessions = sqliteTable(
  "exercise_sessions",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    kind: text("kind").notNull(),
    minutes: integer("minutes").notNull(),
    intensity: text("intensity", { enum: EXERCISE_INTENSITIES }).notNull().default("moderate"),
    ideaId: text("idea_id"),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("exercise_at_idx").on(t.at)],
);

/* -------------------------------- sleep -------------------------------- */

export const sleepLogs = sqliteTable(
  "sleep_logs",
  {
    id: text("id").primaryKey(),
    /** The morning this sleep ended, "YYYY-MM-DD" local. One row per morning. */
    wakeDate: text("wake_date").notNull(),
    bedAt: ts("bed_at").notNull(),
    wakeAt: ts("wake_at").notNull(),
    minutes: integer("minutes").notNull(),
    quality: integer("quality").notNull().default(3), // 1..5
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("sleep_wake_date_uq").on(t.wakeDate)],
);

/* ------------------------------ hydration ------------------------------ */

export const hydrationLogs = sqliteTable(
  "hydration_logs",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    ml: integer("ml").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("hydration_at_idx").on(t.at)],
);

/* ------------------------------- journal ------------------------------- */

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    body: text("body").notNull(),
    mood: integer("mood"), // 1..5
    /** JSON: the engine's PatternReport at the time of writing. The model reads this; it never computes it. */
    patternsSnapshot: text("patterns_snapshot"),
    /** The companion's reply. `reflectionSource` says who wrote it. */
    reflection: text("reflection"),
    reflectionSource: text("reflection_source", { enum: ["model", "engine"] }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("journal_at_idx").on(t.at)],
);

/* -------------------------------- nudges ------------------------------- */

export const nudges = sqliteTable(
  "nudges",
  {
    id: text("id").primaryKey(),
    /** "<patternKey>:<isoWeek>". One nudge per pattern per week. */
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind", { enum: NUDGE_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Where tapping it goes: "/trends", "/plan", ... */
    href: text("href"),
    createdAt: ts("created_at").notNull(),
    readAt: ts("read_at"),
    dismissedAt: ts("dismissed_at"),
  },
  (t) => [uniqueIndex("nudges_dedupe_uq").on(t.dedupeKey)],
);

/* --------------------------- doctor questions -------------------------- */

export const doctorQuestions = sqliteTable(
  "doctor_questions",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    /** The evidence line the pattern engine attached, so the question arrives with its numbers. */
    evidence: text("evidence"),
    source: text("source", { enum: QUESTION_SOURCES }).notNull().default("manual"),
    patternKey: text("pattern_key"),
    asked: bool("asked").notNull().default(false),
    answer: text("answer"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("doctor_q_pattern_uq").on(t.patternKey)],
);

/* ------------------------------- recipes ------------------------------- */

export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slot: text("slot", { enum: MEAL_SLOTS }).notNull(),
  carbsG: real("carbs_g").notNull(),
  proteinG: real("protein_g").notNull(),
  fiberG: real("fiber_g").notNull(),
  minutes: integer("minutes").notNull(),
  /** Comma separated: "high-fiber,vegetarian,quick,no-cook,low-gi". */
  tags: text("tags").notNull().default(""),
  /** JSON array of { name, qty, aisle }. */
  ingredients: text("ingredients").notNull(),
  /** JSON array of strings. */
  steps: text("steps").notNull(),
  whyItWorks: text("why_it_works").notNull(),
});

export const mealPlan = sqliteTable(
  "meal_plan",
  {
    id: text("id").primaryKey(),
    /** Monday of the week, "YYYY-MM-DD". */
    weekOf: text("week_of").notNull(),
    day: integer("day").notNull(), // 0 = Monday .. 6 = Sunday
    slot: text("slot", { enum: MEAL_SLOTS }).notNull(),
    recipeId: text("recipe_id").notNull(),
  },
  (t) => [uniqueIndex("meal_plan_cell_uq").on(t.weekOf, t.day, t.slot)],
);

export const groceryItems = sqliteTable(
  "grocery_items",
  {
    id: text("id").primaryKey(),
    weekOf: text("week_of").notNull(),
    name: text("name").notNull(),
    qty: text("qty").notNull().default(""),
    aisle: text("aisle", { enum: GROCERY_AISLES }).notNull().default("other"),
    fromRecipeId: text("from_recipe_id"),
    checked: bool("checked").notNull().default(false),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("grocery_week_idx").on(t.weekOf)],
);

/* ---------------------------- packing checklist ---------------------------- */

export const packingItems = sqliteTable("packing_items", {
  id: text("id").primaryKey(),
  category: text("category", { enum: PACKING_CATEGORIES }).notNull(),
  label: text("label").notNull(),
  /** Per-day quantity for consumables; the screen multiplies by trip days and adds a spare margin. */
  perDay: real("per_day"),
  unit: text("unit"),
  tip: text("tip"),
  /** Only shown when the profile matches: "insulin", "cgm", "pump", or null for everyone. */
  onlyIf: text("only_if", { enum: ["insulin", "cgm", "pump"] }),
  custom: bool("custom").notNull().default(false),
  checked: bool("checked").notNull().default(false),
  sort: integer("sort").notNull().default(0),
});

export const trips = sqliteTable("trips", {
  id: integer("id").primaryKey(), // always 1: the next trip
  name: text("name").notNull().default(""),
  days: integer("days").notNull().default(7),
  spareFraction: real("spare_fraction").notNull().default(0.5),
  updatedAt: ts("updated_at").notNull(),
});

/* -------------------------- exercise inspiration -------------------------- */

export const exerciseIdeas = sqliteTable("exercise_ideas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // walk, strength, mobility, cardio, play
  minutes: integer("minutes").notNull(),
  intensity: text("intensity", { enum: EXERCISE_INTENSITIES }).notNull(),
  /** "after_meal", "morning", "anytime", "low_energy", "travel", "no_equipment" */
  tags: text("tags").notNull().default(""),
  body: text("body").notNull(),
  glucoseNote: text("glucose_note").notNull(),
});

/* ============================ CLINICAL COPILOT ============================ */

export const COPILOT_STYLES = ["simple", "standard", "clinical"] as const;
export type CopilotStyle = (typeof COPILOT_STYLES)[number];

export const COPILOT_MODES = ["talk", "symptoms", "labs", "appointment", "checkin"] as const;
export type CopilotMode = (typeof COPILOT_MODES)[number];

/**
 * The three places this app spends money on a model. Every one of them is metered, because on a
 * hosted deployment an unmetered paid endpoint is somebody else's budget.
 */
export const AI_FEATURES = ["copilot", "coach", "photo", "gamemaster"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Output of the deterministic safety engine. Ordered most to least severe. */
export const TRIAGE_LEVELS = ["emergency", "urgent", "clinic", "general"] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];

export const SYMPTOMS = [
  "shaky", "sweaty", "confused", "dizzy", "headache", "blurred_vision", "very_thirsty",
  "frequent_urination", "fatigue", "nausea", "vomiting", "abdominal_pain", "fruity_breath",
  "rapid_breathing", "chest_pain", "short_of_breath", "numbness_tingling", "foot_wound",
  "fever", "unable_to_keep_fluids", "one_sided_weakness", "slurred_speech", "fainted", "seizure",
  "irritable", "hungry", "heart_racing", "slow_healing", "other",
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

/** Medications the person reports taking. Recorded as they typed it. Never adjusted by the app. */
export const medications = sqliteTable("medications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Free text exactly as the person entered it: "500 mg twice a day with food". */
  doseText: text("dose_text").notNull().default(""),
  /** Optional link into the controlled knowledge layer (data/knowledge/medications.json id). */
  knowledgeId: text("knowledge_id"),
  startedOn: text("started_on"),
  active: bool("active").notNull().default(true),
  note: text("note"),
  createdAt: ts("created_at").notNull(),
});

export const medicationTaken = sqliteTable(
  "medication_taken",
  {
    id: text("id").primaryKey(),
    medicationId: text("medication_id").notNull(),
    at: ts("at").notNull(),
    note: text("note"),
  },
  (t) => [index("med_taken_at_idx").on(t.at)],
);

export const symptomLogs = sqliteTable(
  "symptom_logs",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    /** Comma separated Symptom keys. */
    symptoms: text("symptoms").notNull(),
    severity: integer("severity").notNull().default(2), // 1 mild .. 3 severe
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("symptom_at_idx").on(t.at)],
);

export const weightLogs = sqliteTable(
  "weight_logs",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    kg: real("kg").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("weight_at_idx").on(t.at)],
);

export const bloodPressureLogs = sqliteTable(
  "blood_pressure_logs",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    systolic: integer("systolic").notNull(),
    diastolic: integer("diastolic").notNull(),
    pulse: integer("pulse"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("bp_at_idx").on(t.at)],
);

/**
 * Lab results as the laboratory reported them. Reference ranges are stored ONLY when the lab
 * supplied them; the app never fills one in. `verified` is set when the person confirms an
 * extracted value.
 */
export const labResults = sqliteTable(
  "lab_results",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    /** Normalised test key when recognised ("a1c", "ldl", "egfr", "uacr", ...), else null. */
    testKey: text("test_key"),
    name: text("name").notNull(),
    value: real("value").notNull(),
    unit: text("unit").notNull().default(""),
    refLow: real("ref_low"),
    refHigh: real("ref_high"),
    /** The lab's own flag if given: "H", "L", "". */
    labFlag: text("lab_flag"),
    verified: bool("verified").notNull().default(false),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("lab_at_idx").on(t.at)],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    withWhom: text("with_whom").notNull().default(""),
    kind: text("kind").notNull().default(""),
    location: text("location").notNull().default(""),
    /** The prep brief, once generated. */
    brief: text("brief"),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("appt_at_idx").on(t.at)],
);

export const wellbeingCheckins = sqliteTable(
  "wellbeing_checkins",
  {
    id: text("id").primaryKey(),
    /** One per local day. */
    date: text("date").notNull(),
    feeling: integer("feeling").notNull(), // 1..5
    energy: integer("energy"),
    stress: integer("stress"),
    unusual: text("unusual"),
    wantToDiscuss: text("want_to_discuss"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("checkin_date_uq").on(t.date)],
);

/** A Copilot conversation. One mode per conversation. */
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    mode: text("mode", { enum: COPILOT_MODES }).notNull().default("talk"),
    title: text("title").notNull().default(""),
    /** Structured state for guided flows (symptom encounter step, lab extraction awaiting verify). JSON. */
    state: text("state"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("conv_updated_idx").on(t.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    body: text("body").notNull(),
    /** Triage level the safety engine attached to this turn, if evaluated. Rendered as a banner by the app. */
    triageLevel: text("triage_level", { enum: TRIAGE_LEVELS }),
    /** JSON: follow-up questions the model proposed, knowledge ids used. */
    meta: text("meta"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("msg_conv_idx").on(t.conversationId, t.createdAt)],
);

/**
 * Audit trail for every clinically relevant AI response. Stores WHAT was accessed and WHICH rules
 * fired — not the person's health data itself, which already lives in its own tables.
 */
export const aiAudit = sqliteTable(
  "ai_audit",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    mode: text("mode", { enum: COPILOT_MODES }).notNull(),
    /** The person's question, so the response can be judged later. */
    userQuestion: text("user_question").notNull(),
    /** JSON array of data windows / tables consulted: ["glucose:30d", "meals:7d", "labs"]. */
    dataAccessed: text("data_accessed").notNull(),
    /** JSON array of knowledge item ids retrieved. */
    knowledgeUsed: text("knowledge_used").notNull(),
    /** JSON array of { ruleId, fired }. */
    safetyRules: text("safety_rules").notNull(),
    triageLevel: text("triage_level", { enum: TRIAGE_LEVELS }).notNull(),
    /**
     * Which paid feature this was. The audit could not previously tell a photo estimate from a chat
     * message, because both recorded mode "talk", and the spend limiter counts per feature.
     */
    feature: text("feature", { enum: AI_FEATURES }).notNull().default("copilot"),
    /** "model" when Claude answered, "engine" when the deterministic flow answered. */
    responder: text("responder", { enum: ["model", "engine"] }).notNull(),
    model: text("model"),
    /** Set when the dose-language filter rewrote part of the reply. */
    filtered: bool("filtered").notNull().default(false),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);

/* ========================= PERSONAL DIABETES MEMORY ========================= */

export const MEMORY_KINDS = [
  "pattern",              // engine-detected, upserted each run with first/last seen
  "question_asked",       // things the person asked the Copilot
  "goal",
  "preferred_food",
  "routine",
  "appointment_summary",
  "confirmed_observation", // the person said "yes, that's true"
  "note",                  // free text the person added themselves
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * What the system knows, as a list the person can read, correct and delete. Every fact names its
 * source. The Copilot is handed this table and nothing else as "memory" — it cannot remember
 * anything that is not written here.
 */
export const memoryFacts = sqliteTable(
  "memory_facts",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    /** Stable key for upserts: pattern key, normalised question, food name. */
    key: text("key").notNull(),
    text: text("text").notNull(),
    evidence: text("evidence"),
    source: text("source", { enum: ["engine", "user", "copilot"] }).notNull(),
    confirmed: bool("confirmed").notNull().default(false),
    firstSeen: ts("first_seen").notNull(),
    lastSeen: ts("last_seen").notNull(),
    timesSeen: integer("times_seen").notNull().default(1),
  },
  (t) => [uniqueIndex("memory_kind_key_uq").on(t.kind, t.key)],
);

/* ============================== CAREGIVER MODE ============================== */

/**
 * A trusted person with a permission-scoped link. Version 1 has no accounts: the link token is
 * the credential, the patient can revoke it at any time, and the server renders ONLY the sections
 * the permissions allow. Alerts reach the caregiver in their view; there is no email/push delivery.
 */
export const CAREGIVER_SCOPES = ["glucose", "meals", "insulin", "activity", "sleep", "notes", "labs", "medications"] as const;
export type CaregiverScope = (typeof CAREGIVER_SCOPES)[number];

export const caregivers = sqliteTable(
  "caregivers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    relationship: text("relationship").notNull().default(""),
    token: text("token").notNull(),
    /** Comma separated CaregiverScope values they can VIEW. Anything not listed is invisible. */
    canView: text("can_view").notNull().default(""),
    canComment: bool("can_comment").notNull().default(false),
    /** Comma separated NudgeKind values they receive in their alert feed ("safety,pattern"). */
    alertKinds: text("alert_kinds").notNull().default(""),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    createdAt: ts("created_at").notNull(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [uniqueIndex("caregiver_token_uq").on(t.token)],
);

export const caregiverComments = sqliteTable(
  "caregiver_comments",
  {
    id: text("id").primaryKey(),
    caregiverId: text("caregiver_id").notNull(),
    at: ts("at").notNull(),
    body: text("body").notNull(),
    /** Optional day the comment is about, "YYYY-MM-DD". */
    aboutDate: text("about_date"),
    readAt: ts("read_at"),
  },
  (t) => [index("cg_comment_at_idx").on(t.at)],
);

export type MemoryFact = typeof memoryFacts.$inferSelect;
export type Caregiver = typeof caregivers.$inferSelect;
export type CaregiverComment = typeof caregiverComments.$inferSelect;

export type Medication = typeof medications.$inferSelect;
export type SymptomLog = typeof symptomLogs.$inferSelect;
export type WeightLog = typeof weightLogs.$inferSelect;
export type BloodPressureLog = typeof bloodPressureLogs.$inferSelect;
export type LabResult = typeof labResults.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type WellbeingCheckin = typeof wellbeingCheckins.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AiAudit = typeof aiAudit.$inferSelect;

export type Profile = typeof profile.$inferSelect;
export type GlucoseReading = typeof glucoseReadings.$inferSelect;
export type Meal = typeof meals.$inferSelect;
export type InsulinDose = typeof insulinDoses.$inferSelect;
export type ExerciseSession = typeof exerciseSessions.$inferSelect;
export type SleepLog = typeof sleepLogs.$inferSelect;
export type HydrationLog = typeof hydrationLogs.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Nudge = typeof nudges.$inferSelect;
export type DoctorQuestion = typeof doctorQuestions.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type MealPlanCell = typeof mealPlan.$inferSelect;
export type GroceryItem = typeof groceryItems.$inferSelect;
export type PackingItem = typeof packingItems.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type ExerciseIdea = typeof exerciseIdeas.$inferSelect;

/* ========================== THE DAILY COACH (n8n) ==========================
 *
 * A scheduler outside the app (n8n) asks Steady for a check-in and delivers it. The division of
 * labour is the invariants, not convenience:
 *
 *   n8n owns   the clock and the transport. It knows when 8:00 AM is and how to reach Telegram.
 *   Steady owns the data, the engines, the safety triage, the model call, the dose filter and the
 *              audit row. n8n never calls a model and never computes a number.
 *
 * So a coach message is an ordinary audited Copilot response that happened to be triggered by a
 * cron instead of a tap. `coach_messages` records what was generated and whether it went out;
 * `coach_events` records every request that hit the API, because these routes are the only part
 * of Steady reachable from outside the machine.
 */

export const COACH_KINDS = ["morning", "weekly"] as const;
export type CoachKind = (typeof COACH_KINDS)[number];

/** What the person tapped on the delivered message. `day` and `appointment_brief` never call a model. */
export const COACH_ACTIONS = ["talk", "day", "encourage", "appointment_brief"] as const;
export type CoachAction = (typeof COACH_ACTIONS)[number];

export const COACH_CHANNELS = ["telegram", "inapp"] as const;
export type CoachChannel = (typeof COACH_CHANNELS)[number];

/**
 * One generated check-in. The unique index on (kind, date) is the whole duplicate defence: a cron
 * that fires twice, a retried HTTP request and a manual test on the same day all collapse onto the
 * same row, and the second caller is handed the first message rather than a new one.
 */
export const coachMessages = sqliteTable(
  "coach_messages",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: COACH_KINDS }).notNull(),
    /** Local day for morning, local week-start day for weekly. "YYYY-MM-DD". */
    date: text("date").notNull(),
    /** The delivered text. Numbers inside it came from the engines. */
    body: text("body").notNull(),
    /** JSON: the engine-computed facts the message was written from, so it can be checked later. */
    facts: text("facts").notNull(),
    /** The safety engine's verdict at generation time. Rendered above the body, from fixed text. */
    triageLevel: text("triage_level", { enum: TRIAGE_LEVELS }).notNull(),
    responder: text("responder", { enum: ["model", "engine"] }).notNull(),
    model: text("model"),
    filtered: bool("filtered").notNull().default(false),
    /** The conversation a reply to this message continues. */
    conversationId: text("conversation_id"),
    createdAt: ts("created_at").notNull(),
    /** Set when a transport confirmed it went out. Null means generated but never delivered. */
    deliveredAt: ts("delivered_at"),
    channel: text("channel", { enum: COACH_CHANNELS }),
    readAt: ts("read_at"),
  },
  (t) => [uniqueIndex("coach_kind_date_uq").on(t.kind, t.date), index("coach_created_idx").on(t.createdAt)],
);

/**
 * Every request to /api/coach/*, including the ones that were turned away. No health data goes in
 * here: the point is to be able to see who has been knocking.
 */
export const coachEvents = sqliteTable(
  "coach_events",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    route: text("route").notNull(),
    /** "ok" | "unauthorized" | "forbidden_chat" | "rate_limited" | "not_configured" | "bad_request" | "error" */
    outcome: text("outcome").notNull(),
    /** Short, non-clinical. A reason or an error class, never the person's words or numbers. */
    detail: text("detail"),
    ip: text("ip"),
  },
  (t) => [index("coach_event_at_idx").on(t.at)],
);

export type CoachMessage = typeof coachMessages.$inferSelect;
export type CoachEvent = typeof coachEvents.$inferSelect;

/* ========================= THE CARBOHYDRATE REFERENCE ========================= */

/**
 * A searchable food and plate reference, so "how many carbs is this" has an answer that is not a
 * guess. Three rules it is built on:
 *
 * 1. EVERYTHING IS PER 100 GRAMS. One canonical basis, and portions are a multiplier on top, so a
 *    portion can never disagree with the nutrition. This is the same decision as storing glucose
 *    only in mg/dL, for the same reason.
 * 2. EVERY NUMBER NAMES ITS SOURCE. `source` is shown next to the figure. A reference value from a
 *    national food database and a number a model guessed from a photo are not the same kind of
 *    thing, and the app must never present them as if they were.
 * 3. A LOOKED-UP NUMBER IS STILL AN ESTIMATE OF WHAT IS ON YOUR PLATE. The database knows what
 *    100 g of cooked rice contains. It does not know how much rice is in your bowl. The screen says
 *    so, and the person can correct any figure before it is logged.
 */
export const FOOD_SOURCES = [
  "USDA FoodData Central (SR Legacy)",
  "USDA FoodData Central (Survey FNDDS)",
  "Manufacturer label",
  /**
   * A figure a restaurant published about its own menu item, with the restaurant in `brand` and the
   * day it was read in `sourceDate`.
   *
   * Kept separate from the USDA sources for a reason that matters at the plate. A government
   * reference figure for cooked rice is stable for years. A chain reformulates a sandwich, changes a
   * supplier or resizes a portion whenever it likes, and the old number stays true-looking. So a
   * restaurant figure carries a date and the app says how old it is.
   */
  "Restaurant published data",
  "You",
] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const foods = sqliteTable(
  "foods",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category").notNull().default("other"),
    /** Per 100 g as eaten. The only basis in the table. */
    carbsG: real("carbs_g").notNull(),
    proteinG: real("protein_g").notNull().default(0),
    fatG: real("fat_g").notNull().default(0),
    fiberG: real("fiber_g").notNull().default(0),
    caloriesKcal: real("calories_kcal").notNull().default(0),
    /** Lowercase comma-separated search terms, including Spanish names. */
    aliases: text("aliases").notNull().default(""),
    source: text("source", { enum: FOOD_SOURCES }).notNull(),
    /**
     * When the figure was read from that source, "YYYY-MM-DD". Null for the USDA references, whose
     * release is the version and which do not drift.
     *
     * It exists for restaurant data. A chain's published carbohydrate figure is accurate on the day
     * it is read and can be wrong a year later with nothing to show it changed, and somebody doses
     * against these numbers. An undated figure invites more trust than it has earned.
     */
    sourceDate: text("source_date"),
    aisle: text("aisle", { enum: GROCERY_AISLES }).notNull().default("other"),
    note: text("note").notNull().default(""),
    /** A food the person added themselves, which they can edit and delete. */
    custom: bool("custom").notNull().default(false),
    /** How many times they have logged it, for ranking their own foods first. */
    timesUsed: integer("times_used").notNull().default(0),
    lastUsedAt: ts("last_used_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("foods_name_idx").on(t.name), index("foods_used_idx").on(t.timesUsed)],
);

/** Portions people actually serve. `grams` is what multiplies the per-100g figures. */
export const foodPortions = sqliteTable(
  "food_portions",
  {
    id: text("id").primaryKey(),
    foodId: text("food_id").notNull(),
    label: text("label").notNull(),
    grams: real("grams").notNull(),
    sort: integer("sort").notNull().default(0),
    custom: bool("custom").notNull().default(false),
  },
  (t) => [index("food_portions_food_idx").on(t.foodId)],
);

/**
 * The components of a logged meal, one row per food. This is what makes the reference worth having:
 * once a plate is built from foods, the app can go back and say what YOUR readings did after that
 * exact food, which no general nutrition database can tell you.
 */
export const mealItems = sqliteTable(
  "meal_items",
  {
    id: text("id").primaryKey(),
    mealId: text("meal_id").notNull(),
    foodId: text("food_id"),
    /** Denormalised so a deleted food never blanks a historical meal. */
    name: text("name").notNull(),
    portionLabel: text("portion_label").notNull().default(""),
    grams: real("grams").notNull(),
    carbsG: real("carbs_g").notNull(),
    proteinG: real("protein_g").notNull().default(0),
    fatG: real("fat_g").notNull().default(0),
    fiberG: real("fiber_g").notNull().default(0),
    caloriesKcal: real("calories_kcal").notNull().default(0),
    /** Whether these numbers came from the reference, a photo estimate, or the person. */
    basis: text("basis", { enum: ["reference", "photo", "manual"] }).notNull().default("reference"),
  },
  (t) => [index("meal_items_meal_idx").on(t.mealId), index("meal_items_food_idx").on(t.foodId)],
);

export type Food = typeof foods.$inferSelect;
export type FoodPortion = typeof foodPortions.$inferSelect;
export type MealItem = typeof mealItems.$inferSelect;

/* ============================ THE JOURNEY ============================
 *
 * The progress ledger. One row per thing earned, and nothing else: there is no stored XP total, no
 * level column, no balance. Totals are summed from this table every time they are shown.
 *
 * That is deliberate and it is what makes the whole feature safe. A stored total is a number that
 * can drift, be double-counted by a retry, or be silently decremented by a future bug; a ledger can
 * only be wrong in a way you can read line by line and explain to the person. `key` is unique, so
 * running the engine twice over the same fortnight cannot award the same thing twice however many
 * times the page is opened.
 *
 * Nothing in this table is ever deleted and no row ever holds a negative. Progress in Steady does
 * not go backwards, because a difficult week is not a failure and glucose is not a score.
 */
export const journeyAwards = sqliteTable(
  "journey_awards",
  {
    id: text("id").primaryKey(),
    /** Unique, and the whole idempotency mechanism. E.g. "log:2026-09-12", "trend_tir:2026-09-07". */
    key: text("key").notNull(),
    /** The engine rule that produced it, for grouping on screen. */
    code: text("code").notNull(),
    kind: text("kind", { enum: AWARD_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** The engine's own numbers at the moment of awarding. The model may never rewrite this. */
    evidence: text("evidence").notNull(),
    xp: integer("xp").notNull().default(0),
    gems: integer("gems").notNull().default(0),
    /** The moment the award belongs to, which is usually earlier than when it was written. */
    earnedAt: ts("earned_at").notNull(),
    createdAt: ts("created_at").notNull(),
    /** Null until it has been celebrated on screen once. */
    seenAt: ts("seen_at"),

    /*
     * PROVENANCE. Without these columns a reward is a number somebody has to take on trust.
     *
     * With them, any row in this table answers: which version of the arithmetic produced it, which
     * version of the thresholds approved it, over which window, against which comparison window,
     * from how many records, and how good that data was. A threshold changed next year does not
     * rewrite what happened this year, because what happened this year is stamped with the rules
     * that were in force when it happened.
     */
    engineVersion: text("engine_version").notNull().default("0"),
    ruleVersion: text("rule_version").notNull().default("0"),
    metricVersion: text("metric_version").notNull().default("0"),
    /** Records the calculation actually consumed. */
    sampleSize: integer("sample_size").notNull().default(0),
    windowFrom: ts("window_from"),
    windowTo: ts("window_to"),
    /** The earlier window a trend was measured against. Null for a habit award, which has none. */
    compareFrom: ts("compare_from"),
    compareTo: ts("compare_to"),
    dataQuality: text("data_quality", { enum: ["high", "moderate", "low", "insufficient"] }).notNull().default("high"),
  },
  (t) => [uniqueIndex("journey_award_key_uq").on(t.key), index("journey_award_earned_idx").on(t.earnedAt)],
);

export type JourneyAward = typeof journeyAwards.$inferSelect;

/**
 * This week's quests. Written once per ISO week from the engine's templates and then only ever
 * marked complete, so the wording a person was shown on Monday is the wording they still see on
 * Sunday even if the templates change under them in a deploy.
 *
 * `verifiedBy` is the honest part: `engine` means the logs prove it, `person` means they tapped to
 * say so. Five quiet minutes cannot be verified by a database and pretending otherwise would mean
 * only offering quests a database can see, which is the wrong set of quests.
 */
export const journeyQuests = sqliteTable(
  "journey_quests",
  {
    id: text("id").primaryKey(),
    /** "<code>:<weekKey>". */
    key: text("key").notNull(),
    weekKey: text("week_key").notNull(),
    code: text("code").notNull(),
    slot: integer("slot").notNull().default(0),
    adventure: text("adventure").notNull(),
    title: text("title").notNull(),
    ask: text("ask").notNull(),
    why: text("why").notNull(),
    xp: integer("xp").notNull().default(0),
    kind: text("kind", { enum: ["auto", "manual"] }).notNull(),
    dimension: text("dimension").notNull(),
    completedAt: ts("completed_at"),
    verifiedBy: text("verified_by", { enum: ["engine", "person"] }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("journey_quest_key_uq").on(t.key), index("journey_quest_week_idx").on(t.weekKey)],
);

/** The Explorer Journal: things the person saw out in the world and wanted to keep. */
export const discoveries = sqliteTable(
  "discoveries",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    place: text("place").notNull().default(""),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("discovery_at_idx").on(t.at)],
);

/**
 * The player's own state, as distinct from their health record. One row, id = 1.
 *
 * Kept in its own table rather than on `profile` on purpose: the game must be removable. Everything
 * the game knows lives in these three tables, so turning Life Quest off is dropping them, and not a
 * migration that touches a single column of clinical data.
 */
export const playerState = sqliteTable("player_state", {
  id: integer("id").primaryKey(), // always 1
  /**
   * Which world they are building. It changes the palette, the terrain and what the regions are
   * called, and it changes nothing about what anything is worth: the rules are identical in every
   * theme, so this can be switched at any time without gaining or losing a single point.
   */
  worldTheme: text("world_theme", { enum: ["forest", "coast", "city"] }).notNull().default("forest"),
  /**
   * The highest region level whose unlock ceremony has been shown. Stored rather than derived,
   * because a ceremony is a one-time moment and deriving it from the level would replay it on
   * every page load forever. Zero means nothing has been shown, which is correct for a new
   * player and for somebody whose whole history was backfilled: they get the ceremony for the
   * region they are actually standing in, once, and not one for every level they passed through.
   */
  /**
   * Who they chose to be here. It changes which quests come up and the order the identities are
   * read in, and nothing about what anything is worth. Empty until they pick, which is not the
   * same as the default: an unanswered question must not look like an answer.
   */
  archetype: text("archetype").notNull().default(""),
  regionSeenLevel: integer("region_seen_level").notNull().default(0),
  /** The last morning the greeting was shown, "YYYY-MM-DD". One a day, never twice. */
  morningSeenDate: text("morning_seen_date").notNull().default(""),
  /** While set and in the future, the world is in Rest Mode: quiet, no asks, nothing expiring. */
  restUntil: ts("rest_until"),
  /** The last time they opened the game, used only to greet somebody returning after a while. */
  lastVisitAt: ts("last_visit_at"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * THE WORLD'S MEMORY.
 *
 * Append-only and never rewritten: what happened in somebody's world is history, and history is
 * not a mutable field. `key` is date-anchored and unique, so the same day cannot produce the same
 * event twice however many times the page is opened, and a retry is free.
 *
 * What the drawing shows is derived from these rows rather than stored beside them, for the same
 * reason the XP total is derived from the award ledger: a stored count can drift out of step with
 * the thing it counts, and then the picture is telling a different story from the record.
 */
export const worldEvents = sqliteTable(
  "world_events",
  {
    id: text("id").primaryKey(),
    /** Date or week anchored, e.g. "sighting:2026-09-12". Unique, and the idempotency mechanism. */
    key: text("key").notNull(),
    kind: text("kind", { enum: WORLD_EVENT_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** The moment it belongs to. */
    at: ts("at").notNull(),
    createdAt: ts("created_at").notNull(),
    /** Null until it has appeared in What's New once. */
    seenAt: ts("seen_at"),
    engineVersion: text("engine_version").notNull().default("0"),
  },
  (t) => [uniqueIndex("world_event_key_uq").on(t.key), index("world_event_at_idx").on(t.at)],
);

export type WorldEvent = typeof worldEvents.$inferSelect;

/**
 * Rounds of Guess the Carbs.
 *
 * The reference figure is DENORMALISED onto the row on purpose, exactly as `meal_items` does it.
 * A food edited or deleted next month must not silently rewrite what somebody was shown in
 * September, because the whole value of looking back at these is seeing what you thought at the
 * time against what you were told at the time.
 *
 * There is no score column and there will not be one. What is stored is what was asked, what was
 * guessed and what the reference said; anything resembling a running accuracy would turn a
 * learning tool into one more thing to be bad at.
 */
export const carbGuesses = sqliteTable(
  "carb_guesses",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    /** "YYYY-MM-DD:n", which is also the round's seed. Unique, so a round is answered once. */
    roundKey: text("round_key").notNull(),
    foodId: text("food_id"),
    foodName: text("food_name").notNull(),
    portionLabel: text("portion_label").notNull(),
    grams: real("grams").notNull(),
    /** What the reference said at the time, for that exact weight. */
    referenceCarbsG: real("reference_carbs_g").notNull(),
    guessG: real("guess_g").notNull(),
    /** Where the figure came from, kept so an old round can still explain itself. */
    source: text("source").notNull().default(""),
    engineVersion: text("engine_version").notNull().default("0"),
  },
  (t) => [uniqueIndex("carb_guess_round_uq").on(t.roundKey), index("carb_guess_at_idx").on(t.at)],
);

export type CarbGuess = typeof carbGuesses.$inferSelect;

export type JourneyQuest = typeof journeyQuests.$inferSelect;
export type Discovery = typeof discoveries.$inferSelect;
export type PlayerState = typeof playerState.$inferSelect;

/* ============================ SECRETS ============================
 *
 * Credentials the person pastes in rather than putting in a .env file. One row per name.
 *
 * Two rules about this table, and both matter:
 *
 *  1. IT IS NEVER EXPORTED. `/settings/data/export` dumps every other table by design, because the
 *     point of that screen is that the data is yours and you can take all of it. A key is not data
 *     about your health, it is a credential, and a credential in a downloads folder is a leak.
 *  2. IT IS NEVER SENT BACK TO A SCREEN. The settings page renders a masked hint built on the
 *     server ("sk-ant-...4f2a") and the last-saved date. The value itself leaves this table only to
 *     be handed to the Anthropic SDK.
 *
 * It is stored in plain text in the same SQLite file as everything else. For a single-person app
 * that runs on your own machine that is the same trust boundary as the health data itself, and
 * pretending otherwise with a homemade cipher whose key sits beside it would be theatre.
 */
export const appSecrets = sqliteTable("app_secrets", {
  /** Stable name, e.g. "anthropic_api_key". */
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type AppSecret = typeof appSecrets.$inferSelect;
