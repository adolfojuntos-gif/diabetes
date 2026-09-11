"use server";
/**
 * Copilot server actions.
 *
 * The safety contract (triage → context → model or engine → filter → persist → audit) lives in
 * `src/lib/data/copilotTurn.ts` so that the Daily Coach's reply endpoint runs the identical
 * sequence instead of a second copy of it. These actions are the screen's way in: parse the form,
 * call the turn, revalidate, redirect.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  conversations,
  messages as messagesTable,
  symptomLogs,
  wellbeingCheckins,
  memoryFacts,
  COPILOT_MODES,
  SYMPTOMS,
  type CopilotMode,
  type Symptom,
} from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import type { TriageInput, TriageResult } from "@/lib/engines/triage";
import { loadTriage, runCopilotTurn, type SymptomFlow } from "@/lib/data/copilotTurn";
import { upsertMemory } from "@/lib/data/memory";
import { addDays, dateKey } from "@/lib/time";
import { fail, done, type ActionResult } from "@/lib/actions";

export type { SymptomFlow };

/** Run the deterministic safety engine. Screens call this with `{}` for a baseline over the data alone. */
export async function runTriage(opts: {
  freeText?: string;
  symptoms?: Symptom[];
  severity?: 1 | 2 | 3;
  flags?: TriageInput["flags"];
}): Promise<TriageResult> {
  return requireAccount(async () => {
  return loadTriage(opts);
  });
}

/** The single path every Copilot turn takes. Thin wrapper: parse, run, revalidate. */
/**
 * These actions feed the SAFETY ENGINE, so they are the last place in the app that should trust a
 * form. They did: `mode`, `ketones` and `flow` were cast to their types with no check, so arbitrary
 * text reached `conversations.mode` and the triage rules, and `Number("x")` produced NaN that went
 * straight into a not-null integer column. Everything below is parsed now.
 */
const zMode = z.enum(COPILOT_MODES);
const zBody = z.string().trim().min(1, "Write something first.").max(4000, "That is longer than the Copilot can take in one go. Try splitting it up.");
const zConversationId = z.string().trim().min(6).max(40);
const zSeverity = z.coerce.number().int().min(1).max(3);
const zSinceDays = z.coerce.number().int().min(0).max(3650);
const zKetones = z.enum(["none", "trace_small", "moderate_large", "unknown"]);
const zSymptoms = z.array(z.enum(SYMPTOMS)).max(SYMPTOMS.length);
const zScale = z.coerce.number().int().min(1).max(5);
const zFlow = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  symptoms: zSymptoms.optional(),
  severity: zSeverity.optional(),
  sinceDays: zSinceDays.optional(),
  ketones: zKetones.optional(),
  lowNotResponding: z.boolean().optional(),
});

export async function send(fd: FormData): Promise<ActionResult> {
  return requireAccount(async () => {
  const bodyParsed = zBody.safeParse(String(fd.get("body") ?? ""));
  if (!bodyParsed.success) return fail(bodyParsed.error.issues[0].message);
  const body = bodyParsed.data;

  const modeParsed = zMode.safeParse(String(fd.get("mode") ?? "talk"));
  const mode: CopilotMode = modeParsed.success ? modeParsed.data : "talk";

  const rawConv = fd.get("conversationId");
  const convParsed = rawConv ? zConversationId.safeParse(String(rawConv)) : null;
  const convIdIn = convParsed?.success ? convParsed.data : null;

  /**
   * The flow state is the last unvalidated path into the safety engine. It used to be
   * `JSON.parse(...) as SymptomFlow`, which is a cast, not a check: an unbounded string from a form
   * became the object the triage rules read. It is parsed against a schema now, and anything that
   * does not fit is dropped rather than half-trusted.
   */
  const flowRaw = fd.get("flow") ? String(fd.get("flow")).slice(0, 4000) : null;
  let flow: SymptomFlow | null = null;
  if (flowRaw) {
    try {
      const parsed = zFlow.safeParse(JSON.parse(flowRaw));
      flow = parsed.success ? (parsed.data as SymptomFlow) : null;
    } catch {
      flow = null;
    }
  }

  const turn = await runCopilotTurn({ body, mode, conversationId: convIdIn, flow, origin: "app" });

  revalidatePath("/copilot");
  revalidatePath(`/copilot/${turn.conversationId}`);
  return done(turn.conversationId);
  });
}

export async function sendAndGo(fd: FormData) {
  return requireAccount(async () => {
  const r = await send(fd);
  if (r.ok && r.id) redirect(`/copilot/${r.id}`);
  redirect(`/copilot?error=${encodeURIComponent(r.ok ? "unknown" : r.error)}`);
  });
}

export async function startConversation(fd: FormData) {
  return requireAccount(async () => {
  return sendAndGo(fd);
  });
}

/** Symptom encounter: record the structured answers, run triage, and log a symptom row. */
export async function submitSymptomStep(fd: FormData): Promise<ActionResult> {
  return requireAccount(async () => {
  const rawConv = fd.get("conversationId");
  const convParsed = rawConv ? zConversationId.safeParse(String(rawConv)) : null;
  const conversationId = convParsed?.success ? convParsed.data : "";

  // Unknown symptom keys are dropped rather than passed to the rule table as strings it cannot mean.
  const symptoms = zSymptoms.safeParse(fd.getAll("symptoms[]").map(String).filter(Boolean));
  const picked: Symptom[] = symptoms.success
    ? symptoms.data
    : (fd.getAll("symptoms[]").map(String).filter((s) => (SYMPTOMS as readonly string[]).includes(s)) as Symptom[]);

  const sevParsed = zSeverity.safeParse(fd.get("severity") ?? 2);
  const severity = (sevParsed.success ? sevParsed.data : 2) as 1 | 2 | 3;

  const daysParsed = zSinceDays.safeParse(fd.get("sinceDays") ?? 0);
  const sinceDays = daysParsed.success ? daysParsed.data : 0;

  const ketParsed = zKetones.safeParse(String(fd.get("ketones") ?? "unknown"));
  const ketones = ketParsed.success ? ketParsed.data : "unknown";

  const lowNotResponding = fd.get("lowNotResponding") === "on";
  const note = String(fd.get("note") ?? "").trim().slice(0, 1000);
  if (picked.length === 0 && !note) return fail("Pick at least one symptom, or describe it in your own words.");

  const now = new Date();
  await db.insert(symptomLogs).values({ id: newId(), at: now, symptoms: picked.join(","), severity, note: note || null, createdAt: now });

  const flow: SymptomFlow = { step: 5, symptoms: picked, severity, sinceDays, ketones, lowNotResponding };
  const describe = [
    picked.length ? `I'm experiencing: ${picked.join(", ")}.` : "",
    note,
    sinceDays > 0 ? `It started about ${sinceDays} day${sinceDays === 1 ? "" : "s"} ago.` : "It started today.",
    `Severity ${severity} of 3.`,
    ketones !== "unknown" ? `Ketones: ${ketones.replace("_", " or ")}.` : "",
    lowNotResponding ? "A low has not come up after two treatments." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const forward = new FormData();
  forward.set("body", describe);
  forward.set("mode", "symptoms");
  forward.set("flow", JSON.stringify(flow));
  if (conversationId) forward.set("conversationId", conversationId);
  const r = await send(forward);
  revalidatePath("/log/more");
  revalidatePath("/");
  return r;
  });
}

export async function submitSymptomStepAndGo(fd: FormData) {
  return requireAccount(async () => {
  const r = await submitSymptomStep(fd);
  if (r.ok && r.id) redirect(`/copilot/${r.id}`);
  redirect(`/copilot/symptoms?error=${encodeURIComponent(r.ok ? "unknown" : r.error)}`);
  });
}

/** Daily check-in: stores the answers, then asks the Copilot to respond to them. */
export async function submitCheckin(fd: FormData) {
  return requireAccount(async () => {
  const feelingParsed = zScale.safeParse(fd.get("feeling") ?? 3);
  const feeling = feelingParsed.success ? feelingParsed.data : 3;
  const energyParsed = fd.get("energy") ? zScale.safeParse(fd.get("energy")) : null;
  const energy = energyParsed?.success ? energyParsed.data : null;
  const stressParsed = fd.get("stress") ? zScale.safeParse(fd.get("stress")) : null;
  const stress = stressParsed?.success ? stressParsed.data : null;
  const unusual = String(fd.get("unusual") ?? "").trim() || null;
  const wantToDiscuss = String(fd.get("wantToDiscuss") ?? "").trim() || null;
  const now = new Date();
  const date = dateKey(now);
  const existing = await db.select().from(wellbeingCheckins).where(eq(wellbeingCheckins.date, date)).limit(1);
  if (existing[0]) {
    await db.update(wellbeingCheckins).set({ feeling, energy, stress, unusual, wantToDiscuss }).where(eq(wellbeingCheckins.id, existing[0].id));
  } else {
    await db.insert(wellbeingCheckins).values({ id: newId(), date, feeling, energy, stress, unusual, wantToDiscuss, createdAt: now });
  }
  revalidatePath("/");
  revalidatePath("/copilot/checkin");

  const body = [
    `Today I'm feeling ${feeling} out of 5.`,
    energy ? `Energy ${energy}/5.` : "",
    stress ? `Stress ${stress}/5.` : "",
    unusual ? `Something I noticed: ${unusual}` : "",
    wantToDiscuss ? `I want to talk about: ${wantToDiscuss}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const forward = new FormData();
  forward.set("body", body);
  forward.set("mode", "checkin");
  const r = await send(forward);
  if (r.ok && r.id) redirect(`/copilot/${r.id}`);
  redirect("/copilot/checkin?saved=1");
  });
}

export async function confirmMemoryFromReply(fd: FormData) {
  return requireAccount(async () => {
  const text = String(fd.get("text") ?? "").trim();
  if (!text) return;
  await upsertMemory("confirmed_observation", text.toLowerCase().slice(0, 60), text.slice(0, 300), "user", null, new Date());
  revalidatePath("/toolkit/memory");
  });
}

export async function deleteConversation(fd: FormData) {
  return requireAccount(async () => {
  const parsed = zConversationId.safeParse(String(fd.get("id") ?? ""));
  if (!parsed.success) return;
  const id = parsed.data;
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  revalidatePath("/copilot");
  redirect("/copilot");
  });
}

/** Appointment prep and lab modes start a conversation with a mode-specific opener. */
export async function startMode(fd: FormData) {
  return requireAccount(async () => {
  const parsedMode = zMode.safeParse(String(fd.get("mode") ?? "talk"));
  const mode: CopilotMode = parsedMode.success ? parsedMode.data : "talk";
  const openers: Record<CopilotMode, string> = {
    talk: "I want to talk something through.",
    symptoms: "I want to check some symptoms.",
    labs: "I have lab results I would like explained.",
    appointment: "I have an appointment coming up and want to prepare for it.",
    checkin: "Here is my check-in for today.",
  };
  const forward = new FormData();
  forward.set("body", openers[mode] ?? openers.talk);
  forward.set("mode", mode);
  const r = await send(forward);
  if (r.ok && r.id) redirect(`/copilot/${r.id}`);
  redirect("/copilot");
  });
}

export async function recentMemoryMatches(limit = 3) {
  return requireAccount(async () => {
  return db.select().from(memoryFacts).where(eq(memoryFacts.kind, "pattern")).orderBy(desc(memoryFacts.lastSeen)).limit(limit);
  });
}

export async function symptomsLast(days = 7) {
  return requireAccount(async () => {
  return db.select().from(symptomLogs).where(and(gte(symptomLogs.at, addDays(new Date(), -days)))).orderBy(desc(symptomLogs.at));
  });
}
