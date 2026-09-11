"use server";
/**
 * Server actions for /move. Movement is recorded, never prescribed: nothing here reads a glucose
 * value or writes anything other than the session the person says they did.
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, exerciseIdeas, exerciseSessions, EXERCISE_INTENSITIES } from "@/lib/db";
import { requireAccount } from "@/lib/auth/session";
import { parseForm, zStr } from "@/lib/actions";
import { newId } from "@/lib/ids";

const zId = z.string().trim().min(1).max(64);
const zIntensity = z.enum(EXERCISE_INTENSITIES);
const zMinutes = z.coerce.number().int().min(1).max(600);

function back(error?: string): never {
  redirect(error ? `/move?error=${encodeURIComponent(error)}` : "/move");
}

/** "I did this" on an idea card: kind, minutes and intensity all come from the idea itself. */
export async function logIdeaSession(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ ideaId: zId, tag: zStr(40).optional() }), fd);
  if ("error" in p) back("That did not save. Try again.");

  const rows = await db.select().from(exerciseIdeas).where(eq(exerciseIdeas.id, p.data.ideaId)).limit(1);
  const idea = rows[0];
  if (!idea) back("That idea is no longer in your list.");

  const now = new Date();
  await db.insert(exerciseSessions).values({
    id: newId(),
    at: now,
    kind: idea.kind,
    minutes: idea.minutes,
    intensity: idea.intensity,
    ideaId: idea.id,
    createdAt: now,
  });

  revalidatePath("/move");
  revalidatePath("/");
  const tag = (p.data.tag ?? "").trim();
  redirect(tag ? `/move?tag=${encodeURIComponent(tag)}` : "/move");
  });
}

/** Something that is not in the list. */
export async function logCustomSession(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(
    z.object({ kind: zStr(60), minutes: zMinutes, intensity: zIntensity, note: zStr(300).optional() }),
    fd,
  );
  if ("error" in p) back("That did not save. Check the minutes, then try again.");
  const kind = p.data.kind.trim();
  if (!kind) back("Say what you did, even roughly.");

  const now = new Date();
  await db.insert(exerciseSessions).values({
    id: newId(),
    at: now,
    kind,
    minutes: p.data.minutes,
    intensity: p.data.intensity,
    note: (p.data.note ?? "").trim() || null,
    createdAt: now,
  });

  revalidatePath("/move");
  revalidatePath("/");
  redirect("/move");
  });
}

export async function deleteSession(fd: FormData): Promise<void> {
  return requireAccount(async () => {
  const p = parseForm(z.object({ id: zId }), fd);
  if ("error" in p) back("That did not delete. Try again.");
  await db.delete(exerciseSessions).where(eq(exerciseSessions.id, p.data.id));
  revalidatePath("/move");
  revalidatePath("/");
  redirect("/move");
  });
}
